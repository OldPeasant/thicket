import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { BSON, type Document } from 'mongodb';

import { runCursor } from '../../browse/browse';
import type { ClientLike } from '../../connections/manager';
import type { Operation } from '../../docs/query/query';
import { RpcError } from '../../server/rpc';
import { ScanError } from '../scanner';

/**
 * `mongodump`-compatible collection dumps: a `.bson` file is the documents' BSON one after another
 * (each starts with its int32 little-endian length), next to it `<name>.metadata.json` holds the
 * collection's options and indexes as canonical Extended JSON (what `mongorestore` reads).
 */

/** Smallest BSON document (`{}`): length, terminating zero. */
const MIN_DOC_BYTES = 5;

/**
 * Largest document accepted in a dump: 16 MiB plus the room `mongodump` may see in documents the
 * server wrote internally (oplog-sized), so a valid dump is never refused.
 */
export const MAX_DOC_BYTES = 16 * 1024 * 1024 + 16 * 1024;

/** One document of a dump: its raw bytes and its 1-based number in the file. */
export interface DumpedDocument {
  bytes: Uint8Array;
  line: number;
}

/**
 * Splits a `.bson` file into documents without reading it whole: chunks go in, the bytes of
 * complete documents come out. A length outside 5 bytes .. {@link MAX_DOC_BYTES} or a file ending
 * inside a document throws `ScanError` (the file is no BSON dump, or it was cut off).
 */
export class BsonScanner {
  private chunks: Buffer[] = [];
  private buffered = 0;
  private count = 0;
  private failure: ScanError | undefined;

  feed(chunk: Buffer): DumpedDocument[] {
    if (this.failure) throw this.failure;
    this.chunks.push(chunk);
    this.buffered += chunk.length;
    const out: DumpedDocument[] = [];
    try {
      for (;;) {
        if (this.buffered < 4) break;
        const head = this.peek(4);
        const size = head.readInt32LE(0);
        if (size < MIN_DOC_BYTES || size > MAX_DOC_BYTES) {
          throw new ScanError(
            `document ${String(this.count + 1)} has an invalid length ${String(size)} (is the file a BSON dump?)`,
            this.count + 1,
          );
        }
        if (this.buffered < size) break;
        const bytes = this.take(size);
        this.count++;
        out.push({ bytes, line: this.count });
      }
    } catch (error) {
      if (!(error instanceof ScanError) || out.length === 0) throw error;
      this.failure = error;
    }
    return out;
  }

  end(): DumpedDocument[] {
    if (this.failure) throw this.failure;
    if (this.buffered > 0) {
      throw new ScanError('the file ends inside a document (was it cut off?)', this.count + 1);
    }
    return [];
  }

  /** The first `n` buffered bytes (joined when they span chunks). */
  private peek(n: number): Buffer {
    const first = this.chunks[0];
    if (first && first.length >= n) return first;
    const joined = Buffer.concat(this.chunks);
    this.chunks = [joined];
    return joined;
  }

  private take(n: number): Uint8Array {
    const all = this.peek(n);
    const bytes = all.subarray(0, n);
    const rest = all.subarray(n);
    this.chunks = rest.length > 0 ? [rest, ...this.chunks.slice(1)] : this.chunks.slice(1);
    this.buffered -= n;
    // A copy: the slice would keep the whole chunk alive while the batch waits.
    return Uint8Array.prototype.slice.call(bytes);
  }
}

/** Decoding of dumped documents: every value keeps its BSON type. */
const DECODE = {
  promoteLongs: false,
  promoteValues: false,
  promoteBuffers: false,
  bsonRegExp: true,
} as const;

/** One dumped document, or `RpcError` naming its number when its bytes are no valid BSON. */
export function parseDumpedDocument(doc: DumpedDocument): Document {
  try {
    return BSON.deserialize(doc.bytes, DECODE);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new RpcError('INVALID_PARAMS', `Document ${String(doc.line)}: not valid BSON: ${reason}`);
  }
}

/** `orders.bson` → `orders.metadata.json` (any other name: `<name>.metadata.json`), same folder. */
export function metadataPath(file: string): string {
  const base = path.basename(file);
  const stem = base.toLowerCase().endsWith('.bson') ? base.slice(0, -'.bson'.length) : base;
  return path.join(path.dirname(file), `${stem}.metadata.json`);
}

/** What a `mongodump` metadata file holds (the parts Thicket writes and reads). */
export interface DumpMetadata {
  options: Document;
  indexes: Document[];
  uuid?: string;
  collectionName: string;
  type: 'collection';
}

