import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import type { ErrorSummary, IoProgress } from '@thicket/contract';
import { BSON, type Document } from 'mongodb';

import { canonical, toNumber } from '../browse/browse';
import type { ClientLike } from '../connections/manager';
import { Operation } from '../docs/query/query';
import { RpcError } from '../server/rpc';
import { JsonScanner, LineScanner, ScanError, type Scanner, type ScannedValue } from './scanner';

/**
 * `io.previewImport` / `io.import` for JSON and JSON Lines. The file is read as a stream: values
 * come out of the scanner as their chunks arrive, are parsed as EJSON (canonical or relaxed: type
 * wrappers such as `{"$oid": …}` are honoured, plain numbers become Int32 / Int64 / Double) and
 * inserted in batches; the next chunk is read only after the batch was written.
 */

export type TextImportFormat = 'json' | 'jsonl';

/** Most documents per `insert` command. */
export const IMPORT_BATCH_DOCS = 1000;

/** Most BSON bytes per `insert` command (the command itself must stay below 16 MB). */
export const IMPORT_BATCH_BYTES = 8 * 1024 * 1024;

/** Per-document errors kept for the progress events. */
export const MAX_REPORTED_ERRORS = 100;

/** Documents in the preview when `sampleSize` is not given. */
export const DEFAULT_SAMPLE_SIZE = 20;

const isPlainDocument = (value: unknown): value is Document =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype &&
  !('_bsontype' in value);

/** Parses one scanned value into a document, or throws an `RpcError` naming its line. */
export function parseImportedDocument(value: ScannedValue): Document {
  let parsed: unknown;
  try {
    parsed = BSON.EJSON.parse(value.text, { relaxed: false });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new RpcError('INVALID_PARAMS', `Line ${String(value.line)}: not valid JSON: ${reason}`);
  }
  if (!isPlainDocument(parsed)) {
    throw new RpcError('INVALID_PARAMS', `Line ${String(value.line)}: not a document`);
  }
  return parsed;
}

function scannerFor(format: TextImportFormat): Scanner {
  return format === 'jsonl' ? new LineScanner() : new JsonScanner();
}

function readError(error: unknown, file: string): RpcError {
  if (error instanceof RpcError) return error;
  if (error instanceof ScanError) return new RpcError('INVALID_PARAMS', error.message);
  const code = (error as { code?: unknown }).code;
  if (code === 'ENOENT') return new RpcError('NOT_FOUND', `The file ${file} no longer exists`);
  const message = error instanceof Error ? error.message : String(error);
  return new RpcError('INTERNAL', `Could not read ${file}: ${message}`);
}

/**
 * The values of a file, in order, read chunk by chunk. Stops reading (and closes the file) when
 * the consumer stops iterating. A broken file structure throws `ScanError`.
 */
export async function* scanFile(
  file: string,
  format: TextImportFormat,
  signal?: AbortSignal,
): AsyncGenerator<ScannedValue> {
  const scanner = scannerFor(format);
  const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: 256 * 1024 });
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) throw new RpcError('CANCELLED', 'The operation was cancelled');
      yield* scanner.feed(chunk as string);
    }
    yield* scanner.end();
  } finally {
    stream.destroy();
  }
}

export interface ImportPreview {
  sizeBytes: number;
  /** Canonical EJSON of the first documents that parse (values that don't are skipped). */
  sample: string[];
}

/** Reads the first `sampleSize` documents of a file for the import preview. */
export async function previewFile(
  file: string,
  format: TextImportFormat,
  sampleSize = DEFAULT_SAMPLE_SIZE,
  signal?: AbortSignal,
): Promise<ImportPreview> {
  try {
    const { size } = await stat(file);
    const sample: string[] = [];
    for await (const value of scanFile(file, format, signal)) {
      try {
        sample.push(canonical(parseImportedDocument(value)));
      } catch {
        continue;
      }
      if (sample.length >= sampleSize) break;
    }
    return { sizeBytes: size, sample };
  } catch (error) {
    throw readError(error, file);
  }
}

export interface ImportOptions {
  db: string;
  coll: string;
  /** Insert in file order; a write error stops the rest of its batch (default true). */
  ordered?: boolean;
  /** Stop the import at the first failed document (default true); else skip it and go on. */
  stopOnError?: boolean;
  /** Called after every batch with the running totals (and once at the end). */
  progress?: (progress: IoProgress) => void;
  signal?: AbortSignal;
}

export interface ImportResult extends IoProgress {
  /** Documents written to the collection. */
  inserted: number;
}

interface Pending {
  doc: Document;
  line: number;
}

interface WriteError {
  index: number;
  errmsg: string;
}

