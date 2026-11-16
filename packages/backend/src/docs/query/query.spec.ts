import type { ParsedParamsOf } from '@thicket/contract';
import { andFilter, rangeQuery } from '@thicket/core';
import { BSON, MongoServerError, type Document, type RunCommandOptions } from 'mongodb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClientLike } from '../../connections/manager';
import { RpcError } from '../../server/rpc';
import {
  DEFAULT_EVENT_BATCH,
  Operation,
  buildFind,
  countDocuments,
  estimatedCount,
  getDocument,
  getSlice,
  killOperations,
  operationToken,
  parseDocument,
  parseEjson,
  streamFind,
} from './query';

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
const findParams = (
  extra: Partial<ParsedParamsOf<'docs.find'>> = {},
): ParsedParamsOf<'docs.find'> => ({ ...target, filter: '{}', ...extra });

const unauthorized = () =>
  new MongoServerError({ ok: 0, code: 13, codeName: 'Unauthorized', errmsg: 'not authorized' });

afterEach(() => {
  vi.useRealTimers();
});

describe('operationToken / parseEjson / parseDocument', () => {
  it('operation tokens are unique thicket: comments', () => {
    const a = operationToken();
    expect(a).toMatch(/^thicket:[0-9a-f]{18}$/);
    expect(operationToken()).not.toBe(a);
  });

  it('parses canonical EJSON; relaxed turns numbers into JS numbers', () => {
    expect(parseEjson('{"n":{"$numberInt":"1"}}', 'x')).toEqual({ n: new BSON.Int32(1) });
    expect(parseEjson('{"n":{"$numberInt":"1"}}', 'x', true)).toEqual({ n: 1 });
  });

  it('refuses invalid EJSON and value wrappers as documents with INVALID_PARAMS', () => {
    const invalid = thrown(() => parseEjson('{"a":', 'filter'));
    expect(invalid.code).toBe('INVALID_PARAMS');
    expect(invalid.message).toMatch(/^filter is not valid EJSON: /);
    for (const text of ['{"$oid":"64b7f0a1e4b0c1a2b3c4d5e6"}', '[1]', '"x"', 'null']) {
      const error = thrown(() => parseDocument(text, 'sort'));
      expect(error.code).toBe('INVALID_PARAMS');
      expect(error.message).toBe('sort must be an EJSON document');
    }
    expect(parseDocument('{"a":"b"}', 'filter')).toEqual({ a: 'b' });
  });
});

