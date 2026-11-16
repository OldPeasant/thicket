import { randomBytes } from 'node:crypto';

import type { ParsedParamsOf, ResultOf, SlicedArray } from '@thicket/contract';
import {
  DEFAULT_SORT,
  findPlan,
  parseSort,
  projectionWithSortKeys,
  sortDocument,
  type PageRequest,
  type SortSpec,
} from '@thicket/core';
import { BSON, type Document } from 'mongodb';

import { RAW, canonical, decodeBatch, toBrowseError, toNumber } from '../../browse/browse';
import { abortable, type ClientLike } from '../../connections/manager';
import { RpcError } from '../../server/rpc';

/**
 * Reading documents (`docs.find/count/estimatedCount/get/getSlice`) with plain server commands
 * on an open client, like `browse.ts`: replies keep cursor batches as BSON bytes and decode them
 * without promotion, so the EJSON sent on is lossless.
 *
 * Cancelling: every command carries a `comment` unique to the operation. On abort the caller
 * stops waiting at once; the running server operation is found by that comment in `currentOp`
 * and killed (`killOp`), and an open cursor is killed (`killCursors`) once its id is known.
 */

/** How long cleanup after a cancel waits for the interrupted command's answer. */
const CANCEL_SETTLE_MS = 4000;

const UNAUTHORIZED = 13;

function cancelled(): RpcError {
  return new RpcError('CANCELLED', 'The operation was cancelled');
}

/** A unique `comment` that identifies one operation in `currentOp`. */
export function operationToken(): string {
  return `thicket:${randomBytes(9).toString('hex')}`;
}

