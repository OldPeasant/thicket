import { randomBytes } from 'node:crypto';

import { BSON, MongoClient, type Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  ConnectionManager,
  NEEDS_REPLICA_SET_MESSAGE,
  RpcClient,
  RpcError,
  connHandlers,
  serve,
  watchHandlers,
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

// admin.watch (task change-streams): change events of a collection, a database and the whole
// deployment on the 8.x replica set fixture, in server order, served like the backend serves
// them (contract validation, streams); the 8.x standalone is refused with a clear message.

const mongo = inject('mongo');
const run = randomBytes(3).toString('hex');
const DB = `watch_${run}`;
const COLL = 'items';

const RS: Profile = {
  id: 'watch-rs',
  name: 'Watch RS',
  connectionString: mongo.mongo8rs.uri,
  readOnly: false,
  production: false,
  serverSelectionTimeoutMS: 10_000,
};
const STANDALONE: Profile = {
  ...RS,
  id: 'watch-standalone',
  connectionString: mongo.mongo8.uri,
};

const parse = (text: string) => BSON.EJSON.parse(text, { relaxed: false }) as Document;

let direct: MongoClient;
let manager: ConnectionManager;
let rpc: RpcClient;
let stop: () => void;
let clientPort: ReturnType<typeof portPair>[1];
const events = new Map<string, Event[]>();
const listeners = new Set<() => void>();

const call = <M extends MethodName>(method: M, params: ParamsOf<M>) =>
  rpc.call(method, params) as Promise<ResultOf<M>>;

/** Change events received so far on a stream. */
const changes = (streamId: string): Document[] =>
  (events.get(streamId) ?? [])
    .filter((e) => e.kind === 'data')
    .map((e) => parse((e.payload as { event: string }).event));

/** The stream's `end` / `error` event, once there is one. */
const outcome = (streamId: string) =>
  (events.get(streamId) ?? []).find((e) => e.kind !== 'data') as
    | { kind: 'end'; payload: { delivered: number } }
    | { kind: 'error'; payload: ErrorInfo }
    | undefined;

/** Waits until `test` holds (checked on every stream event), at most `ms`. */
function until<T>(test: () => T | undefined | false, what: string, ms = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const value = test();
      if (value === undefined || value === false) return;
      listeners.delete(check);
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      listeners.delete(check);
      reject(new Error(`timed out waiting for ${what}`));
    }, ms);
    listeners.add(check);
    check();
  });
}

/**
 * Makes sure the change stream is running on the server: inserts marker documents into
 * `db.coll` until one of them arrives on the stream (events before the `$changeStream`
 * aggregation started are not reported). Returns the number of events received until then.
 */
async function started(streamId: string, db = DB, coll = COLL): Promise<number> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const marker = `marker-${randomBytes(4).toString('hex')}`;
    await direct.db(db).collection(coll).insertOne({ marker });
    const seen = await until(
      () => changes(streamId).some((c) => c['fullDocument']?.['marker'] === marker),
      'the marker',
      1000,
    ).catch(() => false);
    if (seen) return changes(streamId).length;
    if (outcome(streamId)) throw new Error(`stream ended: ${JSON.stringify(outcome(streamId))}`);
  }
  throw new Error('the change stream never started');
}

beforeAll(async () => {
  direct = await MongoClient.connect(mongo.mongo8rs.uri);
  await direct.db(DB).createCollection(COLL);
  const profiles = new Map([RS, STANDALONE].map((p) => [p.id, p]));
  manager = new ConnectionManager({
    loadProfile: (id) => {
      const profile = profiles.get(id);
      return profile
        ? Promise.resolve(profile)
        : Promise.reject(new RpcError('NOT_FOUND', `No profile ${id}`));
    },
    loadSecrets: () => Promise.resolve(null),
  });
  await manager.open(RS.id, undefined);
  await manager.open(STANDALONE.id, undefined);
  const [serverPort, port] = portPair();
  clientPort = port;
  stop = serve(serverPort, {
    table: methods,
    route: 'backend',
    handlers: { ...watchHandlers(manager), ...connHandlers(manager) },
  });
  rpc = new RpcClient(clientPort);
  clientPort.onMessage((message) => {
    const event = message as Partial<Event>;
    if (typeof event.stream !== 'string' || event.kind === undefined) return;
    const list = events.get(event.stream) ?? [];
    list.push(event as Event);
    events.set(event.stream, list);
    for (const listener of [...listeners]) listener();
  });
}, 60_000);

