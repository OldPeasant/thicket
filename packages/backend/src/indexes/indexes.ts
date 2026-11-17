import type { IndexInfo, IndexStats, ResultOf } from '@thicket/contract';

import type { Document } from 'mongodb';

import { canonical, runCommand, runCursor, toNumber } from '../browse/browse';
import type { ClientLike } from '../connections/manager';
import { parseDocument } from '../docs/query/query';
import { RpcError } from '../server/rpc';

/**
 * Indexes of a collection (`idx.*`) as plain server commands on an open client: `listIndexes`,
 * `$collStats` index sizes with `$indexStats` usage, `createIndexes`, `dropIndexes` and `collMod`
 * to hide or unhide. Server errors become `toBrowseError`s (a missing collection is `NOT_FOUND`).
 */

/** Server error code of `Unauthorized`. */
const UNAUTHORIZED = 13;

/** The driver's default index name: `<field>_<value>` per key, joined by `_` (`a_1_b_-1`). */
export function defaultIndexName(key: Document): string {
  return Object.entries(key)
    .map(([field, value]) => `${field}_${String(value)}`)
    .join('_');
}

/** One `listIndexes` entry as the contract's `IndexInfo`. */
export function toIndexInfo(spec: Document): IndexInfo {
  const info: IndexInfo = {
    name: String(spec['name']),
    key: canonical((spec['key'] ?? {}) as Document),
    unique: spec['unique'] === true,
    sparse: spec['sparse'] === true,
    hidden: spec['hidden'] === true,
    raw: canonical(spec),
  };
  const ttl = toNumber(spec['expireAfterSeconds']);
  if (ttl !== undefined && Number.isFinite(ttl) && ttl >= 0) {
    info.expireAfterSeconds = Math.trunc(ttl);
  }
  const partial = spec['partialFilterExpression'];
  if (typeof partial === 'object' && partial !== null) {
    info.partialFilterExpression = canonical(partial as Document);
  }
  return info;
}

/** `idx.list`: every index of the collection, in the server's order. */
export async function listIndexes(
  client: ClientLike,
  db: string,
  coll: string,
  signal?: AbortSignal,
): Promise<ResultOf<'idx.list'>> {
  const specs = await runCursor(client, db, { listIndexes: coll, cursor: {} }, coll, signal);
  return { indexes: specs.map(toIndexInfo) };
}

function isUnauthorized(error: unknown): boolean {
  const detail = (error as { detail?: { serverCode?: unknown; codeName?: unknown } }).detail;
  return detail?.serverCode === UNAUTHORIZED || detail?.codeName === 'Unauthorized';
}

/**
 * `idx.stats`: the size of each index (`$collStats` storage stats) and its usage since the
 * server last started counting (`$indexStats`). On a sharded cluster sizes and accesses are summed
 * over the shards and `since` is the earliest. A user who may not run `$indexStats` gets the
 * sizes without `accesses`/`since`.
 */
export async function indexStatistics(
  client: ClientLike,
  db: string,
  coll: string,
  signal?: AbortSignal,
): Promise<ResultOf<'idx.stats'>> {
  const shards = await runCursor(
    client,
    db,
    { aggregate: coll, pipeline: [{ $collStats: { storageStats: { scale: 1 } } }], cursor: {} },
    coll,
    signal,
  );
  if (shards.length === 0) {
    throw new RpcError('NOT_FOUND', `Collection ${db}.${coll} does not exist`);
  }
  const stats = new Map<string, IndexStats>();
  const entry = (name: string): IndexStats => {
    let found = stats.get(name);
    if (!found) {
      found = { name, sizeBytes: 0 };
      stats.set(name, found);
    }
    return found;
  };
  for (const shard of shards) {
    const sizes = ((shard['storageStats'] as Document | undefined)?.['indexSizes'] ??
      {}) as Document;
    for (const [name, value] of Object.entries(sizes)) {
      const bytes = toNumber(value);
      if (bytes !== undefined && Number.isFinite(bytes) && bytes > 0) entry(name).sizeBytes += bytes;
      else entry(name);
    }
  }

  let usage: Document[] | undefined;
  try {
    usage = await runCursor(
      client,
      db,
      { aggregate: coll, pipeline: [{ $indexStats: {} }], cursor: {} },
      coll,
      signal,
    );
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
  }
  for (const doc of usage ?? []) {
    const stat = entry(String(doc['name']));
    const accesses = (doc['accesses'] ?? {}) as Document;
    const ops = toNumber(accesses['ops']);
    stat.accesses = (stat.accesses ?? 0) + (ops !== undefined && ops > 0 ? Math.trunc(ops) : 0);
    const since = accesses['since'];
    if (since instanceof Date && !Number.isNaN(since.getTime())) {
      const iso = since.toISOString();
      if (stat.since === undefined || iso < stat.since) stat.since = iso;
    }
  }
  return { indexes: [...stats.values()] };
}

/**
 * `idx.create`: `createIndexes` with one index of `key` and the given options (`unique`,
 * `sparse`, `partialFilterExpression`, `expireAfterSeconds`, `collation`, `hidden`, `weights`,
 * `wildcardProjection`, ... passed as given). Without a `name` option the index gets the
 * driver's default name. Answers the index name.
 */
export async function createIndex(
  client: ClientLike,
  db: string,
  coll: string,
  keyText: string,
  optionsText: string | undefined,
): Promise<ResultOf<'idx.create'>> {
  const key = parseDocument(keyText, 'key');
  if (Object.keys(key).length === 0) {
    throw new RpcError('INVALID_PARAMS', 'key must name at least one field');
  }
  const options = optionsText === undefined ? {} : parseDocument(optionsText, 'options');
  const named = options['name'];
  if (named !== undefined && (typeof named !== 'string' || named.length === 0)) {
    throw new RpcError('INVALID_PARAMS', 'options.name must be a non-empty string');
  }
  const name = typeof named === 'string' ? named : defaultIndexName(key);
  const spec: Document = { key, name };
  for (const [option, value] of Object.entries(options)) {
    if (option !== 'key' && option !== 'name') spec[option] = value;
  }
  await runCommand(client, db, { createIndexes: coll, indexes: [spec] });
  return { name };
}

/** `idx.drop`: drops one index by name (`*`, which would drop every index, is refused). */
export async function dropIndex(
  client: ClientLike,
  db: string,
  coll: string,
  name: string,
): Promise<ResultOf<'idx.drop'>> {
  if (name === '*') {
    throw new RpcError('INVALID_PARAMS', 'idx.drop drops one index by name; "*" is not allowed');
  }
  await runCommand(client, db, { dropIndexes: coll, index: name });
  return {};
}

/** `idx.hide`: hides (`hidden: true`) or unhides an index with `collMod`. */
export async function hideIndex(
  client: ClientLike,
  db: string,
  coll: string,
  name: string,
  hidden: boolean,
): Promise<ResultOf<'idx.hide'>> {
  await runCommand(client, db, { collMod: coll, index: { name, hidden } });
  return {};
}
