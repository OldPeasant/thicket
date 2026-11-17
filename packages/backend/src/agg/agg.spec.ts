import type { ParsedParamsOf } from '@thicket/contract';
import { BSON, MongoServerError, type Document, type RunCommandOptions } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';

import type { ClientLike } from '../connections/manager';
import { DEFAULT_EVENT_BATCH, buildFind } from '../docs/query/query';
import { RpcError } from '../server/rpc';
import {
  DEFAULT_EXPLAIN_VERBOSITY,
  DEFAULT_STAGE_LIMIT,
  DEFAULT_STAGE_SAMPLE,
  buildAggregate,
  buildExplained,
  createView,
  explain,
  parsePipeline,
  previewPipeline,
  previewStage,
  streamAggregate,
  writesTo,
} from './agg';

/** One command the fake client received: database, command document and options. */
interface Sent {
  db: string;
  command: Document;
  options: RunCommandOptions | undefined;
}

type Answer = (db: string, command: Document) => Document | Promise<Document>;

/** A fake driver client that answers each command with `answer` and records what it was sent. */
function fakeClient(answer: Answer): ClientLike & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: (db: string) => ({
      command: async (command: Document, options?: RunCommandOptions) => {
        sent.push({ db, command, options });
        return answer(db, command);
      },
    }),
  };
}

/** A promise with its resolve/reject exposed (controls the order explicitly). */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function rejection(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RpcError);
    return error as RpcError;
  }
  throw new Error('expected a rejection');
}

function thrown(fn: () => unknown): RpcError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(RpcError);
    return error as RpcError;
  }
  throw new Error('expected a throw');
}

const firstKey = (doc: Document) => Object.keys(doc)[0];
const commandsOf = (client: { sent: Sent[] }) => client.sent.map((s) => firstKey(s.command));
const ejson = (value: unknown) => BSON.EJSON.stringify(value, { relaxed: false });
const cursorReply = (id: number | BSON.Long, batch: Document[], first = true): Document => ({
  cursor: { id, ns: 'shop.orders', [first ? 'firstBatch' : 'nextBatch']: batch },
  ok: 1,
});
const docs = (...ids: number[]) => ids.map((i) => ({ _id: new BSON.Int32(i) }));
const idsOfBatches = (batches: { docs: string[] }[]) =>
  batches.map((b) =>
    b.docs.map((text) => Number((BSON.EJSON.parse(text, { relaxed: true }) as Document)['_id'])),
  );

const target = { profileId: 'p1', db: 'shop', coll: 'orders' };
const match = { $match: { status: 'open' } };
const group = { $group: { _id: '$customer', n: { $sum: new BSON.Int32(1) } } };
const runParams = (
  pipeline: Document[],
  extra: Partial<ParsedParamsOf<'agg.run'>> = {},
): ParsedParamsOf<'agg.run'> => ({ ...target, pipeline: ejson(pipeline), ...extra });
const previewParams = (
  pipeline: Document[],
  extra: Partial<ParsedParamsOf<'agg.previewStage'>> = {},
): ParsedParamsOf<'agg.previewStage'> => ({ ...target, pipeline: ejson(pipeline), ...extra });
const aggregateExplain = (
  pipeline: Document[],
  extra: Partial<ParsedParamsOf<'agg.explain'>> = {},
  targetExtra: { collation?: string; hint?: string } = {},
): ParsedParamsOf<'agg.explain'> => ({
  ...target,
  target: { kind: 'aggregate', pipeline: ejson(pipeline), ...targetExtra },
  ...extra,
});
const viewParams = (
  pipeline: Document[],
  extra: Partial<ParsedParamsOf<'agg.createView'>> = {},
): ParsedParamsOf<'agg.createView'> => ({
  profileId: 'p1',
  db: 'shop',
  view: 'openOrders',
  viewOn: 'orders',
  pipeline: ejson(pipeline),
  ...extra,
});

