import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RpcError } from '@thicket/backend';
import {
  parseResult,
  profile as profileSchema,
  type Profile,
  type ProfileDraft,
  type SecretKind,
  type SecretStorageStatus,
} from '@thicket/contract';
import { describe, expect, it } from 'vitest';

import type { NativeDialogs } from '../../dialogs';
import { ProfilesReadOnlyError } from '../store';
import {
  ImportFileError,
  MAX_IMPORT_FILE_BYTES,
  exportFile,
  importExportHandlers,
  parseImportFile,
  parseUriList,
  profileFromUri,
  secretAdvice,
  stripUriSecrets,
  uriWithoutSecrets,
  type ImportExportFs,
} from '.';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

/** Every secret value written into the fixtures (fake values, never real credentials). */
const FIXTURE_SECRETS = [
  'fake-pass@word',
  'fake-pass%40word',
  'fake-ssh-password',
  'fake-key-passphrase',
  'fake-identity-passphrase',
];

/** A JSON key or URI option whose name says it holds a secret, or a `user:password@` URI. */
const SECRET_KEY =
  /"[^"]*(password|passphrase|token)[^"]*"\s*:|(password|passphrase|token)=|_TOKEN:|\/\/[^/@"]*:[^/@"]*@/i;

describe('profileFromUri', () => {
  it('moves the password into a secret and mirrors user, mechanism and options', () => {
    const { draft, secrets } = profileFromUri(
      'mongodb://alice:s%3Ae@db1.example.test:27017/shop?authSource=admin&readPreference=nearest&appName=x&connectTimeoutMS=5000',
      'Shop',
    );
    expect(draft).toEqual({
      name: 'Shop',
      connectionString:
        'mongodb://alice@db1.example.test:27017/shop?authSource=admin&readPreference=nearest&connectTimeoutMS=5000&appName=x',
      readOnly: false,
      production: false,
      auth: {
        mechanism: 'SCRAM-SHA-256',
        username: 'alice',
        authSource: 'admin',
        secretMode: 'saved',
      },
      readPreference: 'nearest',
      appName: 'x',
      connectTimeoutMS: 5000,
    });
    expect(secrets).toEqual([{ kind: 'password', value: 's:e' }]);
    expect(profileSchema.safeParse({ ...draft, id: 'p1' }).success).toBe(true);
  });

  it('names the profile after its hosts and asks for a missing password', () => {
    const { draft, secrets } = profileFromUri('mongodb://bob@[::1]:27017,db2.example.test');
    expect(draft.name).toBe('[::1]:27017, db2.example.test');
    expect(draft.auth).toEqual({ mechanism: 'SCRAM-SHA-256', username: 'bob', secretMode: 'ask' });
    expect(secrets).toEqual([]);
  });

  it('has no auth without a user and enables TLS for SRV by default', () => {
    const { draft } = profileFromUri('mongodb+srv://cluster0.example.test/?tlsCAFile=%2Fca.pem');
    expect(draft.auth).toBeUndefined();
    expect(draft.tls).toEqual({ enabled: true, caFile: '/ca.pem' });
  });

  it('takes proxy, client key and AWS secrets out of the connection string', () => {
    const { draft, secrets } = profileFromUri(
      'mongodb://AKIAEXAMPLE:fake-secret@db.example.test/?authMechanism=MONGODB-AWS' +
        '&authMechanismProperties=AWS_SESSION_TOKEN:fake-token' +
        '&proxyHost=socks.example.test&proxyUsername=pu&proxyPassword=fake-proxy' +
        '&tls=true&tlsCertificateKeyFile=%2Fc.pem&tlsCertificateKeyFilePassword=fake-pass',
    );
    for (const value of ['fake-secret', 'fake-token', 'fake-proxy', 'fake-pass', 'AKIAEXAMPLE'])
      expect(draft.connectionString).not.toContain(value);
    expect(draft.auth).toEqual({
      mechanism: 'MONGODB-AWS',
      username: 'AKIAEXAMPLE',
      secretMode: 'saved',
    });
    expect(draft.proxy).toEqual({ host: 'socks.example.test', port: 1080, username: 'pu' });
    expect(secrets).toEqual(
      expect.arrayContaining([
        { kind: 'password', value: 'fake-secret' },
        { kind: 'awsSessionToken', value: 'fake-token' },
        { kind: 'proxyPassword', value: 'fake-proxy' },
        { kind: 'tlsKeyPassphrase', value: 'fake-pass' },
      ]),
    );
    expect(secrets).toHaveLength(4);
  });

  it('throws for something that is not a MongoDB connection string', () => {
    expect(() => profileFromUri('postgres://x')).toThrow();
  });
});

describe('parseImportFile (Compass export)', () => {
  it('imports the plain fixture: names, colors, SSH, TLS and secrets', () => {
    const parsed = parseImportFile(fixture('compass-plain.json'));
    expect(parsed.entries.map((e) => e.source)).toEqual([
      'Orders (staging)',
      'Reporting',
      'Behind bastion',
      'X.509 via key',
      'connection 5',
    ]);
    const [orders, reporting, bastion, x509, recent] = parsed.entries;
    expect(orders?.draft).toMatchObject({
      name: 'Orders (staging)',
      color: '#326fde',
      connectionString:
        'mongodb://alice@db1.example.test:27017,db2.example.test:27018/shop?replicaSet=rs0&authSource=admin&readPreference=secondaryPreferred&appName=orders',
      auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'saved' },
      readPreference: 'secondaryPreferred',
    });
    expect(orders?.secrets).toEqual([{ kind: 'password', value: 'fake-pass@word' }]);
    expect(reporting?.draft).toMatchObject({
      color: '#1f9d8b',
      auth: { mechanism: 'SCRAM-SHA-1', username: 'reporting', secretMode: 'ask' },
      tls: { enabled: true },
    });
    expect(bastion?.draft.ssh).toEqual({
      host: 'bastion.example.test',
      port: 2222,
      username: 'ops',
      method: 'password',
    });
    expect(bastion?.secrets).toEqual([{ kind: 'sshPassword', value: 'fake-ssh-password' }]);
    expect(x509?.draft).toMatchObject({
      color: '#cc6b23',
      auth: { mechanism: 'MONGODB-X509', secretMode: 'none' },
      tls: { enabled: true, caFile: '/home/u/ca.pem', certificateKeyFile: '/home/u/client.pem' },
      ssh: { method: 'privateKey', privateKeyFile: '/home/u/.ssh/id_ed25519', port: 22 },
    });
    expect(x509?.secrets).toEqual([
      { kind: 'tlsKeyPassphrase', value: 'fake-key-passphrase' },
      { kind: 'sshKeyPassphrase', value: 'fake-identity-passphrase' },
    ]);
    expect(recent?.draft.name).toBe('127.0.0.1:27018');
    expect(parsed.skipped).toEqual([
      { source: 'Broken entry', reason: 'it has no connection string' },
      { source: 'Not MongoDB', reason: expect.stringContaining('') as string },
    ]);
    expect(parsed.notices).toEqual([]);
    for (const entry of parsed.entries) {
      expect(profileSchema.safeParse({ ...entry.draft, id: 'x' }).success).toBe(true);
      for (const secret of FIXTURE_SECRETS)
        expect(JSON.stringify(entry.draft)).not.toContain(secret);
    }
  });

  it('imports encrypted entries without credentials and with a notice', () => {
    const parsed = parseImportFile(fixture('compass-encrypted.json'));
    expect(parsed.entries.map((e) => e.draft.name)).toEqual(['Encrypted prod', 'Local']);
    expect(parsed.entries[0]?.draft.auth).toEqual({
      mechanism: 'SCRAM-SHA-256',
      username: 'carol',
      authSource: 'admin',
      secretMode: 'ask',
    });
    expect(parsed.entries[0]?.secrets).toEqual([]);
    expect(parsed.notices).toEqual([
      { source: 'Encrypted prod', reason: expect.stringContaining('encrypted') as string },
    ]);
    expect(parsed.skipped).toEqual([]);
  });

  it('accepts a plain number version and refuses other files', () => {
    const file = { type: 'Compass Connections', version: 1, connections: [] };
    expect(parseImportFile(JSON.stringify(file)).entries).toEqual([]);
    expect(() => parseImportFile('nope')).toThrow(ImportFileError);
    expect(() => parseImportFile('[]')).toThrow(ImportFileError);
    expect(() => parseImportFile(JSON.stringify({ ...file, version: 2 }))).toThrow(/version 2/);
    expect(() => parseImportFile(JSON.stringify({ ...file, connections: {} }))).toThrow(
      ImportFileError,
    );
  });
});

