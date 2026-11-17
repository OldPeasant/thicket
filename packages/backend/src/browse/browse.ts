import type { CollectionInfo, DatabaseInfo, ResultOf } from '@thicket/contract';

import {
  BSON,
  type Document,
  type ReadPreference,
  type RunCommandOptions,
  type RunCursorCommandOptions,
} from 'mongodb';

import { redact, toConnectError } from '../connections/errors';
import type { ClientLike, CursorLike, DbLike } from '../connections/manager';
import { RpcError } from '../server/rpc';

/**
 * Databases and collections (`db.*`, `coll.*`) as plain server commands on an open client.
 * Cursor answers (`listCollections` entries, `$collStats` documents) are decoded without any
 * promotion, so their `raw` EJSON is lossless (Int64 stays Int64, a whole-number Double stays a
 * Double, also inside view pipelines and validators). Other replies keep Int64 as `Long`;
 * their Int32/Double values become JS numbers (`dbStats` sizes in `raw` may then print a
 * whole-number Double as an integer). Sizes and counts are read with `toNumber`.
 */

/**
 * Command options. `promoteValues: false` can't be used here: it would also apply to the
 * driver's error documents and turn `MongoServerError.code` into an Int32 object, breaking the
 * driver's own numeric error handling. Instead the cursor's batch documents are kept as BSON
 * bytes (`fieldsAsRaw`; error replies have no such fields) and decoded with `DECODE`.
 */
export const RAW: RunCommandOptions = {
  promoteLongs: false,
  promoteBuffers: false,
  bsonRegExp: true,
  fieldsAsRaw: { firstBatch: true, nextBatch: true },
};

/** Decoding of batch documents: no Long → number, no Int32/Double unwrapping, regexes as BSON. */
const DECODE = {
  promoteLongs: false,
  promoteValues: false,
  promoteBuffers: false,
  bsonRegExp: true,
} as const;

/** A cursor batch's documents, decoded losslessly when they came as bytes (test fakes send documents). */
export function decodeBatch(batch: unknown): Document[] {
  if (!Array.isArray(batch)) return [];
  return batch.map((doc: unknown) =>
    doc instanceof Uint8Array ? BSON.deserialize(doc, DECODE) : (doc as Document),
  );
}

/** Server error codes with a contract code of their own. */
const NAMESPACE_NOT_FOUND = 26;
const UNAUTHORIZED = 13;

/** The numeric server code and code name of an error answered by the server, if it is one. */
function serverCodes(error: unknown): { code?: number; codeName?: string } | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const e = error as { code?: unknown; codeName?: unknown; name?: unknown };
  const code = toNumber(e.code);
  const codeName = typeof e.codeName === 'string' ? e.codeName : undefined;
  const isServer =
    e.name === 'MongoServerError' ||
    codeName !== undefined ||
    (code !== undefined && Number.isInteger(code));
  if (!isServer) return undefined;
  return {
    ...(code !== undefined && Number.isInteger(code) ? { code } : {}),
    ...(codeName !== undefined ? { codeName } : {}),
  };
}

function messageOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return redact(String(error ?? ''));
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? redact(message) : '';
}

/**
 * A driver error as the `RpcError` a browse handler answers with. Errors the server answered
 * (a server code or code name) are `NOT_FOUND` for a missing namespace and `SERVER_ERROR`
 * otherwise, whatever their text says; only errors without a server answer (network, timeout,
 * server selection) are classified like connection failures.
 */
export function toBrowseError(error: unknown): RpcError {
  if (error instanceof RpcError) return error;
  const server = serverCodes(error);
  if (server) {
    const text = messageOf(error);
    if (server.code === NAMESPACE_NOT_FOUND || server.codeName === 'NamespaceNotFound') {
      return new RpcError('NOT_FOUND', text.length > 0 ? text : 'Namespace not found');
    }
    const prefix = 'The server refused the command';
    const detail: { serverCode?: number; codeName?: string } = {};
    if (server.code !== undefined) detail.serverCode = server.code;
    if (server.codeName !== undefined) detail.codeName = server.codeName;
    return new RpcError('SERVER_ERROR', text.length > 0 ? `${prefix}: ${text}` : prefix, detail);
  }
  const mapped = toConnectError(error);
  if (mapped.code === 'INTERNAL') {
    const text = messageOf(error);
    const prefix = 'Unexpected error while browsing';
    return new RpcError('INTERNAL', text.length > 0 ? `${prefix}: ${text}` : prefix);
  }
  return mapped;
}

