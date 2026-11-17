import type { ParsedParamsOf } from '@thicket/contract';

import type { Document } from 'mongodb';

import { parsePipeline } from '../../agg/agg';
import { canonical, decodeBatch, isOpenCursor, RAW, toBrowseError } from '../../browse/browse';
import { abortable, topologyOf, type ClientLike } from '../../connections/manager';
import { RpcError } from '../../server/rpc';

/**
 * Change streams (`admin.watch`, SPEC M6 "Could"): a `$changeStream` aggregation on the primary
 * (raw commands, so documents keep their exact BSON types) and a `getMore` loop that waits up to
 * {@link WATCH_AWAIT_MS} per round. Events go out one by one in server order, as canonical EJSON.
 * Change streams need a replica set or a sharded cluster: a standalone server is refused with
 * `UNSUPPORTED` before the stream opens ({@link assertWatchable}).
 */

export type WatchParams = Omit<ParsedParamsOf<'admin.watch'>, 'profileId'>;

/** How long one `getMore` waits for new events on the server (ms). */
export const WATCH_AWAIT_MS = 1000;

/** Server code of "The $changeStream stage is only supported on replica sets". */
const CHANGE_STREAM_NEEDS_REPLICA_SET = 40573;

export const NEEDS_REPLICA_SET_MESSAGE =
  'Change streams need a replica set or a sharded cluster; this server is a standalone. ' +
  'Start it as a (single-member) replica set, e.g. with --replSet, to watch changes.';

function needsReplicaSet(): RpcError {
  return new RpcError('UNSUPPORTED', NEEDS_REPLICA_SET_MESSAGE, { reason: 'needsReplicaSet' });
}

/** `toBrowseError`, with the server's "only supported on replica sets" as `UNSUPPORTED`. */
function toWatchError(error: unknown): RpcError {
  const mapped = toBrowseError(error);
  const detail = mapped.detail as { serverCode?: number; codeName?: string } | undefined;
  if (
    detail?.serverCode === CHANGE_STREAM_NEEDS_REPLICA_SET ||
    detail?.codeName === `Location${CHANGE_STREAM_NEEDS_REPLICA_SET}`
  ) {
    return needsReplicaSet();
  }
  return mapped;
}

/**
 * Refuses a standalone server (`UNSUPPORTED`, detail `{ reason: 'needsReplicaSet' }`), from its
 * `hello` answer; replica sets, sharded clusters and load-balanced deployments pass.
 */
export async function assertWatchable(client: ClientLike, signal?: AbortSignal): Promise<void> {
  let hello: Document;
  try {
    hello = await abortable(client.db('admin').command({ hello: 1 }), signal);
  } catch (error) {
    throw toWatchError(error);
  }
  if (topologyOf(hello) === 'standalone') throw needsReplicaSet();
}

/**
 * The `aggregate` command opening the change stream: the whole deployment (`admin`,
 * `allChangesForCluster`), a database (`aggregate: 1`) or a collection; the user's stages follow
 * the `$changeStream` stage.
 */
export function watchCommand(params: WatchParams): { db: string; command: Document } {
  if (params.coll !== undefined && params.db === undefined) {
    throw new RpcError('INVALID_PARAMS', 'coll needs db');
  }
  const stage: Document = {};
  if (params.fullDocument !== undefined) stage['fullDocument'] = params.fullDocument;
  if (params.db === undefined) stage['allChangesForCluster'] = true;
  const pipeline = [
    { $changeStream: stage },
    ...(params.pipeline === undefined ? [] : parsePipeline(params.pipeline)),
  ];
  return {
    db: params.db ?? 'admin',
    command: { aggregate: params.coll ?? 1, pipeline, cursor: {} },
  };
}

function cancelled(): RpcError {
  return new RpcError('CANCELLED', 'The operation was cancelled');
}

/**
 * Runs the change stream until `signal` aborts (then `CANCELLED`, after killing the cursor) or
 * the server ends it (an `invalidate` event, e.g. the watched collection was dropped: resolves
 * with the delivered count). Each event is passed to `send` as canonical EJSON, in order.
 */
export async function streamChanges(
  client: ClientLike,
  params: WatchParams,
  send: (event: string) => void,
  signal: AbortSignal,
): Promise<number> {
  const { db: dbName, command } = watchCommand(params);
  const db = client.db(dbName);
  const run = async (cmd: Document): Promise<Document> => {
    try {
      return await abortable(db.command(cmd, RAW), signal);
    } catch (error) {
      if (signal.aborted) throw cancelled();
      throw toWatchError(error);
    }
  };
  const cursorOf = (reply: Document): Document => (reply['cursor'] ?? {}) as Document;
  const collection =
    typeof command['aggregate'] === 'string' ? command['aggregate'] : '$cmd.aggregate';

  let delivered = 0;
  let reply = await run(command);
  let cursor = cursorOf(reply);
  let id: unknown = cursor['id'];
  const deliver = (batch: unknown) => {
    for (const event of decodeBatch(batch)) {
      send(canonical(event));
      delivered += 1;
    }
  };
  try {
    deliver(cursor['firstBatch']);
    while (isOpenCursor(id)) {
      if (signal.aborted) throw cancelled();
      reply = await run({ getMore: id, collection, maxTimeMS: WATCH_AWAIT_MS });
      cursor = cursorOf(reply);
      id = cursor['id'];
      deliver(cursor['nextBatch']);
    }
    return delivered;
  } finally {
    if (isOpenCursor(id)) {
      await db.command({ killCursors: collection, cursors: [id] }, RAW).catch(() => undefined);
    }
  }
}
