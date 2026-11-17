import { createWriteStream, type WriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';

import type { IoProgress, ParsedParamsOf } from '@thicket/contract';
import { BSON, type Document } from 'mongodb';

import type { ClientLike } from '../connections/manager';
import { Operation, parseDocument, parseEjson } from '../docs/query/query';
import { RpcError } from '../server/rpc';
import { collectionMetadata, metadataPath, stringifyMetadata } from './bson/bson';
import { cellText, collectPaths, valueAt } from './csv/convert';
import { csvLine } from './csv/csv';

/**
 * `io.export`: reads the find or aggregation cursor batch by batch and writes each batch to the
 * file before it asks for the next one, so memory holds at most one batch (the cursor's
 * `batchSize`) plus the file stream's buffer, whatever the result size. Formats: JSON, JSON Lines,
 * CSV (a header line of field paths, one line per document) and BSON (a `mongodump`-compatible
 * `.bson` file plus its `.metadata.json`).
 */

export type ExportParams = ParsedParamsOf<'io.export'>;

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
function write(stream: WriteStream, text: string | Uint8Array): Promise<void> {
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

/** How a format writes documents: what comes before, for each batch, and after them. */
interface Encoder {
  /** Text before the documents; sees the first batch (CSV takes its columns from it). */
  head(first: Document[]): string | Uint8Array;
  batch(docs: Document[], written: number): string | Uint8Array;
  tail(written: number): string | Uint8Array;
}

function jsonEncoder(array: boolean, relaxed: boolean): Encoder {
  return {
    head: () => (array ? '[' : ''),
    batch: (docs, written) => {
      let text = '';
      let n = written;
      for (const doc of docs) {
        const json = BSON.EJSON.stringify(doc, { relaxed });
        text += array ? `${n === 0 ? '\n' : ',\n'}${json}` : `${json}\n`;
        n++;
      }
      return text;
    },
    tail: (written) => (array ? (written === 0 ? ']\n' : '\n]\n') : ''),
  };
}

/** Documents whose paths name the CSV columns when the request names none. */
export const CSV_SAMPLE_DOCS = 1000;

/**
 * CSV: the header is `fields`, or the flattened paths of the first batch (at most
 * {@link CSV_SAMPLE_DOCS} documents, in the order first seen); then one line per document.
 */
function csvEncoder(fields: readonly string[] | undefined, relaxed: boolean): Encoder {
  let columns: readonly string[] = fields ?? [];
  return {
    head: (first) => {
      if (fields === undefined) {
        const paths = new Set<string>();
        for (const doc of first.slice(0, CSV_SAMPLE_DOCS)) collectPaths(doc, paths);
        columns = [...paths];
      }
      return columns.length > 0 ? csvLine(columns) : '';
    },
    batch: (docs) => {
      let text = '';
      for (const doc of docs)
        text += csvLine(columns.map((c) => cellText(valueAt(doc, c), relaxed)));
      return text;
    },
    tail: () => '',
  };
}

/** BSON: every document's bytes, one after another (what `mongodump` writes). */
function bsonEncoder(): Encoder {
  return {
    head: () => '',
    batch: (docs) => Buffer.concat(docs.map((doc) => BSON.serialize(doc))),
    tail: () => '',
  };
}

function encoderFor(p: ExportParams): Encoder {
  const relaxed = p.ejsonMode !== 'canonical';
  switch (p.format) {
    case 'json':
      return jsonEncoder(true, relaxed);
    case 'jsonl':
      return jsonEncoder(false, relaxed);
    case 'csv':
      return csvEncoder(p.csvFields, relaxed);
    case 'bson':
      return bsonEncoder();
  }
}

/** Writes a whole small file (the dump metadata). */
async function writeSmallFile(file: string, text: string): Promise<void> {
  const stream = createWriteStream(file, { encoding: 'utf8' });
  stream.on('error', () => undefined);
  try {
    await write(stream, text);
    await finish(stream);
  } catch (error) {
    await closeStream(stream);
    throw error;
  }
}

export interface ExportOptions {
  /** Called with the running total after every batch (throttled) and once at the end. */
  progress?: (progress: IoProgress) => void;
  signal?: AbortSignal;
}

/**
 * Exports the source's documents to `file` (created or truncated) and resolves with their
 * number. JSON writes one array (`[\n{…},\n{…}\n]\n`), JSON Lines one document per line; both in
 * relaxed EJSON unless `ejsonMode` is `canonical`. CSV writes a header line and one line per
 * document; BSON the documents' bytes, then the dump metadata next to the file
 * ({@link metadataPath}; options and indexes only for a `find` export). On failure or cancel the
 * partial files are removed.
 */
export async function exportToFile(
  client: ClientLike,
  p: ExportParams,
  file: string,
  options: ExportOptions = {},
): Promise<number> {
  const cmd = exportCommand(p);
  const encoder = encoderFor(p);
  const op = new Operation(client, p.db, p.coll, options.signal);
  const stream = createWriteStream(file, { encoding: 'utf8' });
  const metadataFile = p.format === 'bson' ? metadataPath(file) : undefined;
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
    let batch = await op.open(cmd);
    await write(stream, encoder.head(batch));
    for (;;) {
      if (batch.length > 0) {
        const chunk = encoder.batch(batch, written);
        written += batch.length;
        await write(stream, chunk);
        if (written - reported >= EXPORT_PROGRESS_EVERY) report();
      }
      if (!op.hasMore) break;
      batch = await op.more(EXPORT_BATCH_SIZE);
    }
    await write(stream, encoder.tail(written));
    if (streamError) throw streamError;
    await finish(stream);
    if (metadataFile !== undefined) {
      const metadata = await collectionMetadata(
        client,
        p.db,
        p.coll,
        p.source.kind === 'find',
        options.signal,
      );
      if (options.signal?.aborted) throw new RpcError('CANCELLED', 'The operation was cancelled');
      await writeSmallFile(metadataFile, `${stringifyMetadata(metadata)}\n`);
    }
    report();
    return written;
  } catch (error) {
    await closeStream(stream);
    await rm(file, { force: true }).catch(() => undefined);
    if (metadataFile !== undefined) await rm(metadataFile, { force: true }).catch(() => undefined);
    throw fileError(error, file);
  } finally {
    await op.close();
  }
}
