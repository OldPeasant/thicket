import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SecretStorageUnavailableError, SecretsStore } from './store';
import { FakeSafeStorage } from './testing';

// All secret values are fictitious.
let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'thicket-secrets-'));
  file = path.join(dir, 'secrets.bin');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeStore(safeStorage = new FakeSafeStorage(), platform: NodeJS.Platform = 'linux') {
  const log = vi.fn<(message: string) => void>();
  const store = new SecretsStore({
    file,
    safeStorage,
    platform,
    log,
    now: () => new Date('2026-11-16T10:20:30.456Z'),
  });
  return { store, safeStorage, log };
}

describe('SecretsStore set/get/delete', () => {
  it('starts empty without a file', async () => {
    const { store } = makeStore();
    expect(await store.get('p1')).toBeNull();
    expect(await store.kinds('p1')).toEqual([]);
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('stores secrets per profile and reads them back', async () => {
    const { store } = makeStore();
    await store.set('p1', 'password', 'fictitious-pw');
    await store.set('p1', 'sshKeyPassphrase', 'fictitious-pass');
    await store.set('p2', 'password', 'other-pw');
    expect(await store.get('p1')).toEqual({
      password: 'fictitious-pw',
      sshKeyPassphrase: 'fictitious-pass',
    });
    expect(await store.get('p2')).toEqual({ password: 'other-pw' });
    expect(await store.kinds('p1')).toEqual(['password', 'sshKeyPassphrase']);
  });

  it('overwrites a secret of the same kind', async () => {
    const { store } = makeStore();
    await store.set('p1', 'password', 'old');
    await store.set('p1', 'password', 'new');
    expect(await store.get('p1')).toEqual({ password: 'new' });
  });

  it('persists encrypted: a new store reads the file, which holds no plain text', async () => {
    const { store } = makeStore();
    await store.set('profile-with-id', 'password', 'fictitious-pw');
    const bytes = await readFile(file);
    expect(bytes.toString('utf8')).not.toContain('fictitious-pw');
    expect(bytes.toString('utf8')).not.toContain('profile-with-id');
    const { store: reopened } = makeStore();
    expect(await reopened.get('profile-with-id')).toEqual({ password: 'fictitious-pw' });
  });

  it('writes the file with mode 0600 and leaves no temp files', async () => {
    const { store } = makeStore();
    await store.set('p1', 'password', 'x');
    await store.set('p1', 'password', 'y');
    expect(await readdir(dir)).toEqual(['secrets.bin']);
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('deletes one kind, then the profile when its last secret goes', async () => {
    const { store } = makeStore();
    await store.set('p1', 'password', 'pw');
    await store.set('p1', 'tlsKeyPassphrase', 'tls');
    await store.delete('p1', 'password');
    expect(await store.get('p1')).toEqual({ tlsKeyPassphrase: 'tls' });
    await store.delete('p1', 'tlsKeyPassphrase');
    expect(await store.get('p1')).toBeNull();
    const { store: reopened } = makeStore();
    expect(await reopened.get('p1')).toBeNull();
  });

  it('deletes all secrets of a profile without a kind, leaving other profiles', async () => {
    const { store } = makeStore();
    await store.set('p1', 'password', 'pw');
    await store.set('p1', 'sshPassword', 'ssh');
    await store.set('p2', 'password', 'keep');
    await store.delete('p1');
    expect(await store.get('p1')).toBeNull();
    expect(await store.get('p2')).toEqual({ password: 'keep' });
  });

  it('deleting something that is not stored does not write', async () => {
    const { store, safeStorage } = makeStore();
    await store.set('p1', 'password', 'pw');
    const writes = safeStorage.encryptCalls;
    await store.delete('p1', 'sshPassword');
    await store.delete('nobody');
    expect(safeStorage.encryptCalls).toBe(writes);
  });

  it('returns copies: changing a result does not change the store', async () => {
    const { store } = makeStore();
    await store.set('p1', 'password', 'pw');
    const got = await store.get('p1');
    if (got) got.password = 'tampered';
    expect(await store.get('p1')).toEqual({ password: 'pw' });
  });

  it('treats profile ids like __proto__ as plain keys', async () => {
    const { store } = makeStore();
    expect(await store.get('__proto__')).toBeNull();
    expect(await store.get('constructor')).toBeNull();
    await store.set('__proto__', 'password', 'pw');
    const { store: reopened } = makeStore();
    expect(await reopened.get('__proto__')).toEqual({ password: 'pw' });
    expect(await reopened.get('toString')).toBeNull();
  });

  it('serializes concurrent writes', async () => {
    const { store } = makeStore();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.set(`p${i}`, 'password', `pw${i}`)),
    );
    const { store: reopened } = makeStore();
    for (let i = 0; i < 20; i++)
      expect(await reopened.get(`p${i}`)).toEqual({ password: `pw${i}` });
  });

  it('re-encrypts the file when safeStorage asks for it', async () => {
    const { store } = makeStore();
    await store.set('p1', 'password', 'pw');
    const rotating = new FakeSafeStorage({ shouldReEncrypt: true });
    const { store: reopened } = makeStore(rotating);
    expect(await reopened.get('p1')).toEqual({ password: 'pw' });
    expect(rotating.encryptCalls).toBe(1);
  });
});

describe('SecretsStore with a corrupt file', () => {
  const corrupt = (bytes: Buffer | string) => writeFile(file, bytes);
  const fake = new FakeSafeStorage();
  const encrypted = async (text: string) => fake.encryptStringAsync(text);

  it.each([
    ['garbage bytes', () => corrupt(Buffer.from([0, 1, 2, 3, 255]))],
    ['an empty file', () => corrupt('')],
    ['plain JSON (not encrypted)', () => corrupt('{"version":1,"profiles":{}}')],
    ['encrypted non-JSON', async () => corrupt(await encrypted('not json'))],
    ['an unknown version', async () => corrupt(await encrypted('{"version":2,"profiles":{}}'))],
    ['profiles not an object', async () => corrupt(await encrypted('{"version":1,"profiles":[]}'))],
    [
      'an unknown secret kind',
      async () => corrupt(await encrypted('{"version":1,"profiles":{"p":{"pin":"1"}}}')),
    ],
    [
      'a non-string value',
      async () => corrupt(await encrypted('{"version":1,"profiles":{"p":{"password":1}}}')),
    ],
    ['a JSON array', async () => corrupt(await encrypted('[1]'))],
  ])('%s: moves the file aside, starts empty and keeps working', async (_name, write) => {
    await write();
    const original = await readFile(file);
    const { store, log } = makeStore();
    expect(await store.get('p')).toBeNull();
    const aside = path.join(dir, 'secrets.bin.corrupt-2026-11-16T10-20-30-456Z');
    expect(await readFile(aside)).toEqual(original);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('moved aside'));
    await store.set('p', 'password', 'fresh');
    const { store: reopened } = makeStore();
    expect(await reopened.get('p')).toEqual({ password: 'fresh' });
  });

  it('a file from another keychain key (decrypt throws) is moved aside too', async () => {
    await writeFile(file, Buffer.from('v11-other-key-ciphertext'));
    const { store } = makeStore();
    expect(await store.kinds('p')).toEqual([]);
    expect((await readdir(dir)).sort()).toEqual(['secrets.bin.corrupt-2026-11-16T10-20-30-456Z']);
  });

  it('propagates read errors other than a missing file', async () => {
    const store = new SecretsStore({
      file,
      safeStorage: new FakeSafeStorage(),
      platform: 'linux',
      fs: {
        readFile: () => Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' })),
        writeFile: () => Promise.resolve(),
        rename: () => Promise.resolve(),
        rm: () => Promise.resolve(),
      },
    });
    await expect(store.get('p')).rejects.toThrow('EACCES');
  });

  it('removes the temp file when the rename fails and keeps the old state', async () => {
    const removed: string[] = [];
    const store = new SecretsStore({
      file,
      safeStorage: new FakeSafeStorage(),
      platform: 'linux',
      fs: {
        readFile: () => Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
        writeFile: () => Promise.resolve(),
        rename: () => Promise.reject(new Error('EXDEV')),
        rm: (temp) => {
          removed.push(temp);
          return Promise.resolve();
        },
      },
    });
    await expect(store.set('p', 'password', 'pw')).rejects.toThrow('EXDEV');
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatch(/secrets\.bin\..+\.tmp$/);
    expect(await store.get('p')).toBeNull();
  });
});

describe('SecretsStore status', () => {
  it.each(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])(
    'Linux with %s is secure and saves passwords by default',
    async (backend) => {
      const { store } = makeStore(new FakeSafeStorage({ backend }));
      expect(await store.status()).toEqual({
        level: 'secure',
        backend,
        defaultSecretMode: 'saved',
      });
    },
  );

  it('Linux basic_text is weak: profiles default to not saving passwords', async () => {
    const safeStorage = new FakeSafeStorage({ backend: 'basic_text' });
    const { store } = makeStore(safeStorage);
    expect(await store.status()).toEqual({
      level: 'weak',
      backend: 'basic_text',
      defaultSecretMode: 'ask',
    });
    // Electron's plain-text key is switched on so a user who insists can still save.
    expect(safeStorage.plainText).toBe(true);
    await store.set('p', 'password', 'pw');
    expect(await store.get('p')).toEqual({ password: 'pw' });
  });

  it('Linux before ready (unknown backend) counts as weak, never as secure', async () => {
    const { store } = makeStore(new FakeSafeStorage({ backend: 'unknown' }));
    expect(await store.status()).toMatchObject({ level: 'weak', defaultSecretMode: 'ask' });
  });

  it.each([
    ['darwin', 'keychain'],
    ['win32', 'dpapi'],
  ] as const)('%s is secure (%s)', async (platform, backend) => {
    const safeStorage = new FakeSafeStorage({ backend: 'must-not-be-used' });
    const { store } = makeStore(safeStorage, platform);
    expect(await store.status()).toEqual({ level: 'secure', backend, defaultSecretMode: 'saved' });
    expect(safeStorage.plainText).toBe(false);
  });

  it('no encryption: unavailable, set refuses, get leaves an existing file alone', async () => {
    await writeFile(
      file,
      await new FakeSafeStorage().encryptStringAsync(
        '{"version":1,"profiles":{"p":{"password":"pw"}}}',
      ),
    );
    const { store } = makeStore(new FakeSafeStorage({ available: false }));
    expect(await store.status()).toEqual({
      level: 'unavailable',
      backend: 'gnome_libsecret',
      defaultSecretMode: 'ask',
    });
    await expect(store.set('p', 'password', 'x')).rejects.toBeInstanceOf(
      SecretStorageUnavailableError,
    );
    expect(await store.get('p')).toBeNull();
    expect(await readdir(dir)).toEqual(['secrets.bin']);
    // Once encryption works again the old secrets are still there.
    const { store: later } = makeStore();
    expect(await later.get('p')).toEqual({ password: 'pw' });
  });

  it('a failing availability check counts as unavailable', async () => {
    const safeStorage = new FakeSafeStorage();
    safeStorage.isAsyncEncryptionAvailable = () => Promise.reject(new Error('dbus down'));
    const { store, log } = makeStore(safeStorage);
    expect((await store.status()).level).toBe('unavailable');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('dbus down'));
  });

  it('detects once', async () => {
    const safeStorage = new FakeSafeStorage();
    const spy = vi.spyOn(safeStorage, 'isAsyncEncryptionAvailable');
    const { store } = makeStore(safeStorage);
    await store.status();
    await store.set('p', 'password', 'pw');
    await store.status();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