describe('parseUriList', () => {
  it('ignores blank lines and names entries by their masked URI', () => {
    const parsed = parseUriList(['  mongodb://u:fake-pw@a.test ', '', 'nonsense']);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.source).not.toContain('fake-pw');
    expect(parsed.skipped).toEqual([{ source: 'nonsense', reason: expect.any(String) as string }]);
  });
});

describe('exportFile', () => {
  it('contains no password, passphrase or token (grep of the output)', () => {
    // Profiles as `main` stores them, plus secret options a user might have left in a URI.
    const profiles: Profile[] = [
      ...parseImportFile(fixture('compass-plain.json')).entries,
      ...parseUriList([
        'mongodb://AKIAEXAMPLE:fake-secret@db.example.test/?authMechanism=MONGODB-AWS&authMechanismProperties=AWS_SESSION_TOKEN:fake-token',
      ]).entries,
    ].map((e, i) => ({ ...e.draft, id: `p${String(i)}` }) as Profile);
    profiles.push({
      id: 'leaky',
      name: 'Leaky options',
      connectionString:
        'mongodb://db.example.test/?proxyHost=s.test&proxyPassword=fake-proxy-pw&tlsCertificateKeyFilePassword=fake-tls-pw&authMechanismProperties=AWS_SESSION_TOKEN:fake-session',
      readOnly: false,
      production: true,
    });
    const text = exportFile(profiles);
    for (const secret of [
      ...FIXTURE_SECRETS,
      'fake-secret',
      'fake-token',
      'fake-proxy-pw',
      'fake-tls-pw',
      'fake-session',
    ])
      expect(text).not.toContain(secret);
    // No key and no URI option named like a secret ("method": "password" is a value, not one).
    expect(text).not.toMatch(SECRET_KEY);
    expect(text).not.toContain('"id"');
    const parsed = JSON.parse(text) as { type: string; version: number; profiles: unknown[] };
    expect(parsed.type).toBe('Thicket Connections');
    expect(parsed.profiles).toHaveLength(profiles.length);
  });

  it('round-trips through parseImportFile', () => {
    const profiles = parseImportFile(fixture('compass-plain.json')).entries.map(
      (e, i) => ({ ...e.draft, id: `p${String(i)}` }) as Profile,
    );
    const back = parseImportFile(exportFile(profiles));
    expect(back.skipped).toEqual([]);
    // Everything comes back, except that saved secrets are asked for by the recipient.
    expect(back.entries.map((e) => e.draft)).toEqual(
      profiles.map((p) => {
        const rest: Partial<Profile> = { ...p };
        delete rest.id;
        return rest.auth?.secretMode === 'saved'
          ? { ...rest, auth: { ...rest.auth, secretMode: 'ask' } }
          : rest;
      }),
    );
    expect(back.entries.some((e) => e.draft.auth?.secretMode === 'saved')).toBe(false);
  });

  it('masks a connection string it cannot parse', () => {
    expect(uriWithoutSecrets('mongodb://u:fake-pw@')).not.toContain('fake-pw');
  });
});

class FakeProfiles {
  profiles: Profile[] = [];
  private next = 0;
  list(): Promise<Profile[]> {
    return Promise.resolve(structuredClone(this.profiles));
  }
  save(draft: ProfileDraft): Promise<Profile> {
    const saved = profileSchema.parse({ ...draft, id: draft.id ?? `id${String(++this.next)}` });
    const index = this.profiles.findIndex((p) => p.id === saved.id);
    if (index >= 0) this.profiles[index] = saved;
    else this.profiles.push(saved);
    return Promise.resolve(structuredClone(saved));
  }
}

class FakeSecrets {
  stored: { profileId: string; kind: SecretKind; value: string }[] = [];
  failKinds = new Set<SecretKind>();
  constructor(public level: SecretStorageStatus['level'] = 'secure') {}
  status(): Promise<SecretStorageStatus> {
    return Promise.resolve({
      level: this.level,
      backend: this.level === 'secure' ? 'gnome_libsecret' : 'basic_text',
      defaultSecretMode: this.level === 'secure' ? 'saved' : 'ask',
    });
  }
  set(profileId: string, kind: SecretKind, value: string): Promise<void> {
    if (this.failKinds.has(kind)) return Promise.reject(new Error('disk full'));
    this.stored.push({ profileId, kind, value });
    return Promise.resolve();
  }
}

function setup(options: { level?: SecretStorageStatus['level']; file?: string } = {}) {
  const profiles = new FakeProfiles();
  const secrets = new FakeSecrets(options.level);
  const written: { path: string; data: string }[] = [];
  const dialogs: NativeDialogs & { cancel: boolean } = {
    cancel: false,
    showOpenDialog() {
      return Promise.resolve(
        this.cancel
          ? { canceled: true, filePaths: [] }
          : { canceled: false, filePaths: ['/in.json'] },
      );
    },
    showSaveDialog() {
      return Promise.resolve(
        this.cancel ? { canceled: true } : { canceled: false, filePath: '/out.json' },
      );
    },
  };
  const fs: ImportExportFs = {
    readFile: () => Promise.resolve(options.file ?? fixture('compass-plain.json')),
    stat: () => Promise.resolve({ size: (options.file ?? 'x').length }),
    writeFile: (path, data) => {
      written.push({ path, data });
      return Promise.resolve();
    },
  };
  const handlers = importExportHandlers({ profiles, secrets, dialogs, fs });
  const call = (method: string, params: unknown = {}) =>
    (handlers[method] as (p: unknown, c: unknown) => Promise<unknown>)(params, {});
  return { profiles, secrets, dialogs, written, call };
}

