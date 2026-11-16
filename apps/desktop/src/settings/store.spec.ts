import { settings as settingsSchema } from '@thicket/contract';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, SETTINGS_VERSION, SettingsStore, type SettingsFs } from './store';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'thicket-settings-'));
  file = path.join(dir, 'settings.json');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const readJson = async (p: string): Promise<unknown> => JSON.parse(await fs.readFile(p, 'utf8'));

describe('SettingsStore defaults', () => {
  it('uses the defaults when there is no file, without writing one', async () => {
    const store = await SettingsStore.open(file);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    await expect(fs.access(file)).rejects.toThrow();
  });

  it('the defaults are valid settings', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });

  it('fills missing and invalid keys with their defaults, keeps the valid ones', async () => {
    await fs.writeFile(
      file,
      JSON.stringify({ version: 1, settings: { style: 'tron', pageSize: 33, mode: 'dark' } }),
    );
    const store = await SettingsStore.open(file);
    expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, style: 'tron', mode: 'dark' });
  });

  it('get() returns a copy', async () => {
    const store = await SettingsStore.open(file);
    const copy = store.get();
    copy.style = 'tron';
    expect(store.get().style).toBe('business');
  });
});

describe('SettingsStore unknown keys', () => {
  it('drops unknown keys when loading and does not write them back', async () => {
    await fs.writeFile(
      file,
      JSON.stringify({ version: 1, settings: { style: 'tron', removedSetting: 1, __proto__x: 2 } }),
    );
    const store = await SettingsStore.open(file);
    expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, style: 'tron' });
    expect(Object.keys(store.get()).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());

    await store.set({ pageSize: 100 });
    expect(await readJson(file)).toEqual({
      version: SETTINGS_VERSION,
      settings: { ...DEFAULT_SETTINGS, style: 'tron', pageSize: 100 },
    });
  });

  it('__proto__ and constructor keys in the file are dropped and do not pollute settings', async () => {
    // Raw JSON so that `__proto__` is an own property after JSON.parse (as in a hand-edited file).
    await fs.writeFile(
      file,
      '{"version":1,"settings":{"__proto__":{"style":"tron","polluted":true},' +
        '"constructor":{"prototype":{"polluted":true}},"mode":"light"}}',
    );
    const store = await SettingsStore.open(file);
    const value = store.get();
    expect(value).toEqual({ ...DEFAULT_SETTINGS, mode: 'light' });
    expect(Object.keys(value).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect((value as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('ignores unknown keys passed to set()', async () => {
    const store = await SettingsStore.open(file);
    await store.set({ style: 'tron', bogus: true } as never);
    expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, style: 'tron' });
  });

  it('reads a newer version leniently (known keys only)', async () => {
    const log = vi.fn();
    await fs.writeFile(
      file,
      JSON.stringify({ version: 9, settings: { mode: 'light', future: 1 } }),
    );
    const store = await SettingsStore.open(file, { log });
    expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, mode: 'light' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('version 9'));
  });
});