afterAll(async () => {
  rpc.close();
  stop();
  await manager.closeAll();
  await direct
    .db(DB)
    .dropDatabase()
    .catch(() => undefined);
  await direct
    .db(`${DB}_other`)
    .dropDatabase()
    .catch(() => undefined);
  await direct.close();
});

/** Cancels a stream and waits for its `CANCELLED` error event. */
async function cancel(streamId: string): Promise<void> {
  clientPort.send({ cancel: streamId });
  const end = await until(() => outcome(streamId), 'the end of the stream');
  expect(end).toMatchObject({ kind: 'error', payload: { code: 'CANCELLED' } });
}

describe('admin.watch on a replica set', () => {
  it('receives insert, update and delete events of a collection in order', async () => {
    const { streamId } = await call('admin.watch', {
      profileId: RS.id,
      db: DB,
      coll: COLL,
      fullDocument: 'updateLookup',
    });
    const before = await started(streamId);

    const items = direct.db(DB).collection(COLL);
    const { insertedId } = await items.insertOne({ name: 'a', n: BSON.Int32.fromString('1') });
    await items.updateOne({ _id: insertedId }, { $set: { n: new BSON.Double(2) } });
    await items.insertOne({ name: 'b', big: BSON.Long.fromString('9007199254740993') });
    await items.deleteOne({ _id: insertedId });

    const seen = await until(() => {
      const list = changes(streamId).slice(before);
      return list.length >= 4 ? list : undefined;
    }, 'four events');
    expect(seen.map((c) => c['operationType'])).toEqual(['insert', 'update', 'insert', 'delete']);
    expect(seen.every((c) => c['ns'].db === DB && c['ns'].coll === COLL)).toBe(true);
    expect(seen[0]?.['documentKey']).toEqual({ _id: insertedId });
    expect(seen[1]?.['documentKey']).toEqual({ _id: insertedId });
    expect(seen[3]?.['documentKey']).toEqual({ _id: insertedId });
    // updateLookup: the update event carries the document as it is now.
    expect(seen[1]?.['updateDescription']?.['updatedFields']).toEqual({ n: new BSON.Double(2) });
    expect(seen[1]?.['fullDocument']).toMatchObject({ name: 'a', n: new BSON.Double(2) });
    // Lossless: Int32, Double and Long keep their BSON types.
    const text = (events.get(streamId) ?? []).map((e) => JSON.stringify(e.payload)).join('\n');
    expect(text).toContain('{\\"$numberInt\\":\\"1\\"}');
    expect(text).toContain('{\\"$numberDouble\\":\\"2.0\\"}');
    expect(text).toContain('{\\"$numberLong\\":\\"9007199254740993\\"}');
    // Cluster time order: each event comes after the one before.
    const times = seen.map((c) => c['clusterTime'] as BSON.Timestamp);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]!.compare(times[i - 1]!)).toBeGreaterThanOrEqual(0);
    }

    await cancel(streamId);
  });

  it('watches a whole database and filters with a pipeline', async () => {
    const { streamId } = await call('admin.watch', {
      profileId: RS.id,
      db: DB,
      pipeline: BSON.EJSON.stringify(
        [{ $match: { operationType: { $in: ['insert', 'delete'] } } }],
        { relaxed: false },
      ),
    });
    const before = await started(streamId, DB, 'second');
    await direct.db(DB).collection('second').insertOne({ x: 1 });
    await direct
      .db(DB)
      .collection(COLL)
      .updateMany({}, { $set: { touched: true } });
    await direct
      .db(DB)
      .collection(COLL)
      .deleteMany({ marker: { $exists: true } });
    await direct.db(`${DB}_other`).collection('elsewhere').insertOne({ y: 1 });
    await direct.db(DB).collection('second').insertOne({ x: 2, last: true });

    const seen = await until(() => {
      const list = changes(streamId).slice(before);
      return list.some((c) => c['fullDocument']?.['last'] === true) ? list : undefined;
    }, 'the last insert');
    expect(seen.some((c) => c['operationType'] === 'update')).toBe(false);
    expect(seen.every((c) => c['ns'].db === DB)).toBe(true);
    expect(seen.filter((c) => c['operationType'] === 'delete').length).toBeGreaterThan(0);
    expect(seen.at(0)).toMatchObject({ operationType: 'insert', ns: { coll: 'second' } });

    await cancel(streamId);
  });

  it('watches the whole deployment', async () => {
    const { streamId } = await call('admin.watch', { profileId: RS.id });
    const before = await started(streamId, `${DB}_other`, 'elsewhere');
    await direct.db(DB).collection(COLL).insertOne({ everywhere: run });
    const seen = await until(() => {
      const list = changes(streamId).slice(before);
      return list.find((c) => c['fullDocument']?.['everywhere'] === run);
    }, 'the insert in another database');
    expect(seen['ns']).toEqual({ db: DB, coll: COLL });
    await cancel(streamId);
  });

  it('ends the stream when the watched collection is dropped (invalidate)', async () => {
    const coll = `dropped_${run}`;
    await direct.db(DB).createCollection(coll);
    const { streamId } = await call('admin.watch', { profileId: RS.id, db: DB, coll });
    await started(streamId, DB, coll);
    await direct.db(DB).collection(coll).drop();
    const end = await until(() => outcome(streamId), 'the end of the stream');
    expect(end.kind).toBe('end');
    expect(
      changes(streamId)
        .map((c) => c['operationType'])
        .slice(-2),
    ).toEqual(['drop', 'invalidate']);
  });

  it('ends CANCELLED when the connection is closed', async () => {
    const { streamId } = await call('admin.watch', { profileId: RS.id, db: DB, coll: COLL });
    await started(streamId);
    await call('conn.close', { profileId: RS.id });
    const end = await until(() => outcome(streamId), 'the end of the stream');
    expect(end).toMatchObject({ kind: 'error', payload: { code: 'CANCELLED' } });
    await manager.open(RS.id, undefined);
  });

  it('refuses invalid params', async () => {
    await expect(
      call('admin.watch', { profileId: RS.id, coll: COLL } as ParamsOf<'admin.watch'>),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(
      call('admin.watch', { profileId: RS.id, db: DB, pipeline: '[{"a":1,"b":2}]' }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    // A stage the server refuses ends the stream with the server's error.
    const { streamId } = await call('admin.watch', {
      profileId: RS.id,
      db: DB,
      pipeline: '[{"$bogus":{"$numberInt":"1"}}]',
    });
    const end = await until(() => outcome(streamId), 'the end of the stream');
    expect(end).toMatchObject({ kind: 'error', payload: { code: 'SERVER_ERROR' } });
  });
});

describe('admin.watch on a standalone server', () => {
  it("refuses with a clear 'needs replica set' message", async () => {
    const failure = call('admin.watch', { profileId: STANDALONE.id, db: DB, coll: COLL });
    await expect(failure).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      message: NEEDS_REPLICA_SET_MESSAGE,
      detail: { reason: 'needsReplicaSet' },
    });
    expect(NEEDS_REPLICA_SET_MESSAGE).toMatch(/replica set/);
  });
});
