import { BSON, MongoServerError, type Document, type RunCommandOptions } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';

import type { ClientLike } from '../../connections/manager';
import { RAW } from '../../browse/browse';
import {
  assertWatchable,
  NEEDS_REPLICA_SET_MESSAGE,
  streamChanges,
  WATCH_AWAIT_MS,
  watchCommand,
} from './watch';

type Answer = (db: string, command: Document) => Document | Promise<Document>;

interface Sent {
  db: string;
  command: Document;
  options: RunCommandOptions | undefined;
}

function fakeClient(answer: Answer): { client: ClientLike; sent: Sent[] } {
  const sent: Sent[] = [];
  const client: ClientLike = {
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: (db) => ({
      command: async (command, options) => {
        sent.push({ db, command, options });
        return answer(db, command);
      },
    }),
  };
  return { client, sent };
}

const ejson = (value: unknown) => BSON.EJSON.stringify(value, { relaxed: false });
const parse = (text: string) => BSON.EJSON.parse(text, { relaxed: false }) as Document;
const serverError = (code: number, codeName: string, errmsg = 'refused') =>
  new MongoServerError({ ok: 0, code, codeName, errmsg });

const event = (n: number, operationType = 'insert'): Document => ({
  _id: { _data: `token-${n}` },
  operationType,
  ns: { db: 'shop', coll: 'orders' },
  documentKey: { _id: n },
});

const first = (id: unknown, batch: unknown[]) => ({
  cursor: { id, ns: 'shop.orders', firstBatch: batch },
  ok: 1,
});
const next = (id: unknown, batch: unknown[]) => ({
  cursor: { id, ns: 'shop.orders', nextBatch: batch },
  ok: 1,
});