/**
 * Whether a `toBrowseError` answer is the server's `Unauthorized` (code 13), e.g. `currentOp`
 * without the `inprog` privilege, which callers retry with `$ownOps`.
 */
export function isUnauthorizedBrowseError(error: unknown): boolean {
  if (!(error instanceof RpcError)) return false;
  const detail = error.detail as { serverCode?: unknown; codeName?: unknown } | undefined;
  return detail?.serverCode === UNAUTHORIZED || detail?.codeName === 'Unauthorized';
}

function isUnauthorized(error: unknown): boolean {
  const e = error as { code?: unknown; codeName?: unknown };
  return toNumber(e.code) === UNAUTHORIZED || e.codeName === 'Unauthorized';
}

/** A number from a promoted or unpromoted BSON numeric (Int32, Double, Long, Decimal128); `undefined` otherwise. */
export function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof BSON.Long) return value.toNumber();
  if (value instanceof BSON.Int32 || value instanceof BSON.Double) return value.valueOf();
  if (value instanceof BSON.Decimal128) return Number(value.toString());
  return undefined;
}

/** A non-negative number for a size/count field; missing or negative values count as 0. */
function size(value: unknown): number {
  const n = toNumber(value);
  return n !== undefined && Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Canonical EJSON text of a document. */
export function canonical(doc: Document): string {
  return BSON.EJSON.stringify(doc, { relaxed: false });
}

/**
 * Read preference and write concern (task raw-cmd-read-pref): the profile's read preference
 * (+ tags) and write concern are the driver client's defaults, which a raw `db.command()` ignores
 * (it always runs on the primary, without a write concern). So reads pass the database's read
 * preference ({@link readOptions}), cursor commands run as driver cursors ({@link ReadCursor}),
 * whose `getMore`/`killCursors` go to the server that opened them, and document writes carry the
 * write concern in the command ({@link withWriteConcern}). Commands that change the schema
 * (create, drop, rename, `collMod`, indexes) and users/roles stay on the primary as they were.
 */

/** Command options: {@link RAW} plus `readPreference`, if any (none: the primary). */
export function rawOptions(readPreference: ReadPreference | undefined): RunCommandOptions {
  return readPreference === undefined ? RAW : { ...RAW, readPreference };
}

/** Command options for a read: {@link RAW} plus the database's (the profile's) read preference. */
export function readOptions(db: DbLike): RunCommandOptions {
  return rawOptions(db.readPreference);
}

/**
 * The write command with the database's (the profile's) write concern as its `writeConcern`
 * field; unchanged when there is none or the command names one itself.
 */
export function withWriteConcern(db: DbLike, command: Document): Document {
  const concern = db.writeConcern;
  if (concern === undefined || 'writeConcern' in command) return command;
  const field: Document = {};
  if (concern.w !== undefined) field['w'] = concern.w;
  if (concern.journal !== undefined) field['j'] = concern.journal;
  if (concern.wtimeoutMS !== undefined) field['wtimeout'] = concern.wtimeoutMS;
  return Object.keys(field).length === 0 ? command : { ...command, writeConcern: field };
}

/** True for the id of a cursor the server still holds (not missing, not 0). */
export const isOpenCursor = (id: unknown): boolean =>
  id !== undefined && id !== null && toNumber(id) !== 0;

/**
 * The cursor of one read command (`find`, `aggregate`, `listCollections`, ...), batch by batch,
 * read with the database's read preference. It runs as a driver cursor (`runCursorCommand`), so
 * every `getMore` and the `killCursors` of {@link close} reach the server that answered the
 * command, not whichever member the read preference selects next. Batches arrive as BSON bytes
 * and are decoded without promotion (lossless EJSON). A `comment` is sent with the command and
 * every `getMore`. Clients without `runCursorCommand` (test fakes) get plain commands.
 */
export class ReadCursor {
  private cursor: CursorLike | undefined;
  /** Cursor id of the plain-command path. */
  private id: unknown;

  constructor(
    private readonly db: DbLike,
    private readonly collection: string,
    private readonly comment?: unknown,
    /** Overrides the database's read preference (e.g. `primary` for reads around a write). */
    private readonly readPreference: ReadPreference | undefined = db.readPreference,
  ) {}

  /** Runs the cursor command and answers its first batch. */
  async first(command: Document): Promise<Document[]> {
    const cmd = this.comment === undefined ? command : { ...command, comment: this.comment };
    if (this.db.runCursorCommand) {
      const options: RunCursorCommandOptions = { raw: true };
      if (this.readPreference !== undefined) options.readPreference = this.readPreference;
      const cursor = this.db.runCursorCommand(cmd, options);
      if (this.comment !== undefined) cursor.setComment(this.comment);
      this.cursor = cursor;
      return this.fetch(cursor);
    }
    const reply = await this.command(cmd);
    return this.batchOf(reply, 'firstBatch');
  }

  /** True while the server holds more batches. */
  get hasMore(): boolean {
    return isOpenCursor(this.cursor ? this.cursor.id : this.id);
  }

  /** The next batch (empty when there is none). */
  async next(batchSize?: number): Promise<Document[]> {
    if (!this.hasMore) return [];
    if (this.cursor) {
      if (batchSize !== undefined) this.cursor.setBatchSize(batchSize);
      return this.fetch(this.cursor);
    }
    const cmd: Document = { getMore: this.id, collection: this.collection };
    if (batchSize !== undefined) cmd['batchSize'] = batchSize;
    if (this.comment !== undefined) cmd['comment'] = this.comment;
    return this.batchOf(await this.command(cmd), 'nextBatch');
  }

  /** Kills the cursor on its server if it is still open (best effort, never rejects). */
  async close(): Promise<void> {
    if (this.cursor) {
      await this.cursor.close().catch(() => undefined);
      return;
    }
    const id = this.id;
    this.id = undefined;
    if (!isOpenCursor(id)) return;
    await this.command({ killCursors: this.collection, cursors: [id] }).catch(() => undefined);
  }

  private async fetch(cursor: CursorLike): Promise<Document[]> {
    try {
      await cursor.hasNext();
    } catch (error) {
      throw toBrowseError(error);
    }
    return decodeBatch(cursor.readBufferedDocuments());
  }

  private async command(cmd: Document): Promise<Document> {
    try {
      return await this.db.command(cmd, rawOptions(this.readPreference));
    } catch (error) {
      throw toBrowseError(error);
    }
  }

  private batchOf(reply: Document, batch: 'firstBatch' | 'nextBatch'): Document[] {
    const cursor = reply['cursor'] as Document | undefined;
    if (!cursor) throw new RpcError('INTERNAL', 'The server answered without a cursor');
    this.id = isOpenCursor(cursor['id']) ? cursor['id'] : undefined;
    return decodeBatch(cursor[batch]);
  }
}

async function run(client: ClientLike, db: string, command: Document): Promise<Document> {
  try {
    return await client.db(db).command(command, RAW);
  } catch (error) {
    throw toBrowseError(error);
  }
}

/** A read command with the profile's read preference; driver errors become `toBrowseError`s. */
async function read(client: ClientLike, db: string, command: Document): Promise<Document> {
  const target = client.db(db);
  try {
    return await target.command(command, readOptions(target));
  } catch (error) {
    throw toBrowseError(error);
  }
}

/**
 * Runs a command with `RAW` options on the primary (no read preference); driver errors become
 * `toBrowseError`s. For commands that change something and for users/roles.
 */
export const runCommand = run;

/**
 * Runs a read cursor command (`listCollections`, `aggregate`) with the profile's read preference
 * and collects every batch (a {@link ReadCursor}: `getMore`s go to the same server).
 */
export async function runCursor(
  client: ClientLike,
  db: string,
  command: Document,
  collection: string,
  signal?: AbortSignal,
): Promise<Document[]> {
  const cursor = new ReadCursor(client.db(db), collection);
  try {
    const docs = await cursor.first(command);
    while (cursor.hasMore) {
      if (signal?.aborted) throw new RpcError('CANCELLED', 'The operation was cancelled');
      docs.push(...(await cursor.next()));
    }
    return docs;
  } finally {
    await cursor.close();
  }
}

/**
 * Database names the user holds privileges on (`connectionStatus`), for users who may not list
 * every database. Privileges on the whole cluster or on any database (`db: ""`) add nothing.
 */
async function privilegedDatabases(client: ClientLike): Promise<string[]> {
  const status = await run(client, 'admin', { connectionStatus: 1, showPrivileges: true });
  const auth = status['authInfo'] as
    { authenticatedUserPrivileges?: { resource?: { db?: unknown } }[] } | undefined;
  const names = new Set<string>();
  for (const privilege of auth?.authenticatedUserPrivileges ?? []) {
    const db = privilege.resource?.db;
    if (typeof db === 'string' && db.length > 0) names.add(db);
  }
  return [...names];
}

/**
 * `listDatabases`. A user without the cluster-wide `listDatabases` privilege gets the databases
 * they are authorized on (the server's `authorizedDatabases` default); databases the user has
 * privileges on that hold no data yet (so the server doesn't list them) are added from
 * `connectionStatus`, and if the server refuses `listDatabases` altogether those are the list.
 */
export async function listDatabases(
  client: ClientLike,
  withSizes: boolean,
): Promise<ResultOf<'db.listDatabases'>> {
  let listed: DatabaseInfo[];
  let refused: unknown;
  try {
    const admin = client.db('admin');
    const answer = await admin.command(
      { listDatabases: 1, nameOnly: !withSizes },
      readOptions(admin),
    );
    listed = (answer['databases'] as Document[]).map((d) => {
      const info: DatabaseInfo = { name: String(d['name']) };
      if (withSizes) {
        const bytes = toNumber(d['sizeOnDisk']);
        if (bytes !== undefined && bytes >= 0) info.sizeOnDisk = bytes;
        if (typeof d['empty'] === 'boolean') info.empty = d['empty'];
      }
      return info;
    });
  } catch (error) {
    if (!isUnauthorized(error)) throw toBrowseError(error);
    refused = error;
    listed = [];
  }
  const known = new Set(listed.map((d) => d.name));
  let extra: string[] = [];
  try {
    extra = (await privilegedDatabases(client)).filter((name) => !known.has(name));
  } catch {
    // connectionStatus is a best-effort addition when the listing answered; when listDatabases
    // was refused it is the whole list, so answer the refusal rather than an empty list.
    if (refused !== undefined) throw toBrowseError(refused);
  }
  const databases = [...listed, ...extra.map((name) => ({ name }))];
  databases.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { databases };
}

/** `db.create`: a database exists once it has a collection. */
export async function createDatabase(
  client: ClientLike,
  db: string,
  firstCollection: string,
): Promise<ResultOf<'db.create'>> {
  await run(client, db, { create: firstCollection });
  return {};
}

export async function dropDatabase(client: ClientLike, db: string): Promise<ResultOf<'db.drop'>> {
  await run(client, db, { dropDatabase: 1 });
  return {};
}

export async function databaseStats(client: ClientLike, db: string): Promise<ResultOf<'db.stats'>> {
  const stats = await read(client, db, { dbStats: 1, scale: 1 });
  return {
    collections: Math.trunc(size(stats['collections'])),
    views: Math.trunc(size(stats['views'])),
    objects: size(stats['objects']),
    dataSize: size(stats['dataSize']),
    storageSize: size(stats['storageSize']),
    indexSize: size(stats['indexSize']),
    raw: canonical(stats),
  };
}

function collectionType(entry: Document): CollectionInfo['type'] {
  if (entry['type'] === 'view') return 'view';
  if (entry['type'] === 'timeseries') return 'timeseries';
  return 'collection';
}

/**
 * `listCollections` of a database, sorted by name. The internal bucket collection of a time
 * series (`system.buckets.<name>`) is left out when its time series is listed.
 */
export async function listCollections(
  client: ClientLike,
  db: string,
  signal?: AbortSignal,
): Promise<ResultOf<'coll.list'>> {
  const entries = await runCursor(
    client,
    db,
    { listCollections: 1, cursor: {} },
    '$cmd.listCollections',
    signal,
  );
  const timeseries = new Set(
    entries.filter((e) => e['type'] === 'timeseries').map((e) => String(e['name'])),
  );
  const collections = entries
    .filter((e) => {
      const name = String(e['name']);
      return !(
        name.startsWith('system.buckets.') && timeseries.has(name.slice('system.buckets.'.length))
      );
    })
    .map((entry): CollectionInfo => {
      const info: CollectionInfo = {
        name: String(entry['name']),
        type: collectionType(entry),
        raw: canonical(entry),
      };
      const viewOn = (entry['options'] as Document | undefined)?.['viewOn'];
      if (info.type === 'view' && typeof viewOn === 'string') info.viewOn = viewOn;
      return info;
    });
  collections.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { collections };
}

/** Parses the canonical EJSON text of `create` options (`INVALID_PARAMS` when it isn't a document). */
export function parseCreateOptions(text: string | undefined): Document {
  if (text === undefined) return {};
  let parsed: unknown;
  try {
    parsed = BSON.EJSON.parse(text, { relaxed: false });
  } catch (error) {
    throw new RpcError(
      'INVALID_PARAMS',
      `options is not valid EJSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // Only a plain document: EJSON reads value wrappers such as {"$date":...} or {"$oid":...} as
  // a Date, ObjectId, Int32, ... object, which is not a document of create options.
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Object.getPrototypeOf(parsed) !== Object.prototype ||
    '_bsontype' in parsed
  ) {
    throw new RpcError('INVALID_PARAMS', 'options must be an EJSON document');
  }
  return parsed as Document;
}

/** `coll.create`: `create` with the given options (capped, timeseries, validator, viewOn, ...). */
export async function createCollection(
  client: ClientLike,
  db: string,
  coll: string,
  optionsText: string | undefined,
): Promise<ResultOf<'coll.create'>> {
  const options = parseCreateOptions(optionsText);
  // `create` must be the command's first key and name this collection, whatever the options say.
  const command: Document = { create: coll };
  for (const [key, value] of Object.entries(options)) {
    if (key !== 'create') command[key] = value;
  }
  await run(client, db, command);
  return {};
}

export async function dropCollection(
  client: ClientLike,
  db: string,
  coll: string,
): Promise<ResultOf<'coll.drop'>> {
  await run(client, db, { drop: coll });
  return {};
}

export async function renameCollection(
  client: ClientLike,
  db: string,
  coll: string,
  newName: string,
  dropTarget: boolean,
): Promise<ResultOf<'coll.rename'>> {
  await run(client, 'admin', {
    renameCollection: `${db}.${coll}`,
    to: `${db}.${newName}`,
    dropTarget,
  });
  return {};
}

/**
 * `coll.stats` from `$collStats` storage stats (the `collStats` command is deprecated). On a
 * sharded cluster there is one answer per shard: counts and sizes are summed.
 */
export async function collectionStats(
  client: ClientLike,
  db: string,
  coll: string,
  signal?: AbortSignal,
): Promise<ResultOf<'coll.stats'>> {
  const docs = await runCursor(
    client,
    db,
    { aggregate: coll, pipeline: [{ $collStats: { storageStats: { scale: 1 } } }], cursor: {} },
    coll,
    signal,
  );
  if (docs.length === 0) {
    throw new RpcError('NOT_FOUND', `Collection ${db}.${coll} does not exist`);
  }
  const result = { count: 0, size: 0, storageSize: 0, totalIndexSize: 0, nindexes: 0 };
  for (const doc of docs) {
    const s = (doc['storageStats'] ?? {}) as Document;
    result.count += size(s['count']);
    result.size += size(s['size']);
    result.storageSize += size(s['storageSize']);
    result.totalIndexSize += size(s['totalIndexSize']);
    result.nindexes = Math.max(result.nindexes, Math.trunc(size(s['nindexes'])));
  }
  const [only] = docs;
  return { ...result, raw: canonical(docs.length === 1 && only ? only : { shards: docs }) };
}