describe('parsePipeline', () => {
  it('parses an array of one-key stages losslessly (canonical numbers stay BSON types)', () => {
    expect(parsePipeline(ejson([match, group]))).toEqual([match, group]);
    const [limit] = parsePipeline('[{"$limit":{"$numberLong":"5"}}]');
    expect(limit?.['$limit']).toBeInstanceOf(BSON.Long);
  });

  it('accepts an empty pipeline', () => {
    expect(parsePipeline('[]')).toEqual([]);
  });

  it('refuses invalid EJSON with INVALID_PARAMS', () => {
    const error = thrown(() => parsePipeline('[{"$match":'));
    expect(error.code).toBe('INVALID_PARAMS');
    expect(error.message).toMatch(/^pipeline is not valid EJSON: /);
  });

  it.each(['{"$match":{}}', '"x"', 'null', '1'])('refuses %s: not an array', (text) => {
    const error = thrown(() => parsePipeline(text));
    expect(error.code).toBe('INVALID_PARAMS');
    expect(error.message).toBe('pipeline must be an EJSON array of stages');
  });

  it.each([
    ['an empty document', '[{}]'],
    ['two stage names in one document', '[{"$match":{},"$limit":{"$numberInt":"1"}}]'],
    ['an array', '[[{"$match":{}}]]'],
    ['null', '[null]'],
    ['a string', '["$match"]'],
    ['a number', '[{"$numberInt":"1"}]'],
    ['a BSON value wrapper', '[{"$oid":"64b7f0a1e4b0c1a2b3c4d5e6"}]'],
  ])('refuses a stage that is %s, naming its 1-based position', (_what, inner) => {
    const text = `[{"$match":{}},${inner.slice(1, -1)}]`;
    const error = thrown(() => parsePipeline(text));
    expect(error.code).toBe('INVALID_PARAMS');
    expect(error.message).toBe('pipeline stage 2 must be a document with exactly one stage name');
  });
});

describe('writesTo', () => {
  it('is true for a $out or $merge stage anywhere, false otherwise', () => {
    expect(writesTo([])).toBe(false);
    expect(writesTo([match, group])).toBe(false);
    expect(writesTo([match, { $out: 'archive' }])).toBe(true);
    expect(writesTo([{ $merge: { into: 'archive' } }, match])).toBe(true);
    // Only the stage name counts, not field names inside a stage.
    expect(writesTo([{ $project: { $out: 1 } }])).toBe(false);
  });
});

describe('previewPipeline', () => {
  it(`samples ${DEFAULT_STAGE_SAMPLE} input and returns ${DEFAULT_STAGE_LIMIT} output documents by default`, () => {
    expect(previewPipeline([match, group])).toEqual([
      { $limit: DEFAULT_STAGE_SAMPLE },
      match,
      group,
      { $limit: DEFAULT_STAGE_LIMIT },
    ]);
    expect(DEFAULT_STAGE_SAMPLE).toBe(100);
    expect(DEFAULT_STAGE_LIMIT).toBe(20);
  });

  it('uses sampleSize and limit when given', () => {
    expect(previewPipeline([match], 5, 2)).toEqual([{ $limit: 5 }, match, { $limit: 2 }]);
  });

  it('an empty pipeline previews the sample itself', () => {
    expect(previewPipeline([], 3, 1)).toEqual([{ $limit: 3 }, { $limit: 1 }]);
  });

  it.each([
    ['$geoNear', { near: [0, 0], distanceField: 'd' }],
    ['$documents', [{ a: 1 }]],
    ['$search', { text: { query: 'x', path: 'name' } }],
    ['$vectorSearch', { index: 'v', path: 'e', queryVector: [1], limit: 1 }],
    ['$collStats', { count: {} }],
    ['$indexStats', {}],
  ])('puts the sample $limit after a first stage %s', (name, spec) => {
    const first = { [name]: spec };
    expect(previewPipeline([first, match], 10, 4)).toEqual([
      first,
      { $limit: 10 },
      match,
      { $limit: 4 },
    ]);
  });

  it('puts the sample $limit after a first $match with a top-level $text', () => {
    const text = { $match: { $text: { $search: 'coffee' }, qty: { $gt: 1 } } };
    expect(previewPipeline([text, group], 10, 4)).toEqual([
      text,
      { $limit: 10 },
      group,
      { $limit: 4 },
    ]);
  });

  it('a $match without a top-level $text keeps the sample first', () => {
    const nested = { $match: { $or: [{ $text: { $search: 'x' } }] } };
    expect(previewPipeline([match, group], 10, 4)[0]).toEqual({ $limit: 10 });
    expect(previewPipeline([nested], 10, 4)).toEqual([{ $limit: 10 }, nested, { $limit: 4 }]);
  });

  it('a must-be-first stage later in the pipeline does not move the sample', () => {
    const geoNear = { $geoNear: { near: [0, 0], distanceField: 'd' } };
    expect(previewPipeline([match, geoNear], 10, 4)).toEqual([
      { $limit: 10 },
      match,
      geoNear,
      { $limit: 4 },
    ]);
  });

  it.each([
    ['$out last', [match, { $out: 'archive' }]],
    ['$merge last', [match, { $merge: { into: 'archive' } }]],
    ['$out only', [{ $out: 'archive' }]],
  ])('refuses %s: a preview never writes', (_what, stages) => {
    const error = thrown(() => previewPipeline(stages));
    expect(error.code).toBe('INVALID_PARAMS');
    expect(error.message).toMatch(/\$out or \$merge/);
  });
});

