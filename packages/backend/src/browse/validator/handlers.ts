import type { ParsedParamsOf } from '@thicket/contract';

import { abortable, type ConnectionManager } from '../../connections/manager';
import type { Handler, HandlerContext } from '../../server/rpc';
import { checkValidator, getValidator, setValidator } from './validator';

/**
 * Handlers of `coll.validator.get/set/check` on the profile's open connection (`NOT_CONNECTED`
 * otherwise). `set` is a write (refused for read-only profiles by `guardWrites`) and, once sent,
 * runs to completion like the other `browseHandlers` writes; the reads are cancellable.
 */
export function validatorHandlers(manager: ConnectionManager): Record<string, Handler> {
  return {
    'coll.validator.get': async (p: ParsedParamsOf<'coll.validator.get'>, c: HandlerContext) =>
      abortable(getValidator(manager.client(p.profileId), p.db, p.coll, c.signal), c.signal),
    'coll.validator.set': async (p: ParsedParamsOf<'coll.validator.set'>) =>
      setValidator(
        manager.client(p.profileId),
        p.db,
        p.coll,
        p.validator,
        p.validationLevel,
        p.validationAction,
      ),
    'coll.validator.check': async (p: ParsedParamsOf<'coll.validator.check'>, c: HandlerContext) =>
      abortable(
        checkValidator(manager.client(p.profileId), p.db, p.coll, p.ids, p.validator, c.signal),
        c.signal,
      ),
  };
}