describe('importExportHandlers', () => {
  it('profiles.importCompass saves the entries and their secrets (secure keychain)', async () => {
    const { profiles, secrets, call } = setup();
    const result = (await call('profiles.importCompass')) as {
      imported: Profile[];
      skipped: unknown[];
      notices: unknown[];
    };
    expect(parseResult('profiles.importCompass', result).ok).toBe(true);
    expect(result.imported.map((p) => p.name)).toEqual(profiles.profiles.map((p) => p.name));
    expect(result.imported).toHaveLength(5);
    expect(result.skipped).toHaveLength(2);
    expect(secrets.stored).toContainEqual({
      profileId: result.imported[0]?.id,
      kind: 'password',
      value: 'fake-pass@word',
    });
    expect(secrets.stored).toHaveLength(4);

    // A second import of the same file adds nothing.
    const again = (await call('profiles.importCompass')) as {
      imported: Profile[];
      skipped: unknown[];
    };
    expect(again.imported).toEqual([]);
    expect(again.skipped).toHaveLength(7);
    expect(profiles.profiles).toHaveLength(5);
  });

  it('does not save secrets without a secure keychain: the profile asks, a notice says so', async () => {
    const { profiles, secrets, call } = setup({ level: 'weak' });
    const result = (await call('profiles.importCompass')) as {
      imported: Profile[];
      notices: { source: string; reason: string }[];
    };
    expect(secrets.stored).toEqual([]);
    expect(result.imported[0]?.auth?.secretMode).toBe('ask');
    expect(profiles.profiles[0]?.auth?.secretMode).toBe('ask');
    expect(result.notices.map((n) => n.source)).toEqual([
      'Orders (staging)',
      'Behind bastion',
      'X.509 via key',
    ]);
    expect(result.notices[0]?.reason).toMatch(/not saved/);
  });

  it('says where each dropped secret is entered: only the password is asked (CR-6)', () => {
    expect(secretAdvice(['password'])).toBe('the password is asked when connecting');
    expect(secretAdvice(['password', 'sshKeyPassphrase', 'password'])).toBe(
      'the password is asked when connecting; ' +
        'enter the SSH key passphrase in the connection editor',
    );
    expect(secretAdvice(['proxyPassword', 'tlsKeyPassphrase', 'sshPassword'])).toBe(
      'enter the proxy password, client key passphrase, SSH password in the connection editor',
    );
    expect(secretAdvice(['awsSessionToken'])).toBe(
      "the AWS session token can't be entered in Thicket",
    );
    expect(parseImportFile(fixture('compass-encrypted.json')).notices[0]?.reason).toMatch(
      /password is asked when connecting, other secrets .* connection editor/,
    );
  });

  it('falls back to asking when storing the password fails', async () => {
    const { profiles, secrets, call } = setup();
    secrets.failKinds.add('password');
    const result = (await call('profiles.importCompass')) as {
      notices: { source: string; reason: string }[];
    };
    expect(profiles.profiles[0]?.auth?.secretMode).toBe('ask');
    expect(result.notices).toContainEqual({
      source: 'Orders (staging)',
      reason: 'password could not be saved; the password is asked when connecting',
    });
  });

  it('returns null when the dialog is cancelled and INVALID_PARAMS for a foreign file', async () => {
    const cancelled = setup();
    cancelled.dialogs.cancel = true;
    expect(await cancelled.call('profiles.importCompass')).toBeNull();
    const foreign = setup({ file: '{"hello":1}' });
    await expect(foreign.call('profiles.importCompass')).rejects.toSatisfy(
      (e) => e instanceof RpcError && e.code === 'INVALID_PARAMS',
    );
  });

  it('profiles.importUris creates one profile per connection string', async () => {
    const { profiles, secrets, call } = setup();
    const result = (await call('profiles.importUris', {
      uris: ['mongodb://u:fake-pw@a.example.test', 'bad', 'mongodb://b.example.test:27018'],
    })) as { imported: Profile[]; skipped: unknown[] };
    expect(result.imported.map((p) => p.name)).toEqual(['a.example.test', 'b.example.test:27018']);
    expect(result.skipped).toHaveLength(1);
    expect(profiles.profiles).toHaveLength(2);
    expect(secrets.stored).toEqual([
      { profileId: result.imported[0]?.id, kind: 'password', value: 'fake-pw' },
    ]);
  });

  it('profiles.export writes the selected (or all) profiles without secrets', async () => {
    const { written, call, dialogs } = setup();
    const { imported } = (await call('profiles.importCompass')) as { imported: Profile[] };
    const first = imported[0];
    if (!first) throw new Error('nothing imported');
    expect(await call('profiles.export', { profileIds: [first.id] })).toEqual({
      path: '/out.json',
      exported: 1,
    });
    expect(await call('profiles.export', {})).toEqual({ path: '/out.json', exported: 5 });
    for (const { data } of written) {
      for (const secret of FIXTURE_SECRETS) expect(data).not.toContain(secret);
      expect(data).not.toMatch(SECRET_KEY);
    }
    await expect(call('profiles.export', { profileIds: ['nope'] })).rejects.toSatisfy(
      (e) => e instanceof RpcError && e.code === 'NOT_FOUND',
    );
    dialogs.cancel = true;
    expect(await call('profiles.export', {})).toEqual({ path: null, exported: 0 });
  });
});

// ---------------------------------------------------------------------------------------------
// Edge cases (test-writer): secret stripping with odd casing / repeated options, Compass entries
// with SSH + proxy, invalid SSH, EJSON ports and versions, BOM, oversize files, Thicket files.
// ---------------------------------------------------------------------------------------------

/** U+FEFF, the byte order mark some editors write before the JSON. */
const BOM = String.fromCharCode(0xfeff);

/** A Compass export around the given `connections` (version as Compass writes it). */
const compassFile = (connections: unknown[], version: unknown = { $numberInt: '1' }): string =>
  JSON.stringify({ type: 'Compass Connections', version, connections });

const sshEntry = (sshTunnel: unknown, uri = 'mongodb://db.example.test:27017') => ({
  connectionOptions: { connectionString: uri, sshTunnel },
  favorite: { name: 'Tunnel' },
});