describe('buildFind', () => {
  it('a plain query sends only find and filter, in natural order', () => {
    const built = buildFind(findParams({ filter: '{"status":"open"}' }));
    expect(built).toEqual({
      command: { find: 'orders', filter: { status: 'open' } },
      reverse: false,
    });
  });

  it('passes skip, limit, batchSize, collation, hint and maxTimeMS through', () => {
    const { command, reverse } = buildFind(
      findParams({
        sort: '{"name":{"$numberInt":"1"}}',
        skip: 40,
        limit: 20,
        batchSize: 7,
        collation: '{"locale":"de","strength":{"$numberInt":"2"}}',
        hint: '{"name":{"$numberInt":"1"}}',
        maxTimeMS: 1500,
      }),
    );
    expect(reverse).toBe(false);
    expect(command).toEqual({
      find: 'orders',
      filter: {},
      sort: { name: 1 },
      skip: 40,
      limit: 20,
      batchSize: 7,
      collation: { locale: 'de', strength: 2 },
      hint: { name: 1 },
      maxTimeMS: 1500,
    });
  });

  it('accepts an index name as hint; skip 0 and limit 0 are left out', () => {
    const { command } = buildFind(findParams({ hint: '"status_1"', skip: 0, limit: 0 }));
    expect(command).toEqual({ find: 'orders', filter: {}, hint: 'status_1' });
  });

  it('after: filters past the bound with the sort as given', () => {
    const { command, reverse } = buildFind(
      findParams({
        filter: '{"status":"open"}',
        sort: '{"_id":{"$numberInt":"1"}}',
        after: '{"_id":{"$numberInt":"5"}}',
        limit: 10,
      }),
    );
    expect(reverse).toBe(false);
    expect(command['sort']).toEqual({ _id: 1 });
    expect(command['limit']).toBe(10);
    expect(command).not.toHaveProperty('skip');
    expect(command['filter']).toEqual({
      $and: [{ status: 'open' }, { _id: { $gt: new BSON.Int32(5) } }],
    });
  });

  it('before: reads backwards with the reversed sort and reverses the rows', () => {
    const sort = [
      { field: 'score', direction: -1 as const },
      { field: '_id', direction: 1 as const },
    ];
    const bound = { score: new BSON.Int32(80), _id: new BSON.Int32(12) };
    const { command, reverse } = buildFind(
      findParams({
        sort: '{"score":{"$numberInt":"-1"},"_id":{"$numberInt":"1"}}',
        before: ejson(bound),
        limit: 3,
      }),
    );
    expect(reverse).toBe(true);
    expect(command['sort']).toEqual({ score: 1, _id: -1 });
    expect(Object.keys(command['sort'] as Document)).toEqual(['score', '_id']);
    expect(command['filter']).toEqual(andFilter({}, rangeQuery(sort, bound, 'before').filter));
    expect(command['limit']).toBe(3);
  });

  it('fromEnd: the last page with the reversed sort, the filter unchanged', () => {
    const { command, reverse } = buildFind(
      findParams({
        filter: '{"status":"open"}',
        sort: '{"score":{"$numberInt":"-1"},"_id":{"$numberInt":"1"}}',
        fromEnd: true,
        limit: 25,
      }),
    );
    expect(reverse).toBe(true);
    expect(command).toEqual({
      find: 'orders',
      filter: { status: 'open' },
      sort: { score: 1, _id: -1 },
      limit: 25,
    });
  });

  it('range paging without a sort uses {_id: 1}', () => {
    expect(buildFind(findParams({ fromEnd: true, limit: 5 })).command['sort']).toEqual({
      _id: -1,
    });
    const after = buildFind(findParams({ sort: '{}', after: '{"_id":{"$numberInt":"9"}}' }));
    expect(after.command['sort']).toEqual({ _id: 1 });
    expect(after.command['filter']).toEqual({ _id: { $gt: new BSON.Int32(9) } });
  });

  it('fromEnd: false is plain paging', () => {
    const { command, reverse } = buildFind(
      findParams({ sort: '{"_id":{"$numberInt":"1"}}', fromEnd: false, skip: 3 }),
    );
    expect(reverse).toBe(false);
    expect(command).toEqual({ find: 'orders', filter: {}, sort: { _id: 1 }, skip: 3 });
  });

  it.each([
    ['after', { after: '{"score":{"$numberInt":"1"}}' }],
    ['before', { before: '{"score":{"$numberInt":"1"}}' }],
    ['fromEnd', { fromEnd: true }],
  ])('refuses %s with an opaque sort', (_name, extra) => {
    const error = thrown(() =>
      buildFind(findParams({ sort: '{"score":{"$meta":"textScore"}}', limit: 10, ...extra })),
    );
    expect(error.code).toBe('INVALID_PARAMS');
    expect(error.message).toMatch(/needs a sort of plain directions/);
  });

  it('sends an opaque sort as given with skip paging, without widening the projection', () => {
    const { command, reverse } = buildFind(
      findParams({
        filter: '{"$text":{"$search":"lamp"}}',
        sort: '{"score":{"$meta":"textScore"}}',
        projection: '{"name":{"$numberInt":"1"}}',
        skip: 10,
      }),
    );
    expect(reverse).toBe(false);
    expect(command['sort']).toEqual({ score: { $meta: 'textScore' } });
    expect(command['projection']).toEqual({ name: 1 });
    expect(command['skip']).toBe(10);
  });

  it.each(['after', 'before'] as const)('refuses a %s bound that lacks a sort key', (side) => {
    const error = thrown(() =>
      buildFind(
        findParams({
          sort: '{"score":{"$numberInt":"1"},"_id":{"$numberInt":"1"}}',
          [side]: '{"_id":{"$numberInt":"4"}}',
          limit: 10,
        }),
      ),
    );
    expect(error.code).toBe('INVALID_PARAMS');
    expect(error.message).toBe(`${side} has no value for sort key "score"`);
  });

  it('a bound for the default sort must carry _id', () => {
    const error = thrown(() =>
      buildFind(findParams({ before: '{"score":{"$numberInt":"1"}}', limit: 10 })),
    );
    expect(error.message).toBe('before has no value for sort key "_id"');
  });

  it.each([
    ['before without limit', { before: '{"_id":{"$numberInt":"4"}}' }],
    ['before with limit 0', { before: '{"_id":{"$numberInt":"4"}}', limit: 0 }],
    ['fromEnd without limit', { fromEnd: true }],
    ['fromEnd with limit 0', { fromEnd: true, limit: 0 }],
  ])('refuses %s (the backward read would buffer everything)', (_name, extra) => {
    const error = thrown(() => buildFind(findParams(extra)));
    expect(error.code).toBe('INVALID_PARAMS');
    expect(error.message).toBe('before and fromEnd need a limit (the page size)');
  });

  it('after needs no limit (rows stream in sort order)', () => {
    expect(() => buildFind(findParams({ after: '{"_id":{"$numberInt":"4"}}' }))).not.toThrow();
  });

  it('a bound key whose value is null still counts as present', () => {
    const { command } = buildFind(
      findParams({ sort: '{"group":{"$numberInt":"1"}}', after: '{"group":null}' }),
    );
    expect(command['sort']).toEqual({ group: 1 });
  });

  it('refuses invalid EJSON in every query part with INVALID_PARAMS', () => {
    const parts: Partial<ParsedParamsOf<'docs.find'>>[] = [
      { filter: '{"a":' },
      { sort: '{"a":' },
      { projection: '{"a":' },
      { collation: '{"locale":' },
      { hint: '{"a":' },
      { after: '{"_id":', sort: '{"_id":{"$numberInt":"1"}}' },
      { filter: '{"$oid":"64b7f0a1e4b0c1a2b3c4d5e6"}' },
    ];
    for (const extra of parts) {
      expect(thrown(() => buildFind(findParams(extra))).code).toBe('INVALID_PARAMS');
    }
  });

  describe('projection widening', () => {
    const SORT = '{"score":{"$numberInt":"1"},"_id":{"$numberInt":"1"}}';

    it('adds sort keys an inclusion projection leaves out', () => {
      const { command } = buildFind(
        findParams({
          sort: SORT,
          projection: '{"name":{"$numberInt":"1"},"_id":{"$numberInt":"0"}}',
        }),
      );
      // `_id: 0` is dropped: `_id` is returned by default.
      expect(command['projection']).toEqual({ name: 1, score: 1 });
    });

    it('drops exclusions of sort keys, keeping the others', () => {
      const { command } = buildFind(
        findParams({
          sort: SORT,
          projection: '{"score":{"$numberInt":"0"},"secret":{"$numberInt":"0"}}',
        }),
      );
      expect(command['projection']).toEqual({ secret: 0 });
    });

    it('leaves no projection when only sort keys were excluded', () => {
      const { command } = buildFind(
        findParams({ fromEnd: true, limit: 5, projection: '{"_id":{"$numberInt":"0"}}' }),
      );
      expect(command).not.toHaveProperty('projection');
    });

    it('also widens in skip mode (page 1 cannot tell the modes apart)', () => {
      const { command } = buildFind(
        findParams({ sort: SORT, skip: 20, projection: '{"name":{"$numberInt":"1"}}' }),
      );
      expect(command['projection']).toEqual({ name: 1, score: 1 });
    });

    it('keeps the projection as given without a sort; an empty one is left out', () => {
      expect(
        buildFind(findParams({ projection: '{"score":{"$numberInt":"0"}}' })).command['projection'],
      ).toEqual({ score: 0 });
      expect(buildFind(findParams({ projection: '{}', sort: SORT })).command).not.toHaveProperty(
        'projection',
      );
    });
  });
});

