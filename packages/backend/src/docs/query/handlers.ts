import type { ParsedParamsOf, ResultOf } from '@thicket/contract';

import { abortable, type ConnectionManager } from '../../connections/manager';
import { RpcError, type Handler, type HandlerContext } from '../../server/rpc';
import {
  buildFind,
  countDocuments,
  estimatedCount,
  getDocument,
  getSlice,
  streamFind,
} from './query';

/** True while `client` is still the open connection of the profile (not closed or replaced). */
function isOpenClient(manager: ConnectionManager, profileId: string, client: unknown): boolean {
  try {
    return manager.client(profileId) === client;
  } catch {
    return false;
  }
}

/**
 * Handlers of `docs.find` (streamed), `docs.count`, `docs.estimatedCount`, `docs.get` and
 * `docs.getSlice` on the profile's open connection (`NOT_CONNECTED` otherwise). A cancel of the
 * request (or of the find's stream) answers `CANCELLED` and kills the server operation and its
 * cursor. A find stream whose connection was closed (`conn.close`) meanwhile ends `CANCELLED`.
 */
export function docsQueryHandlers(manager: ConnectionManager): Record<string, Handler> {
  return {
    'docs.find': (p: ParsedParamsOf<'docs.find'>, c: HandlerContext): ResultOf<'docs.find'> => {
      const client = manager.client(p.profileId);
      if (!c.openStream) throw new RpcError('INTERNAL', 'docs.find needs a streaming server');
      // Invalid params fail the request itself, before a stream exists.
      const built = buildFind(p);
      const streamId = c.openStream(async (sink) => {
        try {
          return await streamFind(client, p, (batch) => sink.send(batch), sink.signal, built);
        } catch (error) {
          // `conn.close` cancels the profile's streams: whatever the closed client failed with.
          if (!isOpenClient(manager, p.profileId, client)) {
            throw new RpcError('CANCELLED', 'The connection was closed');
          }
          throw error;
        }
      });
      return { streamId };
    },
    'docs.count': async (p: ParsedParamsOf<'docs.count'>, c: HandlerContext) =>
      abortable(countDocuments(manager.client(p.profileId), p, c.signal), c.signal),
    'docs.estimatedCount': async (p: ParsedParamsOf<'docs.estimatedCount'>, c: HandlerContext) =>
      abortable(estimatedCount(manager.client(p.profileId), p, c.signal), c.signal),
    'docs.get': async (p: ParsedParamsOf<'docs.get'>, c: HandlerContext) =>
      abortable(getDocument(manager.client(p.profileId), p, c.signal), c.signal),
    'docs.getSlice': async (p: ParsedParamsOf<'docs.getSlice'>, c: HandlerContext) =>
      abortable(getSlice(manager.client(p.profileId), p, c.signal), c.signal),
  };
}