describe('buildAggregate', () => {
  it('a plain pipeline sends aggregate, pipeline and an empty cursor', () => {
    expect(buildAggregate(runParams([match]))).toEqual({
      aggregate: 'orders',
      pipeline: [match],
      cursor: {},
    });
  });

  it('passes batchSize, collation, hint, allowDiskUse and maxTimeMS through', () => {
    expect(
      buildAggregate(
        runParams([match], {
          batchSize: 7,
          collation: '{"locale":"de","strength":{"$numberInt":"2"}}',
          hint: '{"status":{"$numberInt":"1"}}',
          allowDiskUse: true,
          maxTimeMS: 5000,
        }),
      ),
    ).toEqual({
      aggregate: 'orders',
      pipeline: [match],
      cursor: { batchSize: 7 },
      collation: { locale: 'de', strength: 2 },
      hint: { status: 1 },
      allowDiskUse: true,
      maxTimeMS: 5000,
    });
  });

  it('keeps allowDiskUse false and a hint given as index name', () => {
    const cmd = buildAggregate(runParams([], { allowDiskUse: false, hint: '"status_1"' }));
    expect(cmd['allowDiskUse']).toBe(false);
    expect(cmd['hint']).toBe('status_1');
  });

  it('keeps $out in the pipeline (agg.run is the guarded write)', () => {
    expect(buildAggregate(runParams([match, { $out: 'archive' }]))['pipeline']).toEqual([
      match,
      { $out: 'archive' },
    ]);
  });

  it.each([
    ['pipeline', { pipeline: '{"$match":{}}' }],
    ['collation', { collation: '[1]' }],
    ['hint', { hint: '{"a":' }],
  ])('refuses an unreadable %s with INVALID_PARAMS', (_what, extra) => {
    expect(thrown(() => buildAggregate({ ...runParams([match]), ...extra })).code).toBe(
      'INVALID_PARAMS',
    );
  });
});