describe('secret stripping (odd casing, repeated options, unparsed properties)', () => {
  it('strips secret options written in any case', () => {
    const uri =
      'mongodb://u:fake-pw@db.example.test/?authMechanism=MONGODB-AWS' +
      '&AUTHMECHANISMPROPERTIES=aws_session_token:fake-lower-token' +
      '&PROXYHOST=s.test&proxyusername=pu&PROXYPASSWORD=fake-upper-proxy' +
      '&TLSCertificateKeyFile=%2Fc.pem&TlsCertificateKeyFilePassword=fake-mixed-tls';
    const cleaned = uriWithoutSecrets(uri);
    for (const secret of ['fake-pw', 'fake-lower-token', 'fake-upper-proxy', 'fake-mixed-tls'])
      expect(cleaned).not.toContain(secret);
    expect(cleaned).not.toMatch(/password|token/i);
    const { draft, secrets } = profileFromUri(uri);
    expect(draft.connectionString).toBe(cleaned.replace('u@', ''));
    expect(secrets).toEqual(
      expect.arrayContaining([
        { kind: 'password', value: 'fake-pw' },
        { kind: 'awsSessionToken', value: 'fake-lower-token' },
        { kind: 'proxyPassword', value: 'fake-upper-proxy' },
        { kind: 'tlsKeyPassphrase', value: 'fake-mixed-tls' },
      ]),
    );
    expect(secrets).toHaveLength(4);
  });

  it('strips a mixed-case AWS_SESSION_TOKEN property and keeps the other properties', () => {
    const { draft, secrets } = profileFromUri(
      'mongodb://AKIAEXAMPLE:fake-secret@db.example.test/?authMechanism=MONGODB-AWS' +
        '&authMechanismProperties=Aws_Session_Token:fake-token,SERVICE_NAME:svc',
    );
    expect(draft.connectionString).not.toContain('fake-token');
    expect(draft.connectionString).toContain('SERVICE_NAME:svc');
    expect(secrets).toContainEqual({ kind: 'awsSessionToken', value: 'fake-token' });
  });

  it('strips every copy of a repeated secret option and keeps the first value as the secret', () => {
    const uri =
      'mongodb://db.example.test/?proxyHost=s.test&proxyUsername=pu' +
      '&proxyPassword=fake-first&ProxyPassword=fake-second&proxyPassword=fake-third' +
      '&tls=true&tlsCertificateKeyFile=%2Fc.pem' +
      '&tlsCertificateKeyFilePassword=fake-tls-1&tlscertificatekeyfilepassword=fake-tls-2';
    const { draft, secrets } = profileFromUri(uri);
    for (const s of ['fake-first', 'fake-second', 'fake-third', 'fake-tls-1', 'fake-tls-2']) {
      expect(draft.connectionString).not.toContain(s);
      expect(uriWithoutSecrets(uri)).not.toContain(s);
    }
    expect(secrets).toEqual([
      { kind: 'proxyPassword', value: 'fake-first' },
      { kind: 'tlsKeyPassphrase', value: 'fake-tls-1' },
    ]);
  });

  it('takes the session token out of authMechanismProperties the parser could not read', () => {
    // "FOO" without a value makes the parser keep the whole option verbatim (in `extra`).
    const uri =
      'mongodb://AKIAEXAMPLE:fake-secret@db.example.test/?authMechanism=MONGODB-AWS' +
      '&authMechanismProperties=FOO,AWS_SESSION_TOKEN:fake-extra-token';
    const { draft, secrets } = profileFromUri(uri);
    expect(draft.connectionString).not.toContain('fake-extra-token');
    expect(draft.connectionString).toContain('authMechanismProperties=FOO');
    expect(uriWithoutSecrets(uri)).not.toContain('fake-extra-token');
    expect(secrets).toContainEqual({ kind: 'awsSessionToken', value: 'fake-extra-token' });
  });

  it('drops a repeated authMechanismProperties that held only a session token', () => {
    const uri =
      'mongodb://db.example.test/?authMechanismProperties=SERVICE_NAME:svc' +
      '&authMechanismProperties=AWS_SESSION_TOKEN:fake-t1' +
      '&authMechanismProperties=OTHER:1,aws_session_token:fake-t2' +
      '&authMechanismProperties=AWS_SESSION_TOKEN';
    const cleaned = uriWithoutSecrets(uri);
    expect(cleaned).not.toMatch(/fake-t1|fake-t2|session_token/i);
    expect(cleaned).toContain('SERVICE_NAME:svc');
    expect(cleaned).toContain('OTHER:1');
    // Without MONGODB-AWS the token is not used: neither in the URI nor among the secrets.
    expect(profileFromUri(uri).secrets).toEqual([]);
  });

  it('removes secrets the profile cannot use instead of keeping them', () => {
    const { draft, secrets } = profileFromUri(
      'mongodb://alice:fake-pw@db.example.test/?proxyHost=s.test&proxyPassword=fake-proxy' +
        '&tlsCertificateKeyFilePassword=fake-tls&authMechanismProperties=AWS_SESSION_TOKEN:fake-tok',
    );
    for (const s of ['fake-proxy', 'fake-tls', 'fake-tok', 'fake-pw'])
      expect(draft.connectionString).not.toContain(s);
    // No proxy user, no client key file, not MONGODB-AWS: only the password is kept.
    expect(secrets).toEqual([{ kind: 'password', value: 'fake-pw' }]);
    expect(draft.proxy).toEqual({ host: 's.test', port: 1080 });
  });

  it('strips a percent-encoded secret option name', () => {
    const cleaned = uriWithoutSecrets(
      'mongodb://db.example.test/?proxyHost=s.test&proxy%50assword=fake-encoded-key',
    );
    expect(cleaned).not.toContain('fake-encoded-key');
  });

  it('never shows the password of an unparseable string (uriWithoutSecrets, parseUriList)', () => {
    const bad = 'mongodb://u:fake-bad-pw@host.test:99999';
    expect(uriWithoutSecrets(bad)).not.toContain('fake-bad-pw');
    const parsed = parseUriList([bad]);
    expect(parsed.entries).toEqual([]);
    expect(JSON.stringify(parsed.skipped)).not.toContain('fake-bad-pw');
  });

  it('keeps the connection string unchanged apart from the secrets', () => {
    const uri = 'mongodb://db.example.test:27017/shop?replicaSet=rs0&retryWrites=false';
    expect(uriWithoutSecrets(uri)).toBe(uri);
  });
});

describe('profileFromUri (mapped options)', () => {
  it('mirrors TLS flags, tags, write concern, timeouts and the proxy port', () => {
    const { draft } = profileFromUri(
      'mongodb://db.example.test/?tls=true&tlsAllowInvalidHostnames=true' +
        '&tlsAllowInvalidCertificates=false&readPreference=secondary' +
        '&readPreferenceTags=dc:ny,rack:1&readPreferenceTags=dc:sf' +
        '&w=majority&journal=true&wtimeoutMS=2500&serverSelectionTimeoutMS=7000' +
        '&connectTimeoutMS=0&proxyHost=socks.test&proxyPort=9050',
    );
    expect(draft).toMatchObject({
      tls: { enabled: true, allowInvalidHostnames: true, allowInvalidCertificates: false },
      readPreference: 'secondary',
      readPreferenceTags: [
        [
          { name: 'dc', value: 'ny' },
          { name: 'rack', value: '1' },
        ],
        [{ name: 'dc', value: 'sf' }],
      ],
      writeConcern: { w: 'majority', journal: true, wtimeoutMS: 2500 },
      serverSelectionTimeoutMS: 7000,
      proxy: { host: 'socks.test', port: 9050 },
    });
    expect(draft.connectTimeoutMS).toBeUndefined();
    expect(profileSchema.safeParse({ ...draft, id: 'p' }).success).toBe(true);
  });

  it('ignores read preference tags with the primary mode', () => {
    const { draft } = profileFromUri(
      'mongodb://db.example.test/?readPreference=primary&readPreferenceTags=dc:ny',
    );
    expect(draft.readPreference).toBe('primary');
    expect(draft.readPreferenceTags).toBeUndefined();
  });

  it('uses the given mechanism, drops authSource for X.509 and asks nothing for it', () => {
    const x509 = profileFromUri(
      'mongodb://CN=client@db.example.test/?authMechanism=MONGODB-X509&authSource=%24external&tls=true',
    );
    expect(x509.draft.auth).toEqual({
      mechanism: 'MONGODB-X509',
      username: 'CN=client',
      secretMode: 'none',
    });
    const plain = profileFromUri('mongodb://bob:fake-pw@db.example.test/?authMechanism=PLAIN');
    expect(plain.draft.auth).toMatchObject({ mechanism: 'PLAIN', secretMode: 'saved' });
    expect(plain.secrets).toEqual([{ kind: 'password', value: 'fake-pw' }]);
    const def = profileFromUri('mongodb://bob@db.example.test/?authMechanism=DEFAULT');
    expect(def.draft.auth?.mechanism).toBe('SCRAM-SHA-256');
  });

  it('uses a blank name as no name and trims a given one', () => {
    expect(profileFromUri('mongodb://a.test', '   ').draft.name).toBe('a.test');
    expect(profileFromUri('mongodb://a.test', '  Shop  ').draft.name).toBe('Shop');
  });
});

