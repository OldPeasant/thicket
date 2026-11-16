import type { CollectionInfo, DatabaseInfo, ResultOf } from '@thicket/contract';

import { BSON, type Document, type RunCommandOptions } from 'mongodb';

import { redact, toConnectError } from '../connections/errors';
import type { ClientLike } from '../connections/manager';
import { RpcError } from '../server/rpc';

/**
 * Databases and collections (`db.*`, `coll.*`) as plain server commands on an open client.
 * Commands read Int64 values without converting them to JS numbers, so the `raw` documents the
 * renderer sees keep Int64 lossless in canonical EJSON; sizes and counts are read as numbers.
 */

/**
 * Keep Int64 as `Long` (lossless in `raw`, cursor ids stay Long for getMore) and regular
 * expressions as BSON. Int32/Double are still promoted to JS numbers: `promoteValues: false`
 * would also apply to the driver's error documents and turn `MongoServerError.code` into an
 * Int32 object, which breaks the driver's own numeric error handling.
 */
const RAW: RunCommandOptions = {
  promoteLongs: false,
  promoteBuffers: false,
  bsonRegExp: true,
};

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

function canonical(doc: Document): string {
  return BSON.EJSON.stringify(doc, { relaxed: false });
}

async function run(client: ClientLike, db: string, command: Document): Promise<Document> {
  try {
    return await client.db(db).command(command, RAW);
  } catch (error) {
    throw toBrowseError(error);
  }
}

/** Runs a cursor command (`listCollections`, `aggregate`) and collects every batch. */
async function runCursor(
  client: ClientLike,
  db: string,
  command: Document,
  collection: string,
  signal?: AbortSignal,
): Promise<Document[]> {
  const first = await run(client, db, command);
  const cursor = first['cursor'] as { id: unknown; firstBatch: Document[] } | undefined;
  if (!cursor) throw new RpcError('INTERNAL', 'The server answered without a cursor');
  const docs = [...cursor.firstBatch];
  let id = cursor.id;
  while (toNumber(id) !== 0 && id !== undefined) {
    if (signal?.aborted) {
      await run(client, db, { killCursors: collection, cursors: [id] }).catch(() => undefined);
      throw new RpcError('CANCELLED', 'The operation was cancelled');
    }
    const next = await run(client, db, { getMore: id, collection });
    const batch = next['cursor'] as { id: unknown; nextBatch: Document[] };
    docs.push(...batch.nextBatch);
    id = batch.id;
  }
  return docs;
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
    const answer = await client
      .db('admin')
      .command({ listDatabases: 1, nameOnly: !withSizes }, RAW);
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
  const stats = await run(client, db, { dbStats: 1, scale: 1 });
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