describe('streamAggregate', () => {
  it('runs aggregate and getMore with one comment and sends batches of batchSize in order', async () => {
    const client = fakeClient((_db, command) => {
      if ('aggregate' in command) return cursorReply(BSON.Long.fromNumber(42), docs(1, 2, 3));
      if ('getMore' in command) return cursorReply(0, docs(4, 5), false);
      throw new Error(`unexpected ${firstKey(command)}`);
    });
    const batches: { docs: string[] }[] = [];
    const delivered = await streamAggregate(client, runParams([match], { batchSize: 2 }), (b) =>
      batches.push(b),
    );
    expect(delivered).toBe(5);
    expect(idsOfBatches(batches)).toEqual([[1, 2], [3], [4, 5]]);
    expect(batches[0]?.docs[0]).toBe('{"_id":{"$numberInt":"1"}}');
    expect(commandsOf(client)).toEqual(['aggregate', 'getMore']);
    const [aggregate, getMore] = client.sent;
    expect(aggregate?.db).toBe('shop');
    expect(aggregate?.options).toMatchObject({ promoteLongs: false });
    expect(aggregate?.command).toMatchObject({
      aggregate: 'orders',
      pipeline: [match],
      cursor: { batchSize: 2 },
    });
    expect(String(aggregate?.command['comment'])).toMatch(/^thicket:/);
    expect(getMore?.command).toEqual({
      getMore: BSON.Long.fromNumber(42),
      collection: 'orders',
      batchSize: 2,
      comment: aggregate?.command['comment'],
    });
  });

  it(`splits batches into events of ${DEFAULT_EVENT_BATCH} documents without batchSize`, async () => {
    const many = docs(...Array.from({ length: 250 }, (_, i) => i));
    const client = fakeClient(() => cursorReply(0, many));
    const sizes: number[] = [];
    await expect(
      streamAggregate(client, runParams([match]), (b) => sizes.push(b.docs.length)),
    ).resolves.toBe(250);
    expect(sizes).toEqual([100, 100, 50]);
    expect(commandsOf(client)).toEqual(['aggregate']);
  });

  it('keeps calling getMore (without batchSize when none was given) while the cursor is open', async () => {
    let getMores = 0;
    const client = fakeClient((_db, command) => {
      if ('aggregate' in command) return cursorReply(6, docs(1));
      getMores++;
      return cursorReply(getMores < 3 ? 6 : 0, docs(1 + getMores), false);
    });
    const batches: { docs: string[] }[] = [];
    await expect(streamAggregate(client, runParams([]), (b) => batches.push(b))).resolves.toBe(4);
    expect(idsOfBatches(batches)).toEqual([[1], [2], [3], [4]]);
    expect(commandsOf(client)).toEqual(['aggregate', 'getMore', 'getMore', 'getMore']);
    expect(client.sent[1]?.command).not.toHaveProperty('batchSize');
  });

  it('an empty getMore batch sends no empty event', async () => {
    const client = fakeClient((_db, command) =>
      'aggregate' in command ? cursorReply(6, docs(1)) : cursorReply(0, [], false),
    );
    const send = vi.fn();
    await expect(streamAggregate(client, runParams([]), send)).resolves.toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a pipeline ending in $out delivers no documents and sends nothing', async () => {
    const client = fakeClient(() => cursorReply(0, []));
    const send = vi.fn();
    await expect(
      streamAggregate(client, runParams([match, { $out: 'archive' }]), send),
    ).resolves.toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(client.sent[0]?.command['pipeline']).toEqual([match, { $out: 'archive' }]);
  });

  it('uses a prebuilt command when given', async () => {
    const client = fakeClient(() => cursorReply(0, []));
    const built = { aggregate: 'orders', pipeline: [{ $match: { prebuilt: true } }], cursor: {} };
    await streamAggregate(
      client,
      { ...target, pipeline: 'not EJSON' },
      () => undefined,
      undefined,
      built,
    );
    expect(client.sent[0]?.command).toMatchObject({ pipeline: [{ $match: { prebuilt: true } }] });
  });

  it('refuses an unreadable pipeline with INVALID_PARAMS before sending anything', async () => {
    const client = fakeClient(() => cursorReply(0, []));
    const error = await rejection(
      streamAggregate(client, { ...target, pipeline: '[1]' }, () => undefined),
    );
    expect(error.code).toBe('INVALID_PARAMS');
    expect(client.sent).toEqual([]);
  });

  it('a server error mid-stream rejects SERVER_ERROR and kills the open cursor', async () => {
    const client = fakeClient((_db, command) => {
      if ('aggregate' in command) return cursorReply(42, docs(1));
      if ('getMore' in command) {
        throw new MongoServerError({ ok: 0, code: 2, codeName: 'BadValue', errmsg: 'bad' });
      }
      return { ok: 1 };
    });
    const send = vi.fn();
    const error = await rejection(streamAggregate(client, runParams([]), send));
    expect(error.code).toBe('SERVER_ERROR');
    expect(send).toHaveBeenCalledTimes(1);
    expect(commandsOf(client)).toEqual(['aggregate', 'getMore', 'killCursors']);
    expect(client.sent[2]?.command).toEqual({ killCursors: 'orders', cursors: [42] });
  });

  it('a failing aggregate rejects with the mapped server error and sends nothing', async () => {
    const client = fakeClient(() => {
      throw new MongoServerError({ ok: 0, code: 26, codeName: 'NamespaceNotFound', errmsg: 'x' });
    });
    const send = vi.fn();
    expect((await rejection(streamAggregate(client, runParams([]), send))).code).toBe('NOT_FOUND');
    expect(send).not.toHaveBeenCalled();
  });

  it('a signal aborted before the start rejects CANCELLED without sending anything', async () => {
    const client = fakeClient(() => cursorReply(0, docs(1)));
    const controller = new AbortController();
    controller.abort();
    const error = await rejection(
      streamAggregate(client, runParams([]), () => undefined, controller.signal),
    );
    expect(error.code).toBe('CANCELLED');
    expect(client.sent).toEqual([]);
  });

  it('abort during the aggregate: killOp by comment, then killCursors of the late cursor', async () => {
    const pending = deferred<Document>();
    const client = fakeClient((_db, command) => {
      if ('aggregate' in command) return pending.promise;
      if ('currentOp' in command) return { inprog: [{ opid: 101 }], ok: 1 };
      return { ok: 1 };
    });
    const controller = new AbortController();
    const running = streamAggregate(client, runParams([]), () => undefined, controller.signal);
    await vi.waitFor(() => expect(commandsOf(client)).toEqual(['aggregate']));
    controller.abort();
    await vi.waitFor(() => expect(commandsOf(client)).toContain('killOp'));
    pending.resolve(cursorReply(BSON.Long.fromNumber(77), docs(1)));
    const error = await rejection(running);
    expect(error.code).toBe('CANCELLED');
    const comment = client.sent[0]?.command['comment'];
    expect(client.sent[1]?.command).toMatchObject({ currentOp: 1, 'command.comment': comment });
    expect(client.sent.find((s) => 'killOp' in s.command)?.command).toEqual({
      killOp: 1,
      op: 101,
    });
    expect(client.sent.filter((s) => 'killCursors' in s.command).map((s) => s.command)).toEqual([
      { killCursors: 'orders', cursors: [BSON.Long.fromNumber(77)] },
    ]);
  });
});

