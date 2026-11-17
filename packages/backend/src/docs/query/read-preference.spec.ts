import {
  BSON,
  MongoServerError,
  MongoWriteConcernError,
  ReadPreference,
  WriteConcern,
  type Document,
  type RunCommandOptions,
  type RunCursorCommandOptions,
} from 'mongodb';
import { describe, expect, it, vi } from 'vitest';

import type { ClientLike, CursorLike, DbLike } from '../../connections/manager';
import { RpcError } from '../../server/rpc';
import { Operation, countDocuments, killOperations } from './query';

/**
 * Task raw-cmd-read-pref: `Operation` reads follow the profile's read preference through a
 * driver cursor (`runCursorCommand`, getMore/killCursors pinned to its server), writes run on
 * the primary with the profile's write concern, and a cancel cleans up with the same read
 * preference and closes the cursor once its pending batch settled.
 */

const SECONDARY = new ReadPreference('secondaryPreferred', [{ dc: 'b' }]);

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

interface Sent {
  db: string;
  command: Document;
  options: RunCommandOptions | undefined;
}

/** One `hasNext` of the fake cursor: the batch it buffers and the cursor id afterwards. */
interface Step {
  docs: Document[];
  /** True when the server keeps more batches after this one. */
  more: boolean;
}

/**
 * A scripted driver cursor. Each `hasNext` takes the next pending step (a deferred the test
 * resolves, or a ready one), so the test decides when a batch arrives or fails.
 */
interface ScriptedCursor extends CursorLike {
  command: Document;
  options: RunCursorCommandOptions | undefined;
  calls: string[];
}

type CursorAnswer = (callIndex: number) => Promise<Step>;

function scriptedCursor(
  command: Document,
  options: RunCursorCommandOptions | undefined,
  answer: CursorAnswer,
): ScriptedCursor {
  const calls: string[] = [];
  let id: BSON.Long | undefined;
  let buffered: Uint8Array[] = [];
  let index = 0;
  return {
    command,
    options,
    calls,
    get id() {
      return id;
    },
    async hasNext() {
      calls.push('hasNext');
      const step = await answer(index++);
      buffered = step.docs.map((doc) => BSON.serialize(doc));
      id = step.more ? BSON.Long.fromNumber(77) : BSON.Long.ZERO;
      return buffered.length > 0;
    },
    readBufferedDocuments() {
      const docs = buffered;
      buffered = [];
      return docs;
    },
    setComment(comment: unknown) {
      calls.push(`setComment:${String(comment)}`);
    },
    setBatchSize(size: number) {
      calls.push(`setBatchSize:${size}`);
    },
    close() {
      calls.push('close');
      return Promise.resolve();
    },
  };
}

type Answer = (db: string, command: Document) => Document | Promise<Document>;

/**
 * A fake client like a real `MongoClient` on a profile with a read preference and a write
 * concern: every database carries them and has `runCursorCommand`.
 */
function profileClient(
  answer: Answer,
  cursorAnswer: CursorAnswer = () => Promise.resolve({ docs: [], more: false }),
  defaults: { readPreference?: ReadPreference; writeConcern?: WriteConcern } = {
    readPreference: SECONDARY,
    writeConcern: new WriteConcern(2, 1000, true),
  },
): ClientLike & { sent: Sent[]; cursors: ScriptedCursor[] } {
  const sent: Sent[] = [];
  const cursors: ScriptedCursor[] = [];
  return {
    sent,
    cursors,
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: (db: string): DbLike => ({
      ...(defaults.readPreference ? { readPreference: defaults.readPreference } : {}),
      ...(defaults.writeConcern ? { writeConcern: defaults.writeConcern } : {}),
      command: async (command: Document, options?: RunCommandOptions) => {
        sent.push({ db, command, options });
        return answer(db, command);
      },
      runCursorCommand: (command: Document, options?: RunCursorCommandOptions) => {
        const cursor = scriptedCursor(command, options, cursorAnswer);
        cursors.push(cursor);
        return cursor;
      },
    }),
  };
}

const firstKey = (doc: Document) => Object.keys(doc)[0];
const commandsOf = (client: { sent: Sent[] }) => client.sent.map((s) => firstKey(s.command));
const docs = (...ids: number[]) => ids.map((i) => ({ _id: new BSON.Int32(i) }));
const ready = (step: Step) => Promise.resolve(step);

