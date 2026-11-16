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

  it('undefined values in set() keep the current value', async () => {
    const store = await SettingsStore.open(file);
    await store.set({ style: 'tron' });
    await store.set({ style: undefined, mode: 'dark' });
    expect(store.get()).toMatchObject({ style: 'tron', mode: 'dark' });
  });
});
