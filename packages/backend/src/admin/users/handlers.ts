import type { ParsedParamsOf } from '@thicket/contract';

import { abortable, type ConnectionManager } from '../../connections/manager';
import type { Handler, HandlerContext } from '../../server/rpc';
import { listRoles, listUsers } from './users';

/**
 * Handlers of `admin.users` and `admin.roles` on the profile's open connection (`NOT_CONNECTED`
 * otherwise). Both are reads, so a cancel answers `CANCELLED` at once.
 */
export function usersHandlers(manager: ConnectionManager): Record<string, Handler> {
  return {
    'admin.users': async (p: ParsedParamsOf<'admin.users'>, c: HandlerContext) =>
      abortable(listUsers(manager.client(p.profileId), p.db), c.signal),
    'admin.roles': async (p: ParsedParamsOf<'admin.roles'>, c: HandlerContext) =>
      abortable(listRoles(manager.client(p.profileId), p.db, p.builtin), c.signal),
  };
}
