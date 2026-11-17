import {
  HISTORY_LIMIT,
  savedQuery as savedQuerySchema,
  type FavoriteQuery,
  type HistoryEntry,
  type SavedQuery,
} from '@thicket/contract';
import { createHash, randomUUID } from 'node:crypto';
import * as nodeFs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';

/** Version of the `history/*.json` and `favorites.json` layouts. */
export const HISTORY_VERSION = 1;

/** A collection: history and favorites are kept per collection. */
export interface CollectionKey {
  profileId: string;
  db: string;
  coll: string;
}

/** The file operations the store needs; injectable so tests can simulate failures. */
export interface HistoryFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  /** Must not return before the data is on disk (`flush`). */
  writeFile(path: string, data: string, options: { flush: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
}

export interface HistoryStoreOptions {
  /** The user-data folder: `history/` and `favorites.json` are kept in it. */
  dir: string;
  fs?: HistoryFs;
  log?: (message: string) => void;
  now?: () => Date;
  /** Ids of new favorites. */
  newId?: () => string;
  /** Most history entries per collection (default `HISTORY_LIMIT`). */
  limit?: number;
}

/**
 * A stored query: like the contract's `savedQuery`, but unknown fields (written by a newer version)
 * are dropped instead of making the whole file invalid.
 */
const storedQuery = z.object(savedQuerySchema.shape);

const historyFile = z.object({
  version: z.number().int().min(1),
  profileId: z.string(),
  db: z.string(),
  coll: z.string(),
  entries: z.array(z.object({ query: storedQuery, at: z.string() })),
});

const storedFavorite = z.object({
  id: z.string().min(1),
  profileId: z.string(),
  db: z.string(),
  coll: z.string(),
  name: z.string().min(1),
  query: storedQuery,
  at: z.string(),
});

type StoredFavorite = z.infer<typeof storedFavorite>;

const favoritesFile = z.object({
  version: z.number().int().min(1),
  favorites: z.array(storedFavorite),
});

const FIELDS = ['filter', 'projection', 'sort', 'collation', 'limit'] as const;

/** The query with surrounding whitespace removed from every field (what is stored and compared). */
export function normalizeQuery(query: SavedQuery): SavedQuery {
  return {
    filter: query.filter.trim(),
    projection: query.projection.trim(),
    sort: query.sort.trim(),
    collation: query.collation.trim(),
    limit: query.limit.trim(),
  };
}

export function sameQuery(a: SavedQuery, b: SavedQuery): boolean {
  return FIELDS.every((field) => a[field] === b[field]);
}

function isEmptyQuery(query: SavedQuery): boolean {
  return FIELDS.every((field) => query[field] === '');
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function sameCollection(a: CollectionKey, b: CollectionKey): boolean {
  return a.profileId === b.profileId && a.db === b.db && a.coll === b.coll;
}

/** File name of a collection's history: a hash, as names may contain any character. */
export function historyFileName(key: CollectionKey): string {
  const hash = createHash('sha256')
    .update(JSON.stringify([key.profileId, key.db, key.coll]))
    .digest('hex');
  return `${hash.slice(0, 40)}.json`;
}

/**
 * Query history and favorite queries, in the user-data folder (SPEC.md section 5):
 *
 * - `history/<hash>.json`, one file per collection: `{ version, profileId, db, coll, entries }`,
 *   newest first, at most `limit` entries. Running a query that is already in the history (equal
 *   in every field after trimming) moves it to the top instead of adding it again. Queries with
 *   every field empty are not recorded.
 * - `favorites.json`: `{ version, favorites: [{ id, profileId, db, coll, name, query, at }] }`.
 *   Names are unique per collection (ignoring case): saving under a taken name replaces that
 *   favorite's query.
 *
 * Files are read lazily and cached. Writes are atomic (`<file>.tmp`, flushed, renamed) and every
 * operation is serialized. A file that is not valid JSON in the expected layout is renamed to
 * `<file>.corrupt-<time>` and treated as empty; a file that cannot be read fails the operation.
 * Unknown fields (from a newer version) are ignored, and dropped when the file is next written.
 */
export class HistoryStore {
  private readonly dir: string;
  private readonly fs: HistoryFs;
  private readonly log: (message: string) => void;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly limit: number;
  private readonly histories = new Map<string, HistoryEntry[]>();
  private favorites: StoredFavorite[] | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: HistoryStoreOptions) {
    this.dir = options.dir;
    this.fs = options.fs ?? nodeFs;
    this.log = options.log ?? (() => undefined);
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => randomUUID());
    this.limit = Math.max(1, options.limit ?? HISTORY_LIMIT);
  }

  get favoritesFile(): string {
    return path.join(this.dir, 'favorites.json');
  }

  historyFile(key: CollectionKey): string {
    return path.join(this.dir, 'history', historyFileName(key));
  }

  /** The collection's history, newest first. */
  history(key: CollectionKey): Promise<HistoryEntry[]> {
    return this.serialized(async () => [...(await this.loadHistory(key))]);
  }

  /** The collection's favorites, sorted by name. */
  favoritesOf(key: CollectionKey): Promise<FavoriteQuery[]> {
    return this.serialized(async () => this.publicFavorites(await this.loadFavorites(), key));
  }

  /** The collection's history and favorites, read in one operation (a consistent snapshot). */
  list(key: CollectionKey): Promise<{ entries: HistoryEntry[]; favorites: FavoriteQuery[] }> {
    return this.serialized(async () => ({
      entries: [...(await this.loadHistory(key))],
      favorites: this.publicFavorites(await this.loadFavorites(), key),
    }));
  }

  /** Records a run query at the top of the history; returns the history. */
  add(key: CollectionKey, query: SavedQuery): Promise<HistoryEntry[]> {
    return this.serialized(async () => {
      const current = await this.loadHistory(key);
      const normalized = normalizeQuery(query);
      if (isEmptyQuery(normalized)) return [...current];
      const next = [
        { query: normalized, at: this.now().toISOString() },
        ...current.filter((entry) => !sameQuery(entry.query, normalized)),
      ].slice(0, this.limit);
      await this.writeHistory(key, next);
      return [...next];
    });
  }

  /** Forgets the collection's history. */
  clear(key: CollectionKey): Promise<HistoryEntry[]> {
    return this.serialized(async () => {
      const current = await this.loadHistory(key);
      if (current.length === 0) return [];
      const file = this.historyFile(key);
      try {
        await this.fs.unlink(file);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
      }
      this.histories.set(file, []);
      return [];
    });
  }

  /** Saves a named query (replacing a favorite of the same name); returns the favorites. */
  saveFavorite(key: CollectionKey, name: string, query: SavedQuery): Promise<FavoriteQuery[]> {
    return this.serialized(async () => {
      const all = await this.loadFavorites();
      const trimmed = name.trim();
      const lower = trimmed.toLowerCase();
      const at = this.now().toISOString();
      const existing = all.find((f) => sameCollection(f, key) && f.name.toLowerCase() === lower);
      const saved: StoredFavorite = {
        id: existing?.id ?? this.newId(),
        profileId: key.profileId,
        db: key.db,
        coll: key.coll,
        name: trimmed,
        query: normalizeQuery(query),
        at,
      };
      const next = existing ? all.map((f) => (f === existing ? saved : f)) : [...all, saved];
      await this.writeFavorites(next);
      return this.publicFavorites(next, key);
    });
  }

  /** Removes a favorite of the collection (an unknown id changes nothing); returns the favorites. */
  deleteFavorite(key: CollectionKey, id: string): Promise<FavoriteQuery[]> {
    return this.serialized(async () => {
      const all = await this.loadFavorites();
      const next = all.filter((f) => !(f.id === id && sameCollection(f, key)));
      if (next.length !== all.length) await this.writeFavorites(next);
      return this.publicFavorites(next, key);
    });
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private publicFavorites(all: readonly StoredFavorite[], key: CollectionKey): FavoriteQuery[] {
    return all
      .filter((f) => sameCollection(f, key))
      .map(({ id, name, query, at }) => ({ id, name, query: { ...query }, at }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async loadHistory(key: CollectionKey): Promise<HistoryEntry[]> {
    const file = this.historyFile(key);
    const cached = this.histories.get(file);
    if (cached) return cached;
    const parsed = await this.readJson(file, historyFile);
    // A hash collision (or a copied file) must not show another collection's queries.
    const entries =
      parsed && sameCollection(parsed, key) ? parsed.entries.slice(0, this.limit) : [];
    this.histories.set(file, entries);
    return entries;
  }

  private async loadFavorites(): Promise<StoredFavorite[]> {
    if (this.favorites) return this.favorites;
    const parsed = await this.readJson(this.favoritesFile, favoritesFile);
    this.favorites = parsed?.favorites ?? [];
    return this.favorites;
  }

  private async writeHistory(key: CollectionKey, entries: HistoryEntry[]): Promise<void> {
    const file = this.historyFile(key);
    await this.fs.mkdir(path.dirname(file), { recursive: true });
    await this.writeJson(file, { version: HISTORY_VERSION, ...pickKey(key), entries });
    this.histories.set(file, entries);
  }

  private async writeFavorites(favorites: StoredFavorite[]): Promise<void> {
    await this.fs.mkdir(this.dir, { recursive: true });
    await this.writeJson(this.favoritesFile, { version: HISTORY_VERSION, favorites });
    this.favorites = favorites;
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    const temp = `${file}.tmp`;
    await this.fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { flush: true });
    await this.fs.rename(temp, file);
  }

  /** The file's content, or `undefined` when it is missing or corrupt (moved aside). */
  private async readJson<T>(file: string, schema: z.ZodType<T>): Promise<T | undefined> {
    let text: string;
    try {
      text = await this.fs.readFile(file, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return undefined;
      this.log(`could not read ${file}: ${String(error)}`);
      throw error;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const parsed = schema.safeParse(json);
    if (parsed.success) return parsed.data;
    const backup = `${file}.corrupt-${this.now().toISOString().replace(/[:.]/g, '-')}`;
    try {
      await this.fs.rename(file, backup);
      this.log(`${file} is not valid; moved it to ${backup}`);
    } catch (error) {
      this.log(`${file} is not valid and could not be moved aside: ${String(error)}`);
      throw error;
    }
    return undefined;
  }
}

function pickKey(key: CollectionKey): CollectionKey {
  return { profileId: key.profileId, db: key.db, coll: key.coll };
}