describe('SettingsStore corrupt file', () => {
  const now = () => new Date('2026-11-16T12:34:56.789Z');
  const backup = () => `${file}.corrupt-2026-11-16T12-34-56-789Z`;

  it.each([
    ['not JSON', '{"version": 1, "settings": {'],
    ['empty', ''],
    ['an array', '[1,2]'],
    ['no version', JSON.stringify({ settings: { style: 'tron' } })],
    ['settings not an object', JSON.stringify({ version: 1, settings: 'tron' })],
    ['JSON null', 'null'],
  ])('%s → defaults, the bad file is kept as a backup', async (_name, content) => {
    await fs.writeFile(file, content);
    const log = vi.fn();
    const store = await SettingsStore.open(file, { now, log });
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(await fs.readFile(backup(), 'utf8')).toBe(content);
    await expect(fs.access(file)).rejects.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('corrupt-'));
  });

  it.each([
    ['version 0', { version: 0, settings: {} }],
    ['negative version', { version: -1, settings: {} }],
    ['fractional version', { version: 1.5, settings: {} }],
    ['version as a string', { version: '1', settings: {} }],
    ['settings is an array', { version: 1, settings: [] }],
    ['settings is null', { version: 1, settings: null }],
  ])('%s → treated as corrupt (defaults + backup)', async (_name, content) => {
    const text = JSON.stringify(content);
    await fs.writeFile(file, text);
    const store = await SettingsStore.open(file, { now });
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(await fs.readFile(backup(), 'utf8')).toBe(text);
  });

  it('a corrupt file that cannot be moved aside still gives the defaults (logged)', async () => {
    await fs.writeFile(file, 'garbage');
    const log = vi.fn();
    const stuck: SettingsFs = {
      readFile: (p, e) => fs.readFile(p, e),
      writeFile: (p, d, o) => fs.writeFile(p, d, o),
      rename: () => Promise.reject(Object.assign(new Error('EBUSY'), { code: 'EBUSY' })),
      unlink: (p) => fs.unlink(p),
    };
    const store = await SettingsStore.open(file, { fs: stuck, log, now });
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('could not be moved aside'));
    expect(await fs.readFile(file, 'utf8')).toBe('garbage');
  });

  /** Real fs; while `failMoveAside` is set, renaming settings.json to a corrupt backup fails. */
  function stuckCorruptFs(): SettingsFs & { failMoveAside: boolean } {
    const wrapper = {
      failMoveAside: true,
      readFile: (p: string, e: 'utf8') => fs.readFile(p, e),
      writeFile: (p: string, d: string, o: { flush: boolean }) => fs.writeFile(p, d, o),
      unlink: (p: string) => fs.unlink(p),
      rename: (from: string, to: string) =>
        wrapper.failMoveAside && to.includes('.corrupt-')
          ? Promise.reject(Object.assign(new Error('EBUSY: locked'), { code: 'EBUSY' }))
          : fs.rename(from, to),
    };
    return wrapper;
  }

  it('a corrupt file that could not be moved aside at start is backed up before the first set', async () => {
    await fs.writeFile(file, 'garbage');
    const log = vi.fn();
    const stuck = stuckCorruptFs();
    const store = await SettingsStore.open(file, { fs: stuck, log, now });
    expect(await fs.readFile(file, 'utf8')).toBe('garbage');

    stuck.failMoveAside = false;
    await store.set({ mode: 'dark' });
    expect(await fs.readFile(backup(), 'utf8')).toBe('garbage');
    expect(await readJson(file)).toEqual({
      version: SETTINGS_VERSION,
      settings: { ...DEFAULT_SETTINGS, mode: 'dark' },
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('before writing'));

    // Only the first write moves the file aside.
    await store.set({ mode: 'light' });
    const backups = (await fs.readdir(dir)).filter((n) => n.includes('.corrupt-'));
    expect(backups).toHaveLength(1);
    expect(await fs.readFile(backup(), 'utf8')).toBe('garbage');
  });

  it('if the corrupt file still cannot be moved aside, set rejects and nothing changes; a later set retries', async () => {
    await fs.writeFile(file, 'garbage');
    const log = vi.fn();
    const stuck = stuckCorruptFs();
    const store = await SettingsStore.open(file, { fs: stuck, log, now });
    const listener = vi.fn();
    store.onChange(listener);

    await expect(store.set({ mode: 'dark' })).rejects.toThrow('EBUSY');
    expect(await fs.readFile(file, 'utf8')).toBe('garbage');
    await expect(fs.access(`${file}.tmp`)).rejects.toThrow();
    await expect(fs.access(backup())).rejects.toThrow();
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(listener).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not writing'));

    stuck.failMoveAside = false;
    await expect(store.set({ mode: 'dark' })).resolves.toMatchObject({ mode: 'dark' });
    expect(await fs.readFile(backup(), 'utf8')).toBe('garbage');
    expect(await readJson(file)).toMatchObject({ settings: { mode: 'dark' } });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a corrupt file that disappeared before it could be moved aside (ENOENT) is not retried', async () => {
    await fs.writeFile(file, 'garbage');
    const renames: string[] = [];
    const vanishing: SettingsFs = {
      readFile: (p, e) => fs.readFile(p, e),
      writeFile: (p, d, o) => fs.writeFile(p, d, o),
      unlink: (p) => fs.unlink(p),
      rename: async (from, to) => {
        renames.push(to);
        if (to.includes('.corrupt-')) {
          await fs.unlink(from);
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }
        await fs.rename(from, to);
      },
    };
    const store = await SettingsStore.open(file, { fs: vanishing, now });
    await store.set({ mode: 'dark' });
    expect(renames.filter((to) => to.includes('.corrupt-'))).toHaveLength(1);
    expect(await readJson(file)).toMatchObject({ settings: { mode: 'dark' } });
  });

  const corruptBackups = async () => (await fs.readdir(dir)).filter((n) => n.includes('.corrupt-'));

  it('a pending corrupt file stays in place after a no-op or invalid set; a real change moves it', async () => {
    await fs.writeFile(file, 'garbage');
    const stuck = stuckCorruptFs();
    const store = await SettingsStore.open(file, { fs: stuck, now });
    stuck.failMoveAside = false;

    await store.set({ style: DEFAULT_SETTINGS.style }); // same as the defaults: no write
    await expect(store.set({ pageSize: 30 } as never)).rejects.toThrow(); // refused by the schema
    expect(await fs.readFile(file, 'utf8')).toBe('garbage');
    expect(await corruptBackups()).toEqual([]);

    await store.set({ style: 'tron' });
    expect(await fs.readFile(backup(), 'utf8')).toBe('garbage');
    expect(await readJson(file)).toMatchObject({ settings: { style: 'tron' } });
  });

  it('concurrent sets on a pending corrupt file make one backup and end with the last change', async () => {
    await fs.writeFile(file, 'garbage');
    const stuck = stuckCorruptFs();
    const store = await SettingsStore.open(file, { fs: stuck, now });
    stuck.failMoveAside = false;
    const listener = vi.fn();
    store.onChange(listener);

    await Promise.all([
      store.set({ pageSize: 20 }),
      store.set({ pageSize: 100 }),
      store.set({ mode: 'dark' }),
    ]);
    expect(await corruptBackups()).toEqual([path.basename(backup())]);
    expect(await fs.readFile(backup(), 'utf8')).toBe('garbage');
    expect(await readJson(file)).toMatchObject({ settings: { pageSize: 100, mode: 'dark' } });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('a failed move at set time, queued with a second set, lets the second set retry and succeed', async () => {
    await fs.writeFile(file, 'garbage');
    const stuck = stuckCorruptFs(); // fails at load
    const store = await SettingsStore.open(file, { fs: stuck, now });
    // The move fails once more (in the first set), then works.
    const failingRename = stuck.rename;
    stuck.rename = () => {
      stuck.rename = failingRename;
      stuck.failMoveAside = false;
      return Promise.reject(Object.assign(new Error('EBUSY: locked'), { code: 'EBUSY' }));
    };

    const first = store.set({ mode: 'dark' });
    const second = store.set({ mode: 'light' });
    await expect(first).rejects.toThrow('EBUSY');
    await expect(second).resolves.toMatchObject({ mode: 'light' });
    expect(store.get().mode).toBe('light');
    expect(await fs.readFile(backup(), 'utf8')).toBe('garbage');
    expect(await readJson(file)).toMatchObject({ settings: { mode: 'light' } });
  });

  it('a crash between write and rename after the corrupt file was moved aside keeps the backup; restart uses defaults', async () => {
    await fs.writeFile(file, 'garbage');
    let failMoveAside = true;
    let crash = true;
    const flaky: SettingsFs = {
      readFile: (p, e) => fs.readFile(p, e),
      writeFile: (p, d, o) => fs.writeFile(p, d, o),
      unlink: (p) => fs.unlink(p),
      rename: (from, to) => {
        if (failMoveAside && to.includes('.corrupt-'))
          return Promise.reject(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }));
        if (crash && from.endsWith('.tmp')) return Promise.reject(new Error('process died'));
        return fs.rename(from, to);
      },
    };
    const store = await SettingsStore.open(file, { fs: flaky, now });
    failMoveAside = false;

    await expect(store.set({ mode: 'dark' })).rejects.toThrow('process died');
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(await fs.readFile(backup(), 'utf8')).toBe('garbage');
    await expect(fs.access(file)).rejects.toThrow(); // moved aside, not yet replaced

    // Restart: no settings.json, so the defaults; the backup is still there, nothing new is backed up.
    const restarted = await SettingsStore.open(file, { now });
    expect(restarted.get()).toEqual(DEFAULT_SETTINGS);
    expect(await corruptBackups()).toEqual([path.basename(backup())]);
    expect(await fs.readFile(backup(), 'utf8')).toBe('garbage');
    await expect(fs.access(`${file}.tmp`)).rejects.toThrow(); // stale temp cleaned up at start

    // The original store's retry writes without trying a second backup.
    crash = false;
    await store.set({ mode: 'dark' });
    expect(await corruptBackups()).toEqual([path.basename(backup())]);
    expect(await readJson(file)).toMatchObject({ settings: { mode: 'dark' } });
  });

  it('a load-time move failure without an error code is retried before the first set', async () => {
    await fs.writeFile(file, 'garbage');
    let failMoveAside = true;
    const odd: SettingsFs = {
      readFile: (p, e) => fs.readFile(p, e),
      writeFile: (p, d, o) => fs.writeFile(p, d, o),
      unlink: (p) => fs.unlink(p),
      rename: (from, to) =>
        failMoveAside && to.includes('.corrupt-')
          ? Promise.reject(new Error('device gone'))
          : fs.rename(from, to),
    };
    const log = vi.fn();
    const store = await SettingsStore.open(file, { fs: odd, log, now });
    expect(await fs.readFile(file, 'utf8')).toBe('garbage');
    failMoveAside = false;

    await store.set({ mode: 'light' });
    expect(await fs.readFile(backup(), 'utf8')).toBe('garbage');
    expect(await readJson(file)).toMatchObject({ settings: { mode: 'light' } });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('moved the corrupt'));
  });

  it('without an injected clock the backup is named after the current time', async () => {
    await fs.writeFile(file, 'garbage');
    const before = Date.now();
    await SettingsStore.open(file);
    const backups = (await fs.readdir(dir)).filter((name) =>
      name.startsWith('settings.json.corrupt-'),
    );
    expect(backups).toHaveLength(1);
    const stamp = (backups[0] ?? '').slice('settings.json.corrupt-'.length);
    // 2026-11-16T12-34-56-789Z → 2026-11-16T12:34:56.789Z
    const iso = stamp.replace(/T(\d+)-(\d+)-(\d+)-(\d+)Z$/, 'T$1:$2:$3.$4Z');
    const time = new Date(iso).getTime();
    expect(time).toBeGreaterThanOrEqual(before);
    expect(time).toBeLessThanOrEqual(Date.now());
  });

  it('a read error without an error code gives the defaults (logged)', async () => {
    const log = vi.fn();
    const odd: SettingsFs = {
      readFile: () => Promise.reject(new Error('device gone')),
      writeFile: (p, d, o) => fs.writeFile(p, d, o),
      rename: (a, b) => fs.rename(a, b),
      unlink: () => Promise.reject('not an Error object'),
    };
    const store = await SettingsStore.open(file, { fs: odd, log });
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('could not read'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('could not remove'));
  });

  it('a version-1 file does not log a newer-version warning', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 1, settings: { mode: 'dark' } }));
    const log = vi.fn();
    await SettingsStore.open(file, { log });
    expect(log).not.toHaveBeenCalled();
  });

  it('a later set() writes a fresh valid file next to the backup', async () => {
    await fs.writeFile(file, 'garbage');
    const store = await SettingsStore.open(file, { now });
    await store.set({ style: 'tron' });
    expect(await readJson(file)).toEqual({
      version: SETTINGS_VERSION,
      settings: { ...DEFAULT_SETTINGS, style: 'tron' },
    });
    expect(await fs.readFile(backup(), 'utf8')).toBe('garbage');
  });

  it('a file that cannot be read (not ENOENT) gives the defaults and is left alone', async () => {
    await fs.mkdir(file); // reading a directory fails with EISDIR
    const log = vi.fn();
    const store = await SettingsStore.open(file, { log });
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect((await fs.stat(file)).isDirectory()).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('could not read'));
  });
});

