import type { ParsedParamsOf, ResultOf } from '@thicket/contract';

import { streamOnConnection, type ConnectionManager } from '../../connections/manager';
import { RpcError, type Handler, type HandlerContext } from '../../server/rpc';
import { assertWatchable, streamChanges, watchCommand } from './watch';

/**
 * Handler of `admin.watch` (streamed) on the profile's open connection (`NOT_CONNECTED`
 * otherwise). A standalone server fails the request itself with `UNSUPPORTED` (detail
 * `{ reason: 'needsReplicaSet' }`), before a stream exists. The stream runs until it is cancelled
 * (`CANCELLED`, the server cursor is killed), the connection is closed (`CANCELLED`) or the
 * server invalidates it (`end`).
 */
export function watchHandlers(manager: ConnectionManager): Record<string, Handler> {
  return {
    'admin.watch': async (
      p: ParsedParamsOf<'admin.watch'>,
      c: HandlerContext,
    ): Promise<ResultOf<'admin.watch'>> => {
      const { profileId, ...params } = p;
      const client = manager.client(profileId);
      if (!c.openStream) throw new RpcError('INTERNAL', 'admin.watch needs a streaming server');
      // Invalid params and a standalone server fail the request, before a stream exists.
      watchCommand(params);
      await assertWatchable(client, c.signal);
      const streamId = c.openStream((sink) =>
        streamOnConnection(manager, profileId, client, sink.signal, (signal) =>
          streamChanges(client, params, (event) => sink.send({ event }), signal),
        ),
      );
      return { streamId };
    },
  };
}
