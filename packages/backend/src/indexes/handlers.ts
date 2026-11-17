import type { ParsedParamsOf } from '@thicket/contract';

import { abortable, type ConnectionManager } from '../connections/manager';
import type { Handler, HandlerContext } from '../server/rpc';
import { createIndex, dropIndex, hideIndex, indexStatistics, listIndexes } from './indexes';

/**
 * Handlers of `idx.list/stats/create/drop/hide` on the profile's open connection
 * (`NOT_CONNECTED` otherwise). The writes are refused for read-only profiles by `guardWrites`,
 * which `startBackend` wraps around every handler. Reads are cancellable; writes, once sent, run
 * to completion at the server, so their handlers wait for its answer (like `browseHandlers`).
 */
export function indexHandlers(manager: ConnectionManager): Record<string, Handler> {
  return {
    'idx.list': async (p: ParsedParamsOf<'idx.list'>, c: HandlerContext) =>
      abortable(listIndexes(manager.client(p.profileId), p.db, p.coll, c.signal), c.signal),
    'idx.stats': async (p: ParsedParamsOf<'idx.stats'>, c: HandlerContext) =>
      abortable(indexStatistics(manager.client(p.profileId), p.db, p.coll, c.signal), c.signal),
    'idx.create': async (p: ParsedParamsOf<'idx.create'>) =>
      createIndex(manager.client(p.profileId), p.db, p.coll, p.key, p.options),
    'idx.drop': async (p: ParsedParamsOf<'idx.drop'>) =>
      dropIndex(manager.client(p.profileId), p.db, p.coll, p.name),
    'idx.hide': async (p: ParsedParamsOf<'idx.hide'>) =>
      hideIndex(manager.client(p.profileId), p.db, p.coll, p.name, p.hidden),
  };
}
