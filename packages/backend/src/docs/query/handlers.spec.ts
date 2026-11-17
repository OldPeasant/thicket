import { methods, type Profile } from '@thicket/contract';
import { BSON, type Document } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';

import { ConnectionManager, type ClientLike } from '../../connections/manager';
import {
  RpcError,
  serve,
  type Handler,
  type HandlerContext,
  type StreamProducer,
  type StreamSink,
} from '../../server/rpc';
import { portPair } from '../../server/testing';
import { docsQueryHandlers } from './handlers';

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
  if ('find' in command) return cursorReply(0, [{ _id: 1 }, { _id: 2 }]);
  if ('aggregate' in command) return cursorReply(0, [{ _id: 1, n: 2 }]);
  if ('count' in command) return { n: 9, ok: 1 };
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
  const handlers = docsQueryHandlers(manager);
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
    // docs.find is synchronous and may throw at once (serve awaits it inside a try).
    new Promise<unknown>((resolve) =>
      resolve((handlers[method] as Handler)(params as never, context(signal, streaming))),
    );
  return { manager, handlers, call, sent, producers };
}

const base = { profileId: 'p1', db: 'shop', coll: 'orders' };

/** A sink that records what a producer sends. */
function sink(signal = new AbortController().signal): StreamSink & { batches: unknown[] } {
  const batches: unknown[] = [];
  return { streamId: 'stream-1', signal, batches, send: (payload) => batches.push(payload) };
}

