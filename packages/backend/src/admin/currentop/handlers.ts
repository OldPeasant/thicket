import type { ParsedParamsOf } from '@thicket/contract';

import { abortable, type ConnectionManager } from '../../connections/manager';
import type { Handler, HandlerContext } from '../../server/rpc';
import { currentOps, killOp } from './currentop';

/**
 * Handlers of `admin.currentOp` and `admin.killOp` on the profile's open connection
 * (`NOT_CONNECTED` otherwise). `admin.killOp` is a write: `startBackend` puts it behind the write
 * guard (read-only profiles refused, production profiles need `confirmed`).
 */
export function currentOpHandlers(manager: ConnectionManager): Record<string, Handler> {
  return {
    'admin.currentOp': async (p: ParsedParamsOf<'admin.currentOp'>, c: HandlerContext) => {
      const { profileId, ...filter } = p;
      return abortable(currentOps(manager.client(profileId), filter), c.signal);
    },
    'admin.killOp': async (p: ParsedParamsOf<'admin.killOp'>) =>
      killOp(manager.client(p.profileId), p.opId),
  };
}
