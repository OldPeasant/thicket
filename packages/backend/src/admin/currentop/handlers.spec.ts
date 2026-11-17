import type { Profile } from '@thicket/contract';
import { BSON, MongoServerError, type Document } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { ConnectionManager, type ClientLike } from '../../connections/manager';
import { RpcError, type Handler } from '../../server/rpc';
import { currentOpCommand, escapeRegExp, parseOpId } from './currentop';
import { currentOpHandlers } from './handlers';

const profile: Profile = {
  id: 'p1',
  name: 'Local',
  connectionString: 'mongodb://db.example.test:27017',
  readOnly: false,
  production: false,
};

type Answer = (db: string, command: Document) => Document | Promise<Document>;

const OPS: Document[] = [
  { opid: 7, op: 'none', active: false, ns: '' },
  { opid: 3, op: 'query', active: true, ns: 'shop.orders', microsecs_running: 2_000_000 },
  { opid: 9, op: 'command', active: true, ns: 'admin.$cmd', command: { currentOp: 1 } },
  {
    opid: 4,
    op: 'command',
    active: true,
    ns: 'shop.orders',
    microsecs_running: BSON.Long.fromNumber(9_000_000),
  },
];

const defaultAnswer: Answer = (_db, command) => {
  if ('hello' in command) return { isWritablePrimary: true, ok: 1 };
  if ('currentOp' in command) return { inprog: OPS, ok: 1 };
  return { ok: 1 };
};

async function setup(answer: Answer = defaultAnswer) {
  const sent: { db: string; command: Document }[] = [];
  const client: ClientLike = {
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: (db) => ({
      command: async (command) => {
        sent.push({ db, command });
        return answer(db, command);
      },
    }),
  };
  const manager = new ConnectionManager({
    loadProfile: (id) =>
      id === 'p1' ? Promise.resolve(profile) : Promise.reject(new RpcError('NOT_FOUND', id)),
    loadSecrets: () => Promise.resolve(null),
    createClient: () => client,
  });
  await manager.open('p1', undefined);
  sent.length = 0;
  const handlers = currentOpHandlers(manager);
  const call = (method: string, params: unknown, signal = new AbortController().signal) =>
    Promise.resolve((handlers[method] as Handler)(params as never, { signal, requestId: 'r1' }));
  return { handlers, call, sent };
}

const parse = (text: string) => BSON.EJSON.parse(text, { relaxed: false }) as Document;

describe('currentOpCommand', () => {
  it('is a plain currentOp without filters', () => {
    expect(currentOpCommand({})).toEqual({ currentOp: 1 });
  });

  it('turns the filters into the command fields', () => {
    expect(
      currentOpCommand({ ns: ' shop.orders ', minSecsRunning: 5, opType: 'query', all: true }),
    ).toEqual({
      currentOp: 1,
      $all: true,
      ns: { $regex: '^shop\\.orders(\\.|$)' },
      secs_running: { $gte: 5 },
      op: 'query',
    });
  });

  it('matches the namespace prefix on name boundaries only', () => {
    const regex = new RegExp((currentOpCommand({ ns: 'shop' })['ns'] as Document)['$regex']);
    expect(['shop', 'shop.orders', 'shop.orders.x'].map((ns) => regex.test(ns))).toEqual([
      true,
      true,
      true,
    ]);
    expect(['shopping.x', 'xshop.a'].map((ns) => regex.test(ns))).toEqual([false, false]);
  });

  it('escapes regex characters and ignores empty filters', () => {
    expect(currentOpCommand({ ns: 'a+b', opType: ' ', minSecsRunning: 0 }, true)).toEqual({
      currentOp: 1,
      $ownOps: true,
      ns: { $regex: '^a\\+b(\\.|$)' },
    });
  });
});

describe('escapeRegExp', () => {
  it('makes every regex metacharacter literal', () => {
    const text = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o';
    expect(new RegExp(`^${escapeRegExp(text)}$`).test(text)).toBe(true);
    expect(escapeRegExp('shop.orders')).toBe('shop\\.orders');
  });

  it('ignores a negative minimum running time and a blank namespace', () => {
    expect(currentOpCommand({ ns: '   ', minSecsRunning: -3 })).toEqual({ currentOp: 1 });
  });
});