describe('parseImportFile (Compass edge cases)', () => {
  it('reads a file that starts with a byte order mark', () => {
    const parsed = parseImportFile(`${BOM}${fixture('compass-plain.json')}`);
    expect(parsed.entries).toHaveLength(5);
  });

  it('accepts the version as $numberInt, $numberLong, $numberDouble or a number', () => {
    for (const version of [{ $numberInt: '1' }, { $numberLong: '1' }, { $numberDouble: '1.0' }, 1])
      expect(parseImportFile(compassFile([], version)).entries).toEqual([]);
    for (const version of [{ $numberInt: '' }, { $numberInt: 'x' }, '1', null, 2])
      expect(() => parseImportFile(compassFile([], version))).toThrow(
        /Unsupported Compass export version/,
      );
    expect(() => parseImportFile('{"type":"Compass Connections","connections":[]}')).toThrow(
      /Unsupported Compass export version/,
    );
  });

  it('reads EJSON, plain and string SSH ports; an invalid port falls back to 22', () => {
    const portOf = (port: unknown) =>
      parseImportFile(compassFile([sshEntry({ host: 'b.test', username: 'ops', port })])).entries[0]
        ?.draft.ssh?.port;
    expect(portOf({ $numberInt: '2222' })).toBe(2222);
    expect(portOf({ $numberLong: '2200' })).toBe(2200);
    expect(portOf(2201)).toBe(2201);
    expect(portOf('2202')).toBe(2202);
    expect(portOf(65535)).toBe(65535);
    for (const bad of [0, 65536, -1, 22.5, '', 'abc', { $numberInt: '70000' }, null, undefined])
      expect(portOf(bad)).toBe(22);
  });

  it('skips an SSH tunnel without host or user name', () => {
    const parsed = parseImportFile(
      compassFile([
        sshEntry({ host: 'b.test' }),
        sshEntry({ username: 'ops' }),
        sshEntry({ host: '  ', username: 'ops' }),
      ]),
    );
    expect(parsed.entries).toEqual([]);
    expect(parsed.skipped).toHaveLength(3);
    for (const s of parsed.skipped) expect(s.reason).toMatch(/SSH tunnel has no host or user/);
  });

  it('skips an entry with both an SSH tunnel and a SOCKS5 proxy, without leaking secrets', () => {
    const parsed = parseImportFile(
      compassFile([
        sshEntry(
          { host: 'b.test', username: 'ops', password: 'fake-ssh-pw' },
          'mongodb://u:fake-db-pw@db.example.test/?proxyHost=socks.test&proxyUsername=pu&proxyPassword=fake-proxy',
        ),
      ]),
    );
    expect(parsed.entries).toEqual([]);
    expect(parsed.skipped).toEqual([
      { source: 'Tunnel', reason: 'it uses both an SSH tunnel and a SOCKS5 proxy' },
    ]);
    expect(JSON.stringify(parsed)).not.toMatch(/fake-/);
  });

  it('uses the key file (and its passphrase) over the SSH password', () => {
    const [entry] = parseImportFile(
      compassFile([
        sshEntry({
          host: 'b.test',
          username: 'ops',
          identityKeyFile: '/home/u/.ssh/id_rsa',
          identityKeyPassphrase: 'fake-passphrase',
          password: 'fake-ignored',
        }),
      ]),
    ).entries;
    expect(entry?.draft.ssh).toEqual({
      host: 'b.test',
      port: 22,
      username: 'ops',
      method: 'privateKey',
      privateKeyFile: '/home/u/.ssh/id_rsa',
    });
    expect(entry?.secrets).toEqual([{ kind: 'sshKeyPassphrase', value: 'fake-passphrase' }]);
  });

  it('imports a password SSH tunnel without a password (asked later)', () => {
    const [entry] = parseImportFile(
      compassFile([sshEntry({ host: 'b.test', username: 'ops', password: '' })]),
    ).entries;
    expect(entry?.draft.ssh?.method).toBe('password');
    expect(entry?.secrets).toEqual([]);
  });

  it('ignores an sshTunnel that is not an object', () => {
    const [entry] = parseImportFile(compassFile([sshEntry(null)])).entries;
    expect(entry?.draft.ssh).toBeUndefined();
  });

  it('names entries by position and skips ones that are not objects', () => {
    const parsed = parseImportFile(
      compassFile([
        42,
        null,
        { connectionOptions: { connectionString: 'mongodb://a.test' }, favorite: 'not-object' },
        { connectionOptions: 'nope', favorite: { name: 'No options' } },
        { connectionOptions: { connectionString: '   ' } },
      ]),
    );
    expect(parsed.entries.map((e) => [e.source, e.draft.name])).toEqual([
      ['connection 3', 'a.test'],
    ]);
    expect(parsed.skipped).toEqual([
      { source: 'connection 1', reason: 'not a connection object' },
      { source: 'connection 2', reason: 'not a connection object' },
      { source: 'No options', reason: 'it has no connection string' },
      { source: 'connection 5', reason: 'it has no connection string' },
    ]);
  });

  it('maps Compass color keys and hex colors; unknown colors are left out', () => {
    const colorOf = (color: unknown) =>
      parseImportFile(
        compassFile([
          { connectionOptions: { connectionString: 'mongodb://a.test' }, favorite: { color } },
        ]),
      ).entries[0]?.draft.color;
    expect(colorOf('color1')).toBe('#5fc86e');
    expect(colorOf('color10')).toBe('#a5aaaf');
    expect(colorOf('#ABC')).toBe('#ABC');
    for (const bad of ['color11', 'red', '#12345', 7, '']) expect(colorOf(bad)).toBeUndefined();
  });

  it('leaves out a color named like an object property (toString, constructor, __proto__)', () => {
    // TW-1: COMPASS_COLORS is a plain object, so inherited keys resolve to functions/objects.
    const colorOf = (color: unknown) =>
      parseImportFile(
        compassFile([
          { connectionOptions: { connectionString: 'mongodb://a.test' }, favorite: { color } },
        ]),
      ).entries[0]?.draft.color;
    for (const key of ['toString', 'constructor', '__proto__', 'hasOwnProperty'])
      expect(colorOf(key)).toBeUndefined();
  });

  it('never shows the password of an entry whose connection string is invalid', () => {
    const parsed = parseImportFile(
      compassFile([
        {
          connectionOptions: { connectionString: 'mongodb://u:fake-invalid-pw@host.test:99999' },
          favorite: { name: 'Bad port' },
        },
      ]),
    );
    expect(parsed.skipped).toHaveLength(1);
    expect(parsed.skipped[0]?.source).toBe('Bad port');
    expect(JSON.stringify(parsed.skipped)).not.toContain('fake-invalid-pw');
  });

  it('keeps plain credentials of an entry that also has encrypted ones, with a notice', () => {
    const parsed = parseImportFile(
      compassFile([
        {
          connectionOptions: { connectionString: 'mongodb://u:fake-pw@a.test' },
          favorite: { name: 'Both' },
          connectionSecrets: 'AAAA',
        },
        {
          connectionOptions: { connectionString: 'mongodb://b.test' },
          favorite: { name: 'Blank secrets' },
          connectionSecrets: '  ',
        },
      ]),
    );
    expect(parsed.entries[0]?.secrets).toEqual([{ kind: 'password', value: 'fake-pw' }]);
    expect(parsed.notices.map((n) => n.source)).toEqual(['Both']);
  });

  it('refuses JSON that is not an export object, naming both formats', () => {
    for (const text of ['null', '"x"', '42', '{"type":"Other"}', '{"connections":[]}'])
      expect(() => parseImportFile(text)).toThrow(/Compass Connections.*Thicket Connections/);
    expect(() => parseImportFile('')).toThrow('The file is not JSON');
  });
});

