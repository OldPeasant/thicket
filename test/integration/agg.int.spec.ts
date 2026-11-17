import { randomBytes } from 'node:crypto';

import { BSON, MongoClient, type Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  ConnectionManager,
  RpcClient,
  RpcError,
  aggHandlers,
  connHandlers,
  guardWrites,
  type ClientLike,
  serve,
} from '@thicket/backend';
import {
  methods,
  type ErrorInfo,
  type Event,
  type MethodName,
  type ParamsOf,
  type Profile,
  type ResultOf,
} from '@thicket/contract';

import { portPair } from '../../packages/backend/src/server/testing';

// agg.run / previewStage / explain / createView (task agg-backend) against the 8.x replica set
// fixture, served like startBackend serves them: contract validation and the write guard.

const rs = inject('mongo').mongo8rs;
const run = randomBytes(3).toString('hex');
const DB = `agg_${run}`;
const N = 60;

const base = { connectionString: rs.uri, serverSelectionTimeoutMS: 10_000 };
const PROFILES: Record<string, Profile> = {
  plain: { id: 'plain', name: 'Plain', readOnly: false, production: false, ...base },
  readonly: { id: 'readonly', name: 'Read-only', readOnly: true, production: false, ...base },
  prod: { id: 'prod', name: 'Production', readOnly: false, production: true, ...base },
};

function profileOf(id: string): Profile {
  const profile = PROFILES[id];
  if (!profile) throw new RpcError('NOT_FOUND', `No profile ${id}`);
  return profile;
}

interface StreamOutcome {
  docs: Document[];
  end?: { delivered: number };
  error?: ErrorInfo;
}

const parse = (text: string) => BSON.EJSON.parse(text, { relaxed: false }) as Document;
const ejson = (value: unknown) => BSON.EJSON.stringify(value, { relaxed: false });

