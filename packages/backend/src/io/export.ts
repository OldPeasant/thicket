import { createWriteStream, type WriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';

import type { IoProgress, ParsedParamsOf } from '@thicket/contract';
import { BSON, type Document } from 'mongodb';

import type { ClientLike } from '../connections/manager';
import { Operation, parseDocument, parseEjson } from '../docs/query/query';
import { RpcError } from '../server/rpc';

/**
 * `io.export` for JSON and JSON Lines: reads the find or aggregation cursor batch by batch and
 * writes each batch to the file before it asks for the next one, so memory holds at most one
 * batch (the cursor's `batchSize`) plus the file stream's buffer, whatever the result size.
 */

export type ExportParams = ParsedParamsOf<'io.export'>;

/** Formats this module writes (CSV and BSON come with task io-advanced). */
export const TEXT_EXPORT_FORMATS = ['json', 'jsonl'] as const;

/** Documents per `getMore` while exporting. */
export const EXPORT_BATCH_SIZE = 1000;

/** Least number of documents between two progress events. */
export const EXPORT_PROGRESS_EVERY = 1000;

function optional(target: Document, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

/** The cursor command of an export's source (no paging, the user's projection unchanged). */
export function exportCommand(p: ExportParams): Document {
  const source = p.source;
  if (source.kind === 'aggregate') {
    const pipeline = parseEjson(source.pipeline, 'pipeline');
    if (!Array.isArray(pipeline)) throw new RpcError('INVALID_PARAMS', 'pipeline must be an array');
    const cmd: Document = { aggregate: p.coll, pipeline, cursor: { batchSize: EXPORT_BATCH_SIZE } };
    return cmd;
  }
  const cmd: Document = { find: p.coll, filter: parseDocument(source.filter, 'filter') };
  if (source.sort !== undefined) cmd['sort'] = parseDocument(source.sort, 'sort', true);
  if (source.projection !== undefined) {
    const projection = parseDocument(source.projection, 'projection', true);
    if (Object.keys(projection).length > 0) cmd['projection'] = projection;
  }
  if (source.collation !== undefined) {
    cmd['collation'] = parseDocument(source.collation, 'collation', true);
  }
  if (source.hint !== undefined) cmd['hint'] = parseEjson(source.hint, 'hint', true);
  optional(cmd, 'skip', source.skip);
  if (source.limit !== undefined && source.limit > 0) cmd['limit'] = source.limit;
  optional(cmd, 'maxTimeMS', source.maxTimeMS);
  cmd['batchSize'] = EXPORT_BATCH_SIZE;
  return cmd;
}

/** The error of a stream that failed or was closed, if it did (it then writes nothing more). */
function brokenStream(stream: WriteStream): Error | undefined {
  if (stream.errored) return stream.errored;
  if (stream.destroyed) return new Error('the file was closed');
  return undefined;
}

/**
 * Writes `text`, waiting for `drain` when the stream's buffer is full (back pressure). Rejects at
 * once when the stream already failed: a destroyed stream emits neither `drain` nor `error` again.
 */
function write(stream: WriteStream, text: string): Promise<void> {
  const broken = brokenStream(stream);
  if (broken) return Promise.reject(broken);
  if (stream.write(text)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = (error?: Error) => {
      stream.off('drain', onDrain);
      stream.off('error', onError);
      stream.off('close', onClose);
      if (error) reject(error);
      else resolve();
    };
    const onDrain = () => done();
    const onError = (error: Error) => done(error);
    const onClose = () => done(brokenStream(stream) ?? new Error('the file was closed'));
    stream.once('drain', onDrain);
    stream.once('error', onError);
    stream.once('close', onClose);
  });
}

/** Ends the stream; rejects when it failed (also when the file could not be opened). */
function finish(stream: WriteStream): Promise<void> {
  const broken = brokenStream(stream);
  if (broken) return Promise.reject(broken);
  return new Promise((resolve, reject) => {
    stream.end((error?: Error | null) => {
      const failed = error ?? brokenStream(stream);
      if (failed) reject(failed);
      else resolve();
    });
  });
}

/**
 * Destroys the stream and waits until its file is closed. An open still running finishes (and
 * creates the file) first, so a removal after this cannot be undone by a late open.
 */
function closeStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.closed) {
      resolve();
      return;
    }
    stream.once('close', () => resolve());
    stream.destroy();
  });
}

function fileError(error: unknown, file: string): RpcError {
  if (error instanceof RpcError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new RpcError('INTERNAL', `Could not write ${file}: ${message}`);
}

export interface ExportOptions {
  /** Called with the running total after every batch (throttled) and once at the end. */
  progress?: (progress: IoProgress) => void;
  signal?: AbortSignal;
}

/**
 * Exports the source's documents to `file` (created or truncated) and resolves with their
 * number. JSON writes one array (`[\n{…},\n{…}\n]\n`), JSON Lines one document per line; both in
 * relaxed EJSON unless `ejsonMode` is `canonical`. On failure or cancel the partial file is
 * removed.
 */
export async function exportToFile(
  client: ClientLike,
  p: ExportParams,
  file: string,
  options: ExportOptions = {},
): Promise<number> {
  if (p.format !== 'json' && p.format !== 'jsonl') {
    throw new RpcError('UNSUPPORTED', `Export as ${p.format} is not supported yet`);
  }
  const cmd = exportCommand(p);
  const relaxed = p.ejsonMode !== 'canonical';
  const array = p.format === 'json';
  const op = new Operation(client, p.db, p.coll, options.signal);
  const stream = createWriteStream(file, { encoding: 'utf8' });
  // Errors also surface through write()/finish(); this keeps an early one from being unhandled.
  let streamError: unknown;
  stream.on('error', (error) => (streamError ??= error));
  let written = 0;
  let reported = 0;
  const report = () => {
    reported = written;
    options.progress?.({ processed: written, failed: 0, errors: [] });
  };
  try {
    if (array) await write(stream, '[');
    let batch = await op.open(cmd);
    for (;;) {
      if (batch.length > 0) {
        let text = '';
        for (const doc of batch) {
          const json = BSON.EJSON.stringify(doc, { relaxed });
          text += array ? `${written === 0 ? '\n' : ',\n'}${json}` : `${json}\n`;
          written++;
        }
        await write(stream, text);
        if (written - reported >= EXPORT_PROGRESS_EVERY) report();
      }
      if (!op.hasMore) break;
      batch = await op.more(EXPORT_BATCH_SIZE);
    }
    if (array) await write(stream, written === 0 ? ']\n' : '\n]\n');
    if (streamError) throw streamError;
    await finish(stream);
    report();
    return written;
  } catch (error) {
    await closeStream(stream);
    await rm(file, { force: true }).catch(() => undefined);
    throw fileError(error, file);
  } finally {
    await op.close();
  }
}