/** Parses EJSON text from validated params; `relaxed` turns numbers into JS numbers. */
export function parseEjson(text: string, what: string, relaxed = false): unknown {
  try {
    return BSON.EJSON.parse(text, { relaxed });
  } catch (error) {
    throw new RpcError(
      'INVALID_PARAMS',
      `${what} is not valid EJSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Parses EJSON text that must be a plain document (not a value wrapper such as `{"$oid":…}`). */
export function parseDocument(text: string, what: string, relaxed = false): Document {
  const parsed = parseEjson(text, what, relaxed);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype ||
    '_bsontype' in parsed
  ) {
    throw new RpcError('INVALID_PARAMS', `${what} must be an EJSON document`);
  }
  return parsed as Document;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as { unref?: () => void }).unref?.();
  });
}

async function command(client: ClientLike, db: string, cmd: Document): Promise<Document> {
  try {
    return await client.db(db).command(cmd, RAW);
  } catch (error) {
    throw toBrowseError(error);
  }
}

function isUnauthorized(error: unknown): boolean {
  const detail = (error as { detail?: { serverCode?: number; codeName?: string } }).detail;
  return detail?.serverCode === UNAUTHORIZED || detail?.codeName === 'Unauthorized';
}

/**
 * Kills the server operations carrying `comment`. Users without the `inprog` privilege see (and
 * may kill) their own operations with `$ownOps`. Best effort: failures are ignored.
 */
export async function killOperations(client: ClientLike, comment: string): Promise<void> {
  let reply: Document;
  try {
    try {
      reply = await command(client, 'admin', { currentOp: 1, 'command.comment': comment });
    } catch (error) {
      if (!isUnauthorized(error)) throw error;
      reply = await command(client, 'admin', {
        currentOp: 1,
        $ownOps: true,
        'command.comment': comment,
      });
    }
  } catch {
    return;
  }
  const ops = Array.isArray(reply['inprog']) ? (reply['inprog'] as Document[]) : [];
  await Promise.all(
    ops
      .filter((op) => op['opid'] !== undefined)
      .map((op) => command(client, 'admin', { killOp: 1, op: op['opid'] }).catch(() => undefined)),
  );
}

interface CursorReply {
  id: unknown;
  docs: Document[];
}

function cursorOf(reply: Document, batch: 'firstBatch' | 'nextBatch'): CursorReply {
  const cursor = reply['cursor'] as Document | undefined;
  if (!cursor) throw new RpcError('INTERNAL', 'The server answered without a cursor');
  return { id: cursor['id'], docs: decodeBatch(cursor[batch]) };
}

const isOpen = (id: unknown): boolean => id !== undefined && id !== null && toNumber(id) !== 0;

/**
 * One operation (a cursor command and its `getMore`s) that can be cancelled with `signal`.
 * All commands carry the same `comment`, so a cancel can find and kill whichever is running.
 */
export class Operation {
  readonly comment = operationToken();
  private cursorId: unknown;
  private readonly cleanups: Promise<void>[] = [];

  constructor(
    private readonly client: ClientLike,
    private readonly db: string,
    private readonly collection: string,
    private readonly signal: AbortSignal | undefined,
  ) {}

  /**
   * Runs a command. On abort it rejects with `CANCELLED` at once and, in the background, kills
   * the server operation and the cursor it may still open (awaited by {@link close}).
   */
  async run(cmd: Document): Promise<Document> {
    if (this.signal?.aborted) throw cancelled();
    const pending = command(this.client, this.db, { ...cmd, comment: this.comment });
    try {
      return await abortable(pending, this.signal);
    } catch (error) {
      if (this.signal?.aborted) {
        this.cleanups.push(this.cleanUp(pending));
        throw cancelled();
      }
      throw error;
    }
  }

  private async cleanUp(pending: Promise<Document>): Promise<void> {
    const settled = pending.then(
      (reply) => {
        const cursor = reply['cursor'] as Document | undefined;
        return cursor?.['id'];
      },
      () => undefined,
    );
    await killOperations(this.client, this.comment);
    const id = await Promise.race([settled, sleep(CANCEL_SETTLE_MS).then(() => undefined)]);
    if (isOpen(id)) this.cursorId = id;
    await this.killCursor();
  }

  /** First batch of a cursor command; remembers the cursor id. */
  async open(cmd: Document): Promise<Document[]> {
    const cursor = cursorOf(await this.run(cmd), 'firstBatch');
    this.cursorId = isOpen(cursor.id) ? cursor.id : undefined;
    return cursor.docs;
  }

  /** True while the cursor has more batches. */
  get hasMore(): boolean {
    return this.cursorId !== undefined;
  }

  /** Next batch of the open cursor. */
  async more(batchSize?: number): Promise<Document[]> {
    if (this.cursorId === undefined) return [];
    const cmd: Document = { getMore: this.cursorId, collection: this.collection };
    if (batchSize !== undefined) cmd['batchSize'] = batchSize;
    const cursor = cursorOf(await this.run(cmd), 'nextBatch');
    this.cursorId = isOpen(cursor.id) ? cursor.id : undefined;
    return cursor.docs;
  }

  private async killCursor(): Promise<void> {
    const id = this.cursorId;
    if (id === undefined) return;
    this.cursorId = undefined;
    await command(this.client, this.db, { killCursors: this.collection, cursors: [id] }).catch(
      () => undefined,
    );
  }

  /** Kills a cursor left open and waits for any cancel cleanup. */
  async close(): Promise<void> {
    await this.killCursor();
    await Promise.all(this.cleanups);
  }
}

function optional(target: Document, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

/** The parsed parts of a `docs.find` request and the command it runs. */
export interface FindCommand {
  command: Document;
  /** Rows must be reversed (they were read backwards). */
  reverse: boolean;
}

/**
 * Builds the `find` command for `docs.find` params with paging-core's `findPlan`: range bounds
 * (`after`/`before`) and `fromEnd` read with the (reversed) sort and a filter on the sort keys;
 * `skip`/`limit` are passed through. With a sort of plain directions the projection is widened to
 * contain every sort key.
 */
export function buildFind(p: ParsedParamsOf<'docs.find'>): FindCommand {
  const filter = parseDocument(p.filter, 'filter');
  const sortDoc = p.sort === undefined ? undefined : parseDocument(p.sort, 'sort', true);
  const parsedSort = parseSort(sortDoc);
  const bound =
    p.after !== undefined
      ? parseDocument(p.after, 'after')
      : p.before !== undefined
        ? parseDocument(p.before, 'before')
        : undefined;
  const ranged = bound !== undefined || p.fromEnd === true;
  if (ranged && parsedSort === null) {
    throw new RpcError(
      'INVALID_PARAMS',
      'Range paging (after, before, fromEnd) needs a sort of plain directions (1 / -1)',
    );
  }
  let sort: SortSpec | null = parsedSort;
  if (ranged && sort !== null && sort.length === 0) sort = DEFAULT_SORT;
  if (bound !== undefined && sort !== null) {
    const missing = sort.find((k) => !Object.hasOwn(bound, k.field));
    if (missing) {
      throw new RpcError(
        'INVALID_PARAMS',
        `${p.after !== undefined ? 'after' : 'before'} has no value for sort key "${missing.field}"`,
      );
    }
  }
  const request: PageRequest = {
    pageIndex: 0,
    sort,
    limit: p.limit ?? 0,
    ...(p.skip !== undefined ? { skip: p.skip } : {}),
    ...(p.after !== undefined && bound ? { after: bound } : {}),
    ...(p.before !== undefined && bound ? { before: bound } : {}),
    fromEnd: p.fromEnd === true,
  };
  const plan = findPlan(request, filter);

  const cmd: Document = { find: p.coll, filter: plan.filter };
  if (plan.sort === null) optional(cmd, 'sort', sortDoc);
  else if (plan.sort.length > 0) cmd['sort'] = sortDocument(plan.sort);
  let projection =
    p.projection === undefined ? undefined : parseDocument(p.projection, 'projection', true);
  if (sort !== null && sort.length > 0) {
    projection = projectionWithSortKeys(projection, sort) as Document | undefined;
  }
  if (projection !== undefined && Object.keys(projection).length > 0) {
    cmd['projection'] = projection;
  }
  optional(cmd, 'skip', plan.skip);
  if (plan.limit > 0) cmd['limit'] = plan.limit;
  optional(cmd, 'batchSize', p.batchSize);
  if (p.collation !== undefined) cmd['collation'] = parseDocument(p.collation, 'collation', true);
  if (p.hint !== undefined) cmd['hint'] = parseEjson(p.hint, 'hint', true);
  optional(cmd, 'maxTimeMS', p.maxTimeMS);
  return { command: cmd, reverse: plan.reverseResults };
}

/** Largest batch of documents sent in one `data` event when no `batchSize` is given. */
export const DEFAULT_EVENT_BATCH = 100;

/**
 * Runs `docs.find` and sends the documents as `{ docs }` batches in display order. Resolves with
 * the number of documents sent. Rows read backwards are collected (at most `limit`) and reversed.
 */
export async function streamFind(
  client: ClientLike,
  p: ParsedParamsOf<'docs.find'>,
  send: (batch: { docs: string[] }) => void,
  signal?: AbortSignal,
): Promise<number> {
  const { command: cmd, reverse } = buildFind(p);
  const op = new Operation(client, p.db, p.coll, signal);
  const size = p.batchSize ?? DEFAULT_EVENT_BATCH;
  let delivered = 0;
  const emit = (docs: Document[]) => {
    for (let i = 0; i < docs.length; i += size) {
      const chunk = docs.slice(i, i + size);
      send({ docs: chunk.map(canonical) });
      delivered += chunk.length;
    }
  };
  try {
    const collected: Document[] = [];
    let batch = await op.open(cmd);
    for (;;) {
      if (reverse) collected.push(...batch);
      else emit(batch);
      if (!op.hasMore) break;
      batch = await op.more(p.batchSize);
    }
    if (reverse) emit(collected.reverse());
    return delivered;
  } finally {
    await op.close();
  }
}

/** `docs.count`: an aggregation counting the matches (`$limit` caps the work). */
export async function countDocuments(
  client: ClientLike,
  p: ParsedParamsOf<'docs.count'>,
  signal?: AbortSignal,
): Promise<ResultOf<'docs.count'>> {
  const pipeline: Document[] = [{ $match: parseDocument(p.filter, 'filter') }];
  if (p.limit !== undefined && p.limit > 0) pipeline.push({ $limit: p.limit });
  pipeline.push({ $group: { _id: 1, n: { $sum: 1 } } });
  const cmd: Document = { aggregate: p.coll, pipeline, cursor: {} };
  if (p.collation !== undefined) cmd['collation'] = parseDocument(p.collation, 'collation', true);
  if (p.hint !== undefined) cmd['hint'] = parseEjson(p.hint, 'hint', true);
  optional(cmd, 'maxTimeMS', p.maxTimeMS);
  const op = new Operation(client, p.db, p.coll, signal);
  try {
    const [group] = await op.open(cmd);
    return { count: group ? Math.max(0, Math.trunc(toNumber(group['n']) ?? 0)) : 0 };
  } finally {
    await op.close();
  }
}

/** `docs.estimatedCount`: the `count` command without a query (collection metadata). */
export async function estimatedCount(
  client: ClientLike,
  p: ParsedParamsOf<'docs.estimatedCount'>,
  signal?: AbortSignal,
): Promise<ResultOf<'docs.estimatedCount'>> {
  const cmd: Document = { count: p.coll };
  optional(cmd, 'maxTimeMS', p.maxTimeMS);
  const reply = await new Operation(client, p.db, p.coll, signal).run(cmd);
  return { count: Math.max(0, Math.trunc(toNumber(reply['n']) ?? 0)) };
}

const isIncluded = (v: unknown): boolean => v === true || (typeof v === 'number' && v !== 0);

/** True when the projection lists the fields to return (rather than those to leave out). */
function isInclusion(projection: Document): boolean {
  return Object.entries(projection).some(
    ([k, v]) =>
      k !== '_id' && (isIncluded(v) || (typeof v === 'object' && v !== null && !('$slice' in v))),
  );
}

const relatedPath = (a: string, b: string): boolean =>
  a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

/**
 * `docs.get`: one document by `_id`. With `sliceAbove`, top-level arrays longer than that are
 * loaded with `$slice` (their sizes are read on the server first, so the full arrays never
 * travel) and listed in `sliced`. Arrays the user's projection names otherwise are left alone.
 */
export async function getDocument(
  client: ClientLike,
  p: ParsedParamsOf<'docs.get'>,
  signal?: AbortSignal,
): Promise<ResultOf<'docs.get'>> {
  const id = parseEjson(p.id, 'id');
  let projection =
    p.projection === undefined ? undefined : parseDocument(p.projection, 'projection', true);
  if (projection !== undefined && Object.keys(projection).length === 0) projection = undefined;
  const op = new Operation(client, p.db, p.coll, signal);
  try {
    const large: { path: string; total: number }[] = [];
    if (p.sliceAbove !== undefined) {
      const [sizes] = await op.open({
        aggregate: p.coll,
        pipeline: [
          { $match: { _id: id } },
          { $limit: 1 },
          {
            $project: {
              _id: 0,
              arrays: {
                $filter: {
                  input: {
                    $map: {
                      input: { $objectToArray: '$$ROOT' },
                      as: 'f',
                      in: {
                        k: '$$f.k',
                        n: { $cond: [{ $isArray: '$$f.v' }, { $size: '$$f.v' }, -1] },
                      },
                    },
                  },
                  cond: { $gt: ['$$this.n', p.sliceAbove] },
                },
              },
            },
          },
        ],
        cursor: {},
      });
      await op.close();
      if (!sizes) return { doc: null, sliced: [] };
      for (const entry of (sizes['arrays'] ?? []) as Document[]) {
        const total = toNumber(entry['n']);
        if (typeof entry['k'] === 'string' && total !== undefined) {
          large.push({ path: entry['k'], total });
        }
      }
    }
    const sliced: SlicedArray[] = [];
    const fields: Document = { ...projection };
    const inclusion = projection !== undefined && isInclusion(projection);
    for (const { path, total } of large) {
      const named = Object.entries(fields).filter(([k]) => relatedPath(k, path));
      // Inclusion: only arrays included as a whole; exclusion: only arrays not mentioned.
      const sliceable = inclusion
        ? named.length === 1 && named[0]?.[0] === path && isIncluded(named[0][1])
        : named.length === 0;
      if (!sliceable || p.sliceAbove === undefined) continue;
      fields[path] = { $slice: p.sliceAbove };
      sliced.push({ path, total, loaded: Math.min(total, p.sliceAbove) });
    }
    const cmd: Document = { find: p.coll, filter: { _id: id }, limit: 1, singleBatch: true };
    if (Object.keys(fields).length > 0) cmd['projection'] = fields;
    const [doc] = await op.open(cmd);
    if (!doc) return { doc: null, sliced: [] };
    return {
      doc: canonical(doc),
      sliced: sliced.filter((s) => Array.isArray(doc[s.path])),
    };
  } finally {
    await op.close();
  }
}

/** `$a.b` for a dotted path; components must be plain field names. */
function fieldExpression(path: string): string {
  const parts = path.split('.');
  if (parts.some((part) => part.length === 0 || part.startsWith('$'))) {
    throw new RpcError(
      'INVALID_PARAMS',
      `path "${path}" must be a dotted field path without empty or "$" components`,
    );
  }
  return `$${path}`;
}

/**
 * `docs.getSlice`: items `skip … skip+limit-1` of the array at `path` and its total length,
 * computed on the server (`$slice`/`$size` in an aggregation), so only those items travel.
 * `NOT_FOUND` when there is no such document or no array at `path`. Array indexes inside the
 * path (`items.3.sub`) are not supported: aggregation paths don't index arrays.
 */
export async function getSlice(
  client: ClientLike,
  p: ParsedParamsOf<'docs.getSlice'>,
  signal?: AbortSignal,
): Promise<ResultOf<'docs.getSlice'>> {
  const id = parseEjson(p.id, 'id');
  const field = fieldExpression(p.path);
  const op = new Operation(client, p.db, p.coll, signal);
  try {
    const [doc] = await op.open({
      aggregate: p.coll,
      pipeline: [
        { $match: { _id: id } },
        { $limit: 1 },
        {
          $project: {
            _id: 0,
            isArray: { $isArray: field },
            total: { $cond: [{ $isArray: field }, { $size: field }, 0] },
            items: { $cond: [{ $isArray: field }, { $slice: [field, p.skip, p.limit] }, []] },
          },
        },
      ],
      cursor: {},
    });
    if (!doc) throw new RpcError('NOT_FOUND', 'No document with this _id');
    if (doc['isArray'] !== true) {
      throw new RpcError('NOT_FOUND', `The document has no array at "${p.path}"`);
    }
    const items = (doc['items'] ?? []) as unknown[];
    return {
      items: BSON.EJSON.stringify(items, { relaxed: false }),
      total: Math.max(0, Math.trunc(toNumber(doc['total']) ?? 0)),
    };
  } finally {
    await op.close();
  }
}