describe('parseOpId', () => {
  it('accepts numbers and shard:opid strings', () => {
    expect(parseOpId('{"$numberInt":"12"}')).toEqual(new BSON.Int32(12));
    expect(parseOpId('{"$numberLong":"12"}')).toEqual(BSON.Long.fromNumber(12));
    expect(parseOpId('{"$numberDouble":"12.0"}')).toBe(12);
    expect(parseOpId('"shard01:12"')).toBe('shard01:12');
  });

  it.each(['{"a":1}', '""', '{"$numberDouble":"1.5"}', 'not json', 'true'])(
    'refuses %s',
    (text) => {
      expect(() => parseOpId(text)).toThrowError(
        expect.objectContaining({ code: 'INVALID_PARAMS' }),
      );
    },
  );
});

describe('currentOpHandlers', () => {
  it('serves exactly admin.currentOp and admin.killOp', async () => {
    const { handlers } = await setup();
    expect(Object.keys(handlers).sort()).toEqual(['admin.currentOp', 'admin.killOp']);
  });

  it.each([
    ['admin.currentOp', {}],
    ['admin.killOp', { opId: '{"$numberInt":"1"}' }],
  ])('%s answers NOT_CONNECTED without an open connection', async (method, extra) => {
    const { call, sent } = await setup();
    await expect(call(method, { profileId: 'p2', ...extra })).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    expect(sent).toEqual([]);
  });

  it('lists the operations longest running first, without its own currentOp', async () => {
    const { call, sent } = await setup();
    const { ops } = (await call('admin.currentOp', { profileId: 'p1', ns: 'shop' })) as {
      ops: string[];
    };
    expect(ops.map(parse).map((op) => Number(op['opid']))).toEqual([4, 3, 7]);
    expect(sent).toEqual([
      { db: 'admin', command: { currentOp: 1, ns: { $regex: '^shop(\\.|$)' } } },
    ]);
  });

  it('falls back to $ownOps when the user may not see every operation', async () => {
    const { call, sent } = await setup((db, command) => {
      if ('currentOp' in command && !('$ownOps' in command)) {
        throw new MongoServerError({ ok: 0, code: 13, codeName: 'Unauthorized', errmsg: 'no' });
      }
      return defaultAnswer(db, command);
    });
    const { ops } = (await call('admin.currentOp', { profileId: 'p1' })) as { ops: string[] };
    expect(ops).toHaveLength(3);
    expect(sent.map((s) => s.command)).toEqual([{ currentOp: 1 }, { currentOp: 1, $ownOps: true }]);
  });

  it('passes other server errors on as SERVER_ERROR', async () => {
    const { call } = await setup(() => {
      throw new MongoServerError({ ok: 0, code: 2, codeName: 'BadValue', errmsg: 'bad' });
    });
    await expect(call('admin.currentOp', { profileId: 'p1' })).rejects.toMatchObject({
      code: 'SERVER_ERROR',
    });
  });

  it('kills the operation by its opid on admin', async () => {
    const { call, sent } = await setup();
    await expect(
      call('admin.killOp', { profileId: 'p1', opId: '{"$numberInt":"42"}' }),
    ).resolves.toEqual({});
    expect(sent).toEqual([{ db: 'admin', command: { killOp: 1, op: new BSON.Int32(42) } }]);
  });

  it('keeps $currentOp aggregations of other clients and sorts operations without a running time last', async () => {
    const { call } = await setup((db, command) => {
      if ('currentOp' in command) {
        return {
          ok: 1,
          inprog: [
            { opid: 1, op: 'none', active: false },
            {
              opid: 2,
              op: 'command',
              active: true,
              command: { aggregate: 1, pipeline: [{ $currentOp: {} }] },
              microsecs_running: 5,
            },
            { opid: 3, op: 'query', active: true, microsecs_running: 10 },
            {
              opid: 4,
              op: 'command',
              active: true,
              command: { aggregate: 'orders', pipeline: [{ $match: {} }] },
              microsecs_running: 1_000,
            },
            { opid: 5, op: 'command', active: true, command: null, microsecs_running: 1 },
          ],
        };
      }
      return defaultAnswer(db, command);
    });
    const { ops } = (await call('admin.currentOp', { profileId: 'p1' })) as { ops: string[] };
    expect(ops.map(parse).map((op) => Number(op['opid']))).toEqual([4, 3, 2, 5, 1]);
  });

  it('hides currentOp commands of other clients but lists and kills their $currentOp aggregation', async () => {
    const { call, sent } = await setup((db, command) => {
      if ('currentOp' in command) {
        return {
          ok: 1,
          inprog: [
            {
              opid: 11,
              op: 'command',
              active: true,
              command: { currentOp: 1, $all: true, comment: 'monitoring agent' },
              microsecs_running: 50_000_000,
            },
            {
              opid: 12,
              op: 'command',
              active: true,
              command: { aggregate: 1, pipeline: [{ $currentOp: { allUsers: true } }] },
              microsecs_running: 40_000_000,
            },
          ],
        };
      }
      return defaultAnswer(db, command);
    });
    const { ops } = (await call('admin.currentOp', { profileId: 'p1', all: true })) as {
      ops: string[];
    };
    expect(ops.map(parse).map((op) => Number(op['opid']))).toEqual([12]);
    const opId = JSON.stringify((JSON.parse(ops[0] as string) as Document)['opid']);
    sent.length = 0;
    await call('admin.killOp', { profileId: 'p1', opId });
    expect(sent).toEqual([{ db: 'admin', command: { killOp: 1, op: new BSON.Int32(12) } }]);
  });

  it('answers an empty list when the reply has no inprog array', async () => {
    const { call } = await setup((db, command) =>
      'currentOp' in command ? { ok: 1 } : defaultAnswer(db, command),
    );
    await expect(call('admin.currentOp', { profileId: 'p1' })).resolves.toEqual({ ops: [] });
  });

  it('returns each operation as canonical EJSON (Int64 running times keep their type)', async () => {
    const { call } = await setup();
    const { ops } = (await call('admin.currentOp', { profileId: 'p1' })) as { ops: string[] };
    expect(JSON.parse(ops[0] as string)).toMatchObject({
      opid: { $numberInt: '4' },
      microsecs_running: { $numberLong: '9000000' },
    });
  });

  it('recognises Unauthorized by its code name alone and keeps the filters for $ownOps', async () => {
    const { call, sent } = await setup((db, command) => {
      if ('currentOp' in command && !('$ownOps' in command)) {
        throw new MongoServerError({ ok: 0, codeName: 'Unauthorized', errmsg: 'no' });
      }
      return defaultAnswer(db, command);
    });
    await call('admin.currentOp', { profileId: 'p1', opType: 'query', minSecsRunning: 2 });
    expect(sent.map((s) => s.command)).toEqual([
      { currentOp: 1, secs_running: { $gte: 2 }, op: 'query' },
      { currentOp: 1, $ownOps: true, secs_running: { $gte: 2 }, op: 'query' },
    ]);
  });

  it('passes the error of the $ownOps retry on', async () => {
    const { call, sent } = await setup(() => {
      throw new MongoServerError({ ok: 0, code: 13, codeName: 'Unauthorized', errmsg: 'none' });
    });
    await expect(call('admin.currentOp', { profileId: 'p1' })).rejects.toMatchObject({
      code: 'SERVER_ERROR',
    });
    expect(sent).toHaveLength(2);
  });

  it('answers CANCELLED when the request is aborted while the server is still answering', async () => {
    let release: () => void = () => undefined;
    const { call } = await setup(
      (db, command) =>
        new Promise((resolve) => {
          release = () => resolve(defaultAnswer(db, command));
        }),
    );
    const controller = new AbortController();
    const result = call('admin.currentOp', { profileId: 'p1' }, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
    release();
  });

  it('kills a mongos shard:opid and an Int64 opid as they were listed', async () => {
    const { call, sent } = await setup();
    await call('admin.killOp', { profileId: 'p1', opId: '"shard01:77"' });
    await call('admin.killOp', { profileId: 'p1', opId: '{"$numberLong":"9007199254740993"}' });
    expect(sent.map((s) => s.command)).toEqual([
      { killOp: 1, op: 'shard01:77' },
      { killOp: 1, op: BSON.Long.fromString('9007199254740993') },
    ]);
  });

  it('passes a server error of killOp on as SERVER_ERROR', async () => {
    const { call } = await setup((db, command) => {
      if ('killOp' in command) {
        throw new MongoServerError({ ok: 0, code: 13, codeName: 'Unauthorized', errmsg: 'no' });
      }
      return defaultAnswer(db, command);
    });
    await expect(
      call('admin.killOp', { profileId: 'p1', opId: '{"$numberInt":"5"}' }),
    ).rejects.toMatchObject({ code: 'SERVER_ERROR' });
  });

  it('refuses an opId that is not an operation id without sending anything', async () => {
    const { call, sent } = await setup();
    await expect(call('admin.killOp', { profileId: 'p1', opId: '{"x":1}' })).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    });
    expect(sent).toEqual([]);
  });
});
