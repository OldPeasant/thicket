import type { SavedQuery } from '@thicket/contract';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { historyHandlers } from './handlers';
import { historyFileName, HistoryStore, type HistoryFs } from './store';

const ORDERS = { profileId: 'p1', db: 'shop', coll: 'orders' };
const USERS = { profileId: 'p1', db: 'shop', coll: 'users' };
const OTHER_PROFILE = { profileId: 'p2', db: 'shop', coll: 'orders' };

function query(filter: string, extra: Partial<SavedQuery> = {}): SavedQuery {
  return { filter, projection: '', sort: '', collation: '', limit: '', ...extra };
}

describe('HistoryStore', () => {
  let dir: string;
  let clock: number;
  let ids: number;
  const open = (options: { limit?: number; fs?: HistoryFs } = {}) =>
    new HistoryStore({
      dir,
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)),
      newId: () => `f${++ids}`,
      ...options,
    });

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'thicket-history-'));
    clock = 0;
    ids = 0;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('starts empty without files', async () => {
    const store = open();
    expect(await store.history(ORDERS)).toEqual([]);
    expect(await store.favoritesOf(ORDERS)).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('keeps the newest query first, with its time', async () => {
    const store = open();
    await store.add(ORDERS, query('{ a: 1 }'));
    const entries = await store.add(ORDERS, query('{ b: 2 }'));
    expect(entries).toEqual([
      { query: query('{ b: 2 }'), at: '2026-01-01T00:00:01.000Z' },
      { query: query('{ a: 1 }'), at: '2026-01-01T00:00:00.000Z' },
    ]);
  });

  it('keeps at most `limit` entries, dropping the oldest', async () => {
    const store = open({ limit: 3 });
    for (let i = 1; i <= 5; i++) await store.add(ORDERS, query(`{ n: ${i} }`));
    expect((await store.history(ORDERS)).map((e) => e.query.filter)).toEqual([
      '{ n: 5 }',
      '{ n: 4 }',
      '{ n: 3 }',
    ]);
  });

  it('defaults to 50 entries per collection', async () => {
    const store = open();
    for (let i = 1; i <= 55; i++) await store.add(ORDERS, query(`{ n: ${i} }`));
    const entries = await store.history(ORDERS);
    expect(entries).toHaveLength(50);
    expect(entries[0]?.query.filter).toBe('{ n: 55 }');
    expect(entries.at(-1)?.query.filter).toBe('{ n: 6 }');
  });

  it('moves a query run again to the top instead of adding it twice', async () => {
    const store = open();
    await store.add(ORDERS, query('{ a: 1 }'));
    await store.add(ORDERS, query('{ b: 2 }'));
    // Surrounding whitespace does not make it a different query.
    const entries = await store.add(ORDERS, query('  { a: 1 } ', { limit: ' ' }));
    expect(entries.map((e) => e.query)).toEqual([query('{ a: 1 }'), query('{ b: 2 }')]);
    expect(entries[0]?.at).toBe('2026-01-01T00:00:02.000Z');
  });

  it('tells queries apart by every field', async () => {
    const store = open();
    await store.add(ORDERS, query('{ a: 1 }'));
    await store.add(ORDERS, query('{ a: 1 }', { sort: '{ a: -1 }' }));
    await store.add(ORDERS, query('{ a: 1 }', { limit: '10' }));
    expect(await store.history(ORDERS)).toHaveLength(3);
  });

  it('does not record a query with every field empty', async () => {
    const store = open();
    expect(await store.add(ORDERS, query('   '))).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('keeps one history per collection and profile', async () => {
    const store = open();
    await store.add(ORDERS, query('{ orders: 1 }'));
    await store.add(USERS, query('{ users: 1 }'));
    await store.add(OTHER_PROFILE, query('{ other: 1 }'));
    expect((await store.history(ORDERS)).map((e) => e.query.filter)).toEqual(['{ orders: 1 }']);
    expect((await store.history(USERS)).map((e) => e.query.filter)).toEqual(['{ users: 1 }']);
    expect((await store.history(OTHER_PROFILE)).map((e) => e.query.filter)).toEqual([
      '{ other: 1 }',
    ]);
    expect((await readdir(path.join(dir, 'history'))).sort()).toEqual(
      [historyFileName(ORDERS), historyFileName(USERS), historyFileName(OTHER_PROFILE)].sort(),
    );
  });

  it('keeps names with separators apart (no ambiguous file names)', () => {
    expect(historyFileName({ profileId: 'p', db: 'a.b', coll: 'c' })).not.toBe(
      historyFileName({ profileId: 'p', db: 'a', coll: 'b.c' }),
    );
    expect(historyFileName({ profileId: 'p', db: '../x', coll: '/y' })).toMatch(
      /^[0-9a-f]+\.json$/,
    );
  });

  it('persists history in history/<hash>.json and reads it back', async () => {
    await open().add(ORDERS, query('{ a: 1 }'));
    const file = JSON.parse(
      await readFile(path.join(dir, 'history', historyFileName(ORDERS)), 'utf8'),
    ) as unknown;
    expect(file).toEqual({
      version: 1,
      ...ORDERS,
      entries: [{ query: query('{ a: 1 }'), at: '2026-01-01T00:00:00.000Z' }],
    });
    expect((await open().history(ORDERS)).map((e) => e.query.filter)).toEqual(['{ a: 1 }']);
  });

  it('ignores a history file that belongs to another collection', async () => {
    await mkdir(path.join(dir, 'history'));
    await writeFile(
      path.join(dir, 'history', historyFileName(ORDERS)),
      JSON.stringify({ version: 1, ...USERS, entries: [{ query: query('{}'), at: 'x' }] }),
    );
    expect(await open().history(ORDERS)).toEqual([]);
  });

  it('moves a corrupt history file aside and starts empty', async () => {
    await mkdir(path.join(dir, 'history'));
    const file = path.join(dir, 'history', historyFileName(ORDERS));
    await writeFile(file, '{ not json');
    const store = open();
    expect(await store.history(ORDERS)).toEqual([]);
    const names = await readdir(path.join(dir, 'history'));
    expect(names).toEqual([`${historyFileName(ORDERS)}.corrupt-2026-01-01T00-00-00-000Z`]);
    await store.add(ORDERS, query('{ a: 1 }'));
    expect((await open().history(ORDERS)).map((e) => e.query.filter)).toEqual(['{ a: 1 }']);
  });

  it('clears one collection only', async () => {
    const store = open();
    await store.add(ORDERS, query('{ a: 1 }'));
    await store.add(USERS, query('{ b: 1 }'));
    await store.saveFavorite(ORDERS, 'Fav', query('{ f: 1 }'));
    expect(await store.clear(ORDERS)).toEqual([]);
    expect(await open().history(ORDERS)).toEqual([]);
    expect(await open().history(USERS)).toHaveLength(1);
    expect(await open().favoritesOf(ORDERS)).toHaveLength(1);
    expect(await store.clear(ORDERS)).toEqual([]);
  });

  it('saves favorites per collection, sorted by name, in favorites.json', async () => {
    const store = open();
    await store.saveFavorite(ORDERS, 'Open', query('{ status: "open" }'));
    await store.saveFavorite(ORDERS, ' Big ', query('{ total: { $gt: 100 } }'));
    await store.saveFavorite(USERS, 'Admins', query('{ admin: true }'));
    expect(await store.favoritesOf(ORDERS)).toEqual([
      { id: 'f2', name: 'Big', query: query('{ total: { $gt: 100 } }'), at: expect.any(String) },
      { id: 'f1', name: 'Open', query: query('{ status: "open" }'), at: expect.any(String) },
    ]);
    expect((await store.favoritesOf(USERS)).map((f) => f.name)).toEqual(['Admins']);
    expect(await store.favoritesOf(OTHER_PROFILE)).toEqual([]);

    const file = JSON.parse(await readFile(path.join(dir, 'favorites.json'), 'utf8')) as {
      version: number;
      favorites: unknown[];
    };
    expect(file.version).toBe(1);
    expect(file.favorites).toHaveLength(3);
    expect((await open().favoritesOf(ORDERS)).map((f) => f.name)).toEqual(['Big', 'Open']);
  });

  it('replaces the favorite of the same name (ignoring case) and keeps its id', async () => {
    const store = open();
    await store.saveFavorite(ORDERS, 'Open', query('{ a: 1 }'));
    await store.saveFavorite(USERS, 'Open', query('{ users: 1 }'));
    const favorites = await store.saveFavorite(ORDERS, 'OPEN', query('{ a: 2 }'));
    expect(favorites).toEqual([
      { id: 'f1', name: 'OPEN', query: query('{ a: 2 }'), at: expect.any(String) },
    ]);
    expect((await store.favoritesOf(USERS))[0]?.query.filter).toBe('{ users: 1 }');
  });

  it('deletes a favorite of the collection only', async () => {
    const store = open();
    await store.saveFavorite(ORDERS, 'A', query('{ a: 1 }'));
    await store.saveFavorite(USERS, 'B', query('{ b: 1 }'));
    // Another collection's id changes nothing.
    expect(await store.deleteFavorite(ORDERS, 'f2')).toHaveLength(1);
    expect(await store.deleteFavorite(ORDERS, 'f1')).toEqual([]);
    expect(await open().favoritesOf(ORDERS)).toEqual([]);
    expect(await open().favoritesOf(USERS)).toHaveLength(1);
  });

  it('moves a corrupt favorites.json aside', async () => {
    await writeFile(path.join(dir, 'favorites.json'), JSON.stringify({ favorites: 'x' }));
    const store = open();
    expect(await store.favoritesOf(ORDERS)).toEqual([]);
    expect((await readdir(dir)).some((name) => name.startsWith('favorites.json.corrupt-'))).toBe(
      true,
    );
  });

  it('serializes concurrent adds', async () => {
    const store = open();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.add(ORDERS, query(`{ n: ${i} }`))),
    );
    expect(await open().history(ORDERS)).toHaveLength(10);
  });

  it('keeps the previous state when a write fails', async () => {
    let fail = false;
    const failing: HistoryFs = {
      readFile: (p, e) => fs.readFile(p, e),
      writeFile: async (p, d, o) => {
        if (fail) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
        await fs.writeFile(p, d, o);
      },
      rename: (a, b) => fs.rename(a, b),
      unlink: (p) => fs.unlink(p),
      mkdir: (p, o) => fs.mkdir(p, o),
    };
    const store = open({ fs: failing });
    await store.add(ORDERS, query('{ a: 1 }'));
    fail = true;
    await expect(store.add(ORDERS, query('{ b: 1 }'))).rejects.toThrow('disk full');
    await expect(store.saveFavorite(ORDERS, 'x', query('{}'))).rejects.toThrow('disk full');
    fail = false;
    expect((await store.history(ORDERS)).map((e) => e.query.filter)).toEqual(['{ a: 1 }']);
    expect(await store.favoritesOf(ORDERS)).toEqual([]);
  });

  it('fails (without moving it) when a file cannot be read', async () => {
    const unreadable: HistoryFs = {
      readFile: () => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })),
      writeFile: (p, d, o) => fs.writeFile(p, d, o),
      rename: () => Promise.reject(new Error('must not rename')),
      unlink: (p) => fs.unlink(p),
      mkdir: (p, o) => fs.mkdir(p, o),
    };
    const store = open({ fs: unreadable });
    await expect(store.history(ORDERS)).rejects.toThrow('denied');
    await expect(store.add(ORDERS, query('{ a: 1 }'))).rejects.toThrow('denied');
  });

  it('serves history.* through the handlers', async () => {
    const handlers = historyHandlers(open());
    const call = (method: string, params: unknown) =>
      (handlers[method] as (p: unknown) => Promise<unknown>)(params);
    await call('history.add', { ...ORDERS, query: query('{ a: 1 }') });
    await call('history.saveFavorite', { ...ORDERS, name: 'Fav', query: query('{ f: 1 }') });
    expect(await call('history.list', ORDERS)).toEqual({
      entries: [{ query: query('{ a: 1 }'), at: expect.any(String) }],
      favorites: [{ id: 'f1', name: 'Fav', query: query('{ f: 1 }'), at: expect.any(String) }],
    });
    expect(await call('history.deleteFavorite', { ...ORDERS, id: 'f1' })).toEqual({
      favorites: [],
    });
    expect(await call('history.clear', ORDERS)).toEqual({ entries: [] });
  });
});
