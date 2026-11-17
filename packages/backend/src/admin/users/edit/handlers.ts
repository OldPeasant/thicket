import type { ParsedParamsOf } from '@thicket/contract';

import type { ConnectionManager } from '../../../connections/manager';
import type { Handler } from '../../../server/rpc';
import { EDIT_METHODS, editUsers, type EditMethod } from './edit';

/**
 * Handlers of the user and role changes (`admin.createUser` … `admin.revokeRoles`) on the
 * profile's open connection (`NOT_CONNECTED` otherwise). All are writes: `startBackend` puts them
 * behind the write guard (read-only profiles refused, production profiles need `confirmed`).
 * Once sent, a change is not cancelled.
 */
export function usersEditHandlers(manager: ConnectionManager): Record<string, Handler> {
  const handlers: Record<string, Handler> = {};
  for (const method of EDIT_METHODS) {
    handlers[method] = async (p: ParsedParamsOf<EditMethod>) =>
      editUsers(manager.client(p.profileId), method, p);
  }
  return handlers;
}