describe('streamFind', () => {
  it('runs find and getMore with one comment and sends batches of batchSize in order', async () => {
    const client = fakeClient((_db, command) => {
      if ('find' in command) return cursorReply(BSON.Long.fromNumber(42), docs(1, 2, 3));
      if ('getMore' in command) return cursorReply(0, docs(4, 5), false);
      throw new Error(`unexpected ${firstKey(command)}`);
    });
    const batches: { docs: string[] }[] = [];
    const delivered = await streamFind(
      client,
      findParams({ batchSize: 2, sort: '{"_id":{"$numberInt":"1"}}' }),
      (b) => batches.push(b),
    );
    expect(delivered).toBe(5);
    expect(idsOfBatches(batches)).toEqual([[1, 2], [3], [4, 5]]);
    expect(batches[0]?.docs[0]).toBe('{"_id":{"$numberInt":"1"}}');
    expect(commandsOf(client)).toEqual(['find', 'getMore']);
    const [find, getMore] = client.sent;
    expect(find?.db).toBe('shop');
    expect(find?.options).toMatchObject({ promoteLongs: false });
    expect(find?.command).toMatchObject({ find: 'orders', batchSize: 2, sort: { _id: 1 } });
    expect(getMore?.command).toEqual({
      getMore: BSON.Long.fromNumber(42),
      collection: 'orders',
      batchSize: 2,
      comment: find?.command['comment'],
    });
    expect(String(find?.command['comment'])).toMatch(/^thicket:/);
  });

  it(`splits batches into events of ${DEFAULT_EVENT_BATCH} documents without batchSize`, async () => {
    const many = docs(...Array.from({ length: 250 }, (_, i) => i));
    const client = fakeClient(() => cursorReply(0, many));
    const sizes: number[] = [];
    const delivered = await streamFind(client, findParams(), (b) => sizes.push(b.docs.length));
    expect(delivered).toBe(250);
    expect(sizes).toEqual([100, 100, 50]);
    // An exhausted cursor needs no getMore and no killCursors; getMore has no batchSize.
    expect(commandsOf(client)).toEqual(['find']);
  });

  it('keeps calling getMore while the cursor stays open', async () => {
    let getMores = 0;
    const client = fakeClient((_db, command) => {
      if ('find' in command) return cursorReply(6, docs(1));
      getMores++;
      return cursorReply(getMores < 3 ? 6 : 0, docs(1 + getMores), false);
    });
    const batches: { docs: string[] }[] = [];
    await expect(streamFind(client, findParams(), (b) => batches.push(b))).resolves.toBe(4);
    expect(idsOfBatches(batches)).toEqual([[1], [2], [3], [4]]);
    expect(commandsOf(client)).toEqual(['find', 'getMore', 'getMore', 'getMore']);
  });

  it('getMore carries no batchSize when none was given', async () => {
    const client = fakeClient((_db, command) =>
      'find' in command ? cursorReply(9, docs(1)) : cursorReply(0, docs(2), false),
    );
    await streamFind(client, findParams(), () => undefined);
    expect(client.sent[1]?.command).not.toHaveProperty('batchSize');
  });

  it('an empty result sends no data and delivers 0', async () => {
    const client = fakeClient(() => cursorReply(0, []));
    const send = vi.fn();
    await expect(streamFind(client, findParams(), send)).resolves.toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('rows read backwards (before) are collected over all batches and sent in display order', async () => {
    const client = fakeClient((_db, command) =>
      'find' in command ? cursorReply(7, docs(9, 8)) : cursorReply(0, docs(7), false),
    );
    const batches: { docs: string[] }[] = [];
    const delivered = await streamFind(
      client,
      findParams({ before: '{"_id":{"$numberInt":"10"}}', limit: 3 }),
      (b) => batches.push(b),
    );
    expect(delivered).toBe(3);
    expect(idsOfBatches(batches)).toEqual([[7, 8, 9]]);
    expect(client.sent[0]?.command['sort']).toEqual({ _id: -1 });
  });

  it('fromEnd rows come in display order, split by batchSize', async () => {
    const client = fakeClient(() => cursorReply(0, docs(5, 4, 3)));
    const batches: { docs: string[] }[] = [];
    await streamFind(client, findParams({ fromEnd: true, limit: 3, batchSize: 2 }), (b) =>
      batches.push(b),
    );
    expect(idsOfBatches(batches)).toEqual([[3, 4], [5]]);
  });

  it('uses a prebuilt command when given', async () => {
    const client = fakeClient(() => cursorReply(0, []));
    const built = { command: { find: 'orders', filter: { prebuilt: true } }, reverse: false };
    await streamFind(
      client,
      findParams({ filter: '{"$oid":"bad"}' }),
      () => undefined,
      undefined,
      built,
    );
    expect(client.sent[0]?.command).toMatchObject({ filter: { prebuilt: true } });
  });

  it('a server error mid-stream rejects SERVER_ERROR and kills the open cursor', async () => {
    const client = fakeClient((_db, command) => {
      if ('find' in command) return cursorReply(42, docs(1));
      if ('getMore' in command) {
        throw new MongoServerError({ ok: 0, code: 2, codeName: 'BadValue', errmsg: 'bad' });
      }
      return { ok: 1 };
    });
    const send = vi.fn();
    const error = await rejection(streamFind(client, findParams(), send));
    expect(error.code).toBe('SERVER_ERROR');
    expect(send).toHaveBeenCalledTimes(1);
    expect(commandsOf(client)).toEqual(['find', 'getMore', 'killCursors']);
    expect(client.sent[2]?.command).toEqual({ killCursors: 'orders', cursors: [42] });
  });

  it('a reply without a cursor is INTERNAL', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    const error = await rejection(streamFind(client, findParams(), () => undefined));
    expect(error.code).toBe('INTERNAL');
  });

  it('a failing find rejects with the mapped server error and sends nothing', async () => {
    const client = fakeClient(() => {
      throw new MongoServerError({ ok: 0, code: 26, codeName: 'NamespaceNotFound', errmsg: 'x' });
    });
    expect((await rejection(streamFind(client, findParams(), () => undefined))).code).toBe(
      'NOT_FOUND',
    );
  });
});

describe('Operation cancel', () => {
  /** Answers currentOp with `ops`, the find with `find` (pending until resolved). */
  function cancellable(find: Promise<Document>, ops: Document[] = [{ opid: 101 }]) {
    return fakeClient((_db, command) => {
      if ('find' in command || 'getMore' in command || 'aggregate' in command) return find;
      if ('currentOp' in command) return { inprog: ops, ok: 1 };
      return { ok: 1 };
    });
  }

  it('a signal aborted before the start rejects CANCELLED without sending anything', async () => {
    const client = cancellable(new Promise(() => undefined));
    const controller = new AbortController();
    controller.abort();
    const error = await rejection(
      streamFind(client, findParams(), () => undefined, controller.signal),
    );
    expect(error.code).toBe('CANCELLED');
    expect(client.sent).toEqual([]);
  });

  it('abort during find: killOp by comment, then killCursors once the cursor id is known', async () => {
    const find = deferred<Document>();
    const client = cancellable(find.promise, [{ opid: 101 }, { opid: 102 }, { noOpid: true }]);
    const controller = new AbortController();
    const running = streamFind(client, findParams(), () => undefined, controller.signal);
    await vi.waitFor(() => expect(commandsOf(client)).toEqual(['find']));
    const comment = client.sent[0]?.command['comment'] as string;
    controller.abort();
    await vi.waitFor(() => expect(commandsOf(client)).toContain('killOp'));
    expect(client.sent[1]).toMatchObject({
      db: 'admin',
      command: { currentOp: 1, 'command.comment': comment },
    });
    expect(client.sent.filter((s) => 'killOp' in s.command).map((s) => s.command)).toEqual([
      { killOp: 1, op: 101 },
      { killOp: 1, op: 102 },
    ]);
    // The interrupted find answers late with an open cursor: it is killed.
    find.resolve(cursorReply(BSON.Long.fromNumber(77), docs(1)));
    const error = await rejection(running);
    expect(error.code).toBe('CANCELLED');
    expect(client.sent.at(-1)).toEqual({
      db: 'shop',
      command: { killCursors: 'orders', cursors: [BSON.Long.fromNumber(77)] },
      options: expect.anything(),
    });
    expect(commandsOf(client).filter((c) => c === 'killCursors')).toHaveLength(1);
  });

  it('a find failing after the abort needs no killCursors', async () => {
    const find = deferred<Document>();
    const client = cancellable(find.promise, []);
    const controller = new AbortController();
    const running = streamFind(client, findParams(), () => undefined, controller.signal);
    await vi.waitFor(() => expect(client.sent).toHaveLength(1));
    controller.abort();
    find.reject(new MongoServerError({ ok: 0, code: 11601, codeName: 'Interrupted', errmsg: 'x' }));
    expect((await rejection(running)).code).toBe('CANCELLED');
    expect(commandsOf(client)).toEqual(['find', 'currentOp']);
  });

  it('abort between batches kills the open cursor and stops reading', async () => {
    const getMore = deferred<Document>();
    const client = fakeClient((_db, command) => {
      if ('find' in command) return cursorReply(55, docs(1));
      if ('getMore' in command) return getMore.promise;
      if ('currentOp' in command) return { inprog: [{ opid: 3 }], ok: 1 };
      return { ok: 1 };
    });
    const controller = new AbortController();
    const send = vi.fn();
    const running = streamFind(client, findParams(), send, controller.signal);
    await vi.waitFor(() => expect(commandsOf(client)).toEqual(['find', 'getMore']));
    controller.abort();
    getMore.resolve(cursorReply(55, docs(2), false));
    expect((await rejection(running)).code).toBe('CANCELLED');
    expect(send).toHaveBeenCalledTimes(1);
    expect(commandsOf(client)).toContain('killOp');
    expect(client.sent.filter((s) => 'killCursors' in s.command)[0]?.command).toEqual({
      killCursors: 'orders',
      cursors: [55],
    });
    expect(commandsOf(client).filter((c) => c === 'getMore')).toHaveLength(1);
  });

  it('a command that never answers is given up after the settle time', async () => {
    vi.useFakeTimers();
    const client = cancellable(new Promise(() => undefined), []);
    const controller = new AbortController();
    const running = streamFind(client, findParams(), () => undefined, controller.signal);
    const outcome = running.then(
      () => 'resolved',
      (error: unknown) => (error as RpcError).code,
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(3_900);
    let settled = false;
    void outcome.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await outcome).toBe('CANCELLED');
    // The operation never showed up in currentOp: probed every 100 ms until the settle time.
    const [first, ...probes] = commandsOf(client);
    expect(first).toBe('find');
    expect(probes.length).toBeGreaterThanOrEqual(30);
    expect(probes.length).toBeLessThanOrEqual(41);
    expect(new Set(probes)).toEqual(new Set(['currentOp']));
  });

  it('an operation not yet in currentOp is probed again until it shows up, then killed', async () => {
    const find = deferred<Document>();
    let probes = 0;
    const client = fakeClient((_db, command) => {
      if ('find' in command) return find.promise;
      if ('currentOp' in command) {
        probes++;
        return { inprog: probes < 3 ? [] : [{ opid: 9 }], ok: 1 };
      }
      if ('killOp' in command) {
        find.reject(new MongoServerError({ ok: 0, code: 11601, codeName: 'Interrupted' }));
      }
      return { ok: 1 };
    });
    const controller = new AbortController();
    const running = streamFind(client, findParams(), () => undefined, controller.signal);
    await vi.waitFor(() => expect(commandsOf(client)).toEqual(['find']));
    controller.abort();
    expect((await rejection(running)).code).toBe('CANCELLED');
    expect(commandsOf(client)).toEqual(['find', 'currentOp', 'currentOp', 'currentOp', 'killOp']);
    expect(client.sent.at(-1)?.command).toEqual({ killOp: 1, op: 9 });
  });

  it('a cursor of a reply arriving after the settle time is still killed', async () => {
    vi.useFakeTimers();
    const find = deferred<Document>();
    const client = cancellable(find.promise, []);
    const controller = new AbortController();
    const running = streamFind(client, findParams(), () => undefined, controller.signal);
    const outcome = running.then(
      () => 'resolved',
      (error: unknown) => (error as RpcError).code,
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(4_200);
    expect(await outcome).toBe('CANCELLED');
    expect(commandsOf(client)).not.toContain('killCursors');
    find.resolve(cursorReply(BSON.Long.fromNumber(31), docs(1)));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.sent.at(-1)?.command).toEqual({
      killCursors: 'orders',
      cursors: [BSON.Long.fromNumber(31)],
    });
  });

  it('falls back to $ownOps when currentOp is unauthorized', async () => {
    let calls = 0;
    const client = fakeClient((_db, command) => {
      if ('currentOp' in command) {
        calls++;
        if (calls === 1) throw unauthorized();
        return { inprog: [{ opid: 'shard1:9' }], ok: 1 };
      }
      return { ok: 1 };
    });
    await killOperations(client, 'thicket:abc');
    expect(client.sent.map((s) => s.command)).toEqual([
      { currentOp: 1, 'command.comment': 'thicket:abc' },
      { currentOp: 1, $ownOps: true, 'command.comment': 'thicket:abc' },
      { killOp: 1, op: 'shard1:9' },
    ]);
    expect(client.sent.every((s) => s.db === 'admin')).toBe(true);
  });

  it('gives up quietly when currentOp fails otherwise, or $ownOps fails too', async () => {
    const other = fakeClient(() => {
      throw new MongoServerError({ ok: 0, code: 2, codeName: 'BadValue', errmsg: 'x' });
    });
    await expect(killOperations(other, 'thicket:x')).resolves.toBe(0);
    expect(commandsOf(other)).toEqual(['currentOp']);

    const denied = fakeClient(() => {
      throw unauthorized();
    });
    await expect(killOperations(denied, 'thicket:x')).resolves.toBe(0);
    expect(commandsOf(denied)).toEqual(['currentOp', 'currentOp']);
  });

  it('ignores failing killOps and a reply without inprog', async () => {
    const failing = fakeClient((_db, command) => {
      if ('currentOp' in command) return { inprog: [{ opid: 1 }, { opid: 2 }], ok: 1 };
      throw new Error('kill failed');
    });
    await expect(killOperations(failing, 'thicket:x')).resolves.toBe(2);
    expect(commandsOf(failing)).toEqual(['currentOp', 'killOp', 'killOp']);

    const empty = fakeClient(() => ({ ok: 1 }));
    await expect(killOperations(empty, 'thicket:x')).resolves.toBe(0);
    expect(commandsOf(empty)).toEqual(['currentOp']);
  });

  it('close() kills an open cursor once and ignores a failing killCursors', async () => {
    const client = fakeClient((_db, command) => {
      if ('killCursors' in command) throw new Error('cursor gone');
      return cursorReply(BSON.Long.fromNumber(8), docs(1));
    });
    const op = new Operation(client, 'shop', 'orders', undefined);
    expect(await op.open({ find: 'orders', filter: {} })).toEqual(docs(1));
    expect(op.hasMore).toBe(true);
    await op.close();
    await op.close();
    expect(op.hasMore).toBe(false);
    expect(commandsOf(client)).toEqual(['find', 'killCursors']);
    expect(await op.more()).toEqual([]);
  });

  it('every command of one operation carries the same comment', async () => {
    const client = fakeClient(() => ({ n: 1, ok: 1 }));
    const op = new Operation(client, 'shop', 'orders', undefined);
    await op.run({ count: 'orders' });
    await op.run({ count: 'orders', comment: 'user comment is replaced' });
    expect(client.sent.map((s) => s.command['comment'])).toEqual([op.comment, op.comment]);
  });

  it('a failure without an abort is passed on unchanged (no cleanup)', async () => {
    const client = fakeClient(() => {
      throw new MongoServerError({ ok: 0, code: 50, codeName: 'MaxTimeMSExpired', errmsg: 'slow' });
    });
    const op = new Operation(client, 'shop', 'orders', new AbortController().signal);
    expect((await rejection(op.run({ count: 'orders' }))).code).toBe('SERVER_ERROR');
    await op.close();
    expect(commandsOf(client)).toEqual(['count']);
  });
});

describe('countDocuments', () => {
  it('counts with an aggregation: $match, $limit, $group and the query options', async () => {
    const client = fakeClient(() => cursorReply(0, [{ _id: 1, n: new BSON.Int32(42) }]));
    const result = await countDocuments(client, {
      ...target,
      filter: '{"status":"open"}',
      limit: 50,
      collation: '{"locale":"fr"}',
      hint: '"status_1"',
      maxTimeMS: 900,
    });
    expect(result).toEqual({ count: 42 });
    expect(client.sent[0]?.db).toBe('shop');
    expect(client.sent[0]?.command).toEqual({
      aggregate: 'orders',
      pipeline: [
        { $match: { status: 'open' } },
        { $limit: 50 },
        { $group: { _id: 1, n: { $sum: 1 } } },
      ],
      cursor: {},
      collation: { locale: 'fr' },
      hint: 'status_1',
      maxTimeMS: 900,
      comment: expect.stringMatching(/^thicket:/),
    });
  });

  it('limit 0 counts everything; no match counts 0; a Long count is read', async () => {
    const none = fakeClient(() => cursorReply(0, []));
    await expect(countDocuments(none, { ...target, filter: '{}', limit: 0 })).resolves.toEqual({
      count: 0,
    });
    expect(none.sent[0]?.command['pipeline']).toEqual([
      { $match: {} },
      { $group: { _id: 1, n: { $sum: 1 } } },
    ]);
    const long = fakeClient(() =>
      cursorReply(0, [{ _id: 1, n: BSON.Long.fromNumber(5_000_000_000) }]),
    );
    await expect(countDocuments(long, { ...target, filter: '{}' })).resolves.toEqual({
      count: 5_000_000_000,
    });
  });

  it('a group without a numeric n counts 0', async () => {
    const client = fakeClient(() => cursorReply(0, [{ _id: 1, n: 'many' }]));
    await expect(countDocuments(client, { ...target, filter: '{}' })).resolves.toEqual({
      count: 0,
    });
  });

  it('an abort while counting rejects CANCELLED and kills the aggregation', async () => {
    const pending = deferred<Document>();
    const client = fakeClient((_db, command) => {
      if ('aggregate' in command) return pending.promise;
      if ('currentOp' in command) return { inprog: [{ opid: 4 }], ok: 1 };
      return { ok: 1 };
    });
    const controller = new AbortController();
    const counting = countDocuments(client, { ...target, filter: '{}' }, controller.signal);
    await vi.waitFor(() => expect(client.sent).toHaveLength(1));
    controller.abort();
    pending.resolve(cursorReply(0, [{ _id: 1, n: 3 }]));
    expect((await rejection(counting)).code).toBe('CANCELLED');
    expect(commandsOf(client)).toEqual(['aggregate', 'currentOp', 'killOp']);
  });

  it('an invalid filter is INVALID_PARAMS before anything is sent', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    expect((await rejection(countDocuments(client, { ...target, filter: '{"a":' }))).code).toBe(
      'INVALID_PARAMS',
    );
    expect(client.sent).toEqual([]);
  });
});

