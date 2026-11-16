import { parseResult, type ProfileDraft, type SecretKind } from '@thicket/contract';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SecretsStore, secretsHandlers } from '../secrets';
import { FakeSafeStorage } from '../secrets/testing';
import { profilesHandlers } from './handlers';
import {
  ProfileNotFoundError,
  ProfilesReadOnlyError,
  ProfilesStore,
  migrate,
  splitPassword,
  type ProfileSecretsAccess,
  type ProfilesFs,
} from './store';

/** Id given to a v0 entry without one. */
const V0_ID = /^v0-[0-9a-f]{32}$/;

const ctx = { signal: new AbortController().signal, requestId: '1' };
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'thicket-profiles-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(options: { fs?: ProfilesFs; safeStorage?: FakeSafeStorage } = {}) {
  const safeStorage = options.safeStorage ?? new FakeSafeStorage();
  const secrets = new SecretsStore({
    file: path.join(dir, 'secrets.bin'),
    safeStorage,
    platform: 'linux',
  });
  let n = 0;
  const logs: string[] = [];
  const store = new ProfilesStore({
    file: path.join(dir, 'connections.json'),
    secrets,
    ...(options.fs ? { fs: options.fs } : {}),
    log: (message) => logs.push(message),
    now: () => new Date('2026-01-02T03:04:05.678Z'),
    newId: () => `id-${++n}`,
  });
  const handlers = { ...profilesHandlers(store, secretsHandlers(secrets)) };
  const call = (method: string, params: unknown) =>
    Promise.resolve(handlers[method]?.(params as never, ctx));
  return { store, secrets, safeStorage, call, logs };
}

const draft = (overrides: Partial<ProfileDraft> = {}): ProfileDraft => ({
  name: 'Local',
  connectionString: 'mongodb://localhost:27017',
  readOnly: false,
  production: false,
  ...overrides,
});

async function fileJson(name = 'connections.json'): Promise<unknown> {
  return JSON.parse(await readFile(path.join(dir, name), 'utf8')) as unknown;
}

