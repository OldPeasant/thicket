import type { Profile } from '@thicket/contract';
import { BSON, type Document } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { ConnectionManager, type ClientLike } from '../connections/manager';
import { RpcError, type Handler } from '../server/rpc';
import { indexHandlers } from './handlers';

const profile: Profile = {
  id: 'p1',
  name: 'Local',
  connectionString: 'mongodb://db.example.test:27017',
  readOnly: false,
  production: false,
};

type Answer = (db: string, command: Document) => Document | Promise<Document>;

const emptyCursor = { cursor: { id: BSON.Long.fromNumber(0), firstBatch: [] }, ok: 1 };

const defaultAnswer: Answer = (_db, command) => {
  if ('hello' in command) return { isWritablePrimary: true, ok: 1 };
  if ('buildInfo' in command) return { version: '8.2.0', ok: 1 };
  if ('listIndexes' in command) {
    return {
      cursor: {
        id: BSON.Long.fromNumber(0),
        firstBatch: [{ v: 2, key: { _id: 1 }, name: '_id_' }],
      },
      ok: 1,
    };
  }
  if ('aggregate' in command) {
    const pipeline = command['pipeline'] as Document[];
    if (pipeline.some((stage) => '$collStats' in stage)) {
      return {
        cursor: {
          id: BSON.Long.fromNumber(0),
          firstBatch: [{ ns: 'shop.orders', storageStats: { indexSizes: { _id_: 4096 } } }],
        },
        ok: 1,
      };
    }
    return emptyCursor;
  }
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
  const handlers = indexHandlers(manager);
  const call = (method: string, params: unknown, signal = new AbortController().signal) =>
    Promise.resolve((handlers[method] as Handler)(params as never, { signal, requestId: 'r1' }));
  return { handlers, call, sent };
}

const target = { db: 'shop', coll: 'orders' };

describe('indexHandlers', () => {
  it('serves exactly idx.list/stats/create/drop/hide', async () => {
    const { handlers } = await setup();
    expect(Object.keys(handlers).sort()).toEqual([
      'idx.create',
      'idx.drop',
      'idx.hide',
      'idx.list',
      'idx.stats',
    ]);
  });

  it.each([
    ['idx.list', target],
    ['idx.stats', target],
    ['idx.create', { ...target, key: '{"a":1}' }],
    ['idx.drop', { ...target, name: 'a_1' }],
    ['idx.hide', { ...target, name: 'a_1', hidden: true }],
  ])('%s answers NOT_CONNECTED for a profile without an open connection', async (method, p) => {
    const { call, sent } = await setup();
    await expect(call(method, { profileId: 'p2', ...p })).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    expect(sent).toEqual([]);
  });

  it('pass db, collection and parameters of each request to the server', async () => {
    const { call, sent } = await setup();
    await expect(call('idx.list', { profileId: 'p1', ...target })).resolves.toMatchObject({
      indexes: [{ name: '_id_' }],
    });
    await expect(call('idx.stats', { profileId: 'p1', ...target })).resolves.toEqual({
      indexes: [{ name: '_id_', sizeBytes: 4096 }],
    });
    await expect(
      call('idx.create', {
        profileId: 'p1',
        ...target,
        key: '{"sku":1}',
        options: '{"unique":true}',
      }),
    ).resolves.toEqual({ name: 'sku_1' });
    await expect(call('idx.drop', { profileId: 'p1', ...target, name: 'sku_1' })).resolves.toEqual(
      {},
    );
    await expect(
      call('idx.hide', { profileId: 'p1', ...target, name: 'sku_1', hidden: false }),
    ).resolves.toEqual({});
    expect(sent.map((s) => [s.db, s.command])).toEqual([
      ['shop', { listIndexes: 'orders', cursor: {} }],
      ['shop', expect.objectContaining({ aggregate: 'orders' })],
      ['shop', expect.objectContaining({ aggregate: 'orders', pipeline: [{ $indexStats: {} }] })],
      [
        'shop',
        {
          createIndexes: 'orders',
          indexes: [{ key: { sku: new BSON.Int32(1) }, name: 'sku_1', unique: true }],
        },
      ],
      ['shop', { dropIndexes: 'orders', index: 'sku_1' }],
      ['shop', { collMod: 'orders', index: { name: 'sku_1', hidden: false } }],
    ]);
  });

  it('idx.drop refuses "*" without sending anything', async () => {
    const { call, sent } = await setup();
    await expect(call('idx.drop', { profileId: 'p1', ...target, name: '*' })).rejects.toMatchObject(
      { code: 'INVALID_PARAMS' },
    );
    expect(sent).toEqual([]);
  });

  it.each([
    ['idx.list', 'listIndexes'],
    ['idx.stats', 'aggregate'],
  ])(
    '%s (a read) answers CANCELLED at once while its server command is pending',
    async (method, commandName) => {
      let release!: () => void;
      const { call } = await setup((db, command) =>
        commandName in command
          ? new Promise<Document>((resolve) => {
              release = () => resolve(defaultAnswer(db, command) as Document);
            })
          : defaultAnswer(db, command),
      );
      const controller = new AbortController();
      const pending = call(method, { profileId: 'p1', ...target }, controller.signal);
      // Let the handler send its command before cancelling.
      await new Promise((resolve) => setTimeout(resolve, 0));
      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
      release();
    },
  );

  it.each([
    ['idx.create', 'createIndexes', { key: '{"a":1}' }, { name: 'a_1' }],
    ['idx.drop', 'dropIndexes', { name: 'a_1' }, {}],
    ['idx.hide', 'collMod', { name: 'a_1', hidden: true }, {}],
  ])(
    '%s is not cancellable once sent: a cancel waits for the server answer',
    async (method, commandName, params, result) => {
      let release!: () => void;
      const { call } = await setup((db, command) =>
        commandName in command
          ? new Promise<Document>((resolve) => {
              release = () => resolve({ ok: 1 });
            })
          : defaultAnswer(db, command),
      );
      const controller = new AbortController();
      let settled = false;
      const pending = call(
        method,
        { profileId: 'p1', ...target, ...params },
        controller.signal,
      ).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(settled).toBe(false);
      release();
      await expect(pending).resolves.toEqual(result);
    },
  );

  it.each([
    ['idx.create', 'createIndexes', { key: '{"a":1}' }],
    ['idx.drop', 'dropIndexes', { name: 'a_1' }],
    ['idx.hide', 'collMod', { name: 'a_1', hidden: true }],
  ])(
    '%s with a signal already aborted still sends the write',
    async (method, commandName, params) => {
      const { call, sent } = await setup();
      const controller = new AbortController();
      controller.abort();
      await call(method, { profileId: 'p1', ...target, ...params }, controller.signal);
      expect(sent.map((s) => Object.keys(s.command)[0])).toEqual([commandName]);
    },
  );

  it('a read already cancelled answers CANCELLED', async () => {
    const { call } = await setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      call('idx.list', { profileId: 'p1', ...target }, controller.signal),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
