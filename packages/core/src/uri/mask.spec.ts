import { describe, expect, it } from 'vitest';

import { MASK, mask, maskText, parseConnectionString, toConnectionString } from './index';
import { URI_CASES } from './fixtures';

/** Every form a secret may take in a URI: decoded, percent-encoded, form-encoded. */
function forms(secret: string): string[] {
  return [
    secret,
    encodeURIComponent(secret),
    encodeURIComponent(secret).replace(/%20/g, '+'),
    encodeURI(secret),
  ];
}

function expectNoLeak(masked: string, secrets: string[]): void {
  for (const secret of secrets) {
    for (const form of forms(secret)) expect(masked, `leaks ${secret}`).not.toContain(form);
  }
}

describe('mask', () => {
  const withSecrets = URI_CASES.filter((c) => c.secrets !== undefined);

  it('has test URIs with secrets in the user info and in options', () => {
    expect(withSecrets.length).toBeGreaterThanOrEqual(10);
  });

  it.each(URI_CASES)('never leaks a secret: $name', ({ uri, secrets = [] }) => {
    const masked = mask(uri);
    expectNoLeak(masked, secrets);
    // Also after a round trip through the model (the "copy connection string" view).
    expectNoLeak(mask(toConnectionString(parseConnectionString(uri))), secrets);
    expectNoLeak(maskText(`connect ${uri} failed`), secrets);
    if (secrets.length > 0) expect(masked).toContain(MASK);
  });

  it.each(URI_CASES)('leaves a URI without secrets usable: $name', ({ uri, secrets }) => {
    if (secrets !== undefined) return;
    expect(mask(uri)).toBe(uri);
  });

  it('keeps the user name and hosts visible', () => {
    expect(mask('mongodb://alice:s3cret@h1:27017,h2/admin?replicaSet=rs')).toBe(
      `mongodb://alice:${MASK}@h1:27017,h2/admin?replicaSet=rs`,
    );
    expect(mask('mongodb+srv://bob:pw@cluster.example.net')).toBe(
      `mongodb+srv://bob:${MASK}@cluster.example.net`,
    );
  });

  it('masks option secrets case-insensitively, also with encoded keys', () => {
    expect(
      mask(
        'mongodb://h/?PROXYPASSWORD=pp1Secret&tlscertificatekeyfilepassword=kp2Secret&proxy%50assword=pp3Secret',
      ),
    ).toBe(
      `mongodb://h/?PROXYPASSWORD=${MASK}&tlscertificatekeyfilepassword=${MASK}&proxy%50assword=${MASK}`,
    );
  });

  it('masks only the AWS session token in authMechanismProperties', () => {
    const masked = mask(
      'mongodb://h/?authMechanismProperties=AWS_SESSION_TOKEN:tok123Secret,SERVICE_NAME:mongodb',
    );
    expect(masked).not.toContain('tok123Secret');
    expect(decodeURIComponent(masked)).toContain(`AWS_SESSION_TOKEN:${MASK},SERVICE_NAME:mongodb`);
    expect(mask('mongodb://h/?authMechanismProperties=aws_session_token%3AencTok9')).not.toContain(
      'encTok9',
    );
  });

  it('masks invalid connection strings, erring on the side of hiding more', () => {
    const cases: [string, string][] = [
      ['mongodb://u:pa/ss1Secret@host', 'pa/ss1Secret'],
      ['mongodb://u:pa?ss2Secret@host/db', 'pa?ss2Secret'],
      ['mongodb://u:pa#ss3Secret@host', 'pa#ss3Secret'],
      ['mongodb+srv://u:srv4Secret@host:27017', 'srv4Secret'],
      ['mongodb://u:pa%ZZ5Secret@host', 'pa%ZZ5Secret'],
      ['mongodb://u:pass6Secret@', 'pass6Secret'],
      ['mongodb://u:p@ssw0rd11Secret@localhost', 'ssw0rd11Secret'],
      ['MONGODB://u:upper7Secret@host', 'upper7Secret'],
      ['mongodb://h/?proxyPassword=bad%ZZ8Secret&x', 'bad%ZZ8Secret'],
      ['mongodb://h/?prox%ZZy=bad9Secret', 'bad9Secret'],
      ['mongodb://h/?authMechanismProperties=AWS_SESSION_TOKEN:%ZZ10Secret', '10Secret'],
    ];
    for (const [uri, secret] of cases) {
      const masked = mask(uri);
      expect(masked, uri).not.toContain(secret);
      expect(masked, uri).toContain(MASK);
    }
  });

  it('does not over-mask a valid URI with an encoded @ in an option value', () => {
    const uri = 'mongodb://host:27017/?appName=me%40example';
    expect(mask(uri)).toBe(uri);
  });

  it('treats an unencoded @ after the hosts as the end of credentials, like the driver', () => {
    // The driver reads "host" as user and "27017/?appName=me" as password here.
    expect(mask('mongodb://host:27017/?appName=me@example')).toBe(`mongodb://host:${MASK}@example`);
    // A secret option before that '@' must not stay visible as the "user name".
    expect(mask('mongodb://h/?proxyPassword=ppSecret","mongodb://b:pw@h2')).toBe(
      `mongodb://h:${MASK}@h2`,
    );
  });

  it('returns other strings unchanged', () => {
    expect(mask('not a uri: user:pw@host')).toBe('not a uri: user:pw@host');
    expect(mask('')).toBe('');
  });
});

