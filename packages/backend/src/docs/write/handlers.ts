import type { ParsedParamsOf } from '@thicket/contract';

import { abortable, type ConnectionManager } from '../../connections/manager';
import type { Handler, HandlerContext } from '../../server/rpc';
import {
  deleteDocument,
  deleteMany,
  insertDocuments,
  previewMany,
  replaceDocument,
  updateDocument,
  updateMany,
} from './write';

/**
 * Handlers of `docs.insert/update/replace/delete`, `docs.previewMany` and
 * `docs.updateMany/deleteMany` on the profile's open connection (`NOT_CONNECTED` otherwise).
 * `startBackend` wraps the write methods with `guardWrites()`; these handlers do not check the
 * profile flags themselves.
 */
export function docsWriteHandlers(manager: ConnectionManager): Record<string, Handler> {
  return {
    'docs.insert': async (p: ParsedParamsOf<'docs.insert'>, c: HandlerContext) =>
      abortable(insertDocuments(manager.client(p.profileId), p, c.signal), c.signal),
    'docs.update': async (p: ParsedParamsOf<'docs.update'>, c: HandlerContext) =>
      abortable(updateDocument(manager.client(p.profileId), p, c.signal), c.signal),
    'docs.replace': async (p: ParsedParamsOf<'docs.replace'>, c: HandlerContext) =>
      abortable(replaceDocument(manager.client(p.profileId), p, c.signal), c.signal),
    'docs.delete': async (p: ParsedParamsOf<'docs.delete'>, c: HandlerContext) =>
      abortable(deleteDocument(manager.client(p.profileId), p, c.signal), c.signal),
    'docs.previewMany': async (p: ParsedParamsOf<'docs.previewMany'>, c: HandlerContext) =>
      abortable(previewMany(manager.client(p.profileId), p, c.signal), c.signal),
    'docs.updateMany': async (p: ParsedParamsOf<'docs.updateMany'>, c: HandlerContext) =>
      abortable(updateMany(manager.client(p.profileId), p, c.signal), c.signal),
    'docs.deleteMany': async (p: ParsedParamsOf<'docs.deleteMany'>, c: HandlerContext) =>
      abortable(deleteMany(manager.client(p.profileId), p, c.signal), c.signal),
  };
}