describe('previewStage', () => {
  it('runs the preview pipeline with cursor batchSize = limit and returns canonical EJSON', async () => {
    const client = fakeClient(() => cursorReply(0, docs(1, 2)));
    await expect(
      previewStage(
        client,
        previewParams([match, group], { sampleSize: 5, limit: 3, maxTimeMS: 900 }),
      ),
    ).resolves.toEqual({ docs: ['{"_id":{"$numberInt":"1"}}', '{"_id":{"$numberInt":"2"}}'] });
    expect(client.sent).toHaveLength(1);
    expect(client.sent[0]?.db).toBe('shop');
    expect(client.sent[0]?.command).toMatchObject({
      aggregate: 'orders',
      pipeline: [{ $limit: 5 }, match, group, { $limit: 3 }],
      cursor: { batchSize: 3 },
      maxTimeMS: 900,
    });
    expect(String(client.sent[0]?.command['comment'])).toMatch(/^thicket:/);
  });

  it('uses the default sample and limit and sends no maxTimeMS when not given', async () => {
    const client = fakeClient(() => cursorReply(0, []));
    await expect(previewStage(client, previewParams([match]))).resolves.toEqual({ docs: [] });
    const cmd = client.sent[0]?.command ?? {};
    expect(cmd['pipeline']).toEqual([
      { $limit: DEFAULT_STAGE_SAMPLE },
      match,
      { $limit: DEFAULT_STAGE_LIMIT },
    ]);
    expect(cmd['cursor']).toEqual({ batchSize: DEFAULT_STAGE_LIMIT });
    expect(cmd).not.toHaveProperty('maxTimeMS');
  });

  it('fetches getMore batches for the missing documents until limit and kills the cursor', async () => {
    const client = fakeClient((_db, command) => {
      if ('aggregate' in command) return cursorReply(9, docs(1));
      if ('getMore' in command) return cursorReply(9, docs(2, 3), false);
      return { ok: 1 };
    });
    const result = await previewStage(client, previewParams([match], { limit: 3 }));
    expect(result.docs).toHaveLength(3);
    expect(commandsOf(client)).toEqual(['aggregate', 'getMore', 'killCursors']);
    expect(client.sent[1]?.command).toMatchObject({ getMore: 9, batchSize: 2 });
  });

  it('never returns more than limit documents', async () => {
    const client = fakeClient(() => cursorReply(0, docs(1, 2, 3, 4)));
    const result = await previewStage(client, previewParams([match], { limit: 2 }));
    expect(result.docs).toEqual(['{"_id":{"$numberInt":"1"}}', '{"_id":{"$numberInt":"2"}}']);
  });

  it('refuses $out/$merge and unreadable pipelines before sending anything', async () => {
    const client = fakeClient(() => cursorReply(0, []));
    for (const pipeline of [ejson([{ $out: 'archive' }]), ejson([{ $merge: 'x' }]), '[{}]']) {
      const error = await rejection(previewStage(client, { ...target, pipeline }));
      expect(error.code).toBe('INVALID_PARAMS');
    }
    expect(client.sent).toEqual([]);
  });

  it('a server error rejects mapped (SERVER_ERROR)', async () => {
    const client = fakeClient(() => {
      throw new MongoServerError({ ok: 0, code: 40324, codeName: 'Location40324', errmsg: 'bad' });
    });
    expect((await rejection(previewStage(client, previewParams([match])))).code).toBe(
      'SERVER_ERROR',
    );
  });

  it('a signal aborted before the start rejects CANCELLED without sending anything', async () => {
    const client = fakeClient(() => cursorReply(0, []));
    const controller = new AbortController();
    controller.abort();
    const error = await rejection(previewStage(client, previewParams([]), controller.signal));
    expect(error.code).toBe('CANCELLED');
    expect(client.sent).toEqual([]);
  });
});

