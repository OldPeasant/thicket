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
});
