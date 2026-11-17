import type { Profile } from '@thicket/contract';
import { BSON, MongoServerError, type Document } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';

import { ConnectionManager, type ClientLike } from '../../connections/manager';
import {
  RpcError,
  type Handler,
  type HandlerContext,
  type StreamProducer,
  type StreamSink,
} from '../../server/rpc';
import { watchHandlers } from './handlers';
import { NEEDS_REPLICA_SET_MESSAGE } from './watch';

const profile: Profile = {
  id: 'p1',
  name: 'Local',
  connectionString: 'mongodb://db.example.test:27017',
  readOnly: false,
  production: false,
};

type Answer = (db: string, command: Document) => Document | Promise<Document>;

const REPLICA_SET_HELLO = { isWritablePrimary: true, setName: 'rs0', ok: 1 };
const STANDALONE_HELLO = { isWritablePrimary: true, ok: 1 };

const event = (n: number, operationType: string): Document => ({
  _id: { _data: `token-${n}` },
  operationType,
  ns: { db: 'shop', coll: 'orders' },
  documentKey: { _id: n },
});

const replicaSet: Answer = (_db, command) => {
  if ('hello' in command) return REPLICA_SET_HELLO;
  if ('buildInfo' in command) return { version: '8.2.0', ok: 1 };
  if ('aggregate' in command) {
    return { cursor: { id: 0, ns: 'shop.orders', firstBatch: [event(1, 'insert')] }, ok: 1 };
  }
  return { ok: 1 };
};

async function setup(answer: Answer = replicaSet) {
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
  const handlers = watchHandlers(manager);
  const producers: StreamProducer[] = [];
  const context = (signal: AbortSignal, streaming: boolean): HandlerContext => ({
    signal,
    requestId: 'r1',
    ...(streaming
      ? {
          openStream: (producer: StreamProducer) => {
            producers.push(producer);
            return `stream-${producers.length}`;
          },
        }
      : {}),
  });
  const call = (params: unknown, signal = new AbortController().signal, streaming = true) =>
    new Promise<unknown>((resolve) =>
      resolve((handlers['admin.watch'] as Handler)(params as never, context(signal, streaming))),
    );
  return { manager, handlers, call, sent, producers };
}

/** A sink that records what a producer sends. */
function sink(signal = new AbortController().signal): StreamSink & { payloads: unknown[] } {
  const payloads: unknown[] = [];
  return { streamId: 'stream-1', signal, payloads, send: (payload) => payloads.push(payload) };
}

const base = { profileId: 'p1', db: 'shop', coll: 'orders' };
const parse = (text: string) => BSON.EJSON.parse(text, { relaxed: false }) as Document;
const commandName = (s: { command: Document }) => Object.keys(s.command)[0];

