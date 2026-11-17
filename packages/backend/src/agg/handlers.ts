import type { ParsedParamsOf, ResultOf } from '@thicket/contract';

import { abortable, isOpenClient, type ConnectionManager } from '../connections/manager';
import { RpcError, type Handler, type HandlerContext } from '../server/rpc';
import { buildAggregate, createView, explain, previewStage, streamAggregate } from './agg';

/**
 * Handlers of `agg.run` (streamed), `agg.previewStage`, `agg.explain` and `agg.createView` on the
 * profile's open connection (`NOT_CONNECTED` otherwise). `startBackend` wraps the write methods
 * (`agg.createView`, and `agg.run` with `$out`/`$merge`) with `guardWrites()`; these handlers do
 * not check the profile flags themselves. Cancelling works like `docs.find`.
 */
export function aggHandlers(manager: ConnectionManager): Record<string, Handler> {
  return {
    'agg.run': (p: ParsedParamsOf<'agg.run'>, c: HandlerContext): ResultOf<'agg.run'> => {
      const client = manager.client(p.profileId);
      if (!c.openStream) throw new RpcError('INTERNAL', 'agg.run needs a streaming server');
      // Invalid params fail the request itself, before a stream exists.
      const built = buildAggregate(p);
      const streamId = c.openStream(async (sink) => {
        try {
          return await streamAggregate(client, p, (batch) => sink.send(batch), sink.signal, built);
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
    'agg.previewStage': async (p: ParsedParamsOf<'agg.previewStage'>, c: HandlerContext) =>
      abortable(previewStage(manager.client(p.profileId), p, c.signal), c.signal),
    'agg.explain': async (p: ParsedParamsOf<'agg.explain'>, c: HandlerContext) =>
      abortable(explain(manager.client(p.profileId), p, c.signal), c.signal),
    'agg.createView': async (p: ParsedParamsOf<'agg.createView'>, c: HandlerContext) =>
      abortable(createView(manager.client(p.profileId), p), c.signal),
  };
}
