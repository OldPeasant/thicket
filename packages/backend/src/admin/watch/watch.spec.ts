import {
  BSON,
  MongoServerError,
  type Document,
  type RunCommandOptions,
  type RunCursorCommandOptions,
} from 'mongodb';
import { describe, expect, it, vi } from 'vitest';

import type { ClientLike, CursorLike } from '../../connections/manager';
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

  it('a cancel before the aggregate answers ends CANCELLED and kills the cursor it opens late', async () => {
    const pending = deferred<Document>();
    const { client, sent } = fakeClient((_db, command) =>
      'aggregate' in command ? pending.promise : { ok: 1 },
    );
    const controller = new AbortController();
    const events: string[] = [];
    const running = streamChanges(client, collParams, (e) => events.push(e), controller.signal);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(sent.map(commandName)).toEqual(['aggregate']);
    pending.resolve(first(8, [event(1)]));
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({
      db: 'shop',
      command: { killCursors: 'orders', cursors: [8] },
      options: RAW,
    });
    expect(events).toEqual([]);
  });

  it('a cancel before the aggregate answers kills nothing when the cursor is closed or the aggregate fails', async () => {
    for (const settle of ['closed', 'failed'] as const) {
      const pending = deferred<Document>();
      const { client, sent } = fakeClient(() => pending.promise);
      const controller = new AbortController();
      const running = streamChanges(client, collParams, () => undefined, controller.signal);
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      controller.abort();
      await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
      if (settle === 'closed') pending.resolve(first(0, [event(1)]));
      else pending.reject(serverError(13, 'Unauthorized'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sent.map(commandName)).toEqual(['aggregate']);
    }
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

/** One round of a driver cursor: the batch and the cursor id the server answered with. */
interface Round {
  docs: unknown[];
  id: unknown;
}

/**
 * A client whose databases have `runCursorCommand`: each `tryNext` takes the next scripted round
 * (a value, a promise or an error), like the driver's `RunCommandCursor`. `calls` logs what the
 * code did with the cursor; plain `command`s land in `commands`.
 */
function cursorClient(
  rounds: (Round | Promise<Round> | Error)[],
  options: { tryNext?: boolean; closeFails?: boolean } = {},
) {
  const calls: string[] = [];
  const commands: Document[] = [];
  const opened: { db: string; command: Document; options: RunCursorCommandOptions | undefined }[] =
    [];
  let id: unknown;
  let buffer: unknown[] = [];
  const round = async (): Promise<void> => {
    const next = rounds.shift();
    if (next === undefined) throw new Error('no more rounds scripted');
    if (next instanceof Error) throw next;
    const answer = await next;
    id = answer.id;
    buffer = [...answer.docs];
  };
  const cursor: CursorLike = {
    get id() {
      return id;
    },
    hasNext: async () => {
      calls.push('hasNext');
      if (buffer.length === 0) await round();
      return buffer.length > 0;
    },
    readBufferedDocuments: () => buffer.splice(0),
    setComment: () => undefined,
    setBatchSize: () => undefined,
    setMaxTimeMS: (ms: number) => calls.push(`setMaxTimeMS ${ms}`),
    close: () => {
      calls.push('close');
      return options.closeFails === true
        ? Promise.reject(new Error('connection reset'))
        : Promise.resolve();
    },
  };
  if (options.tryNext !== false) {
    cursor.tryNext = async () => {
      calls.push('tryNext');
      if (buffer.length === 0) await round();
      return buffer.shift() ?? null;
    };
  }
  const client: ClientLike = {
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: (db) => ({
      command: (command) => {
        commands.push(command);
        return Promise.resolve({ ok: 1 });
      },
      runCursorCommand: (command, opts) => {
        opened.push({ db, command, options: opts });
        return cursor;
      },
    }),
  };
  return { client, calls, commands, opened };
}

describe('streamChanges with a driver cursor (runCursorCommand)', () => {
  const collParams = { db: 'shop', coll: 'orders' };
  const long = (n: number) => BSON.Long.fromNumber(n);
  const raw = (doc: Document) => BSON.serialize(doc);

  it('runs the stream as one pinned raw cursor on the primary, round by round, in order', async () => {
    const { client, calls, commands, opened } = cursorClient([
      { docs: [raw(event(1))], id: long(77) },
      { docs: [], id: long(77) },
      { docs: [raw(event(2, 'update')), raw(event(3))], id: long(77) },
      // invalidate: the server closes the cursor.
      { docs: [raw(event(4, 'delete')), raw(event(5, 'invalidate'))], id: long(0) },
    ]);
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
    // Raw batches and no read preference (the primary); the getMores and the kill go through
    // the cursor (pinned to its server), never as separate commands.
    expect(opened).toEqual([
      { db: 'shop', command: watchCommand(collParams).command, options: { raw: true } },
    ]);
    expect(commands).toEqual([]);
    expect(calls).toEqual([
      `setMaxTimeMS ${WATCH_AWAIT_MS}`,
      'tryNext',
      'tryNext',
      'tryNext',
      'tryNext',
      'close',
    ]);
  });

  it('decodes raw BSON batches losslessly as canonical EJSON', async () => {
    const doc = raw({
      _id: { _data: 'token-1' },
      operationType: 'insert',
      fullDocument: { big: BSON.Long.fromString('9007199254740993'), n: new BSON.Int32(1) },
    });
    const { client } = cursorClient([{ docs: [doc], id: long(0) }]);
    const events: string[] = [];
    await streamChanges(client, collParams, (e) => events.push(e), new AbortController().signal);
    const full = JSON.parse(events[0] ?? '{}') as { fullDocument: Record<string, unknown> };
    expect(full.fullDocument).toEqual({
      big: { $numberLong: '9007199254740993' },
      n: { $numberInt: '1' },
    });
  });

  it('cancel while a getMore waits ends CANCELLED at once and closes the cursor after that round', async () => {
    const pending = deferred<Round>();
    const { client, calls } = cursorClient([{ docs: [event(1)], id: long(42) }, pending.promise]);
    const controller = new AbortController();
    const events: string[] = [];
    const running = streamChanges(client, collParams, (e) => events.push(e), controller.signal);
    await vi.waitFor(() => expect(calls.filter((c) => c === 'tryNext')).toHaveLength(2));
    controller.abort();
    await expect(running).rejects.toMatchObject({
      code: 'CANCELLED',
      message: 'The operation was cancelled',
    });
    expect(calls).not.toContain('close');
    // The abandoned getMore answers late: nothing more is delivered, then the cursor is closed.
    pending.resolve({ docs: [event(2)], id: long(42) });
    await vi.waitFor(() => expect(calls.at(-1)).toBe('close'));
    expect(events).toHaveLength(1);
  });

  it('a cancel while the opening aggregate is in flight closes the cursor once it opened', async () => {
    const pending = deferred<Round>();
    const { client, calls } = cursorClient([pending.promise]);
    const controller = new AbortController();
    const events: string[] = [];
    const running = streamChanges(client, collParams, (e) => events.push(e), controller.signal);
    await vi.waitFor(() => expect(calls).toContain('tryNext'));
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(calls).not.toContain('close');
    pending.resolve({ docs: [event(1)], id: long(8) });
    await vi.waitFor(() => expect(calls.at(-1)).toBe('close'));
    expect(events).toEqual([]);
  });

  it('a cancelled round that then fails still closes the cursor', async () => {
    const pending = deferred<Round>();
    const { client, calls } = cursorClient([pending.promise]);
    const controller = new AbortController();
    const running = streamChanges(client, collParams, () => undefined, controller.signal);
    await vi.waitFor(() => expect(calls).toContain('tryNext'));
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
    pending.reject(new Error('connection reset'));
    await vi.waitFor(() => expect(calls.at(-1)).toBe('close'));
  });

  it('an already aborted signal runs no command', async () => {
    const { client, calls } = cursorClient([{ docs: [event(1)], id: long(1) }]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      streamChanges(client, collParams, () => undefined, controller.signal),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(calls).not.toContain('tryNext');
  });

  it('a signal aborted between rounds stops before the next getMore and closes the cursor', async () => {
    const controller = new AbortController();
    const { client, calls } = cursorClient([{ docs: [event(1)], id: long(3) }]);
    const running = streamChanges(client, collParams, () => controller.abort(), controller.signal);
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(calls).toEqual([`setMaxTimeMS ${WATCH_AWAIT_MS}`, 'tryNext', 'close']);
  });

  it("maps the server's $changeStream refusal to UNSUPPORTED needsReplicaSet", async () => {
    const { client, calls } = cursorClient([serverError(40573, 'Location40573')]);
    await expect(
      streamChanges(client, collParams, () => undefined, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      message: NEEDS_REPLICA_SET_MESSAGE,
      detail: { reason: 'needsReplicaSet' },
    });
    expect(calls.at(-1)).toBe('close');
  });

  it('a failing getMore ends the stream with the mapped error and closes the cursor', async () => {
    const { client, calls } = cursorClient([
      { docs: [event(1)], id: long(6) },
      serverError(286, 'ChangeStreamHistoryLost', 'history lost'),
    ]);
    const events: string[] = [];
    await expect(
      streamChanges(client, collParams, (e) => events.push(e), new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      detail: { serverCode: 286, codeName: 'ChangeStreamHistoryLost' },
    });
    expect(events).toHaveLength(1);
    expect(calls.at(-1)).toBe('close');
  });

  it('a failing close does not hide the result', async () => {
    const { client, calls } = cursorClient([{ docs: [event(1)], id: long(0) }], {
      closeFails: true,
    });
    await expect(
      streamChanges(client, collParams, () => undefined, new AbortController().signal),
    ).resolves.toBe(1);
    expect(calls.at(-1)).toBe('close');
  });

  it('falls back to hasNext for cursors without tryNext', async () => {
    const { client, calls } = cursorClient(
      [
        { docs: [event(1), event(2)], id: long(5) },
        { docs: [event(3)], id: long(0) },
      ],
      { tryNext: false },
    );
    const events: string[] = [];
    await expect(
      streamChanges(client, collParams, (e) => events.push(e), new AbortController().signal),
    ).resolves.toBe(3);
    expect(calls.filter((c) => c === 'hasNext')).toHaveLength(2);
  });
});
