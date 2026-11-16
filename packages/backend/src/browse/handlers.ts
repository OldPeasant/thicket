import type { ParsedParamsOf } from '@thicket/contract';

import { abortable, type ConnectionManager } from '../connections/manager';
import type { Handler, HandlerContext } from '../server/rpc';
import {
  collectionStats,
  createCollection,
  createDatabase,
  databaseStats,
  dropCollection,
  dropDatabase,
  listCollections,
  listDatabases,
  renameCollection,
} from './browse';

/**
 * Handlers of `db.listDatabases/create/drop/stats` and `coll.list/create/drop/rename/stats` on
 * the profile's open connection (`NOT_CONNECTED` otherwise). The writes among them are refused
 * for read-only profiles by `guardWrites`, which `startBackend` wraps around every handler.
 * Reads are cancellable: a cancel answers `CANCELLED` at once (a command already sent runs on at
 * the server, cursors are killed between batches). Writes are not: once sent, a create, drop or
 * rename runs to completion at the server, so its handler ignores the signal, waits for the
 * server's answer and returns that rather than claiming a cancel that did not happen. (`serve`
 * itself still answers a cancelled request id with `CANCELLED` and drops the later result.)
 */
export function browseHandlers(manager: ConnectionManager): Record<string, Handler> {
  return {
    'db.listDatabases': async (p: ParsedParamsOf<'db.listDatabases'>, c: HandlerContext) =>
      abortable(listDatabases(manager.client(p.profileId), p.withSizes ?? false), c.signal),
    'db.create': async (p: ParsedParamsOf<'db.create'>) =>
      createDatabase(manager.client(p.profileId), p.db, p.firstCollection),
    'db.drop': async (p: ParsedParamsOf<'db.drop'>) =>
      dropDatabase(manager.client(p.profileId), p.db),
    'db.stats': async (p: ParsedParamsOf<'db.stats'>, c: HandlerContext) =>
      abortable(databaseStats(manager.client(p.profileId), p.db), c.signal),
    'coll.list': async (p: ParsedParamsOf<'coll.list'>, c: HandlerContext) =>
      abortable(listCollections(manager.client(p.profileId), p.db, c.signal), c.signal),
    'coll.create': async (p: ParsedParamsOf<'coll.create'>) =>
      createCollection(manager.client(p.profileId), p.db, p.coll, p.options),
    'coll.drop': async (p: ParsedParamsOf<'coll.drop'>) =>
      dropCollection(manager.client(p.profileId), p.db, p.coll),
    'coll.rename': async (p: ParsedParamsOf<'coll.rename'>) =>
      renameCollection(manager.client(p.profileId), p.db, p.coll, p.newName, p.dropTarget ?? false),
    'coll.stats': async (p: ParsedParamsOf<'coll.stats'>, c: HandlerContext) =>
      abortable(collectionStats(manager.client(p.profileId), p.db, p.coll, c.signal), c.signal),
  };
}