/** Answers currentOp with one operation (so a cancel stops looking at once), else ok. */
const killable: Answer = (_db, command) =>
  'currentOp' in command ? { inprog: [{ opid: 501 }], ok: 1 } : { ok: 1 };

describe('Operation reads and writes (profile read preference / write concern)', () => {
  it('run() sends the profile read preference; write() sends none and adds the write concern', async () => {
    const client = profileClient(() => ({ n: 1, ok: 1 }));
    const op = new Operation(client, 'shop', 'orders', undefined);
    await op.run({ count: 'orders' });
    await op.write({ insert: 'orders', documents: [{ _id: 1 }] });
    await op.close();
    const [read, write] = client.sent;
    expect(read?.options?.readPreference).toBe(SECONDARY);
    expect(read?.command).not.toHaveProperty('writeConcern');
    expect(write?.options?.readPreference).toBeUndefined();
    expect(write?.command).toEqual({
      insert: 'orders',
      documents: [{ _id: 1 }],
      writeConcern: { w: 2, j: true, wtimeout: 1000 },
      comment: op.comment,
    });
  });

  it('write() keeps a write concern the command names itself', async () => {
    const client = profileClient(() => ({ n: 1, ok: 1 }));
    const op = new Operation(client, 'shop', 'orders', undefined);
    await op.write({ delete: 'orders', deletes: [], writeConcern: { w: 1 } });
    expect(client.sent[0]?.command['writeConcern']).toEqual({ w: 1 });
  });

  it('without profile defaults run() and write() send neither (primary, server default)', async () => {
    const client = profileClient(() => ({ n: 1, ok: 1 }), undefined, {});
    const op = new Operation(client, 'shop', 'orders', undefined);
    await op.run({ count: 'orders' });
    await op.write({ insert: 'orders', documents: [] });
    expect(client.sent.map((s) => s.options?.readPreference)).toEqual([undefined, undefined]);
    expect(client.sent[1]?.command).not.toHaveProperty('writeConcern');
  });

  it('the primary option reads from the primary (run and open)', async () => {
    const client = profileClient(
      () => ({ n: 1, ok: 1 }),
      () => ready({ docs: docs(1), more: false }),
    );
    const op = new Operation(client, 'shop', 'orders', undefined, { primary: true });
    await op.run({ count: 'orders' });
    expect(await op.open({ find: 'orders' })).toEqual(docs(1));
    await op.close();
    expect(client.sent[0]?.options?.readPreference).toBe(ReadPreference.primary);
    expect(client.cursors[0]?.options).toEqual({
      raw: true,
      readPreference: ReadPreference.primary,
    });
  });

  it('open()/more() use one driver cursor with the read preference, comment and batch size', async () => {
    const steps = [
      { docs: docs(1, 2), more: true },
      { docs: docs(3), more: true },
      { docs: docs(4), more: false },
    ];
    const client = profileClient(
      () => {
        throw new Error('no plain command expected');
      },
      (i) => ready(steps[i] ?? { docs: [], more: false }),
    );
    const op = new Operation(client, 'shop', 'orders', undefined);
    expect(await op.open({ find: 'orders', filter: {} })).toEqual(docs(1, 2));
    expect(op.hasMore).toBe(true);
    expect(await op.more(5)).toEqual(docs(3));
    expect(await op.more()).toEqual(docs(4));
    expect(op.hasMore).toBe(false);
    expect(await op.more()).toEqual([]);
    await op.close();
    expect(client.sent).toEqual([]);
    expect(client.cursors).toHaveLength(1);
    const [cursor] = client.cursors;
    expect(cursor?.command).toEqual({ find: 'orders', filter: {}, comment: op.comment });
    expect(cursor?.options).toEqual({ raw: true, readPreference: SECONDARY });
    expect(cursor?.calls).toEqual([
      `setComment:${op.comment}`,
      'hasNext',
      'setBatchSize:5',
      'hasNext',
      'hasNext',
      'close',
    ]);
  });

  it('opening a second cursor closes the first one before it runs', async () => {
    const client = profileClient(
      () => ({ ok: 1 }),
      () => ready({ docs: docs(1), more: true }),
    );
    const op = new Operation(client, 'shop', 'orders', undefined);
    await op.open({ find: 'orders' });
    await op.open({ find: 'orders', skip: 1 });
    expect(client.cursors[0]?.calls.at(-1)).toBe('close');
    expect(client.cursors[1]?.calls).not.toContain('close');
    await op.close();
    expect(client.cursors[1]?.calls.at(-1)).toBe('close');
  });

  it('an already aborted signal rejects open() and more() without sending anything', async () => {
    const controller = new AbortController();
    const client = profileClient(
      () => ({ ok: 1 }),
      () => ready({ docs: docs(1), more: true }),
    );
    const op = new Operation(client, 'shop', 'orders', controller.signal);
    await op.open({ find: 'orders' });
    controller.abort();
    expect((await rejection(op.more())).code).toBe('CANCELLED');
    expect((await rejection(op.open({ find: 'orders' }))).code).toBe('CANCELLED');
    expect((await rejection(op.write({ insert: 'orders', documents: [] }))).code).toBe('CANCELLED');
    expect(client.cursors).toHaveLength(1);
    expect(client.cursors[0]?.calls).toEqual([`setComment:${op.comment}`, 'hasNext']);
    expect(client.sent).toEqual([]);
    await op.close();
  });

  it('a failing batch without an abort is a SERVER_ERROR and leaves no cleanup', async () => {
    const client = profileClient(
      () => ({ ok: 1 }),
      () =>
        Promise.reject(
          new MongoServerError({ ok: 0, code: 96, codeName: 'OperationFailed', errmsg: 'boom' }),
        ),
    );
    const op = new Operation(client, 'shop', 'orders', new AbortController().signal);
    expect((await rejection(op.open({ find: 'orders' }))).code).toBe('SERVER_ERROR');
    await op.close();
    expect(client.sent).toEqual([]);
  });
});

