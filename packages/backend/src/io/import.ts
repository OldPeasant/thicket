import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { CsvType, ErrorSummary, IoProgress } from '@thicket/contract';
import { BSON, type Document } from 'mongodb';

import { canonical, toNumber } from '../browse/browse';
import type { ClientLike } from '../connections/manager';
import { Operation } from '../docs/query/query';
import { RpcError } from '../server/rpc';
import {
  BsonScanner,
  createDumpIndexes,
  createWithOptions,
  metadataPath,
  parseDumpedDocument,
  readMetadata,
} from './bson/bson';
import { recordToDocument, resolveMapping, type CsvColumnMapping } from './csv/convert';
import { CsvScanner } from './csv/csv';
import { JsonScanner, LineScanner, ScanError, type Scanner, type ScannedValue } from './scanner';

/**
 * `io.previewImport` / `io.import`. The file is read as a stream: values come out of the
 * format's scanner as their chunks arrive, are turned into documents and inserted in batches;
 * the next chunk is read only after the batch was written.
 *
 * - JSON / JSON Lines: parsed as EJSON (canonical or relaxed: type wrappers such as
 *   `{"$oid": …}` are honoured, plain numbers become Int32 / Int64 / Double).
 * - CSV: the first record is the header; each column is imported as a field path with a BSON
 *   type (`csvMapping`, default: every named column under its name as `auto`).
 * - BSON: a `mongodump` `.bson` file, each document exactly as dumped; its `.metadata.json`
 *   (when present) creates a new collection with the dump's options and, after the documents,
 *   the dump's indexes. Errors name the document's number instead of a line.
 */

export type TextImportFormat = 'json' | 'jsonl';
export type ImportFormat = TextImportFormat | 'csv' | 'bson';

/** One CSV column to import (`io.import`'s `csvMapping`). */
export interface CsvMappingEntry {
  column: string;
  path: string;
  bsonType: CsvType;
}

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

/** One document of the file to import: where it starts, and how to get it (throws RpcError). */
export interface ImportItem {
  line: number;
  parse(): Document;
}

/** A CSV record as an import item, with its cells as written. */
interface CsvItem extends ImportItem {
  cells: string[];
}

/**
 * The records of a CSV file as items; the first record is the header (passed to `onHeader`, not
 * an item). The mapping is checked against the header before any item comes out.
 */
async function* csvItems(
  file: string,
  mapping: readonly CsvMappingEntry[] | undefined,
  signal: AbortSignal | undefined,
  onHeader?: (header: string[]) => void,
): AsyncGenerator<CsvItem> {
  const scanner = new CsvScanner();
  const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: 256 * 1024 });
  let header: string[] | undefined;
  let columns: CsvColumnMapping[] = [];
  const take = function* (records: { cells: string[]; line: number }[]): Generator<CsvItem> {
    for (const record of records) {
      if (header === undefined) {
        header = record.cells;
        columns = resolveMapping(header, mapping);
        onHeader?.(header);
        continue;
      }
      const known = header;
      yield {
        line: record.line,
        cells: record.cells,
        parse: () => recordToDocument(record.cells, record.line, known, columns),
      };
    }
  };
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) throw new RpcError('CANCELLED', 'The operation was cancelled');
      yield* take(scanner.feed(chunk as string));
    }
    yield* take(scanner.end());
  } finally {
    stream.destroy();
  }
}

/** The documents of a `.bson` dump as items (`line` is the document's number). */
async function* bsonItems(
  file: string,
  signal: AbortSignal | undefined,
): AsyncGenerator<ImportItem> {
  const scanner = new BsonScanner();
  const stream = createReadStream(file, { highWaterMark: 1024 * 1024 });
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) throw new RpcError('CANCELLED', 'The operation was cancelled');
      for (const doc of scanner.feed(chunk as Buffer)) {
        yield { line: doc.line, parse: () => parseDumpedDocument(doc) };
      }
    }
    scanner.end();
  } finally {
    stream.destroy();
  }
}

/** The documents of a file to import, in order. A broken structure throws `ScanError`. */
export async function* importItems(
  file: string,
  format: ImportFormat,
  signal?: AbortSignal,
  csvMapping?: readonly CsvMappingEntry[],
): AsyncGenerator<ImportItem> {
  if (format === 'csv') {
    yield* csvItems(file, csvMapping, signal);
  } else if (format === 'bson') {
    yield* bsonItems(file, signal);
  } else {
    for await (const value of scanFile(file, format, signal)) {
      yield { line: value.line, parse: () => parseImportedDocument(value) };
    }
  }
}

/** Rows of a CSV file whose cells the preview shows. */
export const CSV_PREVIEW_ROWS = 20;

export interface ImportPreview {
  sizeBytes: number;
  /** Canonical EJSON of the first documents that parse (values that don't are skipped). */
  sample: string[];
  /** CSV: the header and the cells of the first rows. */
  csvColumns?: string[];
  csvRows?: string[][];
  /** BSON: the name of the dump metadata file next to the file, when there is one. */
  metadataFile?: string;
}