/**
 * The metadata of `db.coll` for its dump: the collection's options and index specs (as
 * `listIndexes` answers them, without the legacy `ns`) and its UUID. Views and time series
 * collections are dumped as the documents they show: plain collection, no options, no indexes.
 * With `withIndexes: false` (an aggregation was exported, not the collection) options and
 * indexes are left empty.
 */
export async function collectionMetadata(
  client: ClientLike,
  db: string,
  coll: string,
  withIndexes: boolean,
  signal?: AbortSignal,
): Promise<DumpMetadata> {
  const metadata: DumpMetadata = {
    options: {},
    indexes: [],
    collectionName: coll,
    type: 'collection',
  };
  if (!withIndexes) return metadata;
  const [info] = await runCursor(
    client,
    db,
    { listCollections: 1, filter: { name: coll }, cursor: {} },
    '$cmd.listCollections',
    signal,
  );
  if (info === undefined || (info['type'] !== undefined && info['type'] !== 'collection')) {
    return metadata;
  }
  const options = info['options'];
  if (typeof options === 'object' && options !== null) metadata.options = options as Document;
  const uuid = (info['info'] as Document | undefined)?.['uuid'];
  if (uuid instanceof BSON.Binary) metadata.uuid = Buffer.from(uuid.buffer).toString('hex');
  const specs = await runCursor(client, db, { listIndexes: coll, cursor: {} }, coll, signal);
  metadata.indexes = specs.map((spec) => {
    const copy = { ...spec };
    delete copy['ns'];
    return copy;
  });
  return metadata;
}

/** Metadata as `mongodump` writes it: one line of canonical Extended JSON. */
export function stringifyMetadata(metadata: DumpMetadata): string {
  return BSON.EJSON.stringify(metadata, { relaxed: false });
}

/** Collection options a restore can apply when it creates the collection. */
const RESTORABLE_OPTIONS = new Set([
  'capped',
  'size',
  'max',
  'validator',
  'validationLevel',
  'validationAction',
  'collation',
  'storageEngine',
  'indexOptionDefaults',
  'changeStreamPreAndPostImages',
  'clusteredIndex',
  'expireAfterSeconds',
  'timeseries',
]);

/** The parsed metadata file next to a `.bson` file; `undefined` when there is none. */
export async function readMetadata(file: string): Promise<Document | undefined> {
  let text: string;
  try {
    text = await readFile(metadataPath(file), 'utf8');
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const parsed = BSON.EJSON.parse(text, { relaxed: false }) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed as Document;
  } catch {
    throw new RpcError(
      'INVALID_PARAMS',
      `${path.basename(metadataPath(file))} is not a valid metadata file`,
    );
  }
}

/** A failed metadata step as `SERVER_ERROR` with `what` in front; a cancel stays `CANCELLED`. */
function stepError(error: unknown, what: string): RpcError {
  if (error instanceof RpcError && error.code === 'CANCELLED') return error;
  return new RpcError(
    'SERVER_ERROR',
    `${what}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/**
 * Before a dump's documents are inserted: creates the collection with the dump's options when it
 * does not exist yet and the dump has options (an existing collection keeps its own options).
 */
export async function createWithOptions(
  op: Operation,
  client: ClientLike,
  db: string,
  coll: string,
  metadata: Document,
): Promise<void> {
  const raw = metadata['options'];
  if (typeof raw !== 'object' || raw === null) return;
  const options = Object.fromEntries(
    Object.entries(raw as Document).filter(([key]) => RESTORABLE_OPTIONS.has(key)),
  );
  if (Object.keys(options).length === 0) return;
  const existing = await runCursor(
    client,
    db,
    { listCollections: 1, filter: { name: coll }, nameOnly: true, cursor: {} },
    '$cmd.listCollections',
  );
  if (existing.length > 0) return;
  try {
    await op.write({ create: coll, ...options });
  } catch (error) {
    throw stepError(error, `Could not create ${coll} with the dump's options`);
  }
}

/**
 * After a dump's documents were inserted: creates its indexes (all but `_id_`, which every
 * collection has). Index specs are passed as `mongorestore` does (without `v` and `ns`).
 */
export async function createDumpIndexes(
  op: Operation,
  coll: string,
  metadata: Document,
): Promise<number> {
  const raw = metadata['indexes'];
  if (!Array.isArray(raw)) return 0;
  const indexes = (raw as unknown[])
    .filter((spec): spec is Document => typeof spec === 'object' && spec !== null)
    .filter((spec) => spec['name'] !== '_id_')
    .map((spec) => {
      const copy = { ...spec };
      delete copy['v'];
      delete copy['ns'];
      return copy;
    });
  if (indexes.length === 0) return 0;
  try {
    await op.write({ createIndexes: coll, indexes });
  } catch (error) {
    throw stepError(
      error,
      "The documents were imported, but the dump's indexes could not be created",
    );
  }
  return indexes.length;
}