describe('watchHandlers', () => {
  it('serves exactly admin.watch', async () => {
    const { handlers } = await setup();
    expect(Object.keys(handlers)).toEqual(['admin.watch']);
  });

  it('answers NOT_CONNECTED for a profile without an open connection, sending nothing', async () => {
    const { call, sent, producers } = await setup();
    await expect(call({ ...base, profileId: 'p2' })).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    expect(sent).toEqual([]);
    expect(producers).toEqual([]);
  });

  it('answers INTERNAL without a streaming server', async () => {
    const { call, sent } = await setup();
    await expect(call(base, undefined, false)).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(sent).toEqual([]);
  });

  it('refuses a standalone server before a stream exists, with a clear needs-replica-set error', async () => {
    const { call, sent, producers } = await setup((db, command) =>
      'hello' in command ? STANDALONE_HELLO : replicaSet(db, command),
    );
    const error = await call(base).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({
      code: 'UNSUPPORTED',
      message: NEEDS_REPLICA_SET_MESSAGE,
      detail: { reason: 'needsReplicaSet' },
    });
    expect(producers).toEqual([]);
    expect(sent.map(commandName)).toEqual(['hello']);
  });

  it('refuses invalid params before asking the server anything', async () => {
    const { call, sent, producers } = await setup();
    await expect(call({ profileId: 'p1', coll: 'orders' })).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    });
    await expect(call({ ...base, pipeline: '[{"$match":{},"$limit":1}]' })).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    });
    expect(sent).toEqual([]);
    expect(producers).toEqual([]);
  });

  it('a cancelled request opens no stream', async () => {
    const controller = new AbortController();
    controller.abort();
    const { call, producers } = await setup();
    await expect(call(base, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(producers).toEqual([]);
  });

  it('returns the stream id, and the stream sends each event as { event } canonical EJSON', async () => {
    const { call, sent, producers } = await setup();
    await expect(call({ ...base, fullDocument: 'updateLookup' })).resolves.toEqual({
      streamId: 'stream-1',
    });
    // The aggregate only runs once the producer starts (after the response).
    expect(sent.map(commandName)).toEqual(['hello']);
    const out = sink();
    await expect(producers[0]?.(out)).resolves.toBe(1);
    expect(sent[1]).toEqual({
      db: 'shop',
      command: {
        aggregate: 'orders',
        pipeline: [{ $changeStream: { fullDocument: 'updateLookup' } }],
        cursor: {},
      },
    });
    expect(out.payloads).toHaveLength(1);
    const { event: text } = out.payloads[0] as { event: string };
    expect(JSON.parse(text)).toMatchObject({
      operationType: 'insert',
      documentKey: { _id: { $numberInt: '1' } },
    });
  });

  it('streams insert, update and delete in order until the server closes the cursor', async () => {
    let getMores = 0;
    const { call, producers } = await setup((db, command) => {
      if ('aggregate' in command) {
        return { cursor: { id: 11, ns: 'shop.orders', firstBatch: [event(1, 'insert')] }, ok: 1 };
      }
      if ('getMore' in command) {
        getMores += 1;
        return getMores === 1
          ? { cursor: { id: 11, nextBatch: [event(2, 'update')] }, ok: 1 }
          : { cursor: { id: 0, nextBatch: [event(3, 'delete'), event(4, 'invalidate')] }, ok: 1 };
      }
      return replicaSet(db, command);
    });
    await call(base);
    const out = sink();
    await expect(producers[0]?.(out)).resolves.toBe(4);
    expect(out.payloads.map((p) => parse((p as { event: string }).event)['operationType'])).toEqual(
      ['insert', 'update', 'delete', 'invalidate'],
    );
  });

  it('a stream cancel kills the server cursor and ends CANCELLED', async () => {
    const { call, producers, sent } = await setup((db, command) => {
      if ('aggregate' in command) return { cursor: { id: 21, firstBatch: [] }, ok: 1 };
      if ('getMore' in command) return new Promise<Document>(() => undefined);
      return replicaSet(db, command);
    });
    await call(base);
    const controller = new AbortController();
    const running = producers[0]?.(sink(controller.signal));
    await vi.waitFor(() => expect(sent.map(commandName)).toContain('getMore'));
    controller.abort();
    await expect(running).rejects.toMatchObject({
      code: 'CANCELLED',
      message: 'The operation was cancelled',
    });
    expect(sent.at(-1)).toEqual({
      db: 'shop',
      command: { killCursors: 'orders', cursors: [21] },
    });
  });

  it('closing the connection ends the stream CANCELLED after killing the cursor', async () => {
    const order: string[] = [];
    const { call, producers, manager } = await setup((db, command) => {
      order.push(String(Object.keys(command)[0]));
      if ('aggregate' in command) return { cursor: { id: 31, firstBatch: [] }, ok: 1 };
      if ('getMore' in command) return new Promise<Document>(() => undefined);
      return replicaSet(db, command);
    });
    await call(base);
    const running = producers[0]?.(sink());
    running?.catch(() => undefined);
    await vi.waitFor(() => expect(order).toContain('getMore'));
    await manager.close('p1');
    await expect(running).rejects.toMatchObject({
      code: 'CANCELLED',
      message: 'The connection was closed',
    });
    expect(order).toContain('killCursors');
  });

  it("maps the server's own replica-set refusal on the aggregate to UNSUPPORTED needsReplicaSet", async () => {
    // e.g. hello looked like a replica set, but the member refuses $changeStream.
    const { call, producers } = await setup((db, command) => {
      if ('aggregate' in command) {
        throw new MongoServerError({
          ok: 0,
          code: 40573,
          codeName: 'Location40573',
          errmsg: 'The $changeStream stage is only supported on replica sets',
        });
      }
      return replicaSet(db, command);
    });
    await call(base);
    await expect(producers[0]?.(sink())).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      detail: { reason: 'needsReplicaSet' },
    });
  });
});
