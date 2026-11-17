/**
 * Turns a server's explain output (canonical EJSON text, as `agg.explain` returns it) into what the
 * explain viewer shows: a tree of plan stages with their numbers, the totals, and the indexes used.
 * Pure; understands the shapes of MongoDB 7/8 explain output:
 * - find / single-stage aggregate, classic engine (`explainVersion` "1"):
 *   `executionStats.executionStages` (with numbers) or `queryPlanner.winningPlan`;
 * - slot-based engine (`explainVersion` "2"): `winningPlan.queryPlan` (classic stage names) with the
 *   numbers of the SBE stages of the same `planNodeId`;
 * - aggregate with more stages: `stages: [{ $cursor: {...} }, { $group: ... }, ...]`;
 * - sharded: `shards` (an array under `SHARD_MERGE`, or one entry per shard for aggregates).
 */

/** Plain value of the explain output: EJSON numbers unwrapped, other wrappers kept as objects. */
type Plain = null | boolean | number | string | Plain[] | { [key: string]: Plain };
type PlainObject = Record<string, Plain>;

/** One line of a stage's details, e.g. `index: status_1_n_1`. */
export interface PlanDetail {
  readonly label: string;
  readonly value: string;
}

export interface PlanNode {
  /** `IXSCAN`, `COLLSCAN`, `$group`, `shard rs0`, ... */
  readonly stage: string;
  readonly nReturned?: number;
  /** `executionTimeMillisEstimate` (cumulative: includes the stages below). */
  readonly timeMs?: number;
  readonly keysExamined?: number;
  readonly docsExamined?: number;
  /** Name of the index the stage reads (scans). */
  readonly indexName?: string;
  readonly details: readonly PlanDetail[];
  /** The stages feeding this one (inputs). */
  readonly children: readonly PlanNode[];
}

export interface ExplainSummary {
  /** `classic` or `sbe` (slot-based engine), from `explainVersion`. */
  readonly engine: 'classic' | 'sbe';
  /** The output stage; its children are its inputs, down to the scans. */
  readonly root: PlanNode;
  readonly nReturned?: number;
  readonly keysExamined?: number;
  readonly docsExamined?: number;
  /** `executionTimeMillis` of the whole query. */
  readonly timeMs?: number;
  /** Names of the indexes the plan reads, in plan order, each once. */
  readonly indexes: readonly string[];
  /** Some stage reads the whole collection. */
  readonly collscan: boolean;
  /** Without execution stats (`queryPlanner` verbosity): no numbers. */
  readonly executed: boolean;
}

const NUMBER_KEYS = ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal'];

/** Canonical (or relaxed) EJSON text → plain values with numbers unwrapped. */
export function toPlain(value: unknown): Plain {
  if (Array.isArray(value)) return value.map(toPlain);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 1) {
      const [key, inner] = entries[0] as [string, unknown];
      if (NUMBER_KEYS.includes(key) && typeof inner === 'string') {
        const n = Number(inner);
        return Number.isNaN(n) ? inner : n;
      }
    }
    return Object.fromEntries(entries.map(([k, v]) => [k, toPlain(v)]));
  }
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  return null;
}