describe('estimatedCount', () => {
  it('runs count without a query and reads n', async () => {
    const client = fakeClient(() => ({ n: BSON.Long.fromNumber(12), ok: 1 }));
    await expect(estimatedCount(client, { ...target, maxTimeMS: 300 })).resolves.toEqual({
      count: 12,
    });
    expect(client.sent[0]?.command).toEqual({
      count: 'orders',
      maxTimeMS: 300,
      comment: expect.stringMatching(/^thicket:/),
    });
  });

  it('a missing or negative n counts 0', async () => {
    await expect(
      estimatedCount(
        fakeClient(() => ({ ok: 1 })),
        target,
      ),
    ).resolves.toEqual({
      count: 0,
    });
    await expect(
      estimatedCount(
        fakeClient(() => ({ n: -3, ok: 1 })),
        target,
      ),
    ).resolves.toEqual({
      count: 0,
    });
  });
});

describe('getDocument', () => {
  const OID = new BSON.ObjectId('64b7f0a1e4b0c1a2b3c4d5e6');
  const ID = ejson(OID);
  const items = (n: number) => Array.from({ length: n }, (_, i) => i);

  /** Answers the size aggregation with `arrays` and the find with `doc` (or nothing). */
  function docClient(arrays: Document[] | null, doc: Document | null) {
    return fakeClient((_db, command) => {
      if ('aggregate' in command) return cursorReply(0, arrays === null ? [] : [{ arrays }]);
      if ('find' in command) return cursorReply(0, doc === null ? [] : [doc]);
      return { ok: 1 };
    });
  }

  const findOf = (client: { sent: Sent[] }) =>
    client.sent.find((s) => 'find' in s.command)?.command;

  it('without sliceAbove: one find by _id, the whole document', async () => {
    const client = docClient(null, { _id: OID, title: 'Lamp', tags: ['a'] });
    const result = await getDocument(client, { ...target, id: ID });
    expect(result).toEqual({ doc: ejson({ _id: OID, title: 'Lamp', tags: ['a'] }), sliced: [] });
    expect(commandsOf(client)).toEqual(['find']);
    expect(client.sent[0]?.command).toEqual({
      find: 'orders',
      filter: { _id: { $eq: OID } },
      limit: 1,
      singleBatch: true,
      comment: expect.stringMatching(/^thicket:/),
    });
  });

  it('an empty projection is left out; a projection is passed on', async () => {
    const empty = docClient(null, { _id: OID });
    await getDocument(empty, { ...target, id: ID, projection: '{}' });
    expect(findOf(empty)).not.toHaveProperty('projection');
    const named = docClient(null, { _id: OID });
    await getDocument(named, { ...target, id: ID, projection: '{"title":{"$numberInt":"1"}}' });
    expect(findOf(named)?.['projection']).toEqual({ title: 1 });
  });

  it('an unknown _id gives doc null', async () => {
    await expect(getDocument(docClient(null, null), { ...target, id: ID })).resolves.toEqual({
      doc: null,
      sliced: [],
    });
    const sized = docClient(null, null);
    await expect(getDocument(sized, { ...target, id: ID, sliceAbove: 10 })).resolves.toEqual({
      doc: null,
      sliced: [],
    });
    // No document in the size query: no find follows.
    expect(commandsOf(sized)).toEqual(['aggregate']);
  });

  it('sliceAbove: reads array sizes on the server, then slices the large ones', async () => {
    const client = docClient([{ k: 'items', n: new BSON.Int32(500) }], {
      _id: OID,
      items: items(100),
      tags: ['a', 'b'],
    });
    const result = await getDocument(client, { ...target, id: ID, sliceAbove: 100 });
    expect(result.sliced).toEqual([{ path: 'items', total: 500, loaded: 100 }]);
    expect(commandsOf(client)).toEqual(['aggregate', 'find']);
    const aggregate = client.sent[0]?.command as Document;
    const pipeline = aggregate['pipeline'] as Document[];
    expect(pipeline.slice(0, 2)).toEqual([{ $match: { _id: { $eq: OID } } }, { $limit: 1 }]);
    expect(JSON.stringify(pipeline[2])).toContain('"$gt":["$$this.n",100]');
    expect(findOf(client)?.['projection']).toEqual({ items: { $slice: 100 } });
    // Both commands belong to one operation.
    expect(client.sent[1]?.command['comment']).toBe(aggregate['comment']);
  });

  it('exclusion projection: slices arrays it does not mention, keeps the exclusions', async () => {
    const client = docClient(
      [
        { k: 'items', n: 500 },
        { k: 'log', n: 300 },
      ],
      { _id: OID, items: items(50) },
    );
    const result = await getDocument(client, {
      ...target,
      id: ID,
      sliceAbove: 50,
      projection: '{"log":{"$numberInt":"0"},"secret":{"$numberInt":"0"}}',
    });
    expect(findOf(client)?.['projection']).toEqual({
      log: 0,
      secret: 0,
      items: { $slice: 50 },
    });
    expect(result.sliced).toEqual([{ path: 'items', total: 500, loaded: 50 }]);
  });

  it('a user $slice or an operator on a sub-path keeps that array unsliced', async () => {
    const client = docClient(
      [
        { k: 'items', n: 500 },
        { k: 'log', n: 500 },
      ],
      { _id: OID, items: items(5), log: items(3) },
    );
    const result = await getDocument(client, {
      ...target,
      id: ID,
      sliceAbove: 10,
      projection: '{"items":{"$slice":{"$numberInt":"5"}},"log.at":{"$numberInt":"0"}}',
    });
    expect(findOf(client)?.['projection']).toEqual({ items: { $slice: 5 }, 'log.at': 0 });
    expect(result.sliced).toEqual([]);
  });

  it('inclusion projection: slices only arrays included as a whole', async () => {
    const client = docClient(
      [
        { k: 'items', n: 500 },
        { k: 'log', n: 500 },
        { k: 'events', n: 500 },
      ],
      { _id: OID, items: items(10), title: 'Lamp', log: [{ at: 1 }] },
    );
    const result = await getDocument(client, {
      ...target,
      id: ID,
      sliceAbove: 10,
      projection: '{"items":true,"title":{"$numberInt":"1"},"log.at":{"$numberInt":"1"}}',
    });
    // `events` is not included at all; `log` only through a sub-path. The expression form keeps
    // `items` included.
    expect(findOf(client)?.['projection']).toEqual({
      items: { $cond: [{ $isArray: '$items' }, { $slice: ['$items', 10] }, '$items'] },
      title: 1,
      'log.at': 1,
    });
    expect(result.sliced).toEqual([{ path: 'items', total: 500, loaded: 10 }]);
  });

  it.each([
    ['{"items":{"$numberInt":"1"}}', {}],
    ['{"_id":{"$numberInt":"0"},"items":{"$numberInt":"1"}}', { _id: 0 }],
  ])(
    'an inclusion projection of only the large array %s stays an inclusion',
    async (projection, rest) => {
      const client = docClient([{ k: 'items', n: 500 }], { _id: OID, items: items(10) });
      const result = await getDocument(client, { ...target, id: ID, sliceAbove: 10, projection });
      // `{items: {$slice: 10}}` alone would be an exclusion projection (every field returned).
      expect(findOf(client)?.['projection']).toEqual({
        ...rest,
        items: { $cond: [{ $isArray: '$items' }, { $slice: ['$items', 10] }, '$items'] },
      });
      expect(result.sliced).toEqual([{ path: 'items', total: 500, loaded: 10 }]);
    },
  );

  it('an inclusion projection of _id alone includes no array: nothing is sliced', async () => {
    const client = docClient([{ k: 'items', n: 500 }], { _id: OID });
    const result = await getDocument(client, {
      ...target,
      id: ID,
      sliceAbove: 10,
      projection: '{"_id":{"$numberInt":"1"}}',
    });
    expect(findOf(client)?.['projection']).toEqual({ _id: 1 });
    expect(result.sliced).toEqual([]);
  });

  it('field names with a dot or a leading $ are not sliced (a projection cannot name them)', async () => {
    const client = docClient(
      [
        { k: 'a.b', n: 500 },
        { k: '$odd', n: 500 },
      ],
      { _id: OID },
    );
    const result = await getDocument(client, { ...target, id: ID, sliceAbove: 10 });
    expect(findOf(client)).not.toHaveProperty('projection');
    expect(result.sliced).toEqual([]);
  });

  it('matches the id literally, also when it looks like a query operator', async () => {
    const client = docClient([], { _id: { $ne: null } });
    await getDocument(client, { ...target, id: '{"$ne":null}', sliceAbove: 10 });
    const pipeline = client.sent[0]?.command['pipeline'] as Document[];
    expect(pipeline[0]).toEqual({ $match: { _id: { $eq: { $ne: null } } } });
    expect(findOf(client)?.['filter']).toEqual({ _id: { $eq: { $ne: null } } });
  });

  it('an inclusion projection with _id: 0 alone counts as exclusion', async () => {
    const client = docClient([{ k: 'items', n: 20 }], { items: items(10) });
    const result = await getDocument(client, {
      ...target,
      id: ID,
      sliceAbove: 10,
      projection: '{"_id":{"$numberInt":"0"}}',
    });
    expect(findOf(client)?.['projection']).toEqual({ _id: 0, items: { $slice: 10 } });
    expect(result.sliced).toEqual([{ path: 'items', total: 20, loaded: 10 }]);
  });

  it('drops a sliced entry when the returned field is no array (changed meanwhile)', async () => {
    const client = docClient([{ k: 'items', n: 500 }], { _id: OID, items: 'replaced' });
    const result = await getDocument(client, { ...target, id: ID, sliceAbove: 10 });
    expect(result.sliced).toEqual([]);
  });

  it('a size reply without arrays slices nothing', async () => {
    const client = fakeClient((_db, command) =>
      'aggregate' in command ? cursorReply(0, [{}]) : cursorReply(0, [{ _id: OID }]),
    );
    await expect(getDocument(client, { ...target, id: ID, sliceAbove: 10 })).resolves.toEqual({
      doc: ejson({ _id: OID }),
      sliced: [],
    });
  });

  it('ignores malformed size entries', async () => {
    const client = docClient([{ k: 7, n: 500 }, { k: 'items' }, { k: 'tags', n: 'x' }], {
      _id: OID,
    });
    await getDocument(client, { ...target, id: ID, sliceAbove: 10 });
    expect(findOf(client)).not.toHaveProperty('projection');
  });

  it('an abort during the size query rejects CANCELLED and sends no find', async () => {
    const pending = deferred<Document>();
    const client = fakeClient((_db, command) =>
      'aggregate' in command ? pending.promise : { inprog: [], ok: 1 },
    );
    const controller = new AbortController();
    const loading = getDocument(client, { ...target, id: ID, sliceAbove: 10 }, controller.signal);
    await vi.waitFor(() => expect(client.sent).toHaveLength(1));
    controller.abort();
    pending.resolve(cursorReply(0, []));
    expect((await rejection(loading)).code).toBe('CANCELLED');
    expect(commandsOf(client)).not.toContain('find');
  });

  it('an invalid id is INVALID_PARAMS', async () => {
    const client = docClient(null, null);
    expect((await rejection(getDocument(client, { ...target, id: '{"$oid":' }))).code).toBe(
      'INVALID_PARAMS',
    );
    expect(client.sent).toEqual([]);
  });
});

