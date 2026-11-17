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
import {
  ImportFileError,
  exportFile,
  importExportHandlers,
  parseImportFile,
  parseUriList,
  profileFromUri,
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

  it('falls back to asking when storing the password fails', async () => {
    const { profiles, secrets, call } = setup();
    secrets.failKinds.add('password');
    const result = (await call('profiles.importCompass')) as {
      notices: { source: string; reason: string }[];
    };
    expect(profiles.profiles[0]?.auth?.secretMode).toBe('ask');
    expect(result.notices).toContainEqual({
      source: 'Orders (staging)',
      reason: expect.stringContaining('could not be saved') as string,
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