describe('maskText', () => {
  it('masks every connection string inside a log line', () => {
    const text =
      'failed "mongodb://a:aaSecret1@h1" then mongodb+srv://b:bbSecret2@c.example.net/?tls=true, giving up';
    const masked = maskText(text);
    expect(masked).toBe(
      `failed "mongodb://a:${MASK}@h1" then mongodb+srv://b:${MASK}@c.example.net/?tls=true, giving up`,
    );
  });

  it('leaves text without connection strings unchanged', () => {
    expect(maskText('nothing to see: password=x')).toBe('nothing to see: password=x');
  });

  it('masks passwords with unencoded quotes, "<", ">" and backticks', () => {
    for (const secret of ["ab'cdSecret", 'ab"cdSecret', 'a<b>cSecret', 'ab`cdSecret']) {
      for (const text of [
        `connect mongodb://u:${secret}@host.example.com failed`,
        `connect 'mongodb://u:${secret}@host.example.com' failed`,
        `connect "mongodb://u:${secret}@h/db?tls=true" failed`,
      ]) {
        expectNoLeak(maskText(text), [secret]);
      }
    }
    expect(maskText("x 'mongodb://u:ab'cdSecret@h' y")).toBe(`x 'mongodb://u:${MASK}@h' y`);
  });

  it('masks several connection strings not separated by whitespace', () => {
    expect(maskText('"mongodb://a@h1","mongodb://b:joinedSecret@h2/db"')).toBe(
      `"mongodb://a@h1","mongodb://b:${MASK}@h2/db"`,
    );
  });

  it('masks connection strings with an upper-case scheme and followed by punctuation', () => {
    expect(maskText('see MONGODB://u:upTxtSecret@h, and mongodb://v:pw2Secret@h2.')).toBe(
      `see MONGODB://u:${MASK}@h, and mongodb://v:${MASK}@h2.`,
    );
  });

  // CR-5: the driver accepts a raw space or tab in the password.
  it('masks passwords containing a raw space or tab', () => {
    for (const secret of ['my spaceSecret', 'my\ttabSecret', 'a  b\t cSecret']) {
      const uri = `mongodb://u:${secret}@h/db`;
      // Accepted by the driver (the URL parser drops tabs, so only spaces survive parsing).
      expect(parseConnectionString(uri).password).toBe(secret.replace(/\t/g, ''));
      expect(maskText(`log: ${uri} failed`)).toBe(`log: mongodb://u:${MASK}@h/db failed`);
      expectNoLeak(maskText(`connect "${uri}" failed`), [secret, 'Secret']);
      expectNoLeak(maskText(`a mongodb://x@h1, then mongodb+srv://u:${secret}@c.net`), ['Secret']);
    }
  });

  it('does not extend credentials across a line break', () => {
    expect(maskText('mongodb://h:27017 failed\nuser:pw@x')).toBe(
      'mongodb://h:27017 failed\nuser:pw@x',
    );
  });

  it('masks rather than leaks prose followed by an "@" on the same line', () => {
    // Documented over-masking: the text up to the '@' could be a password with spaces.
    expect(maskText('mongodb://host:27017 failed for user@x')).toBe(`mongodb://host:${MASK}@x`);
  });

  it('does not start a new connection string at a scheme inside the password', () => {
    // Invalid for the driver, but mask() masks it, so maskText must not split it.
    expectNoLeak(maskText('x mongodb://u:amongodb://bSecret@h y'), ['bSecret']);
    expectNoLeak(maskText('x mongodb://u:a,mongodb://bSecret@h y'), ['bSecret']);
  });

  it('still splits connection strings joined after a port, a path or a non-secret option', () => {
    expect(maskText('mongodb://h:27017,mongodb://b:p1Secret@h2')).toBe(
      `mongodb://h:27017,mongodb://b:${MASK}@h2`,
    );
    expect(maskText('"mongodb://h/?tls=true","mongodb://b:p2Secret@h2"')).toBe(
      `"mongodb://h/?tls=true","mongodb://b:${MASK}@h2"`,
    );
    expectNoLeak(maskText('"mongodb://h/?proxyPassword=pp","mongodb://b:p3Secret@h2"'), [
      'pp',
      'p3Secret',
    ]);
  });
});

