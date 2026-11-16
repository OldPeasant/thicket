import { parseResult, type ProfileDraft } from '@thicket/contract';
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
  type ProfilesFs,
} from './store';

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
        id: 'id-1',
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
    expect(await secrets.get('id-1')).toBeNull();
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