describe('docsQueryHandlers', () => {
  it('serves exactly docs.find/count/estimatedCount/get/getSlice', async () => {
    const { handlers } = await setup();
    expect(Object.keys(handlers).sort()).toEqual([
      'docs.count',
      'docs.estimatedCount',
      'docs.find',
      'docs.get',
      'docs.getSlice',
    ]);
  });

  it.each([
    ['docs.find', { filter: '{}' }],
    ['docs.count', { filter: '{}' }],
    ['docs.estimatedCount', {}],
    ['docs.get', { id: '"a"' }],
    ['docs.getSlice', { id: '"a"', path: 'items', skip: 0, limit: 1 }],
  ])('%s answers NOT_CONNECTED for a profile without an open connection', async (method, p) => {
    const { call, sent, producers } = await setup();
    await expect(call(method, { ...base, profileId: 'p2', ...p })).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    expect(sent).toEqual([]);
    expect(producers).toEqual([]);
  });

  it('docs.find opens a stream; its producer streams the documents', async () => {
    const { call, producers, sent } = await setup();
    await expect(call('docs.find', { ...base, filter: '{}' })).resolves.toEqual({
      streamId: 'stream-1',
    });
    // Nothing runs before the stream starts.
    expect(sent).toEqual([]);
    const out = sink();
    await expect(producers[0]?.(out)).resolves.toBe(2);
    expect(out.batches).toEqual([
      { docs: ['{"_id":{"$numberInt":"1"}}', '{"_id":{"$numberInt":"2"}}'] },
    ]);
    expect(sent.map((s) => Object.keys(s.command)[0])).toEqual(['find']);
  });

  it('docs.find refuses invalid params before a stream exists', async () => {
    const { call, producers } = await setup();
    await expect(
      call('docs.find', {
        ...base,
        filter: '{}',
        sort: '{"s":{"$meta":"textScore"}}',
        fromEnd: true,
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(call('docs.find', { ...base, filter: '{"a":' })).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    });
    expect(producers).toEqual([]);
  });

  it('docs.find ends CANCELLED when conn.close closed its connection meanwhile', async () => {
    let failFind: (error: Error) => void = () => undefined;
    const { call, producers, manager } = await setup((db, command) =>
      'find' in command
        ? new Promise<Document>((_resolve, reject) => (failFind = reject))
        : defaultAnswer(db, command),
    );
    await call('docs.find', { ...base, filter: '{}' });
    const running = producers[0]?.(sink());
    await manager.close('p1');
    failFind(new Error('Topology is closed'));
    await expect(running).rejects.toMatchObject({
      code: 'CANCELLED',
      message: 'The connection was closed',
    });
  });

  it('docs.find ends CANCELLED when its connection was closed and reopened meanwhile', async () => {
    let failFind: (error: Error) => void = () => undefined;
    let findSent = false;
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
              'find' in command
                ? new Promise<Document>((_resolve, reject) => {
                    failFind = reject;
                    findSent = true;
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
    const handler = docsQueryHandlers(manager)['docs.find'] as Handler;
    await handler({ ...base, filter: '{}' } as never, {
      signal: new AbortController().signal,
      requestId: 'r1',
      openStream: (producer) => {
        producers.push(producer);
        return 'stream-1';
      },
    });
    const running = producers[0]?.(sink());
    await vi.waitFor(() => expect(findSent).toBe(true));
    await manager.close('p1');
    await manager.open('p1', undefined);
    expect(clients).toHaveLength(2);
    failFind(new Error('Topology is closed'));
    await expect(running).rejects.toMatchObject({
      code: 'CANCELLED',
      message: 'The connection was closed',
    });
  });

  it('conn.close kills a running find (killOp, killCursors) before it closes the client', async () => {
    const order: string[] = [];
    let releaseFind: (reply: Document) => void = () => undefined;
    const client: ClientLike = {
      connect: () => Promise.resolve(),
      close: () => {
        order.push('client.close');
        return Promise.resolve();
      },
      db: () => ({
        command: async (command: Document) => {
          order.push(Object.keys(command)[0] ?? '');
          if ('find' in command) {
            return new Promise<Document>((resolve) => (releaseFind = resolve));
          }
          if ('currentOp' in command) return { inprog: [{ opid: 42 }], ok: 1 };
          if ('killOp' in command) {
            // The killed find answers with the cursor it had opened.
            releaseFind(cursorReply(77, [{ _id: 1 }]));
            return { ok: 1 };
          }
          return defaultAnswer('admin', command);
        },
      }),
    };
    const manager = new ConnectionManager({
      loadProfile: () => Promise.resolve(profile),
      loadSecrets: () => Promise.resolve(null),
      createClient: () => client,
    });
    await manager.open('p1', undefined);
    order.length = 0;
    const producers: StreamProducer[] = [];
    const handler = docsQueryHandlers(manager)['docs.find'] as Handler;
    await handler({ ...base, filter: '{}' } as never, {
      signal: new AbortController().signal,
      requestId: 'r1',
      openStream: (producer) => {
        producers.push(producer);
        return 'stream-1';
      },
    });
    const out = sink();
    const running = producers[0]?.(out);
    running?.catch(() => undefined);
    await vi.waitFor(() => expect(order).toEqual(['find']));
    await manager.close('p1');
    await expect(running).rejects.toMatchObject({
      code: 'CANCELLED',
      message: 'The connection was closed',
    });
    expect(order).toEqual(['find', 'currentOp', 'killOp', 'killCursors', 'client.close']);
    expect(out.batches).toEqual([]);
  });

  it('a finished find does not delay a later conn.close', async () => {
    vi.useFakeTimers();
    try {
      const { call, producers, manager } = await setup();
      await call('docs.find', { ...base, filter: '{}' });
      await expect(producers[0]?.(sink())).resolves.toBe(2);
      // No timer advanced: the finished stream is no longer waited for.
      await manager.close('p1');
      expect(manager.statusOf('p1')).toEqual({ profileId: 'p1', state: 'disconnected' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('docs.find passes a failure on unchanged while its connection is open', async () => {
    const { call, producers } = await setup((db, command) => {
      if ('find' in command) throw new Error('boom');
      return defaultAnswer(db, command);
    });
    await call('docs.find', { ...base, filter: '{}' });
    await expect(producers[0]?.(sink())).rejects.toMatchObject({
      code: 'INTERNAL',
      message: 'Unexpected error while browsing: boom',
    });
  });

  it('docs.find needs a streaming server', async () => {
    const { call } = await setup();
    await expect(
      call('docs.find', { ...base, filter: '{}' }, new AbortController().signal, false),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('docs.count, estimatedCount, get and getSlice answer from the server', async () => {
    const { call } = await setup((db, command) => {
      if ('aggregate' in command) {
        const pipeline = command['pipeline'] as Document[];
        if ('$group' in (pipeline.at(-1) ?? {})) return cursorReply(0, [{ _id: 1, n: 2 }]);
        return cursorReply(0, [{ isArray: true, total: 3, items: [1] }]);
      }
      return defaultAnswer(db, command);
    });
    await expect(call('docs.count', { ...base, filter: '{}' })).resolves.toEqual({ count: 2 });
    await expect(call('docs.estimatedCount', base)).resolves.toEqual({ count: 9 });
    await expect(call('docs.get', { ...base, id: '{"$numberInt":"1"}' })).resolves.toEqual({
      doc: '{"_id":{"$numberInt":"1"}}',
      sliced: [],
    });
    await expect(
      call('docs.getSlice', { ...base, id: '"a"', path: 'items', skip: 0, limit: 1 }),
    ).resolves.toEqual({ items: '[{"$numberInt":"1"}]', total: 3 });
  });

  it.each([
    ['docs.count', { filter: '{}' }],
    ['docs.estimatedCount', {}],
    ['docs.get', { id: '"a"' }],
    ['docs.getSlice', { id: '"a"', path: 'items', skip: 0, limit: 1 }],
  ])('%s answers CANCELLED at once when the request is cancelled', async (method, p) => {
    const { call } = await setup((db, command) =>
      'currentOp' in command ? { inprog: [], ok: 1 } : new Promise(() => undefined),
    );
    const controller = new AbortController();
    const pending = call(method, { ...base, ...p }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('docsQueryHandlers served (contract validation, streams)', () => {
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
      handlers: docsQueryHandlers(manager),
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

  it('streams a find as data events and end', async () => {
    const s = await served((db, command) =>
      'getMore' in command
        ? cursorReply(0, [{ _id: 3 }], false)
        : 'find' in command
          ? cursorReply(5, [{ _id: 1 }, { _id: 2 }])
          : defaultAnswer(db, command),
    );
    s.clientPort.send({
      id: 'f',
      method: 'docs.find',
      params: { ...base, filter: '{}', batchSize: 2 },
    });
    const { result } = await s.response('f');
    const events = await s.final(result?.streamId ?? '');
    expect(events.map((e) => [e.kind, e.payload])).toEqual([
      ['data', { docs: ['{"_id":{"$numberInt":"1"}}', '{"_id":{"$numberInt":"2"}}'] }],
      ['data', { docs: ['{"_id":{"$numberInt":"3"}}'] }],
      ['end', { delivered: 3 }],
    ]);
    s.stop();
  });

  it('refuses fromEnd together with skip by the contract', async () => {
    const s = await served(defaultAnswer);
    s.clientPort.send({
      id: 'f',
      method: 'docs.find',
      params: { ...base, filter: '{}', fromEnd: true, skip: 10 },
    });
    expect(await s.response('f')).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    expect(s.sent).toEqual([]);
    s.stop();
  });

  it('a stream cancel kills the server operation before CANCELLED is sent', async () => {
    let releaseFind: (reply: Document) => void = () => undefined;
    const s = await served((db, command) => {
      if ('find' in command) {
        return new Promise<Document>((resolve) => (releaseFind = resolve));
      }
      if ('currentOp' in command) return { inprog: [{ opid: 12 }], ok: 1 };
      return defaultAnswer(db, command);
    });
    s.clientPort.send({ id: 'f', method: 'docs.find', params: { ...base, filter: '{}' } });
    const streamId = (await s.response('f')).result?.streamId ?? '';
    await vi.waitFor(() => expect(s.sent.map((x) => Object.keys(x.command)[0])).toEqual(['find']));
    s.clientPort.send({ cancel: streamId });
    await vi.waitFor(() =>
      expect(s.sent.map((x) => Object.keys(x.command)[0])).toContain('killOp'),
    );
    // The interrupted find answers with an open cursor: it is killed before CANCELLED.
    releaseFind(cursorReply(31, [{ _id: 1 }]));
    const events = await s.final(streamId);
    expect(events).toEqual([
      {
        stream: streamId,
        kind: 'error',
        payload: { code: 'CANCELLED', message: 'The operation was cancelled' },
      },
    ]);
    expect(s.sent.map((x) => Object.keys(x.command)[0])).toEqual([
      'find',
      'currentOp',
      'killOp',
      'killCursors',
    ]);
    expect(s.sent.at(-1)?.command).toEqual({ killCursors: 'orders', cursors: [31] });
    s.stop();
  });

  it('a getSlice for a missing document answers NOT_FOUND', async () => {
    const s = await served((db, command) =>
      'aggregate' in command ? cursorReply(0, []) : defaultAnswer(db, command),
    );
    s.clientPort.send({
      id: 'g',
      method: 'docs.getSlice',
      params: { ...base, id: BSON.EJSON.stringify(1), path: 'items', skip: 0, limit: 5 },
    });
    expect(await s.response('g')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    s.stop();
  });
});