describe('parseImportFile (Thicket export)', () => {
  const thicket = (profiles: unknown, version: unknown = 1) =>
    JSON.stringify({ type: 'Thicket Connections', version, profiles });

  it('imports valid profiles without their ids and skips invalid ones with the reason', () => {
    const parsed = parseImportFile(
      thicket([
        {
          id: 'old-id',
          name: 'Shared',
          connectionString: 'mongodb://a.test',
          readOnly: true,
          production: true,
        },
        { name: 'No URI', readOnly: false, production: false },
        'nonsense',
      ]),
    );
    expect(parsed.entries).toEqual([
      {
        source: 'Shared',
        draft: {
          name: 'Shared',
          connectionString: 'mongodb://a.test',
          readOnly: true,
          production: true,
        },
        secrets: [],
      },
    ]);
    expect(parsed.skipped.map((s) => s.source)).toEqual(['No URI', 'profile 3']);
    expect(parsed.skipped[0]?.reason).toContain('connectionString');
  });

  it('skips a hand-edited profile with a password in its URI without echoing it', () => {
    const parsed = parseImportFile(
      thicket([
        {
          name: 'Leaky',
          connectionString: 'mongodb://u:fake-leaked-pw@a.test',
          readOnly: false,
          production: false,
        },
      ]),
    );
    expect(parsed.entries).toEqual([]);
    expect(parsed.skipped.map((s) => s.source)).toEqual(['Leaky']);
    expect(JSON.stringify(parsed.skipped)).not.toContain('fake-leaked-pw');
  });

  it('strips secret URI options from a shared file and says so (CR-1)', () => {
    const parsed = parseImportFile(
      thicket([
        {
          name: 'Shared',
          connectionString:
            'mongodb://a.test/?proxyHost=s.test&proxyUsername=p&proxyPassword=fake-proxy-pw' +
            '&tls=true&tlsCertificateKeyFile=/k.pem&tlsCertificateKeyFilePassword=fake-key-pw' +
            '&authMechanism=MONGODB-AWS' +
            '&authMechanismProperties=AWS_SESSION_TOKEN:fake-session-token',
          readOnly: false,
          production: false,
        },
        {
          name: 'Clean',
          connectionString: 'mongodb://b.test/?appName=x',
          readOnly: false,
          production: false,
        },
      ]),
    );
    const text = JSON.stringify(parsed);
    for (const secret of ['fake-proxy-pw', 'fake-key-pw', 'fake-session-token'])
      expect(text).not.toContain(secret);
    expect(parsed.entries.map((e) => e.secrets)).toEqual([[], []]);
    const shared = parsed.entries[0]?.draft.connectionString ?? '';
    expect(shared).toContain('proxyHost=s.test');
    expect(shared).not.toMatch(/proxyPassword|tlsCertificateKeyFilePassword|AWS_SESSION_TOKEN/i);
    // A string without secrets is kept exactly as written.
    expect(parsed.entries[1]?.draft.connectionString).toBe('mongodb://b.test/?appName=x');
    expect(parsed.notices).toHaveLength(1);
    expect(parsed.notices[0]?.source).toBe('Shared');
    expect(parsed.notices[0]?.reason).toMatch(
      /proxyPassword, tlsCertificateKeyFilePassword, AWS_SESSION_TOKEN removed/,
    );
    expect(parsed.notices[0]?.reason).toContain(
      'enter the proxy password, client key passphrase in the connection editor; ' +
        "the AWS session token can't be entered in Thicket",
    );
    expect(parsed.notices[0]?.reason).not.toMatch(/when connecting/);
  });

  it('imports secretMode saved as ask: no secret is stored for it (CR-2)', () => {
    const parsed = parseImportFile(
      thicket([
        {
          name: 'Saved',
          connectionString: 'mongodb://alice@a.test',
          readOnly: false,
          production: false,
          auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'saved' },
        },
        {
          name: 'None',
          connectionString: 'mongodb://b.test',
          readOnly: false,
          production: false,
          auth: { mechanism: 'MONGODB-X509', secretMode: 'none' },
        },
      ]),
    );
    expect(parsed.entries.map((e) => e.draft.auth?.secretMode)).toEqual(['ask', 'none']);
    expect(parsed.entries.map((e) => e.secrets)).toEqual([[], []]);
  });

  it('refuses other versions and a missing profiles list', () => {
    expect(() => parseImportFile(thicket([], 2))).toThrow(/Thicket export version 2/);
    expect(() => parseImportFile(thicket([], { $numberInt: '1' }))).toThrow(ImportFileError);
    expect(() => parseImportFile(thicket(undefined))).toThrow(/no profiles list/);
  });

  it('skips a profile whose URI passes the contract but cannot be parsed; the rest is imported', () => {
    const base = { readOnly: false, production: false };
    const parsed = parseImportFile(
      thicket([
        { ...base, name: 'Bad port', connectionString: 'mongodb://db.example.test:99999' },
        { ...base, name: 'Good', connectionString: 'mongodb://db.example.test:27017' },
      ]),
    );
    expect(parsed.entries.map((e) => e.source)).toEqual(['Good']);
    expect(parsed.skipped).toEqual([
      { source: 'Bad port', reason: expect.stringMatching(/port/i) as string },
    ]);
    expect(parsed.notices).toEqual([]);
  });

  it('strips a session token and secrets the profile does not use, naming them in the notice', () => {
    const parsed = parseImportFile(
      thicket([
        {
          name: 'Shared AWS',
          readOnly: false,
          production: false,
          // No proxy user and no client key file: the values are dropped all the same.
          connectionString:
            'mongodb://db.example.test/?authMechanism=MONGODB-AWS' +
            '&authMechanismProperties=aws_session_token:fake-shared-token' +
            '&PROXYPASSWORD=fake-shared-proxy&tlsCertificateKeyFilePassword=fake-shared-tls',
        },
      ]),
    );
    const [entry] = parsed.entries;
    expect(entry?.secrets).toEqual([]);
    expect(JSON.stringify(parsed.entries)).not.toMatch(/fake-shared|password|session_token/i);
    expect(parsed.notices).toHaveLength(1);
    const reason = parsed.notices[0]?.reason ?? '';
    for (const option of ['AWS_SESSION_TOKEN', 'proxyPassword', 'tlsCertificateKeyFilePassword'])
      expect(reason).toContain(option);
    expect(reason).not.toContain('fake-shared');
  });
});

