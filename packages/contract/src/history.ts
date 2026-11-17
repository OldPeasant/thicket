import { z } from 'zod';

import { collTarget } from './common';
import { defineMethods } from './define';

/** Most entries of a collection's query history; older ones are dropped. */
export const HISTORY_LIMIT = 50;
/** Longest text of one query bar field that history and favorites keep. */
export const MAX_QUERY_FIELD_LENGTH = 100_000;
/** Longest name of a favorite. */
export const MAX_FAVORITE_NAME_LENGTH = 200;

const queryField = z.string().max(MAX_QUERY_FIELD_LENGTH);

/**
 * A query as typed in the collection view's query bar (shell syntax, `limit` as typed). History
 * keeps the text, not parsed EJSON, so re-running fills the bar exactly as it was.
 */
export const savedQuery = z.strictObject({
  filter: queryField,
  projection: queryField,
  sort: queryField,
  collation: queryField,
  limit: queryField,
});

export type SavedQuery = z.infer<typeof savedQuery>;

/** One run query of a collection (`history/`), newest first. */
export const historyEntry = z.object({
  query: savedQuery,
  /** ISO time of the last run. */
  at: z.string(),
});

export type HistoryEntry = z.infer<typeof historyEntry>;

/** A named query of a collection (`favorites.json`). */
export const favoriteQuery = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  query: savedQuery,
  /** ISO time of the last save. */
  at: z.string(),
});

export type FavoriteQuery = z.infer<typeof favoriteQuery>;

const favoriteName = z
  .string()
  .trim()
  .min(1, { message: 'name must not be empty' })
  .max(MAX_FAVORITE_NAME_LENGTH, {
    message: `name must be at most ${MAX_FAVORITE_NAME_LENGTH} characters`,
  });

const historyResult = z.object({ entries: z.array(historyEntry) });
const favoritesResult = z.object({ favorites: z.array(favoriteQuery) });

export const historyMethods = defineMethods({
  'history.list': {
    summary: "A collection's recent queries (newest first) and favorites (by name)",
    route: 'main',
    params: z.strictObject({ ...collTarget }),
    result: z.object({
      entries: z.array(historyEntry),
      favorites: z.array(favoriteQuery),
    }),
  },
  'history.add': {
    summary: "Records a run query at the top of the collection's history (an equal one moves up)",
    route: 'main',
    params: z.strictObject({ ...collTarget, query: savedQuery }),
    result: historyResult,
  },
  'history.clear': {
    summary: "Forgets the collection's query history (favorites stay)",
    route: 'main',
    params: z.strictObject({ ...collTarget }),
    result: historyResult,
  },
  'history.saveFavorite': {
    summary: 'Saves a named query of the collection (a favorite of the same name is replaced)',
    route: 'main',
    params: z.strictObject({ ...collTarget, name: favoriteName, query: savedQuery }),
    result: favoritesResult,
  },
  'history.deleteFavorite': {
    summary: 'Removes a favorite of the collection',
    route: 'main',
    params: z.strictObject({ ...collTarget, id: z.string().min(1) }),
    result: favoritesResult,
  },
});