/** The CSV preview: header, first rows' cells, and the first rows imported with the default mapping. */
async function previewCsv(
  file: string,
  sampleSize: number,
  signal: AbortSignal | undefined,
): Promise<Omit<ImportPreview, 'sizeBytes'>> {
  let csvColumns: string[] = [];
  const sample: string[] = [];
  const csvRows: string[][] = [];
  const rows = csvItems(file, undefined, signal, (header) => (csvColumns = header));
  for await (const item of rows) {
    if (csvRows.length < CSV_PREVIEW_ROWS) csvRows.push(item.cells);
    if (sample.length < sampleSize) {
      try {
        sample.push(canonical(item.parse()));
      } catch {
        // A row that does not parse is left out of the sample (its cells are still shown).
      }
    }
    if (csvRows.length >= CSV_PREVIEW_ROWS && sample.length >= sampleSize) break;
  }
  return { sample, csvColumns, csvRows };
}

/**
 * Reads the first `sampleSize` documents of a file for the import preview (CSV: imported with
 * the default mapping, plus the header and the first rows' cells; BSON: plus the name of the
 * metadata file next to it).
 */
export async function previewFile(
  file: string,
  format: ImportFormat,
  sampleSize = DEFAULT_SAMPLE_SIZE,
  signal?: AbortSignal,
): Promise<ImportPreview> {
  try {
    const { size } = await stat(file);
    if (format === 'csv') {
      return { sizeBytes: size, ...(await previewCsv(file, sampleSize, signal)) };
    }
    const sample: string[] = [];
    for await (const item of importItems(file, format, signal)) {
      try {
        sample.push(canonical(item.parse()));
      } catch {
        continue;
      }
      if (sample.length >= sampleSize) break;
    }
    const preview: ImportPreview = { sizeBytes: size, sample };
    if (format === 'bson' && (await readMetadata(file)) !== undefined) {
      preview.metadataFile = path.basename(metadataPath(file));
    }
    return preview;
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
  /** CSV only: the columns to import (default: every named column under its name, `auto`). */
  csvMapping?: readonly CsvMappingEntry[];
  /** Called after every batch with the running totals (and once at the end). */
  progress?: (progress: IoProgress) => void;
  signal?: AbortSignal;
}

/** The dump metadata next to a `.bson` file (`undefined` without one). */
async function readMetadataOf(file: string): Promise<Document | undefined> {
  try {
    return await readMetadata(file);
  } catch (error) {
    throw readError(error, metadataPath(file));
  }
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
 * {@link MAX_REPORTED_ERRORS} lines, in line order). With `stopOnError` (the default) the import
 * ends at the first failure (the earliest line, also when a parse failure was found before the
 * server refused an earlier line of the pending batch): documents of earlier lines stay
 * inserted, and the call rejects with that failure's error after a last progress report. A broken file structure (the scanner cannot find where the
 * documents are) always stops the import the same way: the documents read before it are
 * inserted, a last progress is sent, and the call rejects with INVALID_PARAMS naming its line.
 */
export async function importFile(
  client: ClientLike,
  file: string,
  format: ImportFormat,
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
  let stopLine = Infinity;

  const snapshot = (): IoProgress => ({ processed, failed, errors: [...errors] });
  /**
   * Records a failed document. Failures do not always come in line order: a value that does not
   * parse is found while reading, the server's refusals of earlier lines when their batch is
   * written. So `errors` keeps the first lines (in line order), and a stop the earliest line.
   */
  const fail = (line: number, error: ErrorSummary) => {
    failed++;
    let at = errors.length;
    while (at > 0 && (errors[at - 1]?.index ?? 0) > line) at--;
    if (at < MAX_REPORTED_ERRORS) {
      errors.splice(at, 0, { index: line, error });
      if (errors.length > MAX_REPORTED_ERRORS) errors.pop();
    }
    if (stopOnError && line < stopLine) {
      stop = new RpcError(error.code, `Import stopped: ${error.message}`);
      stopLine = line;
    }
  };

  let batch: Pending[] = [];
  let batchBytes = 0;
  const flush = async () => {
    let rest = batch;
    batch = [];
    batchBytes = 0;
    while (rest.length > 0) {
      const reply = await op.write({
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
    for await (const value of importItems(file, format, options.signal, options.csvMapping)) {
      processed++;
      let doc: Document;
      try {
        doc = value.parse();
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
    const metadata = format === 'bson' ? await readMetadataOf(file) : undefined;
    if (metadata) await createWithOptions(op, client, options.db, options.coll, metadata);
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
    if (metadata) await createDumpIndexes(op, options.coll, metadata);
    return { ...snapshot(), inserted };
  } finally {
    await op.close();
  }
}
