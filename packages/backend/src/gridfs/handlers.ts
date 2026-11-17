import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { ParsedParamsOf, ResultOf } from '@thicket/contract';

import { abortable, streamOnConnection, type ConnectionManager } from '../connections/manager';
import type { FileDialogs } from '../io/handlers';
import { RpcError, type Handler, type HandlerContext } from '../server/rpc';
import {
  deleteFile,
  downloadFile,
  fileInfo,
  listBuckets,
  listFiles,
  parseFileId,
  uploadFile,
} from './gridfs';

function needStreams(context: HandlerContext, method: string) {
  if (!context.openStream) throw new RpcError('INTERNAL', `${method} needs a streaming server`);
  return context.openStream;
}

/** A file name safe to suggest in a save dialog (no folders). */
export function suggestedName(filename: string): string {
  const base = filename.split(/[\\/]/).pop()?.trim() ?? '';
  return base.length > 0 && base !== '.' && base !== '..' ? base : 'download';
}

/**
 * Handlers of `gridfs.buckets/files/download/upload/delete` on the profile's open connection
 * (`NOT_CONNECTED` otherwise). Download and upload ask `main` for the native save/open dialog
 * (a cancelled dialog answers `streamId: null`) and then stream `GridfsProgress` events; a cancel
 * or `conn.close` stops them and removes what they wrote. `gridfs.upload` and `gridfs.delete`
 * are writes: `startBackend` wraps them with the write guard, so a read-only profile is refused
 * before the dialog opens.
 */
export function gridfsHandlers(
  manager: ConnectionManager,
  dialogs: FileDialogs,
): Record<string, Handler> {
  return {
    'gridfs.buckets': async (
      p: ParsedParamsOf<'gridfs.buckets'>,
      c: HandlerContext,
    ): Promise<ResultOf<'gridfs.buckets'>> => ({
      buckets: await abortable(listBuckets(manager.client(p.profileId), p.db), c.signal),
    }),
    'gridfs.files': async (p: ParsedParamsOf<'gridfs.files'>, c: HandlerContext) =>
      abortable(
        listFiles(
          manager.client(p.profileId),
          p.db,
          p.bucket,
          { nameContains: p.nameContains, skip: p.skip, limit: p.limit },
          c.signal,
        ),
        c.signal,
      ),
    'gridfs.download': async (
      p: ParsedParamsOf<'gridfs.download'>,
      c: HandlerContext,
    ): Promise<ResultOf<'gridfs.download'>> => {
      const openStream = needStreams(c, 'gridfs.download');
      const id = parseFileId(p.id);
      // A missing file or a closed connection fails before the user picks a path.
      const info = await fileInfo(manager.client(p.profileId), p.db, p.bucket, id);
      const file = await dialogs.saveFile(
        { title: 'Download file', defaultName: suggestedName(info.filename) },
        c.signal,
      );
      if (file === null) return { streamId: null, path: null };
      const client = manager.client(p.profileId);
      const streamId = openStream((sink) =>
        streamOnConnection(manager, p.profileId, client, sink.signal, (signal) =>
          downloadFile(client, p.db, p.bucket, id, info.length, file, {
            signal,
            progress: (progress) => sink.send(progress),
          }),
        ),
      );
      return { streamId, path: file };
    },
    'gridfs.upload': async (
      p: ParsedParamsOf<'gridfs.upload'>,
      c: HandlerContext,
    ): Promise<ResultOf<'gridfs.upload'>> => {
      const openStream = needStreams(c, 'gridfs.upload');
      manager.client(p.profileId);
      const file = await dialogs.openFile({ title: 'Upload file to GridFS' }, c.signal);
      if (file === null) return { streamId: null, fileName: null, sizeBytes: null };
      let sizeBytes: number;
      try {
        sizeBytes = (await stat(file)).size;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new RpcError('INTERNAL', `Could not read ${file}: ${message}`);
      }
      const fileName = p.filename ?? path.basename(file);
      const client = manager.client(p.profileId);
      const streamId = openStream((sink) =>
        streamOnConnection(manager, p.profileId, client, sink.signal, async (signal) => {
          const result = await uploadFile(client, p.db, p.bucket, file, fileName, {
            signal,
            progress: (progress) => sink.send(progress),
          });
          return result.bytes;
        }),
      );
      return { streamId, fileName, sizeBytes };
    },
    'gridfs.delete': async (
      p: ParsedParamsOf<'gridfs.delete'>,
    ): Promise<ResultOf<'gridfs.delete'>> => ({
      deleted: await deleteFile(manager.client(p.profileId), p.db, p.bucket, parseFileId(p.id)),
    }),
  };
}