describe('getSlice', () => {
  const ID = '{"_id":{"$numberInt":"1"}}';
  const params = (extra: Partial<ParsedParamsOf<'docs.getSlice'>> = {}) => ({
    ...target,
    id: '"order-1"',
    path: 'items',
    skip: 20,
    limit: 5,
    ...extra,
  });

  it('computes the slice and the total on the server', async () => {
    const client = fakeClient(() =>
      cursorReply(0, [
        { isArray: true, total: BSON.Long.fromNumber(50_000), items: [new BSON.Int32(20), 'x'] },
      ]),
    );
    const result = await getSlice(client, params());
    expect(result).toEqual({ items: '[{"$numberInt":"20"},"x"]', total: 50_000 });
    expect(client.sent[0]?.command).toEqual({
      aggregate: 'orders',
      pipeline: [
        { $match: { _id: { $eq: 'order-1' } } },
        { $limit: 1 },
        {
          $project: {
            _id: 0,
            parentsOk: { $literal: true },
            isArray: { $isArray: '$items' },
            total: { $cond: [{ $isArray: '$items' }, { $size: '$items' }, 0] },
            items: { $cond: [{ $isArray: '$items' }, { $slice: ['$items', 20, 5] }, []] },
          },
        },
      ],
      cursor: {},
      comment: expect.stringMatching(/^thicket:/),
    });
  });

  it('accepts dotted paths; missing items or total give an empty array and 0', async () => {
    const client = fakeClient(() => cursorReply(0, [{ isArray: true }]));
    await expect(getSlice(client, params({ path: 'a.b' }))).resolves.toEqual({
      items: '[]',
      total: 0,
    });
    expect(JSON.stringify(client.sent[0]?.command)).toContain('"$isArray":"$a.b"');
  });

  it('a dotted path requires every parent to be a document (not an array)', async () => {
    const client = fakeClient(() => cursorReply(0, [{ isArray: true, total: 1, items: [1] }]));
    await getSlice(client, params({ path: 'a.b.c' }));
    const pipeline = client.sent[0]?.command['pipeline'] as Document[];
    const parents = [{ $eq: [{ $type: '$a' }, 'object'] }, { $eq: [{ $type: '$a.b' }, 'object'] }];
    const isArray = { $and: [...parents, { $isArray: '$a.b.c' }] };
    expect(pipeline[2]).toEqual({
      $project: {
        _id: 0,
        parentsOk: { $and: parents },
        isArray,
        total: { $cond: [isArray, { $size: '$a.b.c' }, 0] },
        items: { $cond: [isArray, { $slice: ['$a.b.c', 20, 5] }, []] },
      },
    });
  });

  it('a path through an array (or a missing parent) is NOT_FOUND with its own message', async () => {
    const client = fakeClient(() =>
      cursorReply(0, [{ parentsOk: false, isArray: false, total: 0, items: [] }]),
    );
    const error = await rejection(getSlice(client, params({ path: 'lines.items' })));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toContain('"lines.items" does not lead through nested documents only');
  });

  it.each(['items.3', '0', 'a.10.b'])(
    'refuses the numeric component in %j (array index) with INVALID_PARAMS',
    async (path) => {
      const client = fakeClient(() => ({ ok: 1 }));
      const error = await rejection(getSlice(client, params({ path })));
      expect(error.code).toBe('INVALID_PARAMS');
      expect(error.message).toContain('array indexes are not supported');
      expect(client.sent).toEqual([]);
    },
  );

  it.each(['a..b', '.a', 'a.', '$items', 'a.$b'])(
    'refuses the path %j with INVALID_PARAMS before sending',
    async (path) => {
      const client = fakeClient(() => ({ ok: 1 }));
      const error = await rejection(getSlice(client, params({ path })));
      expect(error.code).toBe('INVALID_PARAMS');
      expect(error.message).toContain(`path "${path}"`);
      expect(client.sent).toEqual([]);
    },
  );

  it('no such document is NOT_FOUND', async () => {
    const client = fakeClient(() => cursorReply(0, []));
    const error = await rejection(getSlice(client, params({ id: ID })));
    expect(error).toMatchObject({ code: 'NOT_FOUND', message: 'No document with this _id' });
  });

  it('no array at the path is NOT_FOUND', async () => {
    const client = fakeClient(() => cursorReply(0, [{ isArray: false, total: 0, items: [] }]));
    const error = await rejection(getSlice(client, params({ path: 'title' })));
    expect(error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'The document has no array at "title"',
    });
  });

  it('an invalid id is INVALID_PARAMS', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    expect((await rejection(getSlice(client, params({ id: '{"$oid":' })))).code).toBe(
      'INVALID_PARAMS',
    );
  });

  it('an abort rejects CANCELLED', async () => {
    const pending = deferred<Document>();
    const client = fakeClient((_db, command) =>
      'aggregate' in command ? pending.promise : { inprog: [], ok: 1 },
    );
    const controller = new AbortController();
    const slicing = getSlice(client, params(), controller.signal);
    await vi.waitFor(() => expect(client.sent).toHaveLength(1));
    controller.abort();
    pending.resolve(cursorReply(0, []));
    expect((await rejection(slicing)).code).toBe('CANCELLED');
  });
});
