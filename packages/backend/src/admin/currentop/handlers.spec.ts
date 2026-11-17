import type { Profile } from '@thicket/contract';
import { BSON, MongoServerError, type Document } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { ConnectionManager, type ClientLike } from '../../connections/manager';
import { RpcError, type Handler } from '../../server/rpc';
import { currentOpCommand, parseOpId } from './currentop';
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

  it('refuses an opId that is not an operation id without sending anything', async () => {
    const { call, sent } = await setup();
    await expect(call('admin.killOp', { profileId: 'p1', opId: '{"x":1}' })).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    });
    expect(sent).toEqual([]);
  });
});
