import { randomBytes } from 'node:crypto';

import { BSON, MongoClient, type Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { ConnectionManager, RpcClient, RpcError, docsQueryHandlers, serve } from '@thicket/backend';
import {
  methods,
  type ErrorInfo,
  type Event,
  type MethodName,
  type ParamsOf,
  type Profile,
  type ResultOf,
} from '@thicket/contract';
import {
  canNext,
  canPrevious,
  createPaging,
  firstPage,
  jumpToPage,
  lastPage,
  nextPage,
  pageLoaded,
  parseSort,
  previousPage,
  setCount,
  sortDocument,
  type PageRequest,
  type PagingState,
} from '@thicket/core';

import { portPair } from '../../packages/backend/src/server/testing';

// docs.find / count / estimatedCount / get / getSlice (task docs-query-backend) against the 8.x
// replica set fixture, served like the backend serves them (contract validation, streams).

const rs = inject('mongo').mongo8rs;
const run = randomBytes(3).toString('hex');
const DB = `docsq_${run}`;
const N = 10_000;

const PROFILE: Profile = {
  id: 'docs-query',
  name: 'Docs query',
  connectionString: rs.uri,
  readOnly: false,
  production: false,
  serverSelectionTimeoutMS: 10_000,
};

interface StreamOutcome {
  docs: Document[];
  batches: number;
  end?: { delivered: number };
  error?: ErrorInfo;
}

function backendFor() {
  const manager = new ConnectionManager({
    loadProfile: (id) =>
      id === PROFILE.id
        ? Promise.resolve(PROFILE)
        : Promise.reject(new RpcError('NOT_FOUND', `No profile ${id}`)),
    loadSecrets: () => Promise.resolve(null),
  });
  const [serverPort, clientPort] = portPair();
  const stop = serve(serverPort, {
    table: methods,
    route: 'backend',
    handlers: docsQueryHandlers(manager),
  });
  const client = new RpcClient(clientPort);
  const events = new Map<string, Event[]>();
  const waiters = new Map<string, () => void>();
  clientPort.onMessage((message) => {
    const event = message as Partial<Event>;
    if (typeof event.stream !== 'string' || event.kind === undefined) return;
    const list = events.get(event.stream) ?? [];
    list.push(event as Event);
    events.set(event.stream, list);
    if (event.kind !== 'data') waiters.get(event.stream)?.();
  });
  const call = <M extends MethodName>(method: M, params: ParamsOf<M>, timeoutMs?: number) =>
    client.call(method, params, timeoutMs === undefined ? {} : { timeoutMs }) as Promise<
      ResultOf<M>
    >;
  /** Waits for the stream's `end` or `error` and returns what it delivered. */
  const finished = (streamId: string): Promise<StreamOutcome> =>
    new Promise((resolve) => {
      const done = () => {
        const list = events.get(streamId) ?? [];
        const last = list.at(-1);
        if (last === undefined || last.kind === 'data') return;
        const data = list.filter((e) => e.kind === 'data');
        resolve({
          docs: data.flatMap((e) =>
            (e.payload as { docs: string[] }).docs.map(
              (text) => BSON.EJSON.parse(text, { relaxed: false }) as Document,
            ),
          ),
          batches: data.length,
          ...(last.kind === 'end' ? { end: last.payload as { delivered: number } } : {}),
          ...(last.kind === 'error' ? { error: last.payload as ErrorInfo } : {}),
        });
      };
      waiters.set(streamId, done);
      done();
    });
  const find = async (params: Omit<ParamsOf<'docs.find'>, 'profileId' | 'db'>) => {
    const { streamId } = await call('docs.find', { profileId: PROFILE.id, db: DB, ...params });
    return finished(streamId);
  };
  const close = async () => {
    client.close();
    stop();
    await manager.closeAll();
  };
  return { manager, call, find, finished, serverPort, clientPort, close };
}

let backend: ReturnType<typeof backendFor>;
let direct: MongoClient;

const ejson = (value: unknown) => BSON.EJSON.stringify(value, { relaxed: false });
const idsOf = (docs: Document[]) => docs.map((d) => Number((d['_id'] as BSON.Int32).valueOf()));

beforeAll(async () => {
  direct = new MongoClient(rs.uri, { serverSelectionTimeoutMS: 10_000 });
  const coll = direct.db(DB).collection<Document>('items');
  const docs: Document[] = [];
  for (let i = 0; i < N; i++) {
    const doc: Document = { _id: i, score: (i * 7919) % 1000, name: `item ${i}` };
    // Every 97th document has no `group`: missing values sort first and need the null branch.
    if (i % 97 !== 0) doc['group'] = (i * 31) % 13;
    docs.push(doc);
  }
  await coll.insertMany(docs);
  await coll.createIndex({ group: 1, _id: -1 });
  backend = backendFor();
  await backend.manager.open(PROFILE.id, undefined);
});

afterAll(async () => {
  await direct.db(DB).dropDatabase();
  await backend.close();
  await direct.close();
});

/** Runs one page request of the paging state machine through `docs.find`, like the UI does. */
async function load(
  state: PagingState,
  request: PageRequest,
  sortText: string,
  extra: Partial<ParamsOf<'docs.find'>> = {},
): Promise<{ state: PagingState; docs: Document[] }> {
  const params: Omit<ParamsOf<'docs.find'>, 'profileId' | 'db'> = {
    coll: 'items',
    filter: '{}',
    sort: request.sort === null ? sortText : ejson(sortDocument(request.sort)),
    limit: request.limit,
    ...extra,
  };
  if (request.skip !== undefined) params.skip = request.skip;
  if (request.after !== undefined) params.after = ejson(request.after);
  if (request.before !== undefined) params.before = ejson(request.before);
  if (request.fromEnd) params.fromEnd = true;
  const outcome = await backend.find(params);
  expect(outcome.error).toBeUndefined();
  expect(outcome.end?.delivered).toBe(outcome.docs.length);
  return { state: pageLoaded(state, request, outcome.docs), docs: outcome.docs };
}

async function expectedIds(sort: Document): Promise<number[]> {
  const docs = await direct.db(DB).collection('items').find({}).sort(sort).toArray();
  return docs.map((d) => Number(d['_id']));
}

const SORTS: { name: string; sort: Document }[] = [
  { name: '_id ascending (default sort)', sort: { _id: 1 } },
  { name: 'compound {group: 1, _id: -1} with missing groups', sort: { group: 1, _id: -1 } },
  { name: 'compound {score: -1, _id: 1}', sort: { score: -1, _id: 1 } },
];

describe.each(['range', 'skip'] as const)('docs.find paging in %s mode (10 000 docs)', (mode) => {
  const PAGE = 500;
  const extra: Partial<ParamsOf<'docs.find'>> =
    mode === 'skip' ? { collation: '{"locale":"simple"}' } : {};

  function start(sort: Document): PagingState {
    // A collation forces skip mode (paging-core); "simple" keeps the server's binary order.
    let state = createPaging({ sort: parseSort(sort), pageSize: PAGE, collation: mode === 'skip' });
    expect(state.mode).toBe(mode);
    state = setCount(state, N, true);
    return state;
  }

  it.each(SORTS)('forward over every page equals a plain sorted find: $name', async ({ sort }) => {
    const text = ejson(sort);
    let state = start(sort);
    let page = await load(state, firstPage(state), text, extra);
    state = page.state;
    const ids = idsOf(page.docs);
    while (canNext(state)) {
      page = await load(state, nextPage(state), text, extra);
      state = page.state;
      ids.push(...idsOf(page.docs));
    }
    expect(state.pageIndex).toBe(N / PAGE - 1);
    expect(ids).toEqual(await expectedIds(sort));
  });

  it.each(SORTS)(
    'backward from the last page equals a plain sorted find: $name',
    async ({ sort }) => {
      const text = ejson(sort);
      let state = start(sort);
      let page = await load(state, lastPage(state), text, extra);
      state = page.state;
      expect(state.pageIndex).toBe(N / PAGE - 1);
      expect(state.page?.isLast).toBe(true);
      const pages: number[][] = [idsOf(page.docs)];
      while (canPrevious(state)) {
        page = await load(state, previousPage(state), text, extra);
        state = page.state;
        pages.unshift(idsOf(page.docs));
      }
      expect(state.pageIndex).toBe(0);
      const expected = await expectedIds(sort);
      expect(pages.flat()).toEqual(expected);
      // The last page holds exactly the final rows.
      expect(pages.at(-1)).toEqual(expected.slice(-PAGE));
    },
  );

  it('jump to a middle page, then next and previous, match the sorted find', async () => {
    const sort = { group: 1, _id: -1 };
    const text = ejson(sort);
    const expected = await expectedIds(sort);
    let state = start(sort);
    let page = await load(state, jumpToPage(state, 7), text, extra);
    state = page.state;
    expect(idsOf(page.docs)).toEqual(expected.slice(7 * PAGE, 8 * PAGE));
    page = await load(state, nextPage(state), text, extra);
    state = page.state;
    expect(idsOf(page.docs)).toEqual(expected.slice(8 * PAGE, 9 * PAGE));
    page = await load(state, previousPage(state), text, extra);
    expect(idsOf(page.docs)).toEqual(expected.slice(7 * PAGE, 8 * PAGE));
  });
});

describe('docs.find details', () => {
  it('streams batches of batchSize and reports the delivered count', async () => {
    const outcome = await backend.find({
      coll: 'items',
      filter: '{"score":{"$lt":{"$numberInt":"100"}}}',
      sort: '{"_id":{"$numberInt":"1"}}',
      batchSize: 64,
    });
    const expected = await direct
      .db(DB)
      .collection('items')
      .countDocuments({ score: { $lt: 100 } });
    expect(outcome.docs).toHaveLength(expected);
    expect(outcome.end).toEqual({ delivered: expected });
    expect(outcome.batches).toBe(Math.ceil(expected / 64));
  });

  it('adds the sort keys to a projection that leaves them out', async () => {
    const outcome = await backend.find({
      coll: 'items',
      filter: '{}',
      projection: '{"name":{"$numberInt":"1"},"_id":{"$numberInt":"0"}}',
      sort: '{"score":{"$numberInt":"1"},"_id":{"$numberInt":"1"}}',
      limit: 3,
    });
    expect(outcome.docs).toHaveLength(3);
    for (const doc of outcome.docs)
      expect(Object.keys(doc).sort()).toEqual(['_id', 'name', 'score']);
  });

  it('refuses range paging with a sort that is not plain directions', async () => {
    await expect(
      backend.call('docs.find', {
        profileId: PROFILE.id,
        db: DB,
        coll: 'items',
        filter: '{}',
        sort: '{"score":{"$meta":"textScore"}}',
        fromEnd: true,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('ends the stream with SERVER_ERROR for a bad filter', async () => {
    const outcome = await backend.find({ coll: 'items', filter: '{"$bogus":{"$numberInt":"1"}}' });
    expect(outcome.error?.code).toBe('SERVER_ERROR');
  });
});

describe('docs.count and docs.estimatedCount', () => {
  it('counts exactly and estimates from metadata', async () => {
    const base = { profileId: PROFILE.id, db: DB, coll: 'items' };
    await expect(backend.call('docs.count', { ...base, filter: '{}' })).resolves.toEqual({
      count: N,
    });
    await expect(
      backend.call('docs.count', { ...base, filter: '{"group":null}' }),
    ).resolves.toEqual({ count: Math.ceil(N / 97) });
    await expect(backend.call('docs.count', { ...base, filter: '{}', limit: 42 })).resolves.toEqual(
      { count: 42 },
    );
    await expect(backend.call('docs.estimatedCount', base)).resolves.toEqual({ count: N });
  });
});

/** Operations of this test's database still known to the server (running ops and idle cursors). */
async function serverOps(coll: string): Promise<Document[]> {
  return direct
    .db('admin')
    .aggregate([
      { $currentOp: { allUsers: true, idleCursors: true } },
      { $match: { ns: `${DB}.${coll}` } },
    ])
    .toArray();
}

async function waitFor<T>(probe: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await probe();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('cancel', () => {
  const SLOW = 'slow';
  // Each document costs 50 ms of server-side JavaScript: a first batch of 101 takes ~5 s.
  const slowFilter = '{"$where":"sleep(50); return true;"}';

  beforeAll(async () => {
    await direct
      .db(DB)
      .collection<Document>(SLOW)
      .insertMany(Array.from({ length: 400 }, (_, i): Document => ({ _id: i })));
  });

  it('cancelling a slow find stream ends it with CANCELLED and kills the server operation', async () => {
    const { streamId } = await backend.call('docs.find', {
      profileId: PROFILE.id,
      db: DB,
      coll: SLOW,
      filter: slowFilter,
    });
    // The query is running on the server, tagged with Thicket's comment.
    const running = await waitFor(
      () => serverOps(SLOW),
      (ops) => ops.length > 0,
    );
    expect(running).toHaveLength(1);
    expect(String(running[0]?.['command']?.['comment'])).toMatch(/^thicket:/);

    backend.clientPort.send({ cancel: streamId });
    const outcome = await backend.finished(streamId);
    expect(outcome.error?.code).toBe('CANCELLED');
    expect(outcome.end).toBeUndefined();
    // The CANCELLED event comes after the cleanup: the operation is gone right away.
    expect(await serverOps(SLOW)).toEqual([]);
  });

  it('cancelling between batches kills the open cursor', async () => {
    const { streamId } = await backend.call('docs.find', {
      profileId: PROFILE.id,
      db: DB,
      coll: SLOW,
      filter: slowFilter,
      batchSize: 2,
    });
    // Wait until some data arrived: a cursor (or a getMore) is open on the server now.
    await waitFor(
      () => serverOps(SLOW),
      (ops) => ops.length > 0,
    );
    await new Promise((r) => setTimeout(r, 300));
    backend.clientPort.send({ cancel: streamId });
    const outcome = await backend.finished(streamId);
    expect(outcome.error?.code).toBe('CANCELLED');
    expect(await serverOps(SLOW)).toEqual([]);
  });

  it('cancelling a slow count request kills its aggregation', async () => {
    const counting = backend.call(
      'docs.count',
      {
        profileId: PROFILE.id,
        db: DB,
        coll: SLOW,
        // $where is not allowed in an aggregation's $match; $function runs the same JavaScript.
        filter:
          '{"$expr":{"$function":{"body":"function() { sleep(50); return true; }","args":[],"lang":"js"}}}',
      },
      1500, // RpcClient answers TIMEOUT and sends a cancel for the request id
    );
    await expect(counting).rejects.toMatchObject({ code: 'TIMEOUT' });
    const ops = await waitFor(
      () => serverOps(SLOW),
      (list) => list.length === 0,
    );
    expect(ops).toEqual([]);
  });
});

describe('docs.get and docs.getSlice on a 50 000-item array', () => {
  const BIG = 'big';
  const ITEMS = 50_000;
  const id = new BSON.ObjectId();
  const idText = ejson(id);
  let fullSize = 0;

  beforeAll(async () => {
    const items = Array.from({ length: ITEMS }, (_, i) => ({ n: i, label: `item-${i}` }));
    const doc = { _id: id, title: 'large', items, tags: ['a', 'b'] };
    await direct.db(DB).collection(BIG).insertOne(doc);
    fullSize = ejson(doc).length;
    expect(fullSize).toBeGreaterThan(1_000_000);
  });

  /** Size of the last response the server port sent (what crosses the process boundary). */
  function lastResponseSize(): number {
    const responses = backend.serverPort.sent.filter(
      (m) => typeof m === 'object' && m !== null && 'ok' in m,
    );
    return JSON.stringify(responses.at(-1)).length;
  }

  it('getSlice returns items n..m and the total without sending the whole document', async () => {
    const result = await backend.call('docs.getSlice', {
      profileId: PROFILE.id,
      db: DB,
      coll: BIG,
      id: idText,
      path: 'items',
      skip: 30_000,
      limit: 50,
    });
    expect(result.total).toBe(ITEMS);
    const items = BSON.EJSON.parse(result.items, { relaxed: true }) as { n: number }[];
    expect(items.map((x) => x.n)).toEqual(Array.from({ length: 50 }, (_, i) => 30_000 + i));
    const size = lastResponseSize();
    expect(size).toBeLessThan(10_000);
    expect(size).toBeLessThan(fullSize / 100);
  });

  it('getSlice past the end returns no items; a missing array or document is NOT_FOUND', async () => {
    const base = { profileId: PROFILE.id, db: DB, coll: BIG, id: idText, limit: 10 };
    await expect(
      backend.call('docs.getSlice', { ...base, path: 'items', skip: ITEMS }),
    ).resolves.toEqual({ items: '[]', total: ITEMS });
    await expect(
      backend.call('docs.getSlice', { ...base, path: 'title', skip: 0 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      backend.call('docs.getSlice', {
        ...base,
        id: ejson(new BSON.ObjectId()),
        path: 'items',
        skip: 0,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('docs.get with sliceAbove loads large arrays sliced and reports them', async () => {
    const result = await backend.call('docs.get', {
      profileId: PROFILE.id,
      db: DB,
      coll: BIG,
      id: idText,
      sliceAbove: 100,
    });
    expect(result.sliced).toEqual([{ path: 'items', total: ITEMS, loaded: 100 }]);
    const doc = BSON.EJSON.parse(result.doc ?? 'null', { relaxed: true }) as Document;
    expect(doc['items']).toHaveLength(100);
    expect(doc['tags']).toEqual(['a', 'b']);
    expect(doc['title']).toBe('large');
    expect(lastResponseSize()).toBeLessThan(20_000);
  });

  it('docs.get without sliceAbove returns the whole document; unknown ids give null', async () => {
    const base = { profileId: PROFILE.id, db: DB, coll: BIG };
    const whole = await backend.call('docs.get', { ...base, id: idText });
    expect(whole.sliced).toEqual([]);
    expect(whole.doc).toBe(ejson(await direct.db(DB).collection(BIG).findOne({ _id: id })));
    await expect(
      backend.call('docs.get', { ...base, id: ejson(new BSON.ObjectId()), sliceAbove: 10 }),
    ).resolves.toEqual({ doc: null, sliced: [] });
  });
});
