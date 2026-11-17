import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { GridfsBucket, GridfsFile, GridfsProgress, ResultOf } from '@thicket/contract';
import { MAX_GRIDFS_FILES } from '@thicket/contract';
import { BSON, Db, GridFSBucket, ObjectId, type Document } from 'mongodb';

import { canonical, toBrowseError, toNumber } from '../browse/browse';
import type { ClientLike } from '../connections/manager';
import { parseEjson } from '../docs/query/query';
import { RpcError } from '../server/rpc';

/**
 * GridFS (`gridfs.*`) on an open connection, through the driver's `GridFSBucket`: buckets are the
 * `<name>.files` collections of a database, files are listed from it, uploads and downloads stream
 * between a local file and the bucket with byte progress. A failed or cancelled upload removes
 * what it wrote (chunks and, if already written, the files document); a failed or cancelled
 * download removes the partial local file. Server errors become `toBrowseError`s.
 */

/** Least number of bytes between two progress events (the last event is always sent). */
export const GRIDFS_PROGRESS_BYTES = 1024 * 1024;

const FILES_SUFFIX = '.files';
const CHUNKS_SUFFIX = '.chunks';

/** Reads that keep the BSON types (an Int32 `_id` stays Int32, so it can be addressed again). */
const RAW_READ = { promoteValues: false, promoteLongs: false, promoteBuffers: false } as const;

/** The driver `Db` behind a connection's client (GridFS needs the driver's collections). */
export function driverDb(client: ClientLike, name: string): Db {
  const db = client.db(name);
  if (!(db instanceof Db)) throw new RpcError('INTERNAL', 'GridFS needs a driver connection');
  return db;
}

/** `{ _id: { $eq: id } }` for a file id of any BSON type (the driver types it as ObjectId). */
function byId(id: unknown): Document {
  return { _id: { $eq: id } };
}

/** The file id of a request (canonical EJSON of any BSON value). */
export function parseFileId(text: string): unknown {
  return parseEjson(text, 'id');
}

/** Escapes text for a literal match inside a regular expression. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Canonical EJSON text of any BSON value. */
function canonicalValue(value: unknown): string {
  return BSON.EJSON.stringify(value, { relaxed: false });
}

function count(value: unknown): number {
  const n = toNumber(value);
  return n !== undefined && Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value instanceof BSON.BSONSymbol) return value.valueOf();
  return undefined;
}

/** A `<bucket>.files` document (read without promotion) as the contract's `GridfsFile`. */
export function toGridfsFile(doc: Document): GridfsFile {
  const uploadDate = doc['uploadDate'];
  const metadata = doc['metadata'] as unknown;
  const isDocument =
    typeof metadata === 'object' &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    !('_bsontype' in metadata);
  const contentType =
    text(doc['contentType']) ??
    (isDocument ? text((metadata as Document)['contentType']) : undefined);
  const file: GridfsFile = {
    id: canonicalValue(doc['_id']),
    filename: text(doc['filename']) ?? '',
    length: count(doc['length']),
    chunkSize: count(doc['chunkSize']),
    uploadDate:
      uploadDate instanceof Date && !Number.isNaN(uploadDate.getTime())
        ? uploadDate.toISOString()
        : '',
  };
  if (contentType !== undefined) file.contentType = contentType;
  if (isDocument) file.metadata = canonical(metadata as Document);
  return file;
}

/** `gridfs.buckets`: every `<name>.files` collection, with its estimated count. */
export async function listBuckets(client: ClientLike, dbName: string): Promise<GridfsBucket[]> {
  const db = driverDb(client, dbName);
  try {
    const collections = await db
      .listCollections({ type: 'collection' }, { nameOnly: true, authorizedCollections: true })
      .toArray();
    const names = new Set(collections.map((c) => c.name));
    const buckets = [...names]
      .filter((n) => n.endsWith(FILES_SUFFIX) && n.length > FILES_SUFFIX.length)
      .map((n) => n.slice(0, -FILES_SUFFIX.length))
      .sort((a, b) => (a === 'fs' ? -1 : b === 'fs' ? 1 : a.localeCompare(b)));
    return await Promise.all(
      buckets.map(async (name) => ({
        name,
        files: await db.collection(`${name}${FILES_SUFFIX}`).estimatedDocumentCount(),
        hasChunks: names.has(`${name}${CHUNKS_SUFFIX}`),
      })),
    );
  } catch (error) {
    throw toBrowseError(error);
  }
}

export interface ListFilesOptions {
  nameContains?: string | undefined;
  skip?: number | undefined;
  limit?: number | undefined;
}

/** `gridfs.files`: files of a bucket, newest first (then by `_id`, descending). */
export async function listFiles(
  client: ClientLike,
  dbName: string,
  bucket: string,
  options: ListFilesOptions,
  signal?: AbortSignal,
): Promise<ResultOf<'gridfs.files'>> {
  const files = driverDb(client, dbName).collection(`${bucket}${FILES_SUFFIX}`);
  const filter: Document =
    options.nameContains !== undefined && options.nameContains.length > 0
      ? { filename: { $regex: escapeRegex(options.nameContains), $options: 'i' } }
      : {};
  try {
    const [docs, total] = await Promise.all([
      files
        .find(filter, {
          ...RAW_READ,
          sort: { uploadDate: -1, _id: -1 },
          skip: options.skip ?? 0,
          limit: options.limit ?? MAX_GRIDFS_FILES,
          ...(signal ? { signal } : {}),
        })
        .toArray(),
      files.countDocuments(filter, signal ? { signal } : {}),
    ]);
    return { files: docs.map(toGridfsFile), total };
  } catch (error) {
    if (signal?.aborted) throw new RpcError('CANCELLED', 'The operation was cancelled');
    throw toBrowseError(error);
  }
}

