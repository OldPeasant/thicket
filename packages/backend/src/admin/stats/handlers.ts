import type { ParsedParamsOf } from '@thicket/contract';

import { abortable, type ConnectionManager } from '../../connections/manager';
import type { Handler, HandlerContext } from '../../server/rpc';
import { replSetStatus, serverStatus } from './stats';

/**
 * Handlers of `admin.serverStatus` and `admin.replSetStatus` on the profile's open connection
 * (`NOT_CONNECTED` otherwise). Both are reads.
 */
export function statsHandlers(manager: ConnectionManager): Record<string, Handler> {
  return {
    'admin.serverStatus': async (p: ParsedParamsOf<'admin.serverStatus'>, c: HandlerContext) =>
      abortable(serverStatus(manager.client(p.profileId)), c.signal),
    'admin.replSetStatus': async (p: ParsedParamsOf<'admin.replSetStatus'>, c: HandlerContext) =>
      abortable(replSetStatus(manager.client(p.profileId)), c.signal),
  };
}
