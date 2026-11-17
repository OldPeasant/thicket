import type { ParsedParamsOf } from '@thicket/contract';

import { abortable, type ConnectionManager } from '../connections/manager';
import type { Handler, HandlerContext } from '../server/rpc';
import { analyzeCollection } from './analyze';

/**
 * Handler of `schema.analyze` on the profile's open connection (`NOT_CONNECTED` otherwise). A
 * cancel answers `CANCELLED` at once and kills the sampling operation on the server.
 */
export function schemaHandlers(manager: ConnectionManager): Record<string, Handler> {
  return {
    'schema.analyze': async (p: ParsedParamsOf<'schema.analyze'>, c: HandlerContext) =>
      abortable(analyzeCollection(manager.client(p.profileId), p, c.signal), c.signal),
  };
}