describe('ProfilesStore CRUD', () => {
  it('starts empty without a file and writes nothing on reads', async () => {
    const { store } = setup();
    expect(await store.list()).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('creates, lists, gets, updates and deletes profiles', async () => {
    const { store } = setup();
    const a = await store.save(
      draft({ name: 'A', color: '#f00', folder: 'Team/Dev', readOnly: true }),
    );
    const b = await store.save(draft({ name: 'B', production: true }));
    expect(a.id).toBe('id-1');
    expect(b.id).toBe('id-2');
    expect((await store.list()).map((p) => p.name)).toEqual(['A', 'B']);
    expect(await store.get('id-1')).toEqual({ profile: a, storedSecrets: [] });
    expect(a).toMatchObject({ color: '#f00', folder: 'Team/Dev', readOnly: true });

    const renamed = await store.save({ ...a, name: 'A2', readOnly: false });
    expect(renamed).toMatchObject({ id: 'id-1', name: 'A2', readOnly: false });
    expect((await store.list()).map((p) => p.name)).toEqual(['A2', 'B']);
    expect(await fileJson()).toEqual({ version: 1, profiles: [renamed, b] });

    await store.delete('id-1');
    expect((await store.list()).map((p) => p.id)).toEqual(['id-2']);
    // A fresh store reads the same from disk.
    expect(await setup().store.list()).toEqual([b]);
  });

  it('refuses unknown ids', async () => {
    const { store } = setup();
    await expect(store.get('nope')).rejects.toBeInstanceOf(ProfileNotFoundError);
    await expect(store.save(draft({ id: 'nope' }))).rejects.toBeInstanceOf(ProfileNotFoundError);
    await expect(store.delete('nope')).rejects.toBeInstanceOf(ProfileNotFoundError);
    await expect(store.duplicate('nope')).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it('refuses a connection string with a password', async () => {
    const { store } = setup();
    await expect(store.save(draft({ connectionString: 'mongodb://u:pw@h' }))).rejects.toThrow(
      /password/,
    );
    expect(await store.list()).toEqual([]);
  });

  it('keeps the "ask for password each time" mode', async () => {
    const { store } = setup();
    const p = await store.save(
      draft({ auth: { mechanism: 'SCRAM-SHA-256', username: 'u', secretMode: 'ask' } }),
    );
    expect((await store.get(p.id)).profile.auth?.secretMode).toBe('ask');
  });

  it('removes a saved password when the profile switches to "ask each time"', async () => {
    const { store, secrets } = setup();
    const auth = {
      mechanism: 'SCRAM-SHA-256' as const,
      username: 'u',
      secretMode: 'saved' as const,
    };
    const p = await store.save(draft({ auth }));
    await secrets.set(p.id, 'password', 'pw');
    await secrets.set(p.id, 'sshPassword', 'ssh');
    await store.save({ ...p, auth: { ...auth, secretMode: 'ask' } });
    expect(await secrets.get(p.id)).toEqual({ sshPassword: 'ssh' });
  });

  it('duplicate copies everything but the id, name and secrets', async () => {
    const { store, secrets } = setup();
    const a = await store.save(
      draft({
        name: 'Prod',
        production: true,
        color: 'red',
        folder: 'F',
        auth: { mechanism: 'SCRAM-SHA-256', username: 'u', secretMode: 'saved' },
      }),
    );
    const other = await store.save(draft({ name: 'Other' }));
    await secrets.set(a.id, 'password', 'pw');
    const copy = await store.duplicate(a.id);
    expect(copy).toEqual({ ...a, id: 'id-3', name: 'Prod (copy)' });
    expect((await store.list()).map((p) => p.id)).toEqual([a.id, copy.id, other.id]);
    expect(await store.get(copy.id)).toEqual({ profile: copy, storedSecrets: [] });
    expect(await secrets.get(copy.id)).toBeNull();
    expect(await secrets.get(a.id)).toEqual({ password: 'pw' });
  });

  it('delete removes the profile secrets', async () => {
    const { store, secrets } = setup();
    const p = await store.save(draft());
    await secrets.set(p.id, 'password', 'pw');
    await store.delete(p.id);
    expect(await secrets.get(p.id)).toBeNull();
  });

  it('returns copies, so callers cannot change the stored profiles', async () => {
    const { store } = setup();
    const p = await store.save(draft());
    const [listed] = await store.list();
    if (listed) listed.name = 'changed';
    p.name = 'changed too';
    expect((await store.get(p.id)).profile.name).toBe('Local');
  });

  it('serializes concurrent saves', async () => {
    const { store } = setup();
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.save(draft({ name: `P${i}` }))));
    expect(await setup().store.list()).toHaveLength(10);
  });
});

describe('secrets stay out of connections.json', () => {
  it('a saved profile with a password writes it only to secrets.bin', async () => {
    const { call } = setup();
    const saved = (await call('profiles.save', {
      profile: draft({
        connectionString: 'mongodb://alice@db.example.net:27017/?authSource=admin',
        auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'saved' },
      }),
    })) as { profile: { id: string } };
    const secret = 'Pa55-unique-7f3c9e';
    expect(
      await call('profiles.setSecret', {
        profileId: saved.profile.id,
        kind: 'password',
        value: secret,
      }),
    ).toEqual({ secureStorage: true });

    const connections = await readFile(path.join(dir, 'connections.json'), 'utf8');
    expect(connections).not.toContain(secret);
    expect(connections).toContain('alice');
    const raw = await readFile(path.join(dir, 'secrets.bin'));
    expect(raw.toString('latin1')).not.toContain(secret);
    // secrets.bin decrypts to the password, keyed by the profile id.
    const decrypted = await new FakeSafeStorage().decryptStringAsync(raw);
    expect(JSON.parse(decrypted.result)).toEqual({
      version: 1,
      profiles: { [saved.profile.id]: { password: secret } },
    });
    const got = await call('profiles.get', { profileId: saved.profile.id });
    expect(got).toMatchObject({ storedSecrets: ['password'] });
    expect(JSON.stringify(got)).not.toContain(secret);
    expect(await readdir(dir)).toEqual(expect.arrayContaining(['connections.json', 'secrets.bin']));
  });

  it('profiles.setSecret for an unknown profile is NOT_FOUND and stores nothing', async () => {
    const { call } = setup();
    await expect(
      call('profiles.setSecret', { profileId: 'ghost', kind: 'password', value: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('handlers', () => {
  it('answer within the contract and map errors', async () => {
    const { call } = setup();
    const saved = await call('profiles.save', { profile: draft() });
    expect(parseResult('profiles.save', saved).ok).toBe(true);
    const id = (saved as { profile: { id: string } }).profile.id;
    expect(parseResult('profiles.list', await call('profiles.list', {})).ok).toBe(true);
    expect(parseResult('profiles.get', await call('profiles.get', { profileId: id })).ok).toBe(
      true,
    );
    const dup = await call('profiles.duplicate', { profileId: id });
    expect(parseResult('profiles.duplicate', dup).ok).toBe(true);
    expect(await call('profiles.delete', { profileId: id })).toEqual({});
    await expect(call('profiles.get', { profileId: id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('a newer file version is readable but changes are UNSUPPORTED', async () => {
    const profile = { ...draft(), id: 'x', futureField: 1 };
    await writeFile(
      path.join(dir, 'connections.json'),
      JSON.stringify({ version: 99, profiles: [profile] }),
    );
    const { call, store } = setup();
    expect(await store.list()).toEqual([{ ...draft(), id: 'x' }]);
    await expect(call('profiles.save', { profile: draft() })).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
    await expect(store.delete('x')).rejects.toBeInstanceOf(ProfilesReadOnlyError);
    expect(await fileJson()).toEqual({ version: 99, profiles: [profile] });
  });
});

describe('migration', () => {
  const fixture = path.join(import.meta.dirname, 'fixtures', 'connections.v0.json');

  it('migrates the v0 fixture, moving passwords into secrets.bin', async () => {
    await writeFile(path.join(dir, 'connections.json'), await readFile(fixture));
    const { store, secrets, logs } = setup();
    const profiles = await store.list();
    expect(profiles).toEqual([
      {
        id: 'legacy-1',
        name: 'Local dev',
        connectionString: 'mongodb://localhost:27017/?directConnection=true',
        color: '#3a7',
        folder: 'Dev/Local',
        readOnly: false,
        production: false,
      },
      {
        id: 'legacy-2',
        name: 'Prod cluster',
        connectionString: 'mongodb+srv://admin@cluster0.example.net/?retryWrites=true',
        auth: { mechanism: 'SCRAM-SHA-256', username: 'admin', secretMode: 'saved' },
        readOnly: true,
        production: true,
      },
      {
        id: expect.stringMatching(V0_ID) as string,
        name: 'Ask me',
        connectionString: 'mongodb://alice@db1:27017,db2:27017/?replicaSet=rs0',
        auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'ask' },
        readOnly: false,
        production: false,
      },
    ]);
    // The file is rewritten in the current layout, without passwords.
    expect(await fileJson()).toEqual({ version: 1, profiles });
    const text = await readFile(path.join(dir, 'connections.json'), 'utf8');
    expect(text).not.toContain('cret-pw');
    expect(text).not.toContain('typed-each-time');
    expect(await secrets.get('legacy-2')).toEqual({ password: 's@cret-pw' });
    expect(await secrets.get(profiles[2]?.id ?? '')).toBeNull();
    expect(logs.some((m) => m.includes('migrated'))).toBe(true);
    // Loading again is a no-op.
    expect(await setup().store.list()).toEqual(profiles);
  });

  it('asks for the password when secrets.bin cannot take it', async () => {
    await writeFile(path.join(dir, 'connections.json'), await readFile(fixture));
    const { store } = setup({ safeStorage: new FakeSafeStorage({ available: false }) });
    const prod = (await store.list()).find((p) => p.id === 'legacy-2');
    expect(prod?.auth?.secretMode).toBe('ask');
    expect(await readFile(path.join(dir, 'connections.json'), 'utf8')).not.toContain('cret-pw');
  });

  it('migrate() rejects unknown layouts', () => {
    expect(migrate(null)).toBeUndefined();
    expect(migrate({ version: 0, profiles: [] })).toBeUndefined();
    expect(migrate({ version: 1, profiles: {} })).toBeUndefined();
    expect(migrate({ version: 1, profiles: [] })).toEqual({
      version: 1,
      profiles: [],
      secrets: [],
    });
  });

  it('splitPassword removes the password from the userinfo', () => {
    expect(splitPassword('mongodb://u:p%3Aw@h:1/db?x=1')).toEqual({
      uri: 'mongodb://u@h:1/db?x=1',
      password: 'p:w',
    });
    expect(splitPassword('mongodb://h')).toEqual({ uri: 'mongodb://h' });
    expect(splitPassword('mongodb://:pw@h')).toEqual({ uri: 'mongodb://h', password: 'pw' });
  });
});

describe('corrupt files', () => {
  it.each([
    ['not JSON', '{oops'],
    ['an unknown layout', '{"profiles": []}'],
    ['an invalid profile', JSON.stringify({ version: 1, profiles: [{ id: 'x' }] })],
    [
      'duplicate ids',
      JSON.stringify({
        version: 1,
        profiles: [
          { ...draft(), id: 'x' },
          { ...draft(), id: 'x' },
        ],
      }),
    ],
  ])('moves a file with %s aside and starts empty', async (_name, content) => {
    await writeFile(path.join(dir, 'connections.json'), content);
    const { store } = setup();
    expect(await store.list()).toEqual([]);
    const backup = 'connections.json.corrupt-2026-01-02T03-04-05-678Z';
    expect(await readdir(dir)).toEqual([backup]);
    expect(await readFile(path.join(dir, backup), 'utf8')).toBe(content);
  });

  it('an unreadable file fails the operation and is not overwritten', async () => {
    const failing: ProfilesFs = {
      readFile: () => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })),
      writeFile: () => Promise.reject(new Error('must not write')),
      rename: () => Promise.reject(new Error('must not rename')),
      unlink: () => Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    };
    const { store } = setup({ fs: failing });
    await expect(store.list()).rejects.toThrow('denied');
    await expect(store.save(draft())).rejects.toThrow('denied');
  });
});

describe('atomic writes', () => {
  /** Real fs that "crashes" (throws) on the rename after the temp file was written. */
  function crashingFs(): ProfilesFs & { crash: boolean } {
    const wrapper = {
      crash: false,
      readFile: (p: string, e: 'utf8') => fs.readFile(p, e),
      writeFile: (p: string, d: string, o: { flush: boolean }) => fs.writeFile(p, d, o),
      rename: async (from: string, to: string) => {
        if (wrapper.crash) throw new Error('crash before rename');
        await fs.rename(from, to);
      },
      unlink: (p: string) => fs.unlink(p),
    };
    return wrapper;
  }

  it('writes through a flushed temp file renamed over connections.json', async () => {
    const calls: string[] = [];
    const tracing: ProfilesFs = {
      readFile: (p, e) => fs.readFile(p, e),
      writeFile: async (p, d, o) => {
        calls.push(`write ${path.basename(p)} flush=${String(o.flush)}`);
        await fs.writeFile(p, d, o);
      },
      rename: async (from, to) => {
        calls.push(`rename ${path.basename(from)} -> ${path.basename(to)}`);
        await fs.rename(from, to);
      },
      unlink: (p) => fs.unlink(p),
    };
    await setup({ fs: tracing }).store.save(draft());
    expect(calls).toEqual([
      'write connections.json.tmp flush=true',
      'rename connections.json.tmp -> connections.json',
    ]);
  });

  it('a crash between write and rename keeps the previous file and state', async () => {
    const crashing = crashingFs();
    const { store } = setup({ fs: crashing });
    const first = await store.save(draft({ name: 'First' }));
    crashing.crash = true;
    await expect(store.save(draft({ name: 'Second' }))).rejects.toThrow('crash before rename');
    expect(await fileJson()).toEqual({ version: 1, profiles: [first] });
    expect(await store.list()).toEqual([first]);
    expect(await readdir(dir)).toEqual(['connections.json']);
  });

  it('a temp file left by a real crash is removed on the next start', async () => {
    const { store } = setup();
    const first = await store.save(draft({ name: 'First' }));
    await writeFile(path.join(dir, 'connections.json.tmp'), '{"version":1,"profiles":[]} half');
    const next = setup();
    expect(await next.store.list()).toEqual([first]);
    expect(await readdir(dir)).toEqual(['connections.json']);
    expect(next.logs.some((m) => m.includes('unfinished write'))).toBe(true);
  });
});

/** A `ProfileSecretsAccess` whose operations can be made to fail; records what it was asked. */
function fakeSecrets(fail: { set?: boolean; delete?: boolean } = {}) {
  const stored = new Map<string, Record<string, string>>();
  const calls: string[] = [];
  const access: ProfileSecretsAccess = {
    kinds: (id) => Promise.resolve(Object.keys(stored.get(id) ?? {}) as SecretKind[]),
    set: (id, kind, value) => {
      calls.push(`set ${id} ${kind}`);
      if (fail.set) return Promise.reject(new Error('secrets.bin locked'));
      stored.set(id, { ...stored.get(id), [kind]: value });
      return Promise.resolve();
    },
    delete: (id, kind) => {
      calls.push(`delete ${id} ${kind ?? '*'}`);
      if (fail.delete) return Promise.reject(new Error('secrets.bin locked'));
      return Promise.resolve();
    },
  };
  return { ...access, stored, calls };
}

function storeWith(secrets: ProfileSecretsAccess, fsImpl?: ProfilesFs) {
  const logs: string[] = [];
  let n = 0;
  const store = new ProfilesStore({
    file: path.join(dir, 'connections.json'),
    secrets,
    ...(fsImpl ? { fs: fsImpl } : {}),
    log: (message) => logs.push(message),
    now: () => new Date('2026-01-02T03:04:05.678Z'),
    newId: () => `id-${++n}`,
  });
  return { store, logs };
}

/** Real fs whose rename throws while `crash` is set (a crash between write and rename). */
function renameCrashFs(): ProfilesFs & { crash: boolean } {
  const wrapper = {
    crash: false,
    readFile: (p: string, e: 'utf8') => fs.readFile(p, e),
    writeFile: (p: string, d: string, o: { flush: boolean }) => fs.writeFile(p, d, o),
    rename: async (from: string, to: string) => {
      if (wrapper.crash) throw new Error('crash before rename');
      await fs.rename(from, to);
    },
    unlink: (p: string) => fs.unlink(p),
  };
  return wrapper;
}

const savedAuth = {
  mechanism: 'SCRAM-SHA-256' as const,
  username: 'u',
  secretMode: 'saved' as const,
};

describe('secrets.bin failures', () => {
  it('delete removes the profile even when its secrets cannot be removed (logged)', async () => {
    const secrets = fakeSecrets({ delete: true });
    const { store, logs } = storeWith(secrets);
    const p = await store.save(draft());
    await store.delete(p.id);
    expect(await store.list()).toEqual([]);
    expect(await fileJson()).toEqual({ version: 1, profiles: [] });
    expect(secrets.calls).toContain(`delete ${p.id} *`);
    expect(logs.some((m) => m.includes(`could not remove the secrets of ${p.id}`))).toBe(true);
  });

  it('switching to "ask" still saves the profile when the password cannot be removed', async () => {
    const secrets = fakeSecrets({ delete: true });
    const { store, logs } = storeWith(secrets);
    const p = await store.save(draft({ auth: savedAuth }));
    const updated = await store.save({ ...p, auth: { ...savedAuth, secretMode: 'ask' } });
    expect(updated.auth?.secretMode).toBe('ask');
    expect(await fileJson()).toEqual({ version: 1, profiles: [updated] });
    expect(secrets.calls).toContain(`delete ${p.id} password`);
    expect(logs.some((m) => m.includes(`could not remove the saved password of ${p.id}`))).toBe(
      true,
    );
  });

  it('saving a profile that keeps secretMode "saved" does not touch its password', async () => {
    const secrets = fakeSecrets();
    const { store } = storeWith(secrets);
    const p = await store.save(draft({ auth: savedAuth }));
    await store.save({ ...p, name: 'Renamed' });
    expect(secrets.calls.filter((c) => c.startsWith('delete'))).toEqual([]);
  });

  it('creating a new profile never deletes secrets', async () => {
    const secrets = fakeSecrets();
    const { store } = storeWith(secrets);
    await store.save(draft({ auth: { mechanism: 'SCRAM-SHA-256', secretMode: 'none' } }));
    expect(secrets.calls).toEqual([]);
  });

  it('switching secretMode to "none" clears the saved password', async () => {
    const { store, secrets } = setup();
    const p = await store.save(draft({ auth: savedAuth }));
    await secrets.set(p.id, 'password', 'fictitious-pw');
    await store.save({ ...p, auth: { ...savedAuth, secretMode: 'none' } });
    expect(await secrets.get(p.id)).toBeNull();
  });

  it('an invalid save does not delete the saved password or change the profile', async () => {
    const { store, secrets } = setup();
    const p = await store.save(draft({ auth: savedAuth }));
    await secrets.set(p.id, 'password', 'fictitious-pw');
    await expect(
      store.save({ ...p, name: '', auth: { ...savedAuth, secretMode: 'ask' } }),
    ).rejects.toThrow();
    expect(await secrets.get(p.id)).toEqual({ password: 'fictitious-pw' });
    expect((await store.get(p.id)).profile).toEqual(p);
  });

  it('a save whose write crashes does not delete the saved password', async () => {
    const crashing = renameCrashFs();
    const secrets = fakeSecrets();
    const { store } = storeWith(secrets, crashing);
    const p = await store.save(draft({ auth: savedAuth }));
    crashing.crash = true;
    await expect(store.save({ ...p, auth: { ...savedAuth, secretMode: 'ask' } })).rejects.toThrow(
      'crash before rename',
    );
    expect(secrets.calls.filter((c) => c.startsWith('delete'))).toEqual([]);
    expect((await store.get(p.id)).profile.auth?.secretMode).toBe('saved');
  });
});

describe('write failures', () => {
  it('a failed temp write removes the temp file and keeps state; the next save works', async () => {
    let failWrite = true;
    const unlinked: string[] = [];
    const flaky: ProfilesFs = {
      readFile: (p, e) => fs.readFile(p, e),
      writeFile: async (p, d, o) => {
        if (failWrite) {
          await fs.writeFile(p, d.slice(0, 5), o);
          throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
        }
        await fs.writeFile(p, d, o);
      },
      rename: (from, to) => fs.rename(from, to),
      unlink: async (p) => {
        unlinked.push(path.basename(p));
        await fs.unlink(p);
      },
    };
    const { store } = setup({ fs: flaky });
    await expect(store.save(draft({ name: 'Lost' }))).rejects.toThrow('disk full');
    expect(unlinked).toContain('connections.json.tmp');
    expect(await readdir(dir)).toEqual([]);
    expect(await store.list()).toEqual([]);
    failWrite = false;
    const ok = await store.save(draft({ name: 'Kept' }));
    expect(await fileJson()).toEqual({ version: 1, profiles: [ok] });
  });

  it('a crashed delete or duplicate keeps the profile and its secrets', async () => {
    const crashing = renameCrashFs();
    const secrets = fakeSecrets();
    const { store } = storeWith(secrets, crashing);
    const p = await store.save(draft());
    crashing.crash = true;
    await expect(store.delete(p.id)).rejects.toThrow('crash before rename');
    await expect(store.duplicate(p.id)).rejects.toThrow('crash before rename');
    expect(await store.list()).toEqual([p]);
    expect(await fileJson()).toEqual({ version: 1, profiles: [p] });
    expect(secrets.calls.filter((c) => c.startsWith('delete'))).toEqual([]);
    expect(await readdir(dir)).toEqual(['connections.json']);
  });

  it('a failed operation does not block the following ones in the queue', async () => {
    const { store } = setup();
    const results = await Promise.allSettled([
      store.get('missing'),
      store.save(draft({ name: 'After failure' })),
    ]);
    expect(results[0]?.status).toBe('rejected');
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: { name: 'After failure' } });
  });

  it('reports the write error, not the cleanup error, when no temp file was created', async () => {
    const refusing: ProfilesFs = {
      readFile: (p, e) => fs.readFile(p, e),
      writeFile: () => Promise.reject(Object.assign(new Error('read-only fs'), { code: 'EROFS' })),
      rename: (from, to) => fs.rename(from, to),
      unlink: (p) => fs.unlink(p),
    };
    const { store } = setup({ fs: refusing });
    await expect(store.save(draft())).rejects.toThrow('read-only fs');
    expect(await store.list()).toEqual([]);
  });

  it('a read error without an error code fails the operation instead of starting empty', async () => {
    const broken: ProfilesFs = {
      readFile: () => Promise.reject(new Error('io error')),
      writeFile: () => Promise.reject(new Error('must not write')),
      rename: () => Promise.reject(new Error('must not rename')),
      unlink: () => Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    };
    const { store } = setup({ fs: broken });
    await expect(store.list()).rejects.toThrow('io error');
  });

  it('logs but continues when a stale temp file cannot be removed', async () => {
    const stuck: ProfilesFs = {
      readFile: (p, e) => fs.readFile(p, e),
      writeFile: (p, d, o) => fs.writeFile(p, d, o),
      rename: (from, to) => fs.rename(from, to),
      unlink: () => Promise.reject(Object.assign(new Error('busy'), { code: 'EBUSY' })),
    };
    const { store, logs } = setup({ fs: stuck });
    expect(await store.list()).toEqual([]);
    expect(logs.some((m) => m.includes('could not remove') && m.includes('busy'))).toBe(true);
  });
});

describe('migration edge cases', () => {
  async function load(content: unknown, secrets = fakeSecrets()) {
    await writeFile(path.join(dir, 'connections.json'), JSON.stringify(content));
    return { ...storeWith(secrets), secrets };
  }

  it('an empty v0 array becomes an empty version-1 file', async () => {
    const { store } = await load([]);
    expect(await store.list()).toEqual([]);
    expect(await fileJson()).toEqual({ version: 1, profiles: [] });
  });

  it('a v0 username without a password asks for it; an empty id gets a new one', async () => {
    const { store, secrets } = await load([
      { id: '', name: 'N', uri: 'mongodb+srv://al%40ice@cluster.example.test/' },
    ]);
    expect(await store.list()).toEqual([
      {
        id: expect.stringMatching(V0_ID) as string,
        name: 'N',
        connectionString: 'mongodb+srv://al%40ice@cluster.example.test/',
        auth: { mechanism: 'SCRAM-SHA-256', username: 'al@ice', secretMode: 'ask' },
        readOnly: false,
        production: false,
      },
    ]);
    expect(secrets.calls).toEqual([]);
  });

  it('askPassword without a username gets "ask" auth and stores no secret', async () => {
    const { store, secrets } = await load([
      { id: 'a', name: 'A', uri: 'mongodb://:typed-pw@h', askPassword: true },
    ]);
    const [p] = await store.list();
    expect(p).toMatchObject({
      connectionString: 'mongodb://h',
      auth: { mechanism: 'SCRAM-SHA-256', secretMode: 'ask' },
    });
    expect(p?.auth?.username).toBeUndefined();
    expect(secrets.calls).toEqual([]);
    expect(await readFile(path.join(dir, 'connections.json'), 'utf8')).not.toContain('typed-pw');
  });

  it('a password without a username is dropped, not moved into secrets.bin', async () => {
    const { store, secrets } = await load([{ id: 'a', name: 'A', uri: 'mongodb://:lone-pw@h' }]);
    const [p] = await store.list();
    expect(p).toMatchObject({ connectionString: 'mongodb://h' });
    expect(p?.auth).toBeUndefined();
    expect(secrets.calls).toEqual([]);
    expect(await readFile(path.join(dir, 'connections.json'), 'utf8')).not.toContain('lone-pw');
  });

  it('empty color/group and non-boolean flags are not carried over', async () => {
    const { store } = await load([
      {
        id: 'a',
        name: 'A',
        uri: 'mongodb://h',
        color: '',
        group: '',
        readonly: 'yes',
        isProduction: 1,
      },
    ]);
    expect(await store.list()).toEqual([
      { id: 'a', name: 'A', connectionString: 'mongodb://h', readOnly: false, production: false },
    ]);
  });

  it('keeps an undecodable password or username as written', async () => {
    expect(splitPassword('mongodb://u:%E0%A4%A@h')).toEqual({
      uri: 'mongodb://u@h',
      password: '%E0%A4%A',
    });
    const { store, secrets } = await load([{ id: 'a', name: 'A', uri: 'mongodb://u%ZZ:p@h' }]);
    expect((await store.list())[0]?.auth?.username).toBe('u%ZZ');
    expect(secrets.stored.get('a')).toEqual({ password: 'p' });
  });

  it('splitPassword leaves a string that is not a mongodb URI unchanged', () => {
    expect(splitPassword('u:pw@h')).toEqual({ uri: 'u:pw@h' });
  });

  it('a password containing "@" is split at the last "@"', () => {
    expect(splitPassword('mongodb://u:p@ss@h1,h2/db')).toEqual({
      uri: 'mongodb://u@h1,h2/db',
      password: 'p@ss',
    });
  });

  it.each([
    ['a non-object entry', [42]],
    ['an entry without a name', [{ id: 'a', uri: 'mongodb://h' }]],
    ['an entry with a non-mongodb uri', [{ id: 'a', name: 'A', uri: 'http://h' }]],
    ['an entry without a scheme but with a password', [{ id: 'a', name: 'A', uri: 'u:pw@h' }]],
    ['an entry without a uri', [{ id: 'a', name: 'A' }]],
    [
      'duplicate v0 ids',
      [
        { id: 'a', name: 'A', uri: 'mongodb://u:pw1@h' },
        { id: 'a', name: 'B', uri: 'mongodb://h' },
      ],
    ],
  ])('a v0 file with %s is moved aside and no secret is moved', async (_name, content) => {
    const { store, secrets } = await load(content);
    expect(await store.list()).toEqual([]);
    expect(await readdir(dir)).toEqual(['connections.json.corrupt-2026-01-02T03-04-05-678Z']);
    expect(secrets.calls).toEqual([]);
  });

  it('a failed rewrite keeps the v0 file and retries on the next operation', async () => {
    const crashing = renameCrashFs();
    crashing.crash = true;
    const v0 = [{ id: 'a', name: 'A', uri: 'mongodb://u:fictitious-pw@h' }];
    await writeFile(path.join(dir, 'connections.json'), JSON.stringify(v0));
    const secrets = fakeSecrets();
    const { store } = storeWith(secrets, crashing);
    await expect(store.list()).rejects.toThrow('crash before rename');
    expect(await fileJson()).toEqual(v0);
    // Secrets are moved before the rewrite, so nothing is lost.
    expect(secrets.stored.get('a')).toEqual({ password: 'fictitious-pw' });
    crashing.crash = false;
    expect((await store.list()).map((p) => p.id)).toEqual(['a']);
    expect(await fileJson()).toMatchObject({ version: 1 });
  });

  it('a retried migration gives an id-less entry the same id, so no secret is orphaned', async () => {
    const crashing = renameCrashFs();
    crashing.crash = true;
    const v0 = [
      { name: 'A', uri: 'mongodb://u:fictitious-pw@h' },
      { name: 'A', uri: 'mongodb://u:fictitious-pw@h' },
    ];
    await writeFile(path.join(dir, 'connections.json'), JSON.stringify(v0));
    const secrets = fakeSecrets();
    const { store } = storeWith(secrets, crashing);
    await expect(store.list()).rejects.toThrow('crash before rename');
    expect(await fileJson()).toEqual(v0);
    const firstIds = [...secrets.stored.keys()];
    // Identical entries at different positions still get different ids.
    expect(firstIds).toHaveLength(2);
    for (const id of firstIds) expect(id).toMatch(V0_ID);
    crashing.crash = false;
    const ids = (await store.list()).map((p) => p.id);
    expect(ids).toEqual(firstIds);
    expect([...secrets.stored.keys()]).toEqual(firstIds);
    expect(await readFile(path.join(dir, 'connections.json'), 'utf8')).not.toContain(
      'fictitious-pw',
    );
    // The id does not depend on the store instance (a retry after a restart gives the same id).
    expect(migrate(v0)?.profiles.map((p) => (p as { id: string }).id)).toEqual(firstIds);
  });

  it('a secrets.bin write error other than "unavailable" keeps the v0 file and retries', async () => {
    const fail = { set: true };
    const v0 = [{ id: 'a', name: 'A', uri: 'mongodb://u:fictitious-pw@h' }];
    await writeFile(path.join(dir, 'connections.json'), JSON.stringify(v0));
    const secrets = fakeSecrets(fail);
    const { store } = storeWith(secrets);
    await expect(store.list()).rejects.toThrow('secrets.bin locked');
    expect(await fileJson()).toEqual(v0);
    expect(secrets.stored.size).toBe(0);
    fail.set = false;
    const [p] = await store.list();
    expect(p?.auth?.secretMode).toBe('saved');
    expect(secrets.stored.get('a')).toEqual({ password: 'fictitious-pw' });
    expect(await fileJson()).toMatchObject({ version: 1 });
  });

  it('migrate() rejects non-integer and non-number versions and passes newer ones', () => {
    expect(migrate({ version: 1.5, profiles: [] })).toBeUndefined();
    expect(migrate({ version: '1', profiles: [] })).toBeUndefined();
    expect(migrate('[]')).toBeUndefined();
    expect(migrate({ version: 2, profiles: [] })).toEqual({
      version: 2,
      profiles: [],
      secrets: [],
    });
  });
});

describe('newer file versions', () => {
  it('drops profiles invalid in this version and still refuses changes', async () => {
    const good = { ...draft(), id: 'good' };
    const content = {
      version: 2,
      profiles: [
        good,
        { id: 'bad', name: '' },
        { ...draft(), id: 'pw', connectionString: 'mongodb://u:p@h' },
      ],
    };
    await writeFile(path.join(dir, 'connections.json'), JSON.stringify(content));
    const { store, logs } = setup();
    expect(await store.list()).toEqual([good]);
    expect(await store.has('good')).toBe(true);
    await expect(store.duplicate('good')).rejects.toBeInstanceOf(ProfilesReadOnlyError);
    await expect(store.save({ ...good, name: 'X' })).rejects.toBeInstanceOf(ProfilesReadOnlyError);
    expect(await fileJson()).toEqual(content);
    expect(logs.some((m) => m.includes('version 2'))).toBe(true);
  });
});

describe('handlers without secrets handlers', () => {
  it('do not offer profiles.setSecret and pass unexpected errors through', async () => {
    const failing: ProfilesFs = {
      readFile: () => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })),
      writeFile: () => Promise.reject(new Error('must not write')),
      rename: () => Promise.reject(new Error('must not rename')),
      unlink: () => Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    };
    const { store } = storeWith(fakeSecrets(), failing);
    const handlers = profilesHandlers(store);
    expect(Object.keys(handlers).sort()).toEqual([
      'profiles.delete',
      'profiles.duplicate',
      'profiles.get',
      'profiles.list',
      'profiles.save',
    ]);
    const error: unknown = await Promise.resolve(
      handlers['profiles.get']?.({ profileId: 'x' } as never, ctx),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toHaveProperty('code', 'NOT_FOUND');
    expect((error as Error).message).toBe('denied');
  });

  it('map delete/duplicate/save of unknown ids to NOT_FOUND', async () => {
    const { call } = setup();
    await expect(call('profiles.delete', { profileId: 'ghost' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(call('profiles.duplicate', { profileId: 'ghost' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(call('profiles.save', { profile: draft({ id: 'ghost' }) })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