describe('stripUriSecrets', () => {
  it('returns a URI without secrets unchanged, even when it is not in canonical form', () => {
    const uri = 'mongodb://db.example.test/?appName=x&replicaSet=rs0&RETRYWRITES=false';
    expect(stripUriSecrets(uri)).toEqual({ uri, removed: [] });
  });

  it('removes the password and reports it', () => {
    const result = stripUriSecrets(
      'mongodb://alice:fake-strip-pw@db.example.test/?authSource=admin',
    );
    expect(result).toEqual({
      uri: 'mongodb://alice@db.example.test/?authSource=admin',
      removed: ['password'],
    });
  });

  it('removes every secret kind, in any case and repeated, reporting each kind once', () => {
    const { uri, removed } = stripUriSecrets(
      'mongodb://u:fake-a@db.example.test/?proxyHost=s.test&proxyPassword=fake-b&ProxyPassword=fake-c' +
        '&TLSCERTIFICATEKEYFILEPASSWORD=fake-d&authMechanismProperties=FOO,AWS_SESSION_TOKEN:fake-e',
    );
    expect(uri).not.toMatch(/fake-|password|session_token/i);
    expect(uri).toContain('proxyHost=s.test');
    expect([...removed].sort()).toEqual(
      ['awsSessionToken', 'password', 'proxyPassword', 'tlsKeyPassphrase'].sort(),
    );
  });

  it('throws for an invalid URI without showing its password', () => {
    let caught: unknown;
    try {
      stripUriSecrets('mongodb://u:fake-invalid-strip@db.example.test:99999');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain('fake-invalid-strip');
  });
});

describe('exportFile (shape)', () => {
  it('writes an empty profiles list and ends with a newline', () => {
    const text = exportFile([]);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({ type: 'Thicket Connections', version: 1, profiles: [] });
  });

  it('does not change the profiles it is given', () => {
    const p: Profile = {
      id: 'p1',
      name: 'Mine',
      connectionString: 'mongodb://alice@a.test/?proxyHost=s.test&proxyPassword=fake-pp',
      readOnly: false,
      production: false,
      auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'saved' },
    };
    const before = structuredClone(p);
    const text = exportFile([p]);
    expect(p).toEqual(before);
    expect(text).not.toContain('fake-pp');
    expect(text).toContain('"secretMode": "ask"');
  });

  it('keeps secretMode none and ask as they are', () => {
    const base = { readOnly: false, production: false, connectionString: 'mongodb://a.test' };
    const text = exportFile([
      { ...base, id: 'a', name: 'X', auth: { mechanism: 'MONGODB-X509', secretMode: 'none' } },
      {
        ...base,
        id: 'b',
        name: 'Y',
        auth: { mechanism: 'SCRAM-SHA-256', username: 'u', secretMode: 'ask' },
      },
    ]);
    const parsed = JSON.parse(text) as { profiles: Profile[] };
    expect(parsed.profiles.map((p) => p.auth?.secretMode)).toEqual(['none', 'ask']);
  });
});

type Call = (method: string, params?: unknown) => Promise<unknown>;
const caller =
  (handlers: ReturnType<typeof importExportHandlers>): Call =>
  (method, params = {}) =>
    (handlers[method] as (p: unknown, c: unknown) => Promise<unknown>)(params, {});