/** The files document of `id`; `NOT_FOUND` when the bucket has none. */
export async function fileInfo(
  client: ClientLike,
  dbName: string,
  bucket: string,
  id: unknown,
): Promise<GridfsFile> {
  let doc: Document | null;
  try {
    doc = await driverDb(client, dbName)
      .collection(`${bucket}${FILES_SUFFIX}`)
      .findOne(byId(id), RAW_READ);
  } catch (error) {
    throw toBrowseError(error);
  }
  if (!doc) throw new RpcError('NOT_FOUND', `No file with this id in the bucket ${bucket}`);
  return toGridfsFile(doc);
}

/** Counts the bytes going through and reports them at most every `every` bytes, and at the end. */
class ByteCounter extends Transform {
  private bytes = 0;
  private reported = 0;

  constructor(
    private readonly report: (bytes: number) => void,
    private readonly step: number,
  ) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    this.bytes += chunk.length;
    if (this.bytes - this.reported >= this.step) {
      this.reported = this.bytes;
      this.report(this.bytes);
    }
    callback(null, chunk);
  }

  get total(): number {
    return this.bytes;
  }
}

export interface TransferOptions {
  signal: AbortSignal;
  progress(progress: GridfsProgress): void;
  /** Least bytes between progress events (tests); default {@link GRIDFS_PROGRESS_BYTES}. */
  progressBytes?: number;
}

function cancelledOr(error: unknown, signal: AbortSignal, what: string): RpcError {
  if (signal.aborted) return new RpcError('CANCELLED', 'The operation was cancelled');
  if (error instanceof RpcError) return error;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && code.startsWith('E')) {
    // A Node file system error (ENOENT, EACCES, ENOSPC, …).
    const message = error instanceof Error ? error.message : String(error);
    return new RpcError('INTERNAL', `Could not ${what}: ${message}`);
  }
  return toBrowseError(error);
}

/**
 * Streams the file `id` of `bucket` into the local file `target`; resolves with the bytes
 * written. A failed or cancelled download removes `target`.
 */
export async function downloadFile(
  client: ClientLike,
  dbName: string,
  bucket: string,
  id: unknown,
  totalBytes: number,
  target: string,
  options: TransferOptions,
): Promise<number> {
  const gridfs = new GridFSBucket(driverDb(client, dbName), { bucketName: bucket });
  const counter = new ByteCounter(
    (bytes) => options.progress({ bytes, totalBytes }),
    options.progressBytes ?? GRIDFS_PROGRESS_BYTES,
  );
  try {
    await pipeline(gridfs.openDownloadStream(id as ObjectId), counter, createWriteStream(target), {
      signal: options.signal,
    });
  } catch (error) {
    await rm(target, { force: true }).catch(() => undefined);
    throw cancelledOr(error, options.signal, `write ${target}`);
  }
  options.progress({ bytes: counter.total, totalBytes });
  return counter.total;
}

/**
 * Streams the local file `source` into `bucket` as `filename`; resolves with the new file's id
 * (canonical EJSON). A failed or cancelled upload deletes its chunks and files document.
 */
export async function uploadFile(
  client: ClientLike,
  dbName: string,
  bucket: string,
  source: string,
  filename: string,
  options: TransferOptions,
): Promise<{ id: string; bytes: number }> {
  const db = driverDb(client, dbName);
  const gridfs = new GridFSBucket(db, { bucketName: bucket });
  const totalBytes = (await stat(source)).size;
  const id = new ObjectId();
  const counter = new ByteCounter(
    (bytes) => options.progress({ bytes, totalBytes }),
    options.progressBytes ?? GRIDFS_PROGRESS_BYTES,
  );
  try {
    options.signal.throwIfAborted();
    await pipeline(createReadStream(source), counter, gridfs.openUploadStream(filename, { id }), {
      signal: options.signal,
    });
  } catch (error) {
    await removeFile(db, bucket, id).catch(() => undefined);
    throw cancelledOr(error, options.signal, `read ${source}`);
  }
  const fileId = canonicalValue(id);
  options.progress({ bytes: counter.total, totalBytes, fileId });
  return { id: fileId, bytes: counter.total };
}

/** Deletes the files document of `id` and its chunks; `true` when the files document existed. */
async function removeFile(db: Db, bucket: string, id: unknown): Promise<boolean> {
  const { deletedCount } = await db.collection(`${bucket}${FILES_SUFFIX}`).deleteOne(byId(id));
  await db.collection(`${bucket}${CHUNKS_SUFFIX}`).deleteMany({ files_id: { $eq: id } });
  return deletedCount > 0;
}

/** `gridfs.delete`: the files document, then its chunks (stray chunks go even without it). */
export async function deleteFile(
  client: ClientLike,
  dbName: string,
  bucket: string,
  id: unknown,
): Promise<boolean> {
  try {
    return await removeFile(driverDb(client, dbName), bucket, id);
  } catch (error) {
    throw toBrowseError(error);
  }
}
