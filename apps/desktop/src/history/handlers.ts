import type { Handler } from '@thicket/backend';
import type { ParsedParamsOf, ResultOf } from '@thicket/contract';

import type { CollectionKey, HistoryStore } from './store';

function keyOf(params: CollectionKey): CollectionKey {
  return { profileId: params.profileId, db: params.db, coll: params.coll };
}

/** Handlers of `history.*` (served by main on the renderer's main port). */
export function historyHandlers(store: HistoryStore): Record<string, Handler> {
  return {
    'history.list': async (
      params: ParsedParamsOf<'history.list'>,
    ): Promise<ResultOf<'history.list'>> => {
      // One store operation, so the answer reflects the state when the request arrived, before
      // any later `history.add` (answers come back in request order).
      return store.list(keyOf(params));
    },
    'history.add': async (
      params: ParsedParamsOf<'history.add'>,
    ): Promise<ResultOf<'history.add'>> => ({
      entries: await store.add(keyOf(params), params.query),
    }),
    'history.clear': async (
      params: ParsedParamsOf<'history.clear'>,
    ): Promise<ResultOf<'history.clear'>> => ({ entries: await store.clear(keyOf(params)) }),
    'history.saveFavorite': async (
      params: ParsedParamsOf<'history.saveFavorite'>,
    ): Promise<ResultOf<'history.saveFavorite'>> => ({
      favorites: await store.saveFavorite(keyOf(params), params.name, params.query),
    }),
    'history.deleteFavorite': async (
      params: ParsedParamsOf<'history.deleteFavorite'>,
    ): Promise<ResultOf<'history.deleteFavorite'>> => ({
      favorites: await store.deleteFavorite(keyOf(params), params.id),
    }),
  };
}