describe('mask and maskText on passwords with special characters', () => {
  // Every printable ASCII character except letters and digits, as typed into the form. The
  // connection string is the one Thicket itself writes, i.e. what ends up in logs and errors.
  const specials = [...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~ '];

  it.each(specials)('hides a password containing %j', (c) => {
    const secret = `ab${c}cdSecret`;
    const uri = toConnectionString({
      ...parseConnectionString('mongodb://host.example.com'),
      username: 'u',
      password: secret,
    });
    expect(parseConnectionString(uri).password).toBe(secret);
    expectNoLeak(mask(uri), [secret]);
    expectNoLeak(maskText(`connect ${uri} failed`), [secret]);
    expectNoLeak(maskText(`connect '${uri}' failed`), [secret]);
  });

  // CR-1 / TW-3 regression: however the log line wraps the URI Thicket wrote.
  it.each(specials)('hides a password containing %j in quoted, bracketed and JSON text', (c) => {
    const secret = `ab${c}cdSecret`;
    const uri = toConnectionString({
      ...parseConnectionString('mongodb://host.example.com/db?tls=true'),
      username: 'u',
      password: secret,
    });
    for (const text of [
      `connect "${uri}" failed`,
      `connect \`${uri}\` failed`,
      `connect <${uri}> failed`,
      `(${uri}),`,
      JSON.stringify({ uri, note: 'a@b:c' }),
      JSON.stringify([uri, uri]),
    ]) {
      expectNoLeak(maskText(text), [secret]);
    }
  });

  it('hides secret options with quotes inside quoted text', () => {
    const uri = toConnectionString({
      ...parseConnectionString('mongodb://h'),
      proxy: { host: 'p', password: `p'x"y\`Secret` },
      tls: { certificateKeyFilePassword: `k'e"y<Secret>` },
    });
    for (const text of [`'${uri}'`, `"${uri}"`, JSON.stringify({ uri })]) {
      expectNoLeak(maskText(text), [`p'x"y\`Secret`, `k'e"y<Secret>`]);
    }
  });

  it('hides a user password that contains a connection-string scheme', () => {
    const secret = 'pw-mongodb://inner-mongodb+srv://Secret';
    const uri = toConnectionString({
      ...parseConnectionString('mongodb://h'),
      username: 'u',
      password: secret,
    });
    expectNoLeak(maskText(`connect ${uri} failed`), [secret, 'inner-', 'Secret']);
  });

  // TW-4: the text scanner splits at an embedded "mongodb://", but Thicket writes ":" and "/"
  // unencoded in option values, so the tail of such a secret option value ends up outside mask().
  it('hides secret option values that contain a connection-string scheme', () => {
    const uri = toConnectionString({
      ...parseConnectionString('mongodb://h'),
      auth: {
        mechanism: 'MONGODB-AWS',
        mechanismProperties: { AWS_SESSION_TOKEN: 'tok-mongodb://awsTail1Secret' },
      },
      proxy: { host: 'p', password: 'px-mongodb://proxyTail2Secret' },
      tls: { certificateKeyFilePassword: 'kp-mongodb+srv://keyTail3Secret' },
    });
    expect(parseConnectionString(uri).proxy.password).toBe('px-mongodb://proxyTail2Secret');
    expectNoLeak(mask(uri), ['awsTail1Secret', 'proxyTail2Secret', 'keyTail3Secret']);
    expectNoLeak(maskText(`connect ${uri} failed`), [
      'awsTail1Secret',
      'proxyTail2Secret',
      'keyTail3Secret',
    ]);
  });

  it('hides proxyPassword and tlsCertificateKeyFilePassword containing special characters', () => {
    const uri = toConnectionString({
      ...parseConnectionString('mongodb://h'),
      proxy: { host: 'p', password: "px&y='Secret" },
      tls: { certificateKeyFilePassword: 'k#e y%Secret' },
    });
    const masked = mask(uri);
    expectNoLeak(masked, ["px&y='Secret", 'k#e y%Secret']);
    expect(masked).toBe(
      `mongodb://h/?tlsCertificateKeyFilePassword=${MASK}&proxyHost=p&proxyPassword=${MASK}`,
    );
  });
});

describe('mask edge cases', () => {
  it('keeps leading whitespace and masks the password after it', () => {
    expect(mask('  mongodb://u:wsSecret@h')).toBe(`  mongodb://u:${MASK}@h`);
  });

  it('masks a mixed-case scheme', () => {
    expect(mask('MongoDB+SRV://u:upSrvSecret@c.example.net')).toBe(
      `MongoDB+SRV://u:${MASK}@c.example.net`,
    );
  });

  it('masks an empty password marker without leaking anything', () => {
    expect(mask('mongodb://u:@h')).toBe(`mongodb://u:${MASK}@h`);
  });

  it('keeps a user name without a password unchanged', () => {
    expect(mask('mongodb://reader@h/db')).toBe('mongodb://reader@h/db');
  });

  it('masks the AWS session token whatever the key case, next to entries without a colon', () => {
    const masked = mask(
      'mongodb://h/?authMechanismProperties=FLAG,Aws_Session_Token:mixTokSecret&authMechanism=MONGODB-AWS',
    );
    expect(masked).not.toContain('mixTokSecret');
    expect(decodeURIComponent(masked)).toBe(
      `mongodb://h/?authMechanismProperties=FLAG,Aws_Session_Token:${MASK}&authMechanism=MONGODB-AWS`,
    );
  });

  it('masks every repeated secret option', () => {
    const masked = mask('mongodb://h/?proxyPassword=one1Secret&proxyPassword=two2Secret');
    expect(masked).toBe(`mongodb://h/?proxyPassword=${MASK}&proxyPassword=${MASK}`);
  });

  it('masks a secret option in a string that also has credentials', () => {
    const masked = mask('mongodb://u:credSecret@h/?tlsCertificateKeyFilePassword=keySecret#frag');
    expect(masked).toBe(`mongodb://u:${MASK}@h/?tlsCertificateKeyFilePassword=${MASK}`);
  });

  it('does not mask an "@" after the hosts when no ":" comes before it', () => {
    expect(mask('mongodb://host/x@y:z')).toBe('mongodb://host/x@y:z');
  });

  it('does not treat the user name as a secret', () => {
    expect(mask('mongodb://alice@h/?proxyUsername=bob')).toBe(
      'mongodb://alice@h/?proxyUsername=bob',
    );
  });
});