function isObject(value: Plain | undefined): value is PlainObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function num(value: Plain | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function obj(value: Plain | undefined): PlainObject | undefined {
  return isObject(value) ? value : undefined;
}

/** Compact text of a detail value: strings as they are, everything else as JSON. */
function text(value: Plain): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Readable details of a classic plan stage (what the stage does; numbers are fields). */
const DETAIL_KEYS: readonly [string, string][] = [
  ['indexName', 'index'],
  ['keyPattern', 'key'],
  ['direction', 'direction'],
  ['indexBounds', 'bounds'],
  ['filter', 'filter'],
  ['sortPattern', 'sort'],
  ['limitAmount', 'limit'],
  ['skipAmount', 'skip'],
  ['transformBy', 'projection'],
  ['memLimit', 'memory limit'],
  ['usedDisk', 'used disk'],
  ['foreignCollection', 'from'],
  ['localField', 'local field'],
  ['foreignField', 'foreign field'],
  ['strategy', 'strategy'],
  ['shardName', 'shard'],
];

/** Stages that read an index without naming it. */
const ID_INDEX_STAGES = new Set(['IDHACK', 'EXPRESS_IXSCAN', 'EXPRESS_CLUSTERED_IXSCAN']);

function details(stage: PlainObject): PlanDetail[] {
  const out: PlanDetail[] = [];
  for (const [key, label] of DETAIL_KEYS) {
    const value = stage[key];
    if (value === undefined || key === 'indexName') continue;
    if (key === 'direction' && value === 'forward') continue;
    if (key === 'usedDisk' && value === false) continue;
    out.push({ label, value: text(value) });
  }
  return out;
}

/**
 * Stats of SBE stages by `planNodeId`: the outermost stage of a node has its output; the reads of
 * its scan stages are its keys/docs examined (the `queryPlan` stages don't have them).
 */
type SbeStats = Map<
  number,
  { nReturned?: number; timeMs?: number; keysExamined?: number; docsExamined?: number }
>;

/** SBE stages whose `numReads` are documents read (collection scan, fetch by record id). */
const SBE_DOC_READS = new Set(['scan', 'seek']);
/** SBE stages whose `numReads` are index keys read. */
const SBE_KEY_READS = new Set(['ixseek', 'ixscan', 'ixscan_generic']);

function addReads(total: number | undefined, reads: number | undefined): number | undefined {
  return reads === undefined ? total : (total ?? 0) + reads;
}

function collectSbe(stage: PlainObject | undefined, into: SbeStats): SbeStats {
  if (stage === undefined) return into;
  const id = num(stage['planNodeId']);
  if (id !== undefined) {
    let entry = into.get(id);
    if (entry === undefined) {
      entry = {
        nReturned: num(stage['nReturned']),
        timeMs: num(stage['executionTimeMillisEstimate']),
      };
      into.set(id, entry);
    }
    const name = typeof stage['stage'] === 'string' ? stage['stage'] : '';
    const reads = num(stage['numReads']);
    if (SBE_DOC_READS.has(name)) entry.docsExamined = addReads(entry.docsExamined, reads);
    if (SBE_KEY_READS.has(name)) entry.keysExamined = addReads(entry.keysExamined, reads);
  }
  for (const child of inputsOf(stage)) collectSbe(child, into);
  return into;
}

/** The input stages of a plan stage, in plan order. */
function inputsOf(stage: PlainObject): PlainObject[] {
  const out: PlainObject[] = [];
  for (const key of ['inputStage', 'outerStage', 'innerStage', 'thenStage', 'elseStage']) {
    const child = obj(stage[key]);
    if (child) out.push(child);
  }
  const many = stage['inputStages'];
  if (Array.isArray(many)) out.push(...many.filter(isObject));
  return out;
}

/** A classic plan stage (or the `queryPlan` of an SBE plan) and everything below it. */
function planNode(stage: PlainObject, sbe?: SbeStats): PlanNode {
  const name = typeof stage['stage'] === 'string' ? stage['stage'] : '?';
  const children = inputsOf(stage).map((child) => planNode(child, sbe));
  const shards = stage['shards'];
  if (Array.isArray(shards)) children.push(...shards.filter(isObject).map(shardNode));
  const id = num(stage['planNodeId']);
  const fromSbe = sbe && id !== undefined ? sbe.get(id) : undefined;
  const indexName =
    typeof stage['indexName'] === 'string'
      ? stage['indexName']
      : ID_INDEX_STAGES.has(name)
        ? '_id_'
        : undefined;
  return {
    stage: name,
    nReturned: num(stage['nReturned']) ?? fromSbe?.nReturned,
    timeMs: num(stage['executionTimeMillisEstimate']) ?? fromSbe?.timeMs,
    keysExamined: num(stage['keysExamined']) ?? fromSbe?.keysExamined,
    docsExamined: num(stage['docsExamined']) ?? fromSbe?.docsExamined,
    indexName,
    details: details(stage),
    children,
  };
}

/** One shard of a sharded find (`shards[]` of `SHARD_MERGE`). */
function shardNode(shard: PlainObject): PlanNode {
  const name = typeof shard['shardName'] === 'string' ? shard['shardName'] : '?';
  const stages = obj(shard['executionStages']) ?? obj(shard['winningPlan']);
  const inner = stages ? queryTree(stages, undefined) : undefined;
  return {
    stage: `shard ${name}`,
    nReturned: num(shard['nReturned']),
    timeMs: num(shard['executionTimeMillis']),
    keysExamined: num(shard['totalKeysExamined']),
    docsExamined: num(shard['totalDocsExamined']),
    details: [],
    children: inner ? [inner] : [],
  };
}

/** The tree of a `winningPlan` or `executionStages` (classic, or `queryPlan` + SBE stages). */
function queryTree(plan: PlainObject, executionStages: PlainObject | undefined): PlanNode {
  const queryPlan = obj(plan['queryPlan']);
  if (queryPlan) return planNode(queryPlan, collectSbe(executionStages, new Map()));
  return planNode(plan);
}

interface QueryPart {
  engine: 'classic' | 'sbe';
  root: PlanNode;
  executed: boolean;
  nReturned?: number;
  keysExamined?: number;
  docsExamined?: number;
  timeMs?: number;
}

/** A `{ queryPlanner, executionStats }` part: a find, or the `$cursor` stage of an aggregate. */
function queryPart(part: PlainObject): QueryPart | undefined {
  const planner = obj(part['queryPlanner']);
  const winning = obj(planner?.['winningPlan']);
  const stats = obj(part['executionStats']);
  const execStages = obj(stats?.['executionStages']);
  if (!winning && !execStages) return undefined;
  const sbe = winning !== undefined && obj(winning['queryPlan']) !== undefined;
  // SBE stages use their own names: the tree comes from `queryPlan`, numbers from the SBE stages.
  const root = sbe || !execStages ? queryTree(winning ?? {}, execStages) : planNode(execStages);
  return {
    engine: sbe ? 'sbe' : 'classic',
    root,
    executed: stats !== undefined,
    nReturned: num(stats?.['nReturned']),
    keysExamined: num(stats?.['totalKeysExamined']),
    docsExamined: num(stats?.['totalDocsExamined']),
    timeMs: num(stats?.['executionTimeMillis']),
  };
}

/** The operator of an aggregate stage (`$group`), skipping the numbers next to it. */
function operatorOf(stage: PlainObject): string | undefined {
  return Object.keys(stage).find((key) => key.startsWith('$'));
}

const STAGE_STAT_KEYS = new Set(['nReturned', 'executionTimeMillisEstimate']);

/** An aggregate's `stages` array → a chain, the last stage at the top. */
function stagesPart(stages: Plain[]): QueryPart | undefined {
  let below: PlanNode | undefined;
  let query: QueryPart | undefined;
  let engine: 'classic' | 'sbe' = 'classic';
  for (const stage of stages.filter(isObject)) {
    const op = operatorOf(stage);
    if (op === undefined) continue;
    const spec = stage[op] ?? null;
    let node: PlanNode;
    if (op === '$cursor' && isObject(spec)) {
      query = queryPart(spec);
      if (query) engine = query.engine;
      node = {
        stage: '$cursor',
        nReturned: num(stage['nReturned']),
        timeMs: num(stage['executionTimeMillisEstimate']),
        details: [],
        children: query ? [query.root] : [],
      };
    } else {
      const extra = Object.entries(stage)
        .filter(([key, value]) => key !== op && !STAGE_STAT_KEYS.has(key) && value !== false)
        .map(([key, value]) => ({ label: key, value: text(value) }));
      node = {
        stage: op,
        nReturned: num(stage['nReturned']),
        timeMs: num(stage['executionTimeMillisEstimate']),
        details: [{ label: 'spec', value: text(spec) }, ...extra],
        children: below ? [below] : [],
      };
    }
    below = node;
  }
  if (below === undefined) return undefined;
  return {
    engine,
    root: below,
    executed: query?.executed ?? below.nReturned !== undefined,
    nReturned: below.nReturned ?? query?.nReturned,
    keysExamined: query?.keysExamined,
    docsExamined: query?.docsExamined,
    timeMs: maxOf(query?.timeMs, below.timeMs),
  };
}

function maxOf(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function sumOf(values: (number | undefined)[]): number | undefined {
  const known = values.filter((v): v is number => v !== undefined);
  return known.length === 0 ? undefined : known.reduce((a, b) => a + b, 0);
}

/** One explain document (unsharded, or one shard's part). */
function partOf(doc: PlainObject): QueryPart | undefined {
  const stages = doc['stages'];
  if (Array.isArray(stages)) return stagesPart(stages);
  const shards = obj(doc['shards']);
  if (shards) {
    const parts = Object.entries(shards).flatMap(([name, value]) => {
      const part = isObject(value) ? partOf(value) : undefined;
      return part ? [{ name, part }] : [];
    });
    if (parts.length === 0) return undefined;
    return {
      engine: parts.some((p) => p.part.engine === 'sbe') ? 'sbe' : 'classic',
      root: {
        stage: 'merge shards',
        details:
          doc['mergeType'] !== undefined ? [{ label: 'merge', value: text(doc['mergeType']) }] : [],
        children: parts.map(({ name, part }) => ({
          stage: `shard ${name}`,
          nReturned: part.nReturned,
          timeMs: part.timeMs,
          keysExamined: part.keysExamined,
          docsExamined: part.docsExamined,
          details: [],
          children: [part.root],
        })),
      },
      executed: parts.every((p) => p.part.executed),
      nReturned: sumOf(parts.map((p) => p.part.nReturned)),
      keysExamined: sumOf(parts.map((p) => p.part.keysExamined)),
      docsExamined: sumOf(parts.map((p) => p.part.docsExamined)),
      timeMs: parts.reduce<number | undefined>((t, p) => maxOf(t, p.part.timeMs), undefined),
    };
  }
  return queryPart(doc);
}

function walk(node: PlanNode, visit: (node: PlanNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

/**
 * The summary of an explain output (canonical EJSON text or an already parsed object).
 * Throws an `Error` with a readable message when it is not an explain output.
 */
export function summarizeExplain(explain: string | object): ExplainSummary {
  const parsed: unknown = typeof explain === 'string' ? JSON.parse(explain) : explain;
  const doc = toPlain(parsed);
  if (!isObject(doc)) throw new Error('The explain output is not a document.');
  const part = partOf(doc);
  if (part === undefined) throw new Error('The explain output has no query plan.');
  const indexes: string[] = [];
  let collscan = false;
  walk(part.root, (node) => {
    if (node.indexName !== undefined && !indexes.includes(node.indexName)) {
      indexes.push(node.indexName);
    }
    if (node.stage === 'COLLSCAN') collscan = true;
  });
  return {
    engine: doc['explainVersion'] === '2' ? 'sbe' : part.engine,
    root: part.root,
    nReturned: part.nReturned,
    keysExamined: part.keysExamined,
    docsExamined: part.docsExamined,
    timeMs: part.timeMs,
    indexes,
    collscan,
    executed: part.executed,
  };
}
