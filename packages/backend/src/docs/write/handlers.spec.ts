import type { Profile } from '@thicket/contract';
import type { Document } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { ConnectionManager, type ClientLike } from '../../connections/manager';
import { RpcError, type Handler, type HandlerContext } from '../../server/rpc';
import { docsWriteHandlers } from './handlers';

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
  if ('aggregate' in command) return { cursor: { id: 0, firstBatch: [{ _id: 1, n: 2 }] }, ok: 1 };
  if ('find' in command) return { cursor: { id: 0, firstBatch: [{ _id: 1 }, { _id: 2 }] }, ok: 1 };
  if ('insert' in command || 'update' in command || 'delete' in command)
    return { n: 1, nModified: 1, ok: 1 };
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
  const handlers = docsWriteHandlers(manager);
  const call = (method: string, params: unknown, signal = new AbortController().signal) =>
    new Promise<unknown>((resolve) =>
      resolve(
        (handlers[method] as Handler)(params as never, {
          signal,
          requestId: 'r1',
        } satisfies HandlerContext),
      ),
    );
  return { handlers, call, sent };
}

const base = { profileId: 'p1', db: 'shop', coll: 'orders' };

const calls: [string, Record<string, unknown>, unknown][] = [
  ['docs.insert', { docs: ['{"_id":1}'] }, { insertedIds: ['{"$numberInt":"1"}'] }],
  ['docs.update', { id: '1', update: '{"$set":{"a":1}}', expected: '{}' }, { modified: true }],
  ['docs.replace', { id: '1', doc: '{"a":1}' }, { modified: true }],
  ['docs.delete', { id: '1' }, { deleted: true }],
  [
    'docs.previewMany',
    { filter: '{}' },
    { matched: 2, sample: ['{"_id":{"$numberInt":"1"}}', '{"_id":{"$numberInt":"2"}}'] },
  ],
  [
    'docs.updateMany',
    { confirmed: true, filter: '{}', update: '{"$set":{"a":1}}' },
    { matched: 1, modified: 1 },
  ],
  ['docs.deleteMany', { confirmed: true, filter: '{}' }, { deleted: 1 }],
];

describe('docsWriteHandlers', () => {
  it('serves exactly the document write and preview methods', async () => {
    const { handlers } = await setup();
    expect(Object.keys(handlers).sort()).toEqual(
      [
        'docs.delete',
        'docs.deleteMany',
        'docs.insert',
        'docs.previewMany',
        'docs.replace',
        'docs.update',
        'docs.updateMany',
      ].sort(),
    );
  });

  it.each(calls)('%s runs on the profile’s open connection', async (method, p, expected) => {
    const { call, sent } = await setup();
    await expect(call(method, { ...base, ...p })).resolves.toEqual(expected);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((s) => s.db === 'shop')).toBe(true);
  });

  it.each(calls)(
    '%s answers NOT_CONNECTED for a profile without an open connection',
    async (method, p) => {
      const { call, sent } = await setup();
      await expect(call(method, { ...base, profileId: 'p2', ...p })).rejects.toMatchObject({
        code: 'NOT_CONNECTED',
      });
      expect(sent).toEqual([]);
    },
  );

  it('an aborted request answers CANCELLED without writing', async () => {
    const { call, sent } = await setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      call('docs.insert', { ...base, docs: ['{"a":1}'] }, controller.signal),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(sent.filter((s) => 'insert' in s.command)).toEqual([]);
  });

  it('a request cancelled while the write runs answers CANCELLED at once', async () => {
    const { call } = await setup((db, command) =>
      'update' in command ? new Promise<Document>(() => undefined) : defaultAnswer(db, command),
    );
    const controller = new AbortController();
    const running = call(
      'docs.update',
      { ...base, id: '1', update: '{"$set":{"a":1}}', expected: '{}' },
      controller.signal,
    );
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