describe('SettingsStore unreadable file', () => {
  const now = () => new Date('2026-11-16T12:34:56.789Z');
  const backup = () => `${file}.unreadable-2026-11-16T12-34-56-789Z`;
  const original = JSON.stringify({ version: 1, settings: { style: 'tron', pageSize: 500 } });
  const eacces = () => Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });

  /** Real fs, but reading settings.json fails with EACCES; `failMoveAside` breaks the backup rename. */
  function unreadableFs(): SettingsFs & { failMoveAside: boolean } {
    const wrapper = {
      failMoveAside: false,
      readFile: (p: string, e: 'utf8') =>
        p === file ? Promise.reject(eacces()) : fs.readFile(p, e),
      writeFile: (p: string, d: string, o: { flush: boolean }) => fs.writeFile(p, d, o),
      unlink: (p: string) => fs.unlink(p),
      rename: (from: string, to: string) =>
        wrapper.failMoveAside && to.includes('.unreadable-')
          ? Promise.reject(Object.assign(new Error('EBUSY: locked'), { code: 'EBUSY' }))
          : fs.rename(from, to),
    };
    return wrapper;
  }

  it('the first set moves the unreadable file aside, then writes the new file', async () => {
    await fs.writeFile(file, original);
    const log = vi.fn();
    const store = await SettingsStore.open(file, { fs: unreadableFs(), log, now });
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(await fs.readFile(file, 'utf8')).toBe(original); // nothing touched at start

    await store.set({ mode: 'dark' });
    expect(await fs.readFile(backup(), 'utf8')).toBe(original);
    expect(await readJson(file)).toEqual({
      version: SETTINGS_VERSION,
      settings: { ...DEFAULT_SETTINGS, mode: 'dark' },
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('unreadable-'));

    // Only the first write moves the file aside.
    await store.set({ mode: 'light' });
    const backups = (await fs.readdir(dir)).filter((n) => n.includes('.unreadable-'));
    expect(backups).toHaveLength(1);
    expect(await fs.readFile(backup(), 'utf8')).toBe(original);
  });

  it('an unreadable file that disappeared before the first set (ENOENT) is just written', async () => {
    const store = await SettingsStore.open(file, { fs: unreadableFs(), now });
    await store.set({ mode: 'dark' });
    expect(await readJson(file)).toMatchObject({ settings: { mode: 'dark' } });
    await expect(fs.access(backup())).rejects.toThrow();
  });

  it('if the file cannot be moved aside, set rejects and nothing changes; a later set retries', async () => {
    await fs.writeFile(file, original);
    const log = vi.fn();
    const unreadable = unreadableFs();
    unreadable.failMoveAside = true;
    const store = await SettingsStore.open(file, { fs: unreadable, log, now });
    const listener = vi.fn();
    store.onChange(listener);

    await expect(store.set({ mode: 'dark' })).rejects.toThrow('EBUSY');
    expect(await fs.readFile(file, 'utf8')).toBe(original);
    await expect(fs.access(`${file}.tmp`)).rejects.toThrow();
    await expect(fs.access(backup())).rejects.toThrow();
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(listener).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not writing'));

    unreadable.failMoveAside = false;
    await expect(store.set({ mode: 'dark' })).resolves.toMatchObject({ mode: 'dark' });
    expect(await fs.readFile(backup(), 'utf8')).toBe(original);
    expect(await readJson(file)).toMatchObject({ settings: { mode: 'dark' } });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  const unreadableBackups = async () =>
    (await fs.readdir(dir)).filter((n) => n.includes('.unreadable-'));

  it('a set that changes nothing or is invalid leaves the unreadable file in place; a real change still moves it', async () => {
    await fs.writeFile(file, original);
    const store = await SettingsStore.open(file, { fs: unreadableFs(), now });

    await store.set({ style: DEFAULT_SETTINGS.style }); // same as the defaults: no write
    await expect(store.set({ pageSize: 30 } as never)).rejects.toThrow(); // refused by the schema
    expect(await fs.readFile(file, 'utf8')).toBe(original);
    expect(await unreadableBackups()).toEqual([]);

    await store.set({ style: 'tron' });
    expect(await fs.readFile(backup(), 'utf8')).toBe(original);
    expect(await readJson(file)).toMatchObject({ settings: { style: 'tron' } });
  });

  it('concurrent sets on an unreadable file make one backup and end with the last change', async () => {
    await fs.writeFile(file, original);
    const store = await SettingsStore.open(file, { fs: unreadableFs(), now });
    const listener = vi.fn();
    store.onChange(listener);

    await Promise.all([
      store.set({ pageSize: 20 }),
      store.set({ pageSize: 100 }),
      store.set({ mode: 'dark' }),
    ]);
    expect(await unreadableBackups()).toEqual([path.basename(backup())]);
    expect(await fs.readFile(backup(), 'utf8')).toBe(original);
    expect(await readJson(file)).toMatchObject({ settings: { pageSize: 100, mode: 'dark' } });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('a write that fails after the move keeps the backup; the retry writes without a second backup', async () => {
    await fs.writeFile(file, original);
    let failWrite = true;
    const base = unreadableFs();
    const flaky: SettingsFs = {
      ...base,
      writeFile: (p, d, o) =>
        failWrite ? Promise.reject(new Error('disk full')) : fs.writeFile(p, d, o),
    };
    let tick = 0;
    const clock = () => new Date(Date.UTC(2026, 10, 16, 12, 0, tick++));
    const store = await SettingsStore.open(file, { fs: flaky, now: clock });

    await expect(store.set({ mode: 'dark' })).rejects.toThrow('disk full');
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    const [first] = await unreadableBackups();
    expect(first).toBeDefined();
    expect(await fs.readFile(path.join(dir, first ?? ''), 'utf8')).toBe(original);
    await expect(fs.access(file)).rejects.toThrow(); // moved aside, not yet replaced

    failWrite = false;
    await store.set({ mode: 'dark' });
    expect(await unreadableBackups()).toEqual([first]);
    expect(await fs.readFile(path.join(dir, first ?? ''), 'utf8')).toBe(original);
    expect(await readJson(file)).toMatchObject({ settings: { mode: 'dark' } });
  });

  it('a read error without an error code is treated as unreadable: the first set moves the file aside', async () => {
    await fs.writeFile(file, original);
    const odd: SettingsFs = {
      readFile: (p, e) =>
        p === file ? Promise.reject(new Error('device gone')) : fs.readFile(p, e),
      writeFile: (p, d, o) => fs.writeFile(p, d, o),
      rename: (a, b) => fs.rename(a, b),
      unlink: (p) => fs.unlink(p),
    };
    const store = await SettingsStore.open(file, { fs: odd, now });
    await store.set({ mode: 'light' });
    expect(await fs.readFile(backup(), 'utf8')).toBe(original);
    expect(await readJson(file)).toMatchObject({ settings: { mode: 'light' } });
  });

  it('with the real fs, a settings.json that is a directory (EISDIR) is moved aside on the first set', async () => {
    await fs.mkdir(file);
    await fs.writeFile(path.join(file, 'keep.txt'), 'fictitious content');
    const store = await SettingsStore.open(file, { now });
    await store.set({ dateDisplay: 'utc' });
    expect((await fs.stat(backup())).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(backup(), 'keep.txt'), 'utf8')).toBe('fictitious content');
    expect(await readJson(file)).toMatchObject({ settings: { dateDisplay: 'utc' } });
  });
});

/** Real fs, but `rename` of the temp file over the settings file "crashes" (never happens). */
function crashBeforeRename(): SettingsFs & { crashed: boolean } {
  const wrapper = {
    crashed: false,
    readFile: (p: string, e: 'utf8') => fs.readFile(p, e),
    writeFile: (p: string, d: string, o: { flush: boolean }) => fs.writeFile(p, d, o),
    unlink: (p: string) => fs.unlink(p),
    rename: (from: string, to: string) => {
      if (from.endsWith('.tmp')) {
        wrapper.crashed = true;
        return Promise.reject(new Error('process died'));
      }
      return fs.rename(from, to);
    },
  };
  return wrapper;
}

describe('SettingsStore atomic writes', () => {
  it('writes to a temp file and renames it over settings.json', async () => {
    const calls: string[] = [];
    const tracing: SettingsFs = {
      readFile: (p, e) => fs.readFile(p, e),
      writeFile: async (p, d, o) => {
        calls.push(`write ${path.basename(p)} flush=${o.flush}`);
        await fs.writeFile(p, d, o);
      },
      rename: async (a, b) => {
        calls.push(`rename ${path.basename(a)} → ${path.basename(b)}`);
        await fs.rename(a, b);
      },
      unlink: (p) => fs.unlink(p),
    };
    const store = await SettingsStore.open(file, { fs: tracing });
    await store.set({ mode: 'dark' });
    expect(calls).toEqual([
      'write settings.json.tmp flush=true',
      'rename settings.json.tmp → settings.json',
    ]);
    await expect(fs.access(store.tempFile)).rejects.toThrow();
  });

  it('a crash between write and rename keeps the previous file; the next start reads it', async () => {
    const first = await SettingsStore.open(file);
    await first.set({ style: 'tron' });
    const before = await fs.readFile(file, 'utf8');

    const crashing = crashBeforeRename();
    const second = await SettingsStore.open(file, { fs: crashing });
    await expect(second.set({ style: 'business', pageSize: 500 })).rejects.toThrow('process died');
    expect(crashing.crashed).toBe(true);
    // The temp file holds the new content, settings.json still the old one, untouched.
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect(await readJson(`${file}.tmp`)).toMatchObject({ settings: { pageSize: 500 } });
    // In memory nothing changed either.
    expect(second.get().style).toBe('tron');

    // "Restart": the old settings load, the unfinished temp file is cleaned up.
    const log = vi.fn();
    const third = await SettingsStore.open(file, { log });
    expect(third.get()).toEqual({ ...DEFAULT_SETTINGS, style: 'tron' });
    await expect(fs.access(`${file}.tmp`)).rejects.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('unfinished write'));
  });

  it('a crash before the first file existed leaves no settings.json; next start uses defaults', async () => {
    const store = await SettingsStore.open(file, { fs: crashBeforeRename() });
    await expect(store.set({ style: 'tron' })).rejects.toThrow();
    await expect(fs.access(file)).rejects.toThrow();
    const next = await SettingsStore.open(file);
    expect(next.get()).toEqual(DEFAULT_SETTINGS);
  });

  it('a crash while writing the temp file (torn temp) keeps settings.json; restart cleans up', async () => {
    const first = await SettingsStore.open(file);
    await first.set({ mode: 'dark' });
    const before = await fs.readFile(file, 'utf8');

    const torn: SettingsFs = {
      readFile: (p, e) => fs.readFile(p, e),
      // Half of the content reaches the temp file, then the process dies.
      writeFile: async (p, d) => {
        await fs.writeFile(p, d.slice(0, Math.floor(d.length / 2)));
        throw new Error('process died');
      },
      rename: (a, b) => fs.rename(a, b),
      unlink: (p) => fs.unlink(p),
    };
    const second = await SettingsStore.open(file, { fs: torn });
    await expect(second.set({ mode: 'light' })).rejects.toThrow('process died');
    expect(await fs.readFile(file, 'utf8')).toBe(before);

    const third = await SettingsStore.open(file);
    expect(third.get()).toEqual({ ...DEFAULT_SETTINGS, mode: 'dark' });
    await expect(fs.access(`${file}.tmp`)).rejects.toThrow();
  });

  it('a set queued behind a failed one starts from the saved settings, not the failed change', async () => {
    let failNext = true;
    const once: SettingsFs = {
      readFile: (p, e) => fs.readFile(p, e),
      writeFile: (p, d, o) => {
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error('disk full'));
        }
        return fs.writeFile(p, d, o);
      },
      rename: (a, b) => fs.rename(a, b),
      unlink: (p) => fs.unlink(p),
    };
    const store = await SettingsStore.open(file, { fs: once });
    const listener = vi.fn();
    store.onChange(listener);
    const [failed, ok] = await Promise.allSettled([
      store.set({ style: 'tron' }),
      store.set({ pageSize: 500 }),
    ]);
    expect(failed.status).toBe('rejected');
    expect(ok).toEqual({
      status: 'fulfilled',
      value: { ...DEFAULT_SETTINGS, pageSize: 500 },
    });
    expect(await readJson(file)).toEqual({
      version: SETTINGS_VERSION,
      settings: { ...DEFAULT_SETTINGS, pageSize: 500 },
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, pageSize: 500 });
  });

  it('a stale temp file that cannot be removed is logged; loading still works', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 1, settings: { style: 'tron' } }));
    const log = vi.fn();
    const locked: SettingsFs = {
      readFile: (p, e) => fs.readFile(p, e),
      writeFile: (p, d, o) => fs.writeFile(p, d, o),
      rename: (a, b) => fs.rename(a, b),
      unlink: () => Promise.reject(Object.assign(new Error('EPERM: locked'), { code: 'EPERM' })),
    };
    const store = await SettingsStore.open(file, { fs: locked, log });
    expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, style: 'tron' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('could not remove'));
  });

  it('no stale temp file: nothing is logged about it', async () => {
    const log = vi.fn();
    await SettingsStore.open(file, { log });
    expect(log).not.toHaveBeenCalled();
  });

  it('serializes concurrent sets; the file ends with the last one', async () => {
    const store = await SettingsStore.open(file);
    await Promise.all([
      store.set({ pageSize: 20 }),
      store.set({ pageSize: 100 }),
      store.set({ style: 'tron' }),
    ]);
    expect(store.get()).toMatchObject({ pageSize: 100, style: 'tron' });
    expect(await readJson(file)).toMatchObject({ settings: { pageSize: 100, style: 'tron' } });
  });

  it('a failed set does not block the next one', async () => {
    let fail = true;
    const flaky: SettingsFs = {
      readFile: (p, e) => fs.readFile(p, e),
      writeFile: (p, d, o) =>
        fail ? Promise.reject(new Error('disk full')) : fs.writeFile(p, d, o),
      rename: (a, b) => fs.rename(a, b),
      unlink: (p) => fs.unlink(p),
    };
    const store = await SettingsStore.open(file, { fs: flaky });
    await expect(store.set({ mode: 'dark' })).rejects.toThrow('disk full');
    fail = false;
    await expect(store.set({ mode: 'light' })).resolves.toMatchObject({ mode: 'light' });
  });
});