describe('buildExplained', () => {
  it('a find target is built exactly like docs.find', () => {
    const query = {
      filter: '{"status":"open"}',
      projection: '{"total":{"$numberInt":"1"}}',
      sort: '{"total":{"$numberInt":"-1"}}',
      collation: '{"locale":"en"}',
      hint: '"status_1"',
      skip: 5,
      limit: 10,
    };
    const built = buildExplained({ ...target, target: { kind: 'find', ...query } });
    expect(built).toEqual(buildFind({ ...target, ...query }).command);
    expect(built).toMatchObject({ find: 'orders', filter: { status: 'open' }, skip: 5, limit: 10 });
    expect(built).not.toHaveProperty('kind');
  });

  it('a find target with an invalid filter is INVALID_PARAMS', () => {
    expect(
      thrown(() => buildExplained({ ...target, target: { kind: 'find', filter: '{"a":' } })).code,
    ).toBe('INVALID_PARAMS');
  });

  it('an aggregate target builds aggregate with an empty cursor, collation and hint', () => {
    expect(
      buildExplained(
        aggregateExplain([match, group], {}, { collation: '{"locale":"fr"}', hint: '"status_1"' }),
      ),
    ).toEqual({
      aggregate: 'orders',
      pipeline: [match, group],
      cursor: {},
      collation: { locale: 'fr' },
      hint: 'status_1',
    });
    expect(buildExplained(aggregateExplain([match]))).toEqual({
      aggregate: 'orders',
      pipeline: [match],
      cursor: {},
    });
  });

  it.each([
    ['the default verbosity', undefined],
    ['executionStats', 'executionStats' as const],
    ['allPlansExecution', 'allPlansExecution' as const],
  ])('refuses $out/$merge with %s (it would run the pipeline)', (_what, verbosity) => {
    for (const writing of [{ $out: 'archive' }, { $merge: { into: 'archive' } }]) {
      const p = aggregateExplain([match, writing], verbosity ? { verbosity } : {});
      const error = thrown(() => buildExplained(p));
      expect(error.code).toBe('INVALID_PARAMS');
      expect(error.message).toContain(`(${verbosity ?? DEFAULT_EXPLAIN_VERBOSITY} would run it)`);
    }
  });

  it('builds $out/$merge with queryPlanner', () => {
    expect(
      buildExplained(aggregateExplain([match, { $out: 'archive' }], { verbosity: 'queryPlanner' })),
    ).toMatchObject({ pipeline: [match, { $out: 'archive' }] });
  });

  it('refuses an unreadable aggregate pipeline with INVALID_PARAMS', () => {
    const p: ParsedParamsOf<'agg.explain'> = {
      ...target,
      target: { kind: 'aggregate', pipeline: '{}' },
    };
    expect(thrown(() => buildExplained(p)).code).toBe('INVALID_PARAMS');
  });
});

