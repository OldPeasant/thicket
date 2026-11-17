import type { ParsedParamsOf, ResultOf } from '@thicket/contract';
import type { Document } from 'mongodb';

import { canonical, toBrowseError } from '../../src/browse/browse';
import type { ClientLike } from '../connections/manager';
import {
  DEFAULT_EVENT_BATCH,
  Operation,
  buildFind,
  parseDocument,
  parseEjson,
} from '../docs/query/query';
import { RpcError } from '../server/rpc';

/**
 * Aggregation (`agg.run/previewStage/explain/createView`) with plain server commands on an open
 * client, like `docs/query`: batches stay lossless (canonical EJSON) and every command carries a
 * unique `comment`, so a cancel kills the server operation and its cursor (`Operation`).
 *
 * `$out`/`$merge` make `agg.run` a write: the guard (`guardWrites`, `pipelineWrites`) checks the
 * profile before the handler runs. `previewStage` never writes (such stages are refused) and
 * `explain` runs them only in `queryPlanner` mode, which does not execute the pipeline.
 */

/** Stages that write their input to a collection. */
export const WRITING_STAGES: readonly string[] = ['$out', '$merge'];

/**
 * Stages that must come first in a pipeline: the preview's sample `$limit` goes after them.
 * (`$documents` generates its input; `$search`/`$vectorSearch` are Atlas Search.)
 */
const FIRST_STAGES: readonly string[] = [
  '$changeStream',
  '$collStats',
  '$currentOp',
  '$documents',
  '$geoNear',
  '$indexStats',
  '$listLocalSessions',
  '$listSampledQueries',
  '$listSearchIndexes',
  '$listSessions',
  '$planCacheStats',
  '$querySettings',
  '$search',
  '$searchMeta',
  '$shardedDataDistribution',
  '$vectorSearch',
];

/** Input documents a preview samples when `sampleSize` is not given. */
export const DEFAULT_STAGE_SAMPLE = 100;

/** Output documents a preview returns when `limit` is not given. */
export const DEFAULT_STAGE_LIMIT = 20;

/** Explain verbosity when none is given: with keys/docs examined and time (SPEC.md M3). */
export const DEFAULT_EXPLAIN_VERBOSITY = 'executionStats';

const isPlainDocument = (value: unknown): value is Document =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype &&
  !('_bsontype' in value);

/**
 * Parses a pipeline (canonical EJSON text of an array of stage documents). Each stage must be a
 * plain document with exactly one key, the stage name (`INVALID_PARAMS` otherwise).
 */
export function parsePipeline(text: string): Document[] {
  const parsed = parseEjson(text, 'pipeline');
  if (!Array.isArray(parsed)) {
    throw new RpcError('INVALID_PARAMS', 'pipeline must be an EJSON array of stages');
  }
  return parsed.map((stage: unknown, i) => {
    if (!isPlainDocument(stage) || Object.keys(stage).length !== 1) {
      throw new RpcError(
        'INVALID_PARAMS',
        `pipeline stage ${i + 1} must be a document with exactly one stage name`,
      );
    }
    return stage;
  });
}

const stageName = (stage: Document): string => Object.keys(stage)[0] ?? '';

/** Whether a parsed pipeline has a `$out` or `$merge` stage. */
export function writesTo(pipeline: readonly Document[]): boolean {
  return pipeline.some((stage) => WRITING_STAGES.includes(stageName(stage)));
}

