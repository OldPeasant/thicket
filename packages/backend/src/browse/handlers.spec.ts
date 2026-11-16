import type { Profile } from '@thicket/contract';
import { BSON, type Document } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { ConnectionManager, type ClientLike } from '../connections/manager';
import { RpcError, type Handler } from '../server/rpc';
import { browseHandlers } from './handlers';

const profile: Profile = {
  id: 'p1',
  name: 'Local',
  connectionString: 'mongodb://db.example.test:27017',
  readOnly: false,
  production: false,
};

type Answer = (db: string, command: Document) => Document | Promise<Document>;

const defaultAnswer: Answer = (_db, command) => {
  if ('hello' in command) return { isWritablePrimary: true, ok: 1 };
  if ('buildInfo' in command) return { version: '8.2.0', ok: 1 };
  if ('listDatabases' in command) return { databases: [{ name: 'shop' }], ok: 1 };
  if ('listCollections' in command || 'aggregate' in command) {
    return { cursor: { id: BSON.Long.fromNumber(0), firstBatch: [] }, ok: 1 };
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
  const handlers = browseHandlers(manager);
  const call = (method: string, params: unknown, signal = new AbortController().signal) =>
    Promise.resolve((handlers[method] as Handler)(params as never, { signal, requestId: 'r1' }));
  return { handlers, call, sent };
}

describe('browseHandlers', () => {
  it('serves exactly db.listDatabases/create/drop/stats and coll.list/create/drop/rename/stats', async () => {
    const { handlers } = await setup();
    expect(Object.keys(handlers).sort()).toEqual([
      'coll.create',
      'coll.drop',
      'coll.list',
      'coll.rename',
      'coll.stats',
      'db.create',
      'db.drop',
      'db.listDatabases',
      'db.stats',
    ]);
  });

  it.each([
    ['db.listDatabases', {}],
    ['db.create', { db: 'shop', firstCollection: 'orders' }],
    ['db.drop', { db: 'shop' }],
    ['db.stats', { db: 'shop' }],
    ['coll.list', { db: 'shop' }],
    ['coll.create', { db: 'shop', coll: 'orders' }],
    ['coll.drop', { db: 'shop', coll: 'orders' }],
    ['coll.rename', { db: 'shop', coll: 'orders', newName: 'orders2' }],
    ['coll.stats', { db: 'shop', coll: 'orders' }],
  ])('%s answers NOT_CONNECTED for a profile without an open connection', async (method, p) => {
    const { call, sent } = await setup();
    await expect(call(method, { profileId: 'p2', ...p })).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    expect(sent).toEqual([]);
  });

  it('db.listDatabases asks names only unless withSizes', async () => {
    const { call, sent } = await setup();
    await expect(call('db.listDatabases', { profileId: 'p1' })).resolves.toEqual({
      databases: [{ name: 'shop' }],
    });
    await call('db.listDatabases', { profileId: 'p1', withSizes: true });
    const lists = sent.filter((s) => 'listDatabases' in s.command).map((s) => s.command);
    expect(lists).toEqual([
      { listDatabases: 1, nameOnly: true },
      { listDatabases: 1, nameOnly: false },
    ]);
  });

  it('coll.rename sends dropTarget false unless asked', async () => {
    const { call, sent } = await setup();
    await call('coll.rename', { profileId: 'p1', db: 'shop', coll: 'a', newName: 'b' });
    await call('coll.rename', {
      profileId: 'p1',
      db: 'shop',
      coll: 'a',
      newName: 'b',
      dropTarget: true,
    });
    expect(sent.map((s) => s.command['dropTarget'])).toEqual([false, true]);
  });

  it('pass db, collection and options of each request to the server', async () => {
    const { call, sent } = await setup();
    await call('db.create', { profileId: 'p1', db: 'shop', firstCollection: 'orders' });
    await call('db.drop', { profileId: 'p1', db: 'old' });
    await call('db.stats', { profileId: 'p1', db: 'shop' });
    await call('coll.list', { profileId: 'p1', db: 'shop' });
    await call('coll.create', {
      profileId: 'p1',
      db: 'shop',
      coll: 'logs',
      options: '{"capped":true,"size":{"$numberInt":"1024"}}',
    });
    await call('coll.drop', { profileId: 'p1', db: 'shop', coll: 'logs' });
    await call('coll.stats', { profileId: 'p1', db: 'shop', coll: 'orders' }).catch(
      (e: unknown) => e,
    );
    expect(sent.map((s) => [s.db, Object.keys(s.command)[0], Object.values(s.command)[0]])).toEqual(
      [
        ['shop', 'create', 'orders'],
        ['old', 'dropDatabase', 1],
        ['shop', 'dbStats', 1],
        ['shop', 'listCollections', 1],
        ['shop', 'create', 'logs'],
        ['shop', 'drop', 'logs'],
        ['shop', 'aggregate', 'orders'],
      ],
    );
  });

  it('a cancel answers CANCELLED at once while the server command is still running', async () => {
    let release!: () => void;
    const { call } = await setup((db, command) =>
      'dbStats' in command
        ? new Promise<Document>((resolve) => {
            release = () => resolve({ ok: 1 });
          })
        : defaultAnswer(db, command),
    );
    const controller = new AbortController();
    const pending = call('db.stats', { profileId: 'p1', db: 'shop' }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    release();
  });

  it.each([
    ['db.create', 'create', { db: 'shop', firstCollection: 'orders' }],
    ['db.drop', 'dropDatabase', { db: 'shop' }],
    ['coll.create', 'create', { db: 'shop', coll: 'orders' }],
    ['coll.drop', 'drop', { db: 'shop', coll: 'orders' }],
    ['coll.rename', 'renameCollection', { db: 'shop', coll: 'orders', newName: 'orders2' }],
  ])(
    '%s is not cancellable once sent: a cancel waits for the server answer',
    async (method, commandName, params) => {
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
      const pending = call(method, { profileId: 'p1', ...params }, controller.signal).finally(
        () => {
          settled = true;
        },
      );
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(settled).toBe(false);
      release();
      await expect(pending).resolves.toEqual({});
    },
  );

  it.each([
    ['db.listDatabases', 'listDatabases', {}],
    ['db.stats', 'dbStats', { db: 'shop' }],
    ['coll.list', 'listCollections', { db: 'shop' }],
    ['coll.stats', 'aggregate', { db: 'shop', coll: 'orders' }],
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
      const pending = call(method, { profileId: 'p1', ...params }, controller.signal);
      // Let the handler send its command before cancelling.
      await new Promise((resolve) => setTimeout(resolve, 0));
      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
      release();
    },
  );

  it.each([
    ['db.create', 'create', { db: 'shop', firstCollection: 'orders' }],
    ['db.drop', 'dropDatabase', { db: 'shop' }],
    ['coll.create', 'create', { db: 'shop', coll: 'orders' }],
    ['coll.drop', 'drop', { db: 'shop', coll: 'orders' }],
    ['coll.rename', 'renameCollection', { db: 'shop', coll: 'orders', newName: 'orders2' }],
  ])(
    '%s with a signal already aborted still sends the write and answers its result',
    async (method, commandName, params) => {
      const { call, sent } = await setup();
      const controller = new AbortController();
      controller.abort();
      await expect(
        call(method, { profileId: 'p1', ...params }, controller.signal),
      ).resolves.toEqual({});
      expect(sent.map((s) => Object.keys(s.command)[0])).toEqual([commandName]);
    },
  );

  it('a cancelled write answers the server error when the write fails', async () => {
    const { call } = await setup((db, command) =>
      'drop' in command
        ? Promise.reject(
            Object.assign(new Error('ns not found'), {
              name: 'MongoServerError',
              code: 26,
              codeName: 'NamespaceNotFound',
            }),
          )
        : defaultAnswer(db, command),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      call('coll.drop', { profileId: 'p1', db: 'shop', coll: 'ghost' }, controller.signal),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a request already cancelled answers CANCELLED', async () => {
    const { call } = await setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      call('coll.list', { profileId: 'p1', db: 'shop' }, controller.signal),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