describe('explain', () => {
  const plan = { queryPlanner: { winningPlan: { stage: 'IXSCAN' } }, ok: 1 };

  it(`sends explain with verbosity ${DEFAULT_EXPLAIN_VERBOSITY} by default and returns canonical EJSON`, async () => {
    const client = fakeClient(() => plan);
    await expect(explain(client, aggregateExplain([match]))).resolves.toEqual({
      explain: ejson(plan),
    });
    expect(DEFAULT_EXPLAIN_VERBOSITY).toBe('executionStats');
    expect(client.sent).toHaveLength(1);
    expect(client.sent[0]?.db).toBe('shop');
    expect(client.sent[0]?.command).toMatchObject({
      explain: { aggregate: 'orders', pipeline: [match], cursor: {} },
      verbosity: 'executionStats',
    });
    expect(String(client.sent[0]?.command['comment'])).toMatch(/^thicket:/);
  });

  it('explains a find with the given verbosity', async () => {
    const client = fakeClient(() => plan);
    await explain(client, {
      ...target,
      target: { kind: 'find', filter: '{"status":"open"}' },
      verbosity: 'allPlansExecution',
    });
    expect(client.sent[0]?.command).toMatchObject({
      explain: { find: 'orders', filter: { status: 'open' } },
      verbosity: 'allPlansExecution',
    });
  });

  it('explains $out with queryPlanner and sends nothing for other verbosities', async () => {
    const client = fakeClient(() => plan);
    const out = [match, { $out: 'archive' }];
    expect((await rejection(explain(client, aggregateExplain(out)))).code).toBe('INVALID_PARAMS');
    expect(client.sent).toEqual([]);
    await explain(client, aggregateExplain(out, { verbosity: 'queryPlanner' }));
    expect(client.sent[0]?.command).toMatchObject({ verbosity: 'queryPlanner' });
  });

  it('a server error rejects mapped (SERVER_ERROR with its code)', async () => {
    const client = fakeClient(() => {
      throw new MongoServerError({ ok: 0, code: 2, codeName: 'BadValue', errmsg: 'bad hint' });
    });
    const error = await rejection(explain(client, aggregateExplain([match])));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toContain('bad hint');
  });

  it('a signal aborted before the start rejects CANCELLED without sending anything', async () => {
    const client = fakeClient(() => plan);
    const controller = new AbortController();
    controller.abort();
    const error = await rejection(explain(client, aggregateExplain([]), controller.signal));
    expect(error.code).toBe('CANCELLED');
    expect(client.sent).toEqual([]);
  });
});

describe('createView', () => {
  it('sends create with viewOn and pipeline on the database and resolves {}', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    await expect(createView(client, viewParams([match]))).resolves.toEqual({});
    expect(client.sent).toEqual([
      {
        db: 'shop',
        command: { create: 'openOrders', viewOn: 'orders', pipeline: [match] },
        options: undefined,
      },
    ]);
  });

  it('passes a collation (relaxed numbers)', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    await createView(
      client,
      viewParams([], { collation: '{"locale":"de","strength":{"$numberInt":"1"}}' }),
    );
    expect(client.sent[0]?.command['collation']).toEqual({ locale: 'de', strength: 1 });
  });

  it('refuses an unreadable pipeline or collation before sending anything', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    for (const p of [
      { ...viewParams([]), pipeline: '[{}]' },
      viewParams([], { collation: '"de"' }),
    ]) {
      expect((await rejection(createView(client, p))).code).toBe('INVALID_PARAMS');
    }
    expect(client.sent).toEqual([]);
  });

  it('maps an existing namespace to SERVER_ERROR with the server code', async () => {
    const client = fakeClient(() => {
      throw new MongoServerError({
        ok: 0,
        code: 48,
        codeName: 'NamespaceExists',
        errmsg: 'Namespace shop.openOrders already exists',
      });
    });
    const error = await rejection(createView(client, viewParams([match])));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toBe(
      'The server refused the command: Namespace shop.openOrders already exists',
    );
    expect(error.detail).toEqual({ serverCode: 48, codeName: 'NamespaceExists' });
  });

  it('maps NamespaceNotFound to NOT_FOUND and unknown failures to INTERNAL', async () => {
    const missing = fakeClient(() => {
      throw new MongoServerError({ ok: 0, code: 26, codeName: 'NamespaceNotFound', errmsg: 'x' });
    });
    expect((await rejection(createView(missing, viewParams([])))).code).toBe('NOT_FOUND');
    const broken = fakeClient(() => {
      throw new Error('socket hang up');
    });
    const error = await rejection(createView(broken, viewParams([])));
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toBe('Unexpected error while browsing: socket hang up');
  });

  it('passes an RpcError on unchanged', async () => {
    const original = new RpcError('NOT_CONNECTED', 'gone');
    const client = fakeClient(() => {
      throw original;
    });
    expect(await rejection(createView(client, viewParams([])))).toBe(original);
  });
});
