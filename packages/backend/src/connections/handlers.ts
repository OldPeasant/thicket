import type { ParsedParamsOf, ResultOf } from '@thicket/contract';

import type { Handler, HandlerContext } from '../server/rpc';
import type { ConnectionManager } from './manager';

/** Handlers of `conn.test/open/close/status/serverInfo`. */
export function connHandlers(manager: ConnectionManager): Record<string, Handler> {
  return {
    'conn.test': (
      params: ParsedParamsOf<'conn.test'>,
      context: HandlerContext,
    ): Promise<ResultOf<'conn.test'>> =>
      manager.test(
        params.profileId !== undefined
          ? { profileId: params.profileId }
          : { profile: params.profile as NonNullable<typeof params.profile> },
        params.password,
        context.signal,
      ),
    'conn.open': (
      params: ParsedParamsOf<'conn.open'>,
      context: HandlerContext,
    ): Promise<ResultOf<'conn.open'>> =>
      manager.open(params.profileId, params.password, context.signal),
    'conn.close': async (params: ParsedParamsOf<'conn.close'>): Promise<ResultOf<'conn.close'>> => {
      await manager.close(params.profileId);
      return {};
    },
    'conn.status': (params: ParsedParamsOf<'conn.status'>): ResultOf<'conn.status'> => ({
      connections:
        params.profileId !== undefined ? [manager.statusOf(params.profileId)] : manager.statuses(),
    }),
    'conn.serverInfo': (
      params: ParsedParamsOf<'conn.serverInfo'>,
    ): Promise<ResultOf<'conn.serverInfo'>> => manager.serverInfo(params.profileId),
  };
}