describe('importExportHandlers (edge cases)', () => {
  it('refuses a file larger than MAX_IMPORT_FILE_BYTES before reading it', async () => {
    const { profiles, secrets, dialogs } = setup();
    let reads = 0;
    const sizes = [MAX_IMPORT_FILE_BYTES + 1, MAX_IMPORT_FILE_BYTES];
    const fs: ImportExportFs = {
      stat: () => Promise.resolve({ size: sizes.shift() ?? 0 }),
      readFile: () => {
        reads++;
        return Promise.resolve(compassFile([]));
      },
      writeFile: () => Promise.resolve(),
    };
    const call = caller(importExportHandlers({ profiles, secrets, dialogs, fs }));
    await expect(call('profiles.importCompass')).rejects.toSatisfy(
      (e) => e instanceof RpcError && e.code === 'INVALID_PARAMS' && /too large/.test(e.message),
    );
    expect(reads).toBe(0);
    // Exactly at the limit is still read.
    expect(await call('profiles.importCompass')).toEqual({
      imported: [],
      skipped: [],
      notices: [],
    });
    expect(reads).toBe(1);
  });

  it('returns null when the open dialog gives no file; no path from the save dialog writes nothing', async () => {
    const { profiles, secrets } = setup();
    const dialogs: NativeDialogs = {
      showOpenDialog: () => Promise.resolve({ canceled: false, filePaths: [] }),
      showSaveDialog: () => Promise.resolve({ canceled: false }),
    };
    const call = caller(importExportHandlers({ profiles, secrets, dialogs }));
    expect(await call('profiles.importCompass')).toBeNull();
    expect(await call('profiles.export')).toEqual({ path: null, exported: 0 });
  });

  it('maps a BOM-prefixed file, a non-JSON file and a read-only store correctly', async () => {
    const bom = setup({ file: `${BOM}${fixture('compass-encrypted.json')}` });
    const result = (await bom.call('profiles.importCompass')) as { imported: Profile[] };
    expect(result.imported).toHaveLength(2);

    const notJson = setup({ file: 'not json at all' });
    await expect(notJson.call('profiles.importCompass')).rejects.toSatisfy(
      (e) => e instanceof RpcError && e.code === 'INVALID_PARAMS',
    );

    const readOnly = setup();
    readOnly.profiles.save = () => Promise.reject(new ProfilesReadOnlyError(99));
    await expect(
      readOnly.call('profiles.importUris', { uris: ['mongodb://a.test'] }),
    ).rejects.toSatisfy((e) => e instanceof RpcError && e.code === 'UNSUPPORTED');

    const broken = setup();
    broken.profiles.list = () => Promise.reject(new Error('disk on fire'));
    await expect(
      broken.call('profiles.importUris', { uris: ['mongodb://a.test'] }),
    ).rejects.toThrow('disk on fire');
  });

  it('imports a Compass entry with a color named "constructor" instead of failing the import', async () => {
    // TW-1: the inherited value is not a color, so saving the profile must not fail.
    const { profiles, call } = setup({
      file: compassFile([
        { connectionOptions: { connectionString: 'mongodb://a.test' }, favorite: { name: 'A' } },
        {
          connectionOptions: { connectionString: 'mongodb://b.test' },
          favorite: { name: 'B', color: 'constructor' },
        },
      ]),
    });
    const result = (await call('profiles.importCompass')) as { imported: Profile[] };
    expect(result.imported.map((p) => [p.name, p.color])).toEqual([
      ['A', undefined],
      ['B', undefined],
    ]);
    expect(profiles.profiles).toHaveLength(2);
  });

  it('profiles.importCompass reads a Thicket file: strips secrets, skips invalid entries (CR-5)', async () => {
    const file = JSON.stringify({
      type: 'Thicket Connections',
      version: 1,
      profiles: [
        {
          id: 'old',
          name: 'Shared',
          connectionString: 'mongodb://alice@a.test/?proxyHost=s.test&proxyPassword=fake-proxy-pw',
          readOnly: false,
          production: false,
          auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'saved' },
        },
        { name: 'Broken', readOnly: false, production: false },
      ],
    });
    const { profiles, secrets, call } = setup({ file });
    const result = await call('profiles.importCompass');
    expect(parseResult('profiles.importCompass', result).ok).toBe(true);
    const { imported, skipped, notices } = result as {
      imported: Profile[];
      skipped: { source: string }[];
      notices: { source: string }[];
    };
    expect(imported.map((p) => [p.id, p.name, p.auth?.secretMode])).toEqual([
      ['id1', 'Shared', 'ask'],
    ]);
    expect(skipped.map((s) => s.source)).toEqual(['Broken']);
    expect(notices.map((n) => n.source)).toEqual(['Shared']);
    expect(secrets.stored).toEqual([]);
    expect(JSON.stringify([result, profiles.profiles])).not.toContain('fake-proxy-pw');

    const readOnly = setup({ file });
    readOnly.profiles.save = () => Promise.reject(new ProfilesReadOnlyError(99));
    await expect(readOnly.call('profiles.importCompass')).rejects.toSatisfy(
      (e) => e instanceof RpcError && e.code === 'UNSUPPORTED',
    );
  });

  it('does not ask the keychain when no entry has a secret', async () => {
    const { secrets, call } = setup({ level: 'weak' });
    let asked = 0;
    const status = secrets.status.bind(secrets);
    secrets.status = () => {
      asked++;
      return status();
    };
    const result = (await call('profiles.importUris', {
      uris: ['mongodb://a.test', 'mongodb://bob@b.test'],
    })) as { imported: Profile[]; notices: unknown[] };
    expect(asked).toBe(0);
    expect(result.imported).toHaveLength(2);
    expect(result.notices).toEqual([]);
  });

  it('skips duplicates inside one import, keeping the first', async () => {
    const { profiles, call } = setup();
    const result = (await call('profiles.importUris', {
      uris: ['mongodb://a.test', 'mongodb://a.test', 'mongodb://b.test'],
    })) as { imported: Profile[]; skipped: { source: string; reason: string }[] };
    expect(result.imported.map((p) => p.name)).toEqual(['a.test', 'b.test']);
    expect(result.skipped).toEqual([
      { source: 'mongodb://a.test', reason: 'a connection with this name and address exists' },
    ]);
    expect(profiles.profiles).toHaveLength(2);
  });

  it('keeps secretMode when a non-password secret fails or is dropped on a weak keychain', async () => {
    const tunnel = compassFile([
      sshEntry({ host: 'b.test', username: 'ops', password: 'fake-ssh-pw' }, 'mongodb://u@a.test'),
    ]);
    const secure = setup({ file: tunnel });
    secure.secrets.failKinds.add('sshPassword');
    const failed = (await secure.call('profiles.importCompass')) as {
      imported: Profile[];
      notices: { source: string; reason: string }[];
    };
    expect(failed.imported[0]?.auth?.secretMode).toBe('ask');
    expect(failed.notices).toEqual([
      {
        source: 'Tunnel',
        reason: 'SSH password could not be saved; enter the SSH password in the connection editor',
      },
    ]);

    const weak = setup({ level: 'unavailable', file: tunnel });
    const dropped = (await weak.call('profiles.importCompass')) as {
      notices: { source: string; reason: string }[];
    };
    expect(weak.secrets.stored).toEqual([]);
    expect(dropped.notices[0]?.reason).toMatch(/^SSH password not saved: .*not secure/);
    // Only the database password is asked when connecting (CR-6).
    expect(dropped.notices[0]?.reason).toMatch(/enter the SSH password in the connection editor$/);
    expect(dropped.notices[0]?.reason).not.toMatch(/when connecting/);
  });

  it('a failing password secret turns saved into ask in the stored profile and the result', async () => {
    const { profiles, secrets, call } = setup();
    secrets.failKinds.add('password');
    const result = (await call('profiles.importUris', {
      uris: ['mongodb://alice:fake-pw@a.test'],
    })) as { imported: Profile[] };
    expect(result.imported[0]?.auth?.secretMode).toBe('ask');
    expect(profiles.profiles).toHaveLength(1);
    expect(profiles.profiles[0]?.auth?.secretMode).toBe('ask');
    expect(result.imported[0]?.id).toBe(profiles.profiles[0]?.id);
  });

  it('reports the encrypted-credentials notice through the handler (contract-valid)', async () => {
    const { call } = setup({ file: fixture('compass-encrypted.json') });
    const result = await call('profiles.importCompass');
    expect(parseResult('profiles.importCompass', result).ok).toBe(true);
    expect((result as { notices: { source: string }[] }).notices.map((n) => n.source)).toEqual([
      'Encrypted prod',
    ]);
  });

  it('profiles.export with an empty selection exports nothing (not everything)', async () => {
    const { written, call } = setup();
    await call('profiles.importUris', { uris: ['mongodb://a.test', 'mongodb://b.test'] });
    expect(await call('profiles.export', { profileIds: [] })).toEqual({
      path: '/out.json',
      exported: 0,
    });
    const file = JSON.parse(written[0]?.data ?? '{}') as { profiles: unknown[] };
    expect(file.profiles).toEqual([]);
  });

  it('profiles.export writes UTF-8 with mode 0644; the file re-imports as new profiles', async () => {
    const { profiles, secrets, dialogs } = setup();
    const writes: { options: unknown; data: string }[] = [];
    const fs: ImportExportFs = {
      stat: () => Promise.resolve({ size: 10 }),
      readFile: () => Promise.resolve(writes[0]?.data ?? ''),
      writeFile: (_path, data, options) => {
        writes.push({ data, options });
        return Promise.resolve();
      },
    };
    const call = caller(importExportHandlers({ profiles, secrets, dialogs, fs }));
    await call('profiles.importUris', { uris: ['mongodb://alice:fake-pw@a.test'] });
    await call('profiles.export');
    expect(writes[0]?.options).toEqual({ encoding: 'utf8', mode: 0o644 });
    expect(writes[0]?.data).not.toContain('fake-pw');
    // Re-importing the export into the same store adds nothing (same name and address).
    const again = (await call('profiles.importCompass')) as { imported: Profile[] };
    expect(again.imported).toEqual([]);
    profiles.profiles = [];
    const fresh = (await call('profiles.importCompass')) as { imported: Profile[] };
    expect(fresh.imported.map((p) => [p.name, p.auth?.secretMode])).toEqual([['a.test', 'ask']]);
  });
});
