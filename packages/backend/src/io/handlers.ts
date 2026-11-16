import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type {
  ParsedParamsOf,
  PrivilegedMethodName,
  PrivilegedParamsOf,
  ResultOf,
} from '@thicket/contract';

import type { ConnectionManager } from '../connections/manager';
import { RpcError, type Handler, type HandlerContext } from '../server/rpc';
import { exportCommand, exportToFile } from './export';
import { importFile, previewFile, type TextImportFormat } from './import';

/** The native file dialogs `main` shows for the backend (privileged `dialog.*` methods). */
export interface FileDialogs {
  saveFile(
    params: PrivilegedParamsOf<'dialog.saveFile'>,
    signal: AbortSignal,
  ): Promise<string | null>;
  openFile(
    params: PrivilegedParamsOf<'dialog.openFile'>,
    signal: AbortSignal,
  ): Promise<string | null>;
}

/** Calls the privileged dialog methods over the backend's link to main. */
export function dialogsOverLink(
  call: (method: PrivilegedMethodName, params: unknown) => Promise<unknown>,
): FileDialogs {
  const pick = async (method: PrivilegedMethodName, params: unknown) =>
    ((await call(method, params)) as { path: string | null }).path;
  return {
    saveFile: (params) => pick('dialog.saveFile', params),
    openFile: (params) => pick('dialog.openFile', params),
  };
}

/** Chosen import files the backend remembers per `fileToken` (the oldest are forgotten). */
export const MAX_FILE_TOKENS = 100;

const FILTERS: Record<TextImportFormat, { name: string; extensions: string[] }[]> = {
  json: [
    { name: 'JSON', extensions: ['json'] },
    { name: 'All files', extensions: ['*'] },
  ],
  jsonl: [
    { name: 'JSON Lines', extensions: ['jsonl', 'ndjson', 'json'] },
    { name: 'All files', extensions: ['*'] },
  ],
};

function textFormat(format: string, what: string): TextImportFormat {
  if (format === 'json' || format === 'jsonl') return format;
  throw new RpcError('UNSUPPORTED', `${what} as ${format} is not supported yet`);
}

function needStreams(context: HandlerContext, method: string) {
  if (!context.openStream) throw new RpcError('INTERNAL', `${method} needs a streaming server`);
  return context.openStream;
}

/**
 * Handlers of `io.export`, `io.previewImport` and `io.import` (JSON and JSON Lines). The file is
 * chosen with `main`'s native dialog; a cancelled dialog answers `streamId: null` / `null`. The
 * renderer only ever gets an opaque `fileToken` for the chosen import file. Export and import run
 * as streams of `IoProgress` events on the profile's open connection; a cancel stops them (the
 * server operation is killed, a partial export file removed). `io.import` is a write: the backend
 * wraps it with the write guard like every other write handler.
 */
export function ioHandlers(
  manager: ConnectionManager,
  dialogs: FileDialogs,
): Record<string, Handler> {
  const files = new Map<string, { file: string; format: TextImportFormat }>();
  const remember = (file: string, format: TextImportFormat): string => {
    const token = `file-${randomUUID()}`;
    files.set(token, { file, format });
    for (const old of files.keys()) {
      if (files.size <= MAX_FILE_TOKENS) break;
      files.delete(old);
    }
    return token;
  };

  return {
    'io.export': async (
      p: ParsedParamsOf<'io.export'>,
      c: HandlerContext,
    ): Promise<ResultOf<'io.export'>> => {
      const openStream = needStreams(c, 'io.export');
      const format = textFormat(p.format, 'Export');
      // Fail on a closed connection or invalid params before the user picks a file.
      manager.client(p.profileId);
      exportCommand(p);
      const file = await dialogs.saveFile(
        {
          title: 'Export documents',
          defaultName: `${p.coll}.${format}`,
          filters: FILTERS[format].slice(0, 1).concat([{ name: 'All files', extensions: ['*'] }]),
        },
        c.signal,
      );
      if (file === null) return { streamId: null, path: null };
      const client = manager.client(p.profileId);
      const streamId = openStream((sink) =>
        exportToFile(client, p, file, {
          signal: sink.signal,
          progress: (progress) => sink.send(progress),
        }),
      );
      return { streamId, path: file };
    },
    'io.previewImport': async (
      p: ParsedParamsOf<'io.previewImport'>,
      c: HandlerContext,
    ): Promise<ResultOf<'io.previewImport'>> => {
      const format = textFormat(p.format, 'Import');
      const file = await dialogs.openFile(
        { title: 'Import documents', filters: FILTERS[format] },
        c.signal,
      );
      if (file === null) return null;
      const preview = await previewFile(file, format, p.sampleSize, c.signal);
      return {
        fileToken: remember(file, format),
        fileName: path.basename(file),
        sizeBytes: preview.sizeBytes,
        sample: preview.sample,
      };
    },
    'io.import': (p: ParsedParamsOf<'io.import'>, c: HandlerContext): ResultOf<'io.import'> => {
      const openStream = needStreams(c, 'io.import');
      const chosen = files.get(p.fileToken);
      if (!chosen) {
        throw new RpcError('NOT_FOUND', 'Unknown file: choose the file again (io.previewImport)');
      }
      if (p.csvMapping !== undefined) {
        throw new RpcError('INVALID_PARAMS', 'csvMapping is only for CSV files');
      }
      const client = manager.client(p.profileId);
      const streamId = openStream(async (sink) => {
        const result = await importFile(client, chosen.file, chosen.format, {
          db: p.db,
          coll: p.coll,
          ...(p.ordered !== undefined ? { ordered: p.ordered } : {}),
          ...(p.stopOnError !== undefined ? { stopOnError: p.stopOnError } : {}),
          signal: sink.signal,
          progress: (progress) => sink.send(progress),
        });
        return result.inserted;
      });
      return { streamId };
    },
  };
}