/** A promise and the functions that settle it, for replies the test releases in its own order. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const commandName = (s: Sent) => Object.keys(s.command)[0];

describe('watchCommand', () => {
  it('watches a collection on its database', () => {
    expect(watchCommand({ db: 'shop', coll: 'orders' })).toEqual({
      db: 'shop',
      command: { aggregate: 'orders', pipeline: [{ $changeStream: {} }], cursor: {} },
    });
  });

  it('watches a whole database with aggregate: 1', () => {
    expect(watchCommand({ db: 'shop' })).toEqual({
      db: 'shop',
      command: { aggregate: 1, pipeline: [{ $changeStream: {} }], cursor: {} },
    });
  });

  it('watches the whole deployment on admin with allChangesForCluster', () => {
    expect(watchCommand({})).toEqual({
      db: 'admin',
      command: {
        aggregate: 1,
        pipeline: [{ $changeStream: { allChangesForCluster: true } }],
        cursor: {},
      },
    });
  });

  it('passes fullDocument into the $changeStream stage', () => {
    expect(
      watchCommand({ db: 'shop', coll: 'orders', fullDocument: 'updateLookup' }).command[
        'pipeline'
      ],
    ).toEqual([{ $changeStream: { fullDocument: 'updateLookup' } }]);
    expect(watchCommand({ fullDocument: 'required' }).command['pipeline']).toEqual([
      { $changeStream: { fullDocument: 'required', allChangesForCluster: true } },
    ]);
  });

  it("appends the user's stages after $changeStream, keeping their BSON types", () => {
    const pipeline = ejson([
      { $match: { operationType: { $in: ['insert', 'delete'] } } },
      { $project: { n: new BSON.Int32(1), big: BSON.Long.fromNumber(5) } },
    ]);
    const stages = watchCommand({ db: 'shop', coll: 'orders', pipeline }).command[
      'pipeline'
    ] as Document[];
    expect(stages).toHaveLength(3);
    expect(stages[0]).toEqual({ $changeStream: {} });
    expect(stages[1]).toEqual({ $match: { operationType: { $in: ['insert', 'delete'] } } });
    expect((stages[2]?.['$project'] as Document)['big']).toBeInstanceOf(BSON.Long);
  });

  it('accepts an empty user pipeline', () => {
    expect(watchCommand({ db: 'shop', pipeline: '[]' }).command['pipeline']).toEqual([
      { $changeStream: {} },
    ]);
  });

  it('refuses a collection without a database', () => {
    expect(() => watchCommand({ coll: 'orders' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PARAMS', message: 'coll needs db' }),
    );
  });

  it.each([
    ['not an array', '{"$match":{}}'],
    ['a stage with two names', '[{"$match":{},"$limit":1}]'],
    ['malformed EJSON', '[{'],
  ])('refuses a pipeline that is %s', (_label, pipeline) => {
    expect(() => watchCommand({ db: 'shop', pipeline })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PARAMS' }),
    );
  });
});

describe('assertWatchable', () => {
  it.each([
    ['a replica set', { isWritablePrimary: true, setName: 'rs0', ok: 1 }],
    ['a sharded cluster', { isWritablePrimary: true, msg: 'isdbgrid', ok: 1 }],
    ['a load-balanced deployment', { isWritablePrimary: true, serviceId: 'svc', ok: 1 }],
  ])('lets %s pass', async (_label, hello) => {
    const { client, sent } = fakeClient(() => hello);
    await expect(assertWatchable(client)).resolves.toBeUndefined();
    expect(sent.map((s) => [s.db, s.command])).toEqual([['admin', { hello: 1 }]]);
  });

  it.each([
    ['isWritablePrimary', { isWritablePrimary: true, ok: 1 }],
    ['legacy ismaster', { ismaster: true, ok: 1 }],
  ])(
    "refuses a standalone server (%s) as UNSUPPORTED with reason 'needsReplicaSet'",
    async (_label, hello) => {
      const { client } = fakeClient(() => hello);
      const error = await assertWatchable(client).catch((e: unknown) => e);
      expect(error).toMatchObject({
        code: 'UNSUPPORTED',
        message: NEEDS_REPLICA_SET_MESSAGE,
        detail: { reason: 'needsReplicaSet' },
      });
    },
  );

  it('the message clearly names the replica set requirement and how to fix it', () => {
    expect(NEEDS_REPLICA_SET_MESSAGE).toMatch(/replica set/);
    expect(NEEDS_REPLICA_SET_MESSAGE).toMatch(/standalone/);
    expect(NEEDS_REPLICA_SET_MESSAGE).toContain('--replSet');
  });

  it('maps a failing hello like other server errors', async () => {
    const { client } = fakeClient(() => {
      throw serverError(13, 'Unauthorized', 'not authorized');
    });
    await expect(assertWatchable(client)).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      detail: { serverCode: 13, codeName: 'Unauthorized' },
    });
  });

  it('answers CANCELLED for an already aborted signal', async () => {
    const { client } = fakeClient(() => ({ isWritablePrimary: true, setName: 'rs0', ok: 1 }));
    const controller = new AbortController();
    controller.abort();
    await expect(assertWatchable(client, controller.signal)).rejects.toMatchObject({
      code: 'CANCELLED',
    });
  });

  it('answers CANCELLED when the signal aborts while hello is pending', async () => {
    const hello = deferred<Document>();
    const { client } = fakeClient(() => hello.promise);
    const controller = new AbortController();
    const result = assertWatchable(client, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
    hello.resolve({ isWritablePrimary: true, ok: 1 });
  });
});

describe('streamChanges', () => {
  const collParams = { db: 'shop', coll: 'orders' };

  it('sends the first batch and each getMore batch in server order, then ends on a closed cursor', async () => {
    let getMores = 0;
    const { client, sent } = fakeClient((_db, command) => {
      if ('aggregate' in command) return first(BSON.Long.fromNumber(77), [event(1)]);
      getMores += 1;
      if (getMores === 1) return next(BSON.Long.fromNumber(77), []);
      if (getMores === 2) return next(BSON.Long.fromNumber(77), [event(2, 'update'), event(3)]);
      // invalidate: the server closes the cursor.
      return next(BSON.Long.fromNumber(0), [event(4, 'delete'), event(5, 'invalidate')]);
    });
    const events: string[] = [];
    const delivered = await streamChanges(
      client,
      collParams,
      (e) => events.push(e),
      new AbortController().signal,
    );
    expect(delivered).toBe(5);
    expect(
      events.map(parse).map((e) => [e['operationType'], (e['_id'] as Document)['_data']]),
    ).toEqual([
      ['insert', 'token-1'],
      ['update', 'token-2'],
      ['insert', 'token-3'],
      ['delete', 'token-4'],
      ['invalidate', 'token-5'],
    ]);
    expect(sent.map(commandName)).toEqual(['aggregate', 'getMore', 'getMore', 'getMore']);
    // No killCursors after the server closed the cursor itself.
    expect(sent.some((s) => 'killCursors' in s.command)).toBe(false);
    expect(sent[1]).toEqual({
      db: 'shop',
      command: {
        getMore: BSON.Long.fromNumber(77),
        collection: 'orders',
        maxTimeMS: WATCH_AWAIT_MS,
      },
      options: RAW,
    });
    expect(sent[0]?.options).toBe(RAW);
  });

  it('getMores a database or deployment stream on $cmd.aggregate', async () => {
    const { client, sent } = fakeClient((_db, command) =>
      'aggregate' in command ? first(5, []) : next(0, []),
    );
    await streamChanges(client, { db: 'shop' }, () => undefined, new AbortController().signal);
    await streamChanges(client, {}, () => undefined, new AbortController().signal);
    expect(sent.map((s) => [s.db, commandName(s), s.command['collection']])).toEqual([
      ['shop', 'aggregate', undefined],
      ['shop', 'getMore', '$cmd.aggregate'],
      ['admin', 'aggregate', undefined],
      ['admin', 'getMore', '$cmd.aggregate'],
    ]);
  });

  it('resolves with 0 and sends no getMore when the cursor is closed at once', async () => {
    const { client, sent } = fakeClient(() => first(0, []));
    await expect(
      streamChanges(client, collParams, () => undefined, new AbortController().signal),
    ).resolves.toBe(0);
    expect(sent.map(commandName)).toEqual(['aggregate']);
  });

  it('treats a missing cursor in the reply as closed', async () => {
    const { client } = fakeClient(() => ({ ok: 1 }));
    await expect(
      streamChanges(client, collParams, () => undefined, new AbortController().signal),
    ).resolves.toBe(0);
  });

  it('decodes raw BSON batches losslessly as canonical EJSON', async () => {
    const raw = BSON.serialize({
      _id: { _data: 'token-1' },
      operationType: 'insert',
      fullDocument: {
        _id: new BSON.ObjectId('65a000000000000000000001'),
        n: new BSON.Int32(1),
        big: BSON.Long.fromString('9007199254740993'),
        price: BSON.Decimal128.fromString('9.99'),
        d: new BSON.Double(2),
      },
    });
    const { client } = fakeClient(() => first(0, [raw]));
    const events: string[] = [];
    await streamChanges(client, collParams, (e) => events.push(e), new AbortController().signal);
    expect(events).toHaveLength(1);
    const full = JSON.parse(events[0] ?? '{}') as { fullDocument: Record<string, unknown> };
    expect(full.fullDocument).toEqual({
      _id: { $oid: '65a000000000000000000001' },
      n: { $numberInt: '1' },
      big: { $numberLong: '9007199254740993' },
      price: { $numberDecimal: '9.99' },
      d: { $numberDouble: '2.0' },
    });
  });

  it('cancel while a getMore waits kills the server cursor and ends CANCELLED', async () => {
    const pending = deferred<Document>();
    const { client, sent } = fakeClient((_db, command) => {
      if ('aggregate' in command) return first(BSON.Long.fromNumber(42), [event(1)]);
      if ('getMore' in command) return pending.promise;
      return { ok: 1 };
    });
    const controller = new AbortController();
    const events: string[] = [];
    const running = streamChanges(client, collParams, (e) => events.push(e), controller.signal);
    await vi.waitFor(() => expect(sent.map(commandName)).toEqual(['aggregate', 'getMore']));
    controller.abort();
    await expect(running).rejects.toMatchObject({
      code: 'CANCELLED',
      message: 'The operation was cancelled',
    });
    expect(sent[2]).toEqual({
      db: 'shop',
      command: { killCursors: 'orders', cursors: [BSON.Long.fromNumber(42)] },
      options: RAW,
    });
    expect(events).toHaveLength(1);
    // A late answer of the abandoned getMore delivers nothing more.
    pending.resolve(next(BSON.Long.fromNumber(42), [event(2)]));
    await Promise.resolve();
    expect(events).toHaveLength(1);
  });

  it('cancel of a database stream kills the cursor on $cmd.aggregate', async () => {
    const pending = deferred<Document>();
    const { client, sent } = fakeClient((_db, command) => {
      if ('aggregate' in command) return first(9, []);
      if ('getMore' in command) return pending.promise;
      return { ok: 1 };
    });
    const controller = new AbortController();
    const running = streamChanges(client, { db: 'shop' }, () => undefined, controller.signal);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(sent[2]?.command).toEqual({ killCursors: '$cmd.aggregate', cursors: [9] });
  });

  it('a signal aborted between batches stops before the next getMore and kills the cursor', async () => {
    const controller = new AbortController();
    const { client, sent } = fakeClient((_db, command) => {
      if ('aggregate' in command) return first(3, [event(1)]);
      return { ok: 1 };
    });
    // The consumer aborts while handling the first event (e.g. the user pressed Stop).
    const running = streamChanges(client, collParams, () => controller.abort(), controller.signal);
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(sent.map(commandName)).toEqual(['aggregate', 'killCursors']);
  });

  it('a cancel before the aggregate answers ends CANCELLED without a cursor to kill', async () => {
    const pending = deferred<Document>();
    const { client, sent } = fakeClient(() => pending.promise);
    const controller = new AbortController();
    const running = streamChanges(client, collParams, () => undefined, controller.signal);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
    pending.resolve(first(8, [event(1)]));
    await Promise.resolve();
    expect(sent.map(commandName)).toEqual(['aggregate']);
  });

  it('a failing killCursors does not hide the cancel', async () => {
    const pending = deferred<Document>();
    const { client, sent } = fakeClient((_db, command) => {
      if ('aggregate' in command) return first(4, []);
      if ('getMore' in command) return pending.promise;
      throw new Error('connection reset');
    });
    const controller = new AbortController();
    const running = streamChanges(client, collParams, () => undefined, controller.signal);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(sent.map(commandName)).toEqual(['aggregate', 'getMore', 'killCursors']);
  });

  it.each([
    ['server code 40573', serverError(40573, 'Location40573')],
    [
      'code name Location40573 only',
      Object.assign(new Error('only on replica sets'), {
        codeName: 'Location40573',
      }),
    ],
  ])(
    "maps the server's $changeStream refusal (%s) to UNSUPPORTED needsReplicaSet",
    async (_label, error) => {
      const { client } = fakeClient(() => {
        throw error;
      });
      await expect(
        streamChanges(client, collParams, () => undefined, new AbortController().signal),
      ).rejects.toMatchObject({
        code: 'UNSUPPORTED',
        message: NEEDS_REPLICA_SET_MESSAGE,
        detail: { reason: 'needsReplicaSet' },
      });
    },
  );

  it('passes other aggregate errors on as SERVER_ERROR with the server code', async () => {
    const { client } = fakeClient(() => {
      throw serverError(13, 'Unauthorized', 'not authorized on shop');
    });
    await expect(
      streamChanges(client, collParams, () => undefined, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      detail: { serverCode: 13, codeName: 'Unauthorized' },
    });
  });

  it('a failing getMore ends the stream with the error and kills the still open cursor', async () => {
    const { client, sent } = fakeClient((_db, command) => {
      if ('aggregate' in command) return first(6, [event(1)]);
      if ('getMore' in command) throw serverError(286, 'ChangeStreamHistoryLost', 'history lost');
      return { ok: 1 };
    });
    const events: string[] = [];
    await expect(
      streamChanges(client, collParams, (e) => events.push(e), new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      detail: { serverCode: 286, codeName: 'ChangeStreamHistoryLost' },
    });
    expect(events).toHaveLength(1);
    expect(sent.map(commandName)).toEqual(['aggregate', 'getMore', 'killCursors']);
    expect(sent[2]?.command).toEqual({ killCursors: 'orders', cursors: [6] });
  });

  it('refuses invalid params before any command is sent', async () => {
    const { client, sent } = fakeClient(() => first(0, []));
    await expect(
      streamChanges(client, { coll: 'orders' }, () => undefined, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(sent).toEqual([]);
  });
});
