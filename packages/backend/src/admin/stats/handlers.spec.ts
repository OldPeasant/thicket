import type { Profile } from '@thicket/contract';
import { BSON, MongoServerError, type Document } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { ConnectionManager, type ClientLike } from '../../connections/manager';
import { RpcError, type Handler } from '../../server/rpc';
import { statsHandlers } from './handlers';

const profile: Profile = {
  id: 'p1',
  name: 'Local',
  connectionString: 'mongodb://db.example.test:27017',
  readOnly: false,
  production: false,
};

type Answer = (db: string, command: Document) => Document | Promise<Document>;

const STATUS: Document = {
  host: 'db1',
  version: '8.2.1',
  uptime: 120,
  opcounters: { insert: BSON.Long.fromNumber(5), query: 7 },
  connections: { current: 3, available: 800 },
  ok: 1,
};

const RS: Document = {
  set: 'rs0',
  members: [{ _id: 0, name: 'db1:27017', stateStr: 'PRIMARY', health: 1 }],
  ok: 1,
};

const defaultAnswer: Answer = (_db, command) => {
  if ('hello' in command) return { isWritablePrimary: true, ok: 1 };
  if ('serverStatus' in command) return STATUS;
  if ('replSetGetStatus' in command) return RS;
  return { ok: 1 };
};

function serverError(code: number, codeName: string, message: string): MongoServerError {
  return new MongoServerError({ ok: 0, code, codeName, errmsg: message });
}

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
  const handlers = statsHandlers(manager);
  const call = (method: string, params: unknown, signal = new AbortController().signal) =>
    Promise.resolve((handlers[method] as Handler)(params as never, { signal, requestId: 'r1' }));
  return { handlers, call, sent };
}

const parse = (text: string) => BSON.EJSON.parse(text, { relaxed: false }) as Document;

describe('statsHandlers', () => {
  it('serves admin.serverStatus and admin.replSetStatus', async () => {
    const { handlers } = await setup();
    expect(Object.keys(handlers).sort()).toEqual(['admin.replSetStatus', 'admin.serverStatus']);
  });

  it('admin.serverStatus runs serverStatus on admin and answers canonical EJSON', async () => {
    const { call, sent } = await setup();
    const result = (await call('admin.serverStatus', { profileId: 'p1' })) as { status: string };
    expect(sent).toEqual([{ db: 'admin', command: { serverStatus: 1 } }]);
    expect(result.status).toContain('"$numberLong":"5"');
    expect(parse(result.status)['host']).toBe('db1');
  });

  it('admin.serverStatus leaves out $-named fields so the EJSON parses again', async () => {
    const { call } = await setup((db, command) =>
      'serverStatus' in command
        ? {
            ...STATUS,
            metrics: {
              operatorCounters: { match: { $regex: BSON.Long.fromNumber(2), $eq: 1 } },
              list: [{ $in: 1, keep: 2 }],
              document: { inserted: BSON.Long.fromNumber(9) },
            },
            localTime: new Date(0),
          }
        : defaultAnswer(db, command),
    );
    const { status } = (await call('admin.serverStatus', { profileId: 'p1' })) as {
      status: string;
    };
    const doc = parse(status);
    expect(doc['metrics']).toEqual({
      operatorCounters: { match: {} },
      list: [{ keep: new BSON.Int32(2) }],
      document: { inserted: BSON.Long.fromNumber(9) },
    });
    expect(doc['localTime']).toEqual(new Date(0));
  });

  it('admin.replSetStatus runs replSetGetStatus on admin', async () => {
    const { call, sent } = await setup();
    const result = (await call('admin.replSetStatus', { profileId: 'p1' })) as {
      status: string | null;
    };
    expect(sent).toEqual([{ db: 'admin', command: { replSetGetStatus: 1 } }]);
    expect(parse(result.status ?? '{}')['set']).toBe('rs0');
  });

  it.each([
    [76, 'NoReplicationEnabled', 'not running with --replSet'],
    [59, 'CommandNotFound', 'no such cmd: replSetGetStatus'],
  ])('admin.replSetStatus answers null for %s (%s)', async (code, codeName, message) => {
    const { call } = await setup((db, command) => {
      if ('replSetGetStatus' in command) throw serverError(code, codeName, message);
      return defaultAnswer(db, command);
    });
    await expect(call('admin.replSetStatus', { profileId: 'p1' })).resolves.toEqual({
      status: null,
    });
  });

  it('admin.replSetStatus answers other refusals as SERVER_ERROR', async () => {
    const { call } = await setup((db, command) => {
      if ('replSetGetStatus' in command) throw serverError(13, 'Unauthorized', 'not authorized');
      return defaultAnswer(db, command);
    });
    await expect(call('admin.replSetStatus', { profileId: 'p1' })).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      detail: { serverCode: 13, codeName: 'Unauthorized' },
    });
  });

  it('admin.replSetStatus does not mistake a failure without a server code for a standalone', async () => {
    const { call } = await setup((db, command) => {
      if ('replSetGetStatus' in command) throw new Error('socket hang up');
      return defaultAnswer(db, command);
    });
    const failure = call('admin.replSetStatus', { profileId: 'p1' });
    await expect(failure).rejects.toBeInstanceOf(RpcError);
    await expect(failure).rejects.not.toMatchObject({ code: 'SERVER_ERROR' });
  });

  it('admin.serverStatus answers a refusal as SERVER_ERROR', async () => {
    const { call } = await setup((db, command) => {
      if ('serverStatus' in command) throw serverError(13, 'Unauthorized', 'not authorized');
      return defaultAnswer(db, command);
    });
    await expect(call('admin.serverStatus', { profileId: 'p1' })).rejects.toMatchObject({
      code: 'SERVER_ERROR',
    });
  });

  it('answers NOT_CONNECTED for a profile without an open connection', async () => {
    const { call } = await setup();
    await expect(
      Promise.resolve().then(() => call('admin.serverStatus', { profileId: 'p2' })),
    ).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });

  it('a cancelled request answers CANCELLED', async () => {
    const { call } = await setup((db, command) =>
      'serverStatus' in command
        ? new Promise<Document>(() => undefined)
        : defaultAnswer(db, command),
    );
    const controller = new AbortController();
    const pending = call('admin.serverStatus', { profileId: 'p1' }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
