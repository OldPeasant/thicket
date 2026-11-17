import type { Profile } from '@thicket/contract';
import { BSON, type Document } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { ConnectionManager, type ClientLike } from '../../connections/manager';
import { RpcError, type Handler } from '../../server/rpc';
import { validatorHandlers } from './handlers';

const profile: Profile = {
  id: 'p1',
  name: 'Local',
  connectionString: 'mongodb://db.example.test:27017',
  readOnly: false,
  production: false,
};

type Answer = (db: string, command: Document) => Document | Promise<Document>;

const SCHEMA = { $jsonSchema: { bsonType: 'object', required: ['sku'] } };

const defaultAnswer: Answer = (_db, command) => {
  if ('hello' in command) return { isWritablePrimary: true, ok: 1 };
  if ('buildInfo' in command) return { version: '8.2.0', ok: 1 };
  if ('listCollections' in command) {
    return {
      cursor: {
        id: BSON.Long.fromNumber(0),
        firstBatch: [
          { name: 'orders', options: { validator: SCHEMA, validationLevel: 'moderate' } },
        ],
      },
      ok: 1,
    };
  }
  if ('find' in command) {
    return { cursor: { id: BSON.Long.fromNumber(0), firstBatch: [{ _id: 'sku-2' }] }, ok: 1 };
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
  const handlers = validatorHandlers(manager);
  const call = (method: string, params: unknown, signal = new AbortController().signal) =>
    Promise.resolve((handlers[method] as Handler)(params as never, { signal, requestId: 'r1' }));
  return { handlers, call, sent };
}

const target = { db: 'shop', coll: 'orders' };
const setParams = {
  ...target,
  validator: '{"$jsonSchema":{"bsonType":"object","required":["sku"]}}',
  validationLevel: 'strict',
  validationAction: 'warn',
};

describe('validatorHandlers', () => {
  it('serves exactly coll.validator.get/set/check', async () => {
    const { handlers } = await setup();
    expect(Object.keys(handlers).sort()).toEqual([
      'coll.validator.check',
      'coll.validator.get',
      'coll.validator.set',
    ]);
  });

  it.each([
    ['coll.validator.get', target],
    ['coll.validator.set', setParams],
    ['coll.validator.check', { ...target, ids: '["a"]' }],
  ])('%s answers NOT_CONNECTED for a profile without an open connection', async (method, p) => {
    const { call, sent } = await setup();
    await expect(call(method, { profileId: 'p2', ...p })).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    expect(sent).toEqual([]);
  });

  it('passes db, collection and parameters of each request to the server', async () => {
    const { call, sent } = await setup();
    await expect(call('coll.validator.get', { profileId: 'p1', ...target })).resolves.toEqual({
      validator: '{"$jsonSchema":{"bsonType":"object","required":["sku"]}}',
      validationLevel: 'moderate',
      validationAction: 'error',
    });
    await expect(call('coll.validator.set', { profileId: 'p1', ...setParams })).resolves.toEqual(
      {},
    );
    await expect(
      call('coll.validator.check', { profileId: 'p1', ...target, ids: '["sku-1","sku-2"]' }),
    ).resolves.toEqual({ invalid: '["sku-2"]', hasValidator: true });
    await expect(
      call('coll.validator.check', {
        profileId: 'p1',
        ...target,
        ids: '["sku-1"]',
        validator: '{"sku":{"$exists":true}}',
      }),
    ).resolves.toEqual({ invalid: '["sku-2"]', hasValidator: true });
    expect(sent.map((s) => [s.db, s.command])).toEqual([
      ['shop', { listCollections: 1, filter: { name: 'orders' }, cursor: {} }],
      [
        'shop',
        {
          collMod: 'orders',
          validator: SCHEMA,
          validationLevel: 'strict',
          validationAction: 'warn',
        },
      ],
      ['shop', { listCollections: 1, filter: { name: 'orders' }, cursor: {} }],
      [
        'shop',
        {
          find: 'orders',
          filter: { _id: { $in: ['sku-1', 'sku-2'] }, $nor: [SCHEMA] },
          projection: { _id: 1 },
        },
      ],
      [
        'shop',
        {
          find: 'orders',
          filter: { _id: { $in: ['sku-1'] }, $nor: [{ sku: { $exists: true } }] },
          projection: { _id: 1 },
        },
      ],
    ]);
  });

  it('coll.validator.set with a null validator removes it', async () => {
    const { call, sent } = await setup();
    await call('coll.validator.set', { profileId: 'p1', ...setParams, validator: null });
    expect(sent.map((s) => s.command)).toEqual([
      { collMod: 'orders', validator: {}, validationLevel: 'strict', validationAction: 'warn' },
    ]);
  });

  it.each([
    ['coll.validator.get', 'listCollections', {}],
    ['coll.validator.check', 'find', { ids: '["a"]' }],
  ])(
    '%s (a read) answers CANCELLED at once while its server command is pending',
    async (method, commandName, params) => {
      let release!: () => void;
      const { call } = await setup((db, command) =>
        commandName in command
          ? new Promise<Document>((resolve) => {
              release = () => resolve(defaultAnswer(db, command) as Document);
            })
          : defaultAnswer(db, command),
      );
      const controller = new AbortController();
      const pending = call(method, { profileId: 'p1', ...target, ...params }, controller.signal);
      // Let the handler send its command before cancelling.
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
      release();
    },
  );

  it('coll.validator.set is not cancellable once sent: a cancel waits for the server answer', async () => {
    let release!: () => void;
    const { call } = await setup((db, command) =>
      'collMod' in command
        ? new Promise<Document>((resolve) => {
            release = () => resolve({ ok: 1 });
          })
        : defaultAnswer(db, command),
    );
    const controller = new AbortController();
    let settled = false;
    const pending = call(
      'coll.validator.set',
      { profileId: 'p1', ...setParams },
      controller.signal,
    ).finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    release();
    await expect(pending).resolves.toEqual({});
  });
});
