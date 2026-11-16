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

/**
 * Handlers of `docs.find` (streamed), `docs.count`, `docs.estimatedCount`, `docs.get` and
 * `docs.getSlice` on the profile's open connection (`NOT_CONNECTED` otherwise). A cancel of the
 * request (or of the find's stream) answers `CANCELLED` and kills the server operation and its
 * cursor.
 */
export function docsQueryHandlers(manager: ConnectionManager): Record<string, Handler> {
  return {
    'docs.find': (p: ParsedParamsOf<'docs.find'>, c: HandlerContext): ResultOf<'docs.find'> => {
      const client = manager.client(p.profileId);
      if (!c.openStream) throw new RpcError('INTERNAL', 'docs.find needs a streaming server');
      // Invalid params fail the request itself, before a stream exists.
      const built = buildFind(p);
      const streamId = c.openStream((sink) =>
        streamFind(client, p, (batch) => sink.send(batch), sink.signal, built),
      );
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
