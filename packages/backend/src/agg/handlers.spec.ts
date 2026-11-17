import { methods, type Profile } from '@thicket/contract';
import { BSON, type Document } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';

import { ConnectionManager, type ClientLike } from '../connections/manager';
import {
  RpcError,
  serve,
  type Handler,
  type HandlerContext,
  type StreamProducer,
  type StreamSink,
} from '../server/rpc';
import { portPair } from '../server/testing';
import { aggHandlers } from './handlers';

const profile: Profile = {
  id: 'p1',
  name: 'Local',
  connectionString: 'mongodb://db.example.test:27017',
  readOnly: false,
  production: false,
};

type Answer = (db: string, command: Document) => Document | Promise<Document>;

const cursorReply = (id: number, batch: Document[], first = true): Document => ({
  cursor: { id, ns: 'shop.orders', [first ? 'firstBatch' : 'nextBatch']: batch },
  ok: 1,
});

const defaultAnswer: Answer = (_db, command) => {
  if ('hello' in command) return { isWritablePrimary: true, ok: 1 };
  if ('buildInfo' in command) return { version: '8.2.0', ok: 1 };
  if ('explain' in command) return { queryPlanner: { winningPlan: { stage: 'COLLSCAN' } }, ok: 1 };
  if ('aggregate' in command) return cursorReply(0, [{ _id: 1 }, { _id: 2 }]);
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
  const handlers = aggHandlers(manager);
  const producers: StreamProducer[] = [];
  const context = (signal: AbortSignal, streaming = true): HandlerContext => ({
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
  const call = (
    method: string,
    params: unknown,
    signal = new AbortController().signal,
    streaming = true,
  ) =>
    // agg.run is synchronous and may throw at once (serve awaits it inside a try).
    new Promise<unknown>((resolve) =>
      resolve((handlers[method] as Handler)(params as never, context(signal, streaming))),
    );
  return { manager, handlers, call, sent, producers };
}

const base = { profileId: 'p1', db: 'shop', coll: 'orders' };
const ejson = (value: unknown) => BSON.EJSON.stringify(value, { relaxed: false });
const pipeline = ejson([{ $match: { status: 'open' } }]);
const firstKeys = (sent: { command: Document }[]) => sent.map((s) => Object.keys(s.command)[0]);

/** A sink that records what a producer sends. */
function sink(signal = new AbortController().signal): StreamSink & { batches: unknown[] } {
  const batches: unknown[] = [];
  return { streamId: 'stream-1', signal, batches, send: (payload) => batches.push(payload) };
}

describe('aggHandlers', () => {
  it('serves exactly agg.run/previewStage/explain/createView', async () => {
    const { handlers } = await setup();
    expect(Object.keys(handlers).sort()).toEqual([
      'agg.createView',
      'agg.explain',
      'agg.previewStage',
      'agg.run',
    ]);
  });

  it.each([
    ['agg.run', { ...base, pipeline }],
    ['agg.previewStage', { ...base, pipeline }],
    ['agg.explain', { ...base, target: { kind: 'aggregate', pipeline } }],
    ['agg.createView', { profileId: 'p1', db: 'shop', view: 'v', viewOn: 'orders', pipeline }],
  ])('%s answers NOT_CONNECTED for a profile without an open connection', async (method, p) => {
    const { call, sent, producers } = await setup();
    await expect(call(method, { ...p, profileId: 'p2' })).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    expect(sent).toEqual([]);
    expect(producers).toEqual([]);
  });

  it('agg.run opens a stream; its producer streams the documents', async () => {
    const { call, producers, sent } = await setup();
    await expect(call('agg.run', { ...base, pipeline })).resolves.toEqual({
      streamId: 'stream-1',
    });
    // Nothing runs before the stream starts.
    expect(sent).toEqual([]);
    const out = sink();
    await expect(producers[0]?.(out)).resolves.toBe(2);
    expect(out.batches).toEqual([
      { docs: ['{"_id":{"$numberInt":"1"}}', '{"_id":{"$numberInt":"2"}}'] },
    ]);
    expect(firstKeys(sent)).toEqual(['aggregate']);
    expect(sent[0]?.command).toMatchObject({ aggregate: 'orders', pipeline: [{ $match: {} }] });
  });

  it('agg.run refuses invalid params before a stream exists', async () => {
    const { call, producers } = await setup();
    for (const p of [
      { pipeline: '{"$match":{}}' },
      { pipeline: '[{"$match":{},"$limit":1}]' },
      { pipeline, collation: '[1]' },
      { pipeline, hint: '{"a":' },
    ]) {
      await expect(call('agg.run', { ...base, ...p })).rejects.toMatchObject({
        code: 'INVALID_PARAMS',
      });
    }
    expect(producers).toEqual([]);
  });

  it('agg.run needs a streaming server', async () => {
    const { call } = await setup();
    await expect(
      call('agg.run', { ...base, pipeline }, new AbortController().signal, false),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('agg.run ends CANCELLED when conn.close closed its connection meanwhile', async () => {
    let failAggregate: (error: Error) => void = () => undefined;
    const { call, producers, manager } = await setup((db, command) =>
      'aggregate' in command
        ? new Promise<Document>((_resolve, reject) => (failAggregate = reject))
        : defaultAnswer(db, command),
    );
    await call('agg.run', { ...base, pipeline });
    const running = producers[0]?.(sink());
    await manager.close('p1');
    failAggregate(new Error('Topology is closed'));
    await expect(running).rejects.toMatchObject({
      code: 'CANCELLED',
      message: 'The connection was closed',
    });
  });

  it('agg.run ends CANCELLED when its connection was closed and reopened meanwhile', async () => {
    let failAggregate: (error: Error) => void = () => undefined;
    let aggregateSent = false;
    const clients: ClientLike[] = [];
    const manager = new ConnectionManager({
      loadProfile: () => Promise.resolve(profile),
      loadSecrets: () => Promise.resolve(null),
      createClient: () => {
        const client: ClientLike = {
          connect: () => Promise.resolve(),
          close: () => Promise.resolve(),
          db: () => ({
            command: async (command: Document) =>
              'aggregate' in command
                ? new Promise<Document>((_resolve, reject) => {
                    failAggregate = reject;
                    aggregateSent = true;
                  })
                : defaultAnswer('admin', command),
          }),
        };
        clients.push(client);
        return client;
      },
    });
    await manager.open('p1', undefined);
    const producers: StreamProducer[] = [];
    const handler = aggHandlers(manager)['agg.run'] as Handler;
    await handler({ ...base, pipeline } as never, {
      signal: new AbortController().signal,
      requestId: 'r1',
      openStream: (producer) => {
        producers.push(producer);
        return 'stream-1';
      },
    });
    const running = producers[0]?.(sink());
    await vi.waitFor(() => expect(aggregateSent).toBe(true));
    await manager.close('p1');
    await manager.open('p1', undefined);
    expect(clients).toHaveLength(2);
    failAggregate(new Error('Topology is closed'));
    await expect(running).rejects.toMatchObject({
      code: 'CANCELLED',
      message: 'The connection was closed',
    });
  });

  it('agg.run passes a failure on unchanged while its connection is open', async () => {
    const { call, producers } = await setup((db, command) => {
      if ('aggregate' in command) throw new Error('boom');
      return defaultAnswer(db, command);
    });
    await call('agg.run', { ...base, pipeline });
    await expect(producers[0]?.(sink())).rejects.toMatchObject({
      code: 'INTERNAL',
      message: 'Unexpected error while browsing: boom',
    });
  });

  it('agg.previewStage, explain and createView answer from the server', async () => {
    const { call, sent } = await setup();
    await expect(
      call('agg.previewStage', { ...base, pipeline, sampleSize: 4, limit: 1 }),
    ).resolves.toEqual({ docs: ['{"_id":{"$numberInt":"1"}}'] });
    expect(sent[0]?.command['pipeline']).toEqual([
      { $limit: 4 },
      { $match: { status: 'open' } },
      { $limit: 1 },
    ]);
    const explained = (await call('agg.explain', {
      ...base,
      target: { kind: 'aggregate', pipeline },
    })) as { explain: string };
    expect(BSON.EJSON.parse(explained.explain)).toMatchObject({
      queryPlanner: { winningPlan: { stage: 'COLLSCAN' } },
    });
    await expect(
      call('agg.createView', {
        profileId: 'p1',
        db: 'shop',
        view: 'openOrders',
        viewOn: 'orders',
        pipeline,
      }),
    ).resolves.toEqual({});
    expect(sent.at(-1)?.command).toEqual({
      create: 'openOrders',
      viewOn: 'orders',
      pipeline: [{ $match: { status: 'open' } }],
    });
  });

  it.each([
    ['agg.previewStage', { ...base, pipeline }],
    ['agg.explain', { ...base, target: { kind: 'aggregate', pipeline } }],
    ['agg.createView', { profileId: 'p1', db: 'shop', view: 'v', viewOn: 'orders', pipeline }],
  ])('%s answers CANCELLED at once when the request is cancelled', async (method, p) => {
    const { call } = await setup((_db, command) =>
      'currentOp' in command ? { inprog: [], ok: 1 } : new Promise(() => undefined),
    );
    const controller = new AbortController();
    const pending = call(method, p, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('aggHandlers served (contract validation, streams)', () => {
  interface Message {
    id?: string;
    ok?: boolean;
    result?: { streamId: string };
    error?: { code: string };
    stream?: string;
    kind?: string;
    payload?: unknown;
  }

  async function served(answer: Answer) {
    const { manager, sent } = await setup(answer);
    const [clientPort, serverPort] = portPair();
    const stop = serve(serverPort, {
      table: methods,
      route: 'backend',
      handlers: aggHandlers(manager),
    });
    const received: Message[] = [];
    clientPort.onMessage((m) => received.push(m as Message));
    const response = async (id: string) => {
      await vi.waitFor(() => expect(received.find((m) => m.id === id)).toBeDefined());
      return received.find((m) => m.id === id) as Message;
    };
    const final = async (stream: string) => {
      await vi.waitFor(() =>
        expect(received.find((m) => m.stream === stream && m.kind !== 'data')).toBeDefined(),
      );
      return received.filter((m) => m.stream === stream);
    };
    return { clientPort, received, response, final, sent, stop };
  }

  it('streams an aggregate as data events of batchSize and end', async () => {
    const s = await served((db, command) =>
      'getMore' in command
        ? cursorReply(0, [{ _id: 3 }], false)
        : 'aggregate' in command
          ? cursorReply(5, [{ _id: 1 }, { _id: 2 }])
          : defaultAnswer(db, command),
    );
    s.clientPort.send({ id: 'a', method: 'agg.run', params: { ...base, pipeline, batchSize: 2 } });
    const { result } = await s.response('a');
    const events = await s.final(result?.streamId ?? '');
    expect(events.map((e) => [e.kind, e.payload])).toEqual([
      ['data', { docs: ['{"_id":{"$numberInt":"1"}}', '{"_id":{"$numberInt":"2"}}'] }],
      ['data', { docs: ['{"_id":{"$numberInt":"3"}}'] }],
      ['end', { delivered: 3 }],
    ]);
    s.stop();
  });

  it('refuses a pipeline that is not EJSON array text by the contract', async () => {
    const s = await served(defaultAnswer);
    s.clientPort.send({ id: 'a', method: 'agg.run', params: { ...base, pipeline: '{}' } });
    expect(await s.response('a')).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    expect(s.sent).toEqual([]);
    s.stop();
  });

  it('refuses $out in agg.previewStage with INVALID_PARAMS', async () => {
    const s = await served(defaultAnswer);
    s.clientPort.send({
      id: 'p',
      method: 'agg.previewStage',
      params: { ...base, pipeline: ejson([{ $out: 'archive' }]) },
    });
    expect(await s.response('p')).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    expect(s.sent).toEqual([]);
    s.stop();
  });

  it('a stream cancel kills the server operation and cursor before CANCELLED is sent', async () => {
    let releaseAggregate: (reply: Document) => void = () => undefined;
    const s = await served((db, command) => {
      if ('aggregate' in command) {
        return new Promise<Document>((resolve) => (releaseAggregate = resolve));
      }
      if ('currentOp' in command) return { inprog: [{ opid: 12 }], ok: 1 };
      return defaultAnswer(db, command);
    });
    s.clientPort.send({ id: 'a', method: 'agg.run', params: { ...base, pipeline } });
    const streamId = (await s.response('a')).result?.streamId ?? '';
    await vi.waitFor(() => expect(firstKeys(s.sent)).toEqual(['aggregate']));
    s.clientPort.send({ cancel: streamId });
    await vi.waitFor(() => expect(firstKeys(s.sent)).toContain('killOp'));
    releaseAggregate(cursorReply(31, [{ _id: 1 }]));
    const events = await s.final(streamId);
    expect(events).toEqual([
      {
        stream: streamId,
        kind: 'error',
        payload: { code: 'CANCELLED', message: 'The operation was cancelled' },
      },
    ]);
    expect(firstKeys(s.sent)).toEqual(['aggregate', 'currentOp', 'killOp', 'killCursors']);
    expect(s.sent.at(-1)?.command).toEqual({ killCursors: 'orders', cursors: [31] });
    s.stop();
  });
});