describe('Operation cancel with a driver cursor', () => {
  it('cancel during the first batch: killOp with the read preference, cursor closed after the batch settles', async () => {
    const first = deferred<Step>();
    const client = profileClient(killable, () => first.promise);
    const controller = new AbortController();
    const op = new Operation(client, 'shop', 'orders', controller.signal);
    const opening = op.open({ find: 'orders' });
    await vi.waitFor(() => expect(client.cursors[0]?.calls).toContain('hasNext'));
    controller.abort();
    expect((await rejection(opening)).code).toBe('CANCELLED');
    expect(op.hasMore).toBe(false);
    await vi.waitFor(() => expect(commandsOf(client)).toEqual(['currentOp', 'killOp']));
    for (const sent of client.sent) {
      expect(sent.db).toBe('admin');
      expect(sent.options?.readPreference).toBe(SECONDARY);
    }
    expect(client.sent[0]?.command).toEqual({ currentOp: 1, 'command.comment': op.comment });
    expect(client.sent[1]?.command).toEqual({ killOp: 1, op: 501 });
    // The batch is still in flight: the cursor is not closed under it.
    expect(client.cursors[0]?.calls).not.toContain('close');

    first.resolve({ docs: docs(1), more: true });
    await op.close();
    expect(client.cursors[0]?.calls.filter((c) => c === 'close')).toHaveLength(1);
    expect(client.cursors[0]?.calls.at(-1)).toBe('close');
  });

  it('cancel during a getMore: the same cursor is closed once its batch settles', async () => {
    const second = deferred<Step>();
    const client = profileClient(killable, (i) =>
      i === 0 ? ready({ docs: docs(1), more: true }) : second.promise,
    );
    const controller = new AbortController();
    const op = new Operation(client, 'shop', 'orders', controller.signal);
    expect(await op.open({ find: 'orders' })).toEqual(docs(1));
    const next = op.more(10);
    await vi.waitFor(() =>
      expect(client.cursors[0]?.calls.filter((c) => c === 'hasNext')).toHaveLength(2),
    );
    controller.abort();
    expect((await rejection(next)).code).toBe('CANCELLED');
    expect(op.hasMore).toBe(false);
    await vi.waitFor(() => expect(commandsOf(client)).toContain('killOp'));
    expect(client.sent.every((s) => s.options?.readPreference === SECONDARY)).toBe(true);
    expect(client.cursors[0]?.calls).not.toContain('close');

    second.resolve({ docs: docs(2), more: true });
    await op.close();
    expect(client.cursors).toHaveLength(1);
    expect(client.cursors[0]?.calls).toEqual([
      `setComment:${op.comment}`,
      'hasNext',
      'setBatchSize:10',
      'hasNext',
      'close',
    ]);
  });

  it.each([
    ['first batch', 0],
    ['getMore', 1],
  ])(
    'cancel during the %s, close() at once: the cursor is closed only after the batch settles',
    async (_name, pendingCall) => {
      const pending = deferred<Step>();
      const client = profileClient(killable, (i) =>
        i < pendingCall ? ready({ docs: docs(1), more: true }) : pending.promise,
      );
      const controller = new AbortController();
      const op = new Operation(client, 'shop', 'orders', controller.signal);
      const fetching = op.open({ find: 'orders' });
      if (pendingCall === 0) {
        await vi.waitFor(() => expect(client.cursors[0]?.calls).toContain('hasNext'));
      } else {
        await fetching;
      }
      const batch = pendingCall === 0 ? fetching : op.more();
      await vi.waitFor(() =>
        expect(client.cursors[0]?.calls.filter((c) => c === 'hasNext')).toHaveLength(
          pendingCall + 1,
        ),
      );
      controller.abort();
      expect((await rejection(batch)).code).toBe('CANCELLED');
      await vi.waitFor(() => expect(commandsOf(client)).toContain('killOp'));

      // The caller closes the operation at once: the cursor must not be closed under the
      // pending batch (the driver would end its session and skip killCursors, leaking it).
      let closed = false;
      const closing = op.close().then(() => {
        closed = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(closed).toBe(false);
      expect(client.cursors[0]?.calls).not.toContain('close');

      pending.resolve({ docs: docs(2), more: true });
      await closing;
      expect(client.cursors).toHaveLength(1);
      expect(client.cursors[0]?.calls.filter((c) => c === 'close')).toHaveLength(1);
      expect(client.cursors[0]?.calls.at(-1)).toBe('close');
    },
  );

  it('cancel during a getMore that then fails still closes the cursor', async () => {
    const second = deferred<Step>();
    const client = profileClient(killable, (i) =>
      i === 0 ? ready({ docs: docs(1), more: true }) : second.promise,
    );
    const controller = new AbortController();
    const op = new Operation(client, 'shop', 'orders', controller.signal);
    await op.open({ find: 'orders' });
    const next = op.more();
    await vi.waitFor(() =>
      expect(client.cursors[0]?.calls.filter((c) => c === 'hasNext')).toHaveLength(2),
    );
    controller.abort();
    expect((await rejection(next)).code).toBe('CANCELLED');
    second.reject(
      new MongoServerError({ ok: 0, code: 11601, codeName: 'Interrupted', errmsg: 'killed' }),
    );
    await op.close();
    expect(client.cursors[0]?.calls.at(-1)).toBe('close');
  });

  it('a cancelled primary-read operation looks for the command with the primary read preference', async () => {
    const first = deferred<Step>();
    const client = profileClient(killable, () => first.promise);
    const controller = new AbortController();
    const op = new Operation(client, 'shop', 'orders', controller.signal, { primary: true });
    const opening = op.open({ find: 'orders' });
    await vi.waitFor(() => expect(client.cursors[0]?.calls).toContain('hasNext'));
    controller.abort();
    expect((await rejection(opening)).code).toBe('CANCELLED');
    await vi.waitFor(() => expect(commandsOf(client)).toContain('killOp'));
    expect(client.sent.map((s) => s.options?.readPreference)).toEqual([
      ReadPreference.primary,
      ReadPreference.primary,
    ]);
    first.resolve({ docs: [], more: false });
    await op.close();
  });

  it('a failing killCursors of a late run() reply does not fail close()', async () => {
    const reply = deferred<Document>();
    const client = profileClient((db, command) => {
      if ('aggregate' in command) return reply.promise;
      if ('killCursors' in command) throw new Error('cursor gone');
      return killable(db, command);
    });
    const controller = new AbortController();
    const op = new Operation(client, 'shop', 'orders', controller.signal);
    const running = op.run({ aggregate: 'orders', pipeline: [], cursor: {} });
    await vi.waitFor(() => expect(client.sent).toHaveLength(1));
    controller.abort();
    expect((await rejection(running)).code).toBe('CANCELLED');
    reply.resolve({ cursor: { id: BSON.Long.fromNumber(32), firstBatch: [] }, ok: 1 });
    await expect(op.close()).resolves.toBeUndefined();
    expect(commandsOf(client)).toContain('killCursors');
  });

  it('a cancelled run() whose late reply opened a cursor kills it with the read preference', async () => {
    const reply = deferred<Document>();
    const client = profileClient((db, command) => {
      if ('aggregate' in command) return reply.promise;
      return killable(db, command);
    });
    const controller = new AbortController();
    const op = new Operation(client, 'shop', 'orders', controller.signal);
    const running = op.run({ aggregate: 'orders', pipeline: [], cursor: {} });
    await vi.waitFor(() => expect(client.sent).toHaveLength(1));
    controller.abort();
    expect((await rejection(running)).code).toBe('CANCELLED');
    await vi.waitFor(() => expect(commandsOf(client)).toContain('killOp'));
    reply.resolve({
      cursor: { id: BSON.Long.fromNumber(31), ns: 'shop.orders', firstBatch: [] },
      ok: 1,
    });
    await op.close();
    expect(commandsOf(client)).toEqual(['aggregate', 'currentOp', 'killOp', 'killCursors']);
    const kill = client.sent[3];
    expect(kill?.db).toBe('shop');
    expect(kill?.command).toEqual({ killCursors: 'orders', cursors: [BSON.Long.fromNumber(31)] });
    expect(kill?.options?.readPreference).toBe(SECONDARY);
  });

  it('a cancelled write() looks for the command on the primary (no read preference)', async () => {
    const reply = deferred<Document>();
    const client = profileClient((db, command) => {
      if ('insert' in command) return reply.promise;
      return killable(db, command);
    });
    const controller = new AbortController();
    const op = new Operation(client, 'shop', 'orders', controller.signal);
    const writing = op.write({ insert: 'orders', documents: [{ _id: 1 }] });
    await vi.waitFor(() => expect(client.sent).toHaveLength(1));
    controller.abort();
    expect((await rejection(writing)).code).toBe('CANCELLED');
    await vi.waitFor(() => expect(commandsOf(client)).toContain('killOp'));
    reply.resolve({ n: 1, ok: 1 });
    await op.close();
    expect(commandsOf(client)).toEqual(['insert', 'currentOp', 'killOp']);
    expect(client.sent.map((s) => s.options?.readPreference)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('killOperations with a read preference', () => {
  it('sends currentOp, the $ownOps retry and killOp with the given read preference', async () => {
    let calls = 0;
    const client = profileClient((_db, command) => {
      if ('currentOp' in command) {
        calls++;
        if (calls === 1)
          throw new MongoServerError({
            ok: 0,
            code: 13,
            codeName: 'Unauthorized',
            errmsg: 'not authorized',
          });
        return { inprog: [{ opid: 9 }], ok: 1 };
      }
      return { ok: 1 };
    });
    await expect(killOperations(client, 'thicket:abc', SECONDARY)).resolves.toBe(1);
    expect(commandsOf(client)).toEqual(['currentOp', 'currentOp', 'killOp']);
    expect(client.sent.every((s) => s.options?.readPreference === SECONDARY)).toBe(true);
  });
});

describe('countDocuments options', () => {
  it('follows the read preference by default and the primary with { primary: true }', async () => {
    const client = profileClient(
      () => ({ ok: 1 }),
      () => ready({ docs: [{ _id: 1, n: new BSON.Int32(3) }], more: false }),
    );
    const params = { profileId: 'p1', db: 'shop', coll: 'orders', filter: '{}' };
    await expect(countDocuments(client, params)).resolves.toEqual({ count: 3 });
    await expect(countDocuments(client, params, undefined, { primary: true })).resolves.toEqual({
      count: 3,
    });
    expect(client.cursors.map((c) => c.options?.readPreference)).toEqual([
      SECONDARY,
      ReadPreference.primary,
    ]);
    expect(client.cursors.every((c) => c.calls.at(-1) === 'close')).toBe(true);
  });
});

describe('write concern errors', () => {
  const wceReply = {
    n: 1,
    ok: 1,
    writeConcernError: {
      code: 100,
      codeName: 'UnsatisfiableWriteConcern',
      errmsg: 'Not enough data-bearing nodes',
    },
  };

  it('a MongoWriteConcernError answers its reply (the write was applied)', async () => {
    const client = profileClient(() => {
      throw new MongoWriteConcernError(wceReply);
    });
    const op = new Operation(client, 'shop', 'orders', undefined);
    await expect(op.write({ insert: 'orders', documents: [{ _id: 1 }] })).resolves.toEqual(
      wceReply,
    );
  });

  it('other server errors of a write are still SERVER_ERROR', async () => {
    const client = profileClient(() => {
      throw new MongoServerError({ ok: 0, code: 112, codeName: 'WriteConflict', errmsg: 'no' });
    });
    const op = new Operation(client, 'shop', 'orders', undefined);
    const error = await rejection(op.write({ insert: 'orders', documents: [] }));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toEqual({ serverCode: 112, codeName: 'WriteConflict' });
  });
});