function writeErrorsOf(reply: Document): WriteError[] {
  const list = reply['writeErrors'];
  if (!Array.isArray(list)) return [];
  return (list as Document[]).map((e) => ({
    index: toNumber(e['index']) ?? 0,
    errmsg: typeof e['errmsg'] === 'string' ? e['errmsg'] : 'write error',
  }));
}

/**
 * Imports a JSON / JSON Lines file into `db.coll` (created by the first insert if missing).
 * Every document that fails (it is not valid JSON/EJSON, not a document, or the server refuses
 * it, e.g. a duplicate `_id`) is counted in `failed` and its line reported in `errors` (the first
 * {@link MAX_REPORTED_ERRORS}). With `stopOnError` (the default) the import ends at the first
 * failure: documents of earlier lines stay inserted, and the call rejects with that failure's
 * error after a last progress report. A broken file structure (the scanner cannot find where the
 * documents are) always stops the import the same way: the documents read before it are
 * inserted, a last progress is sent, and the call rejects with INVALID_PARAMS naming its line.
 */
export async function importFile(
  client: ClientLike,
  file: string,
  format: TextImportFormat,
  options: ImportOptions,
): Promise<ImportResult> {
  const ordered = options.ordered ?? true;
  const stopOnError = options.stopOnError ?? true;
  const op = new Operation(client, options.db, options.coll, options.signal);
  let processed = 0;
  let failed = 0;
  let inserted = 0;
  const errors: { index: number; error: ErrorSummary }[] = [];
  let stop: RpcError | undefined;

  const snapshot = (): IoProgress => ({ processed, failed, errors: [...errors] });
  const fail = (line: number, error: ErrorSummary) => {
    failed++;
    if (errors.length < MAX_REPORTED_ERRORS) errors.push({ index: line, error });
    if (stopOnError) stop ??= new RpcError(error.code, `Import stopped: ${error.message}`);
  };

  let batch: Pending[] = [];
  let batchBytes = 0;
  const flush = async () => {
    let rest = batch;
    batch = [];
    batchBytes = 0;
    while (rest.length > 0) {
      const reply = await op.run({
        insert: options.coll,
        documents: rest.map((p) => p.doc),
        ordered,
      });
      const wce = reply['writeConcernError'] as Document | undefined;
      if (wce) {
        const reason = typeof wce['errmsg'] === 'string' ? wce['errmsg'] : 'unknown';
        throw new RpcError(
          'SERVER_ERROR',
          `The insert was applied but not acknowledged by the requested write concern: ${reason}`,
        );
      }
      inserted += toNumber(reply['n']) ?? 0;
      const writeErrors = writeErrorsOf(reply);
      for (const e of writeErrors) {
        const line = rest[e.index]?.line ?? 0;
        fail(line, { code: 'SERVER_ERROR', message: `Line ${String(line)}: ${e.errmsg}` });
      }
      const last = writeErrors.at(-1);
      // An ordered insert stops at its first error: go on after it, unless the import stops.
      rest = ordered && last && !stop ? rest.slice(last.index + 1) : [];
    }
    options.progress?.(snapshot());
  };

  /** Reads the file into batches until its end or a stop; a broken structure throws ScanError. */
  const readAll = async () => {
    for await (const value of scanFile(file, format, options.signal)) {
      processed++;
      let doc: Document;
      try {
        doc = parseImportedDocument(value);
      } catch (error) {
        fail(value.line, (error as RpcError).toInfo());
        if (stop) break;
        continue;
      }
      const size = BSON.calculateObjectSize(doc);
      if (batch.length > 0 && batchBytes + size > IMPORT_BATCH_BYTES) await flush();
      if (stop) break;
      batch.push({ doc, line: value.line });
      batchBytes += size;
      if (batch.length >= IMPORT_BATCH_DOCS) await flush();
      if (stop) break;
    }
  };

  // A broken file structure stops the import (whatever stopOnError says), like a stop.
  let broken: RpcError | undefined;
  try {
    try {
      try {
        await readAll();
      } catch (error) {
        // Other read errors (the file vanished, CANCELLED) end the import without a flush.
        if (!(error instanceof ScanError)) throw error;
        broken = readError(error, file);
      }
      // Documents read before a failed line or a broken structure are still written (also when
      // the import stops); an empty flush only sends the final progress.
      await flush();
    } catch (error) {
      throw readError(error, file);
    }
    // A stop comes from an earlier line than the broken structure: the import ended there.
    const failure = stop ?? broken;
    if (failure) throw failure;
    return { ...snapshot(), inserted };
  } finally {
    await op.close();
  }
}