function backendFor() {
  // The killOp commands this backend's own clients send (a cancel's cleanup).
  const killOps: Document[] = [];
  const manager = new ConnectionManager({
    loadProfile: (id) => Promise.resolve(profileOf(id)),
    loadSecrets: () => Promise.resolve(null),
    createClient: (uri, options) => {
      const client = new MongoClient(uri, { ...options, monitorCommands: true });
      client.on('commandStarted', (event) => {
        if (event.commandName === 'killOp') killOps.push(event.command);
      });
      return client as ClientLike;
    },
  });
  const [serverPort, clientPort] = portPair();
  const stop = serve(serverPort, {
    table: methods,
    route: 'backend',
    handlers: { ...guardWrites(aggHandlers(manager), profileOf), ...connHandlers(manager) },
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
  const call = <M extends MethodName>(method: M, params: ParamsOf<M>) =>
    client.call(method, params) as Promise<ResultOf<M>>;
  const finished = (streamId: string): Promise<StreamOutcome> =>
    new Promise((resolve) => {
      const done = () => {
        const list = events.get(streamId) ?? [];
        const last = list.at(-1);
        if (last === undefined || last.kind === 'data') return;
        resolve({
          docs: list
            .filter((e) => e.kind === 'data')
            .flatMap((e) => (e.payload as { docs: string[] }).docs.map(parse)),
          ...(last.kind === 'end' ? { end: last.payload as { delivered: number } } : {}),
          ...(last.kind === 'error' ? { error: last.payload as ErrorInfo } : {}),
        });
      };
      waiters.set(streamId, done);
      done();
    });
  const aggregate = async (params: Omit<ParamsOf<'agg.run'>, 'db'>) => {
    const { streamId } = await call('agg.run', { db: DB, ...params });
    return finished(streamId);
  };
  const close = async () => {
    client.close();
    stop();
    await manager.closeAll();
  };
  return { manager, killOps, call, finished, aggregate, close };
}

let backend: ReturnType<typeof backendFor>;
let direct: MongoClient;

async function failure(promise: Promise<unknown>): Promise<ErrorInfo> {
  try {
    await promise;
  } catch (error) {
    return error as ErrorInfo;
  }
  throw new Error('expected the call to fail');
}

const STAGES: Document[] = [
  { $match: { qty: { $gte: 10 } } },
  { $group: { _id: '$category', total: { $sum: '$qty' }, n: { $sum: 1 } } },
  { $sort: { total: -1, _id: 1 } },
];

beforeAll(async () => {
  direct = new MongoClient(rs.uri, { serverSelectionTimeoutMS: 10_000 });
  const docs: Document[] = [];
  for (let i = 0; i < N; i++) {
    docs.push({
      _id: i,
      category: `c${i % 4}`,
      qty: (i * 7) % 50,
      price: new BSON.Decimal128(`${i}.5`),
    });
  }
  await direct.db(DB).collection('orders').insertMany(docs);
  await direct.db(DB).collection('orders').createIndex({ qty: 1 });
  backend = backendFor();
  await backend.manager.open('plain', undefined);
  await backend.manager.open('readonly', undefined);
  await backend.manager.open('prod', undefined);
});

afterAll(async () => {
  await direct.db(DB).dropDatabase();
  await backend.close();
  await direct.close();
});

const target = (profileId = 'plain') => ({ profileId, db: DB, coll: 'orders' });

describe('agg.run', () => {
  it('streams the pipeline result in batches, lossless', async () => {
    const outcome = await backend.aggregate({
      profileId: 'plain',
      coll: 'orders',
      pipeline: ejson([{ $sort: { _id: 1 } }]),
      batchSize: 7,
    });
    expect(outcome.error).toBeUndefined();
    expect(outcome.end?.delivered).toBe(N);
    expect(outcome.docs.map((d) => Number(d['_id']))).toEqual([...Array(N).keys()]);
    expect(outcome.docs[3]?.['price']).toBeInstanceOf(BSON.Decimal128);
  });

  it('refuses a pipeline that is not an array of stages', async () => {
    const error = await failure(
      backend.call('agg.run', { ...target(), pipeline: '[{"$match":{},"$sort":{}}]' }),
    );
    expect(error.code).toBe('INVALID_PARAMS');
  });
});

describe('agg.run and conn.close', () => {
  const SLOW = 'slow_close';

  async function serverOps(): Promise<Document[]> {
    return direct
      .db('admin')
      .aggregate([
        { $currentOp: { allUsers: true, idleCursors: true } },
        { $match: { ns: `${DB}.${SLOW}` } },
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

  it('conn.close during a slow agg.run ends its stream with CANCELLED and kills the server operation', async () => {
    await direct
      .db(DB)
      .collection<Document>(SLOW)
      .insertMany(Array.from({ length: 40 }, (_, i): Document => ({ _id: i })));
    const { streamId } = await backend.call('agg.run', {
      ...target(),
      coll: SLOW,
      // Every document takes 50 ms: the aggregation runs for seconds on the server.
      pipeline: ejson([
        {
          $match: {
            $expr: {
              $function: { body: 'function() { sleep(50); return true; }', args: [], lang: 'js' },
            },
          },
        },
      ]),
    });
    expect(await waitFor(serverOps, (ops) => ops.length > 0)).not.toEqual([]);
    const kills = backend.killOps.length;
    try {
      await backend.call('conn.close', { profileId: 'plain' });
      const outcome = await backend.finished(streamId);
      expect(outcome.error).toEqual({ code: 'CANCELLED', message: 'The connection was closed' });
      // conn.close cancelled the stream before closing the client: its operation is gone...
      expect(await serverOps()).toEqual([]);
      // ...killed by the stream's cleanup (a killOp from this backend's own client), not left to
      // the server noticing the closed sockets.
      expect(backend.killOps.length).toBeGreaterThan(kills);
    } finally {
      await backend.manager.open('plain', undefined);
    }
  });
});

describe('agg.previewStage', () => {
  it('preview of stage 2 of 3 matches running the first 2 stages', async () => {
    const { docs } = await backend.call('agg.previewStage', {
      ...target(),
      pipeline: ejson(STAGES.slice(0, 2)),
      sampleSize: N,
      limit: 100,
    });
    const expected = await direct
      .db(DB)
      .collection('orders')
      .aggregate(STAGES.slice(0, 2))
      .toArray();
    const byId = (list: Document[]) =>
      [...list].sort((a, b) => String(a['_id']).localeCompare(String(b['_id'])));
    expect(docs.length).toBe(4);
    expect(byId(docs.map((t) => BSON.EJSON.parse(t) as Document))).toEqual(byId(expected));
  });

  it('samples sampleSize input documents and returns at most limit', async () => {
    const counted = await backend.call('agg.previewStage', {
      ...target(),
      pipeline: ejson([{ $count: 'n' }]),
      sampleSize: 25,
    });
    expect(counted.docs.map((t) => BSON.EJSON.parse(t))).toEqual([{ n: 25 }]);
    const limited = await backend.call('agg.previewStage', {
      ...target(),
      pipeline: '[]',
      limit: 5,
    });
    expect(limited.docs).toHaveLength(5);
  });

  it('previews a pipeline whose first $match uses $text (it must stay the first stage)', async () => {
    const notes = direct.db(DB).collection('notes');
    const rows: Document[] = [
      { _id: 1, body: 'black coffee', n: 1 },
      { _id: 2, body: 'green tea', n: 2 },
      { _id: 3, body: 'coffee with milk', n: 3 },
    ];
    await notes.insertMany(rows);
    await notes.createIndex({ body: 'text' });
    const stages = [{ $match: { $text: { $search: 'coffee' } } }, { $sort: { _id: 1 } }];
    const { docs } = await backend.call('agg.previewStage', {
      profileId: 'plain',
      db: DB,
      coll: 'notes',
      pipeline: ejson(stages),
      sampleSize: 10,
    });
    expect(docs.map((t) => Number((BSON.EJSON.parse(t) as Document)['_id']))).toEqual([1, 3]);
  });

  it('refuses $out and $merge', async () => {
    const error = await failure(
      backend.call('agg.previewStage', { ...target(), pipeline: ejson([{ $out: 'nope' }]) }),
    );
    expect(error.code).toBe('INVALID_PARAMS');
    expect(await direct.db(DB).listCollections({ name: 'nope' }).toArray()).toEqual([]);
  });
});

describe('agg.explain', () => {
  it('explains a find and returns the winning plan (index used)', async () => {
    const { explain } = await backend.call('agg.explain', {
      ...target(),
      target: { kind: 'find', filter: ejson({ qty: { $gte: 40 } }) },
    });
    const parsed = parse(explain);
    const text = JSON.stringify(parsed['queryPlanner']['winningPlan']);
    expect(text).toContain('IXSCAN');
    expect(parsed['executionStats']).toBeDefined();
  });

  it('explains an aggregate and returns the winning plan', async () => {
    const { explain } = await backend.call('agg.explain', {
      ...target(),
      target: { kind: 'aggregate', pipeline: ejson(STAGES) },
      verbosity: 'queryPlanner',
    });
    const parsed = parse(explain);
    // Classic engine: stages[0].$cursor.queryPlanner; SBE: queryPlanner at the top.
    const planner =
      parsed['queryPlanner'] ?? (parsed['stages'] as Document[])[0]?.['$cursor']['queryPlanner'];
    expect(planner['winningPlan']).toBeDefined();
  });

  it('explains $out only with queryPlanner (other modes would write)', async () => {
    const pipeline = ejson([{ $out: 'explained' }]);
    const error = await failure(
      backend.call('agg.explain', { ...target(), target: { kind: 'aggregate', pipeline } }),
    );
    expect(error.code).toBe('INVALID_PARAMS');
    await backend.call('agg.explain', {
      ...target(),
      target: { kind: 'aggregate', pipeline },
      verbosity: 'queryPlanner',
    });
    expect(await direct.db(DB).listCollections({ name: 'explained' }).toArray()).toEqual([]);
  });
});

describe('$out / $merge through the guard', () => {
  const outPipeline = (coll: string) => ejson([{ $match: { qty: { $lt: 10 } } }, { $out: coll }]);

  it('refuses $out on a read-only profile, even confirmed', async () => {
    for (const confirmed of [undefined, true]) {
      const error = await failure(
        backend.call('agg.run', {
          ...target('readonly'),
          pipeline: outPipeline('ro_out'),
          ...(confirmed ? { confirmed } : {}),
        }),
      );
      expect(error.code).toBe('READ_ONLY');
    }
    expect(await direct.db(DB).listCollections({ name: 'ro_out' }).toArray()).toEqual([]);
  });

  it('read-only profiles still run reading pipelines', async () => {
    const outcome = await backend.aggregate({
      profileId: 'readonly',
      coll: 'orders',
      pipeline: ejson([{ $count: 'n' }]),
    });
    expect(outcome.docs).toEqual([{ n: new BSON.Int32(N) }]);
  });

  it('$out on production requires confirmed', async () => {
    const error = await failure(
      backend.call('agg.run', { ...target('prod'), pipeline: outPipeline('prod_out') }),
    );
    expect(error.code).toBe('CONFIRMATION_REQUIRED');
    expect(await direct.db(DB).listCollections({ name: 'prod_out' }).toArray()).toEqual([]);

    const outcome = await backend.aggregate({
      profileId: 'prod',
      coll: 'orders',
      pipeline: outPipeline('prod_out'),
      confirmed: true,
    });
    expect(outcome.error).toBeUndefined();
    expect(outcome.end?.delivered).toBe(0);
    const expected = await direct
      .db(DB)
      .collection('orders')
      .countDocuments({ qty: { $lt: 10 } });
    expect(await direct.db(DB).collection('prod_out').countDocuments()).toBe(expected);
  });

  it('$merge on production requires confirmed', async () => {
    const pipeline = ejson([{ $merge: { into: 'prod_merge' } }]);
    const error = await failure(backend.call('agg.run', { ...target('prod'), pipeline }));
    expect(error.code).toBe('CONFIRMATION_REQUIRED');
    const outcome = await backend.aggregate({
      profileId: 'prod',
      coll: 'orders',
      pipeline,
      confirmed: true,
    });
    expect(outcome.error).toBeUndefined();
    expect(await direct.db(DB).collection('prod_merge').countDocuments()).toBe(N);
  });
});

describe('agg.createView', () => {
  it('creates a view from a pipeline', async () => {
    await backend.call('agg.createView', {
      profileId: 'plain',
      db: DB,
      view: 'big_orders',
      viewOn: 'orders',
      pipeline: ejson([{ $match: { qty: { $gte: 40 } } }]),
    });
    const [info] = await direct.db(DB).listCollections({ name: 'big_orders' }).toArray();
    expect(info?.type).toBe('view');
    const expected = await direct
      .db(DB)
      .collection('orders')
      .countDocuments({ qty: { $gte: 40 } });
    expect(await direct.db(DB).collection('big_orders').countDocuments()).toBe(expected);
  });

  it('is a write: refused on read-only, needs confirmed on production', async () => {
    const params = {
      db: DB,
      view: 'guarded_view',
      viewOn: 'orders',
      pipeline: '[]',
    };
    expect(
      (await failure(backend.call('agg.createView', { ...params, profileId: 'readonly' }))).code,
    ).toBe('READ_ONLY');
    expect(
      (await failure(backend.call('agg.createView', { ...params, profileId: 'prod' }))).code,
    ).toBe('CONFIRMATION_REQUIRED');
    await backend.call('agg.createView', { ...params, profileId: 'prod', confirmed: true });
  });
});