describe('SettingsStore change listeners', () => {
  it('notifies listeners with the full settings after a saved change', async () => {
    const store = await SettingsStore.open(file);
    const listener = vi.fn();
    const off = store.onChange(listener);
    await store.set({ dateDisplay: 'utc' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, dateDisplay: 'utc' });

    await store.set({ dateDisplay: 'utc' }); // no change: no write, no event
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    await store.set({ dateDisplay: 'local' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the write fails', async () => {
    const store = await SettingsStore.open(file, { fs: crashBeforeRename() });
    const listener = vi.fn();
    store.onChange(listener);
    await expect(store.set({ style: 'tron' })).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it('a throwing listener is logged and does not fail the set or other listeners', async () => {
    const log = vi.fn();
    const store = await SettingsStore.open(file, { log });
    const other = vi.fn();
    store.onChange(() => {
      throw new Error('boom');
    });
    store.onChange(other);
    await expect(store.set({ checkForUpdates: false })).resolves.toMatchObject({
      checkForUpdates: false,
    });
    expect(other).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('a set() with an invalid value is refused: nothing written, nobody notified', async () => {
    const store = await SettingsStore.open(file);
    await store.set({ style: 'tron' });
    const before = await fs.readFile(file, 'utf8');
    const listener = vi.fn();
    store.onChange(listener);
    await expect(store.set({ pageSize: 30 } as never)).rejects.toThrow();
    expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, style: 'tron' });
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    // The queue is not blocked by the refused change.
    await expect(store.set({ pageSize: 20 })).resolves.toMatchObject({ pageSize: 20 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('undefined values in set() keep the current value', async () => {
    const store = await SettingsStore.open(file);
    await store.set({ style: 'tron' });
    await store.set({ style: undefined, mode: 'dark' });
    expect(store.get()).toMatchObject({ style: 'tron', mode: 'dark' });
  });
});