function optional(target: Document, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

/** Adds `collation` and `hint` (EJSON text) to a command. */
function addCollationAndHint(cmd: Document, p: { collation?: string; hint?: string }): void {
  if (p.collation !== undefined) cmd['collation'] = parseDocument(p.collation, 'collation', true);
  if (p.hint !== undefined) cmd['hint'] = parseEjson(p.hint, 'hint', true);
}

/** Builds the `aggregate` command of `agg.run` (`INVALID_PARAMS` for unreadable params). */
export function buildAggregate(p: ParsedParamsOf<'agg.run'>): Document {
  const cmd: Document = { aggregate: p.coll, pipeline: parsePipeline(p.pipeline) };
  cmd['cursor'] = p.batchSize === undefined ? {} : { batchSize: p.batchSize };
  addCollationAndHint(cmd, p);
  optional(cmd, 'allowDiskUse', p.allowDiskUse);
  optional(cmd, 'maxTimeMS', p.maxTimeMS);
  return cmd;
}

/**
 * Runs `agg.run` and sends the documents as `{ docs }` batches (at most `batchSize`, default
 * {@link DEFAULT_EVENT_BATCH}, per event). Resolves with the number of documents sent. A pipeline
 * ending in `$out`/`$merge` delivers none. `built` is the command from {@link buildAggregate}
 * when the caller validated the params already.
 */
export async function streamAggregate(
  client: ClientLike,
  p: ParsedParamsOf<'agg.run'>,
  send: (batch: { docs: string[] }) => void,
  signal?: AbortSignal,
  built: Document = buildAggregate(p),
): Promise<number> {
  const op = new Operation(client, p.db, p.coll, signal);
  const size = p.batchSize ?? DEFAULT_EVENT_BATCH;
  let delivered = 0;
  try {
    let batch = await op.open(built);
    for (;;) {
      for (let i = 0; i < batch.length; i += size) {
        const chunk = batch.slice(i, i + size);
        send({ docs: chunk.map(canonical) });
        delivered += chunk.length;
      }
      if (!op.hasMore) break;
      batch = await op.more(p.batchSize);
    }
    return delivered;
  } finally {
    await op.close();
  }
}

/**
 * The pipeline a stage preview runs: a `$limit` of `sampleSize` input documents (after a stage
 * that must come first, such as `$geoNear`), the given stages, and a `$limit` of `limit` output
 * documents. `$out`/`$merge` are refused (`INVALID_PARAMS`): a preview never writes. The sample
 * is the first documents in natural order, not `$sample`, so the same input gives the same
 * preview each time.
 */
export function previewPipeline(
  stages: readonly Document[],
  sampleSize: number = DEFAULT_STAGE_SAMPLE,
  limit: number = DEFAULT_STAGE_LIMIT,
): Document[] {
  if (writesTo(stages)) {
    throw new RpcError(
      'INVALID_PARAMS',
      'A preview does not run $out or $merge stages (they write); run the pipeline instead',
    );
  }
  const first = stages[0];
  const leading = first !== undefined && FIRST_STAGES.includes(stageName(first)) ? 1 : 0;
  return [
    ...stages.slice(0, leading),
    { $limit: sampleSize },
    ...stages.slice(leading),
    { $limit: limit },
  ];
}

/** `agg.previewStage`: the output of the given stages on a sample of the input. */
export async function previewStage(
  client: ClientLike,
  p: ParsedParamsOf<'agg.previewStage'>,
  signal?: AbortSignal,
): Promise<ResultOf<'agg.previewStage'>> {
  const limit = p.limit ?? DEFAULT_STAGE_LIMIT;
  const pipeline = previewPipeline(parsePipeline(p.pipeline), p.sampleSize, limit);
  const cmd: Document = { aggregate: p.coll, pipeline, cursor: { batchSize: limit } };
  optional(cmd, 'maxTimeMS', p.maxTimeMS);
  const op = new Operation(client, p.db, p.coll, signal);
  try {
    const docs = await op.open(cmd);
    while (op.hasMore && docs.length < limit) docs.push(...(await op.more(limit - docs.length)));
    return { docs: docs.slice(0, limit).map(canonical) };
  } finally {
    await op.close();
  }
}

/**
 * Builds the command `agg.explain` explains. A find is built like `docs.find` (same filter,
 * projection, sort, skip, limit, collation, hint). An aggregate with `$out`/`$merge` is only
 * explained in `queryPlanner` mode: the other modes execute the pipeline (`INVALID_PARAMS`).
 */
export function buildExplained(p: ParsedParamsOf<'agg.explain'>): Document {
  const verbosity = p.verbosity ?? DEFAULT_EXPLAIN_VERBOSITY;
  const target = p.target;
  if (target.kind === 'find') {
    const query: Omit<typeof target, 'kind'> & { kind?: 'find' } = { ...target };
    delete query.kind;
    return buildFind({ profileId: p.profileId, db: p.db, coll: p.coll, ...query }).command;
  }
  const pipeline = parsePipeline(target.pipeline);
  if (writesTo(pipeline) && verbosity !== 'queryPlanner') {
    throw new RpcError(
      'INVALID_PARAMS',
      `A pipeline with $out or $merge is explained only with verbosity queryPlanner (${verbosity} would run it)`,
    );
  }
  const cmd: Document = { aggregate: p.coll, pipeline, cursor: {} };
  addCollationAndHint(cmd, target);
  return cmd;
}

/** `agg.explain`: the server's explain output of a find or an aggregate, as canonical EJSON. */
export async function explain(
  client: ClientLike,
  p: ParsedParamsOf<'agg.explain'>,
  signal?: AbortSignal,
): Promise<ResultOf<'agg.explain'>> {
  const explained = buildExplained(p);
  const verbosity = p.verbosity ?? DEFAULT_EXPLAIN_VERBOSITY;
  const reply = await new Operation(client, p.db, p.coll, signal).run({
    explain: explained,
    verbosity,
  });
  return { explain: canonical(reply) };
}

/** `agg.createView`: `create` of a view on `viewOn` with the pipeline (and collation). */
export async function createView(
  client: ClientLike,
  p: ParsedParamsOf<'agg.createView'>,
): Promise<ResultOf<'agg.createView'>> {
  const cmd: Document = { create: p.view, viewOn: p.viewOn, pipeline: parsePipeline(p.pipeline) };
  if (p.collation !== undefined) cmd['collation'] = parseDocument(p.collation, 'collation', true);
  try {
    await client.db(p.db).command(cmd);
  } catch (error) {
    throw toBrowseError(error);
  }
  return {};
}
