import { methods, type Profile } from '@thicket/contract';
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
import { shellHandlers } from './handlers';
import type { ShellHost } from './host';

const profile: Profile = {
  id: 'p1',
  name: 'Local',
  connectionString: 'mongodb://db.example.test:27017',
  readOnly: true,
  production: false,
};

async function connectedManager() {
  const client: ClientLike = {
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: () => ({ command: () => Promise.resolve({ ok: 1 }) }),
  };
  const manager = new ConnectionManager({
    loadProfile: (id) =>
      id === 'p1' ? Promise.resolve(profile) : Promise.reject(new RpcError('NOT_FOUND', id)),
    loadSecrets: () => Promise.resolve(null),
    createClient: () => client,
  });
  await manager.open('p1', undefined);
  return manager;
}

/** A host double recording its calls (the real host is covered by host.spec.ts). */
function fakeHost() {
  const sessions = new Set(['s1']);
  return {
    open: vi.fn((_profileId: string, _config: unknown, db: string | undefined) =>
      Promise.resolve({ sessionId: 's1', db: db ?? 'test' }),
    ),
    has: vi.fn((id: string) => sessions.has(id)),
    // The 4th argument (the stream signal) is checked through the mock's calls.
    eval: vi.fn((...args: [string, string, (o: unknown) => void, AbortSignal?]) => {
      const emit = args[2];
      emit({ kind: 'print', text: 'hi' });
      emit({ kind: 'result', text: '1', value: '{"$numberInt":"1"}' });
      return Promise.resolve(2);
    }),
    complete: vi.fn(() => Promise.resolve(['db.c.find', 'db.c.findOne'])),
    close: vi.fn((id: string) =>
      sessions.has(id)
        ? Promise.resolve()
        : Promise.reject(new RpcError('NOT_FOUND', `No shell session ${id}`)),
    ),
  };
}

async function setup() {
  const manager = await connectedManager();
  const host = fakeHost();
  const handlers = shellHandlers(manager, host as unknown as ShellHost);
  const producers: StreamProducer[] = [];
  const context = (signal = new AbortController().signal, streaming = true): HandlerContext => ({
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
  const call = (method: string, params: unknown, ctx = context()) =>
    new Promise<unknown>((resolve) => resolve((handlers[method] as Handler)(params as never, ctx)));
  return { manager, host, handlers, call, context, producers };
}

function sink(signal = new AbortController().signal): StreamSink & { batches: unknown[] } {
  const batches: unknown[] = [];
  return { streamId: 'stream-1', signal, batches, send: (payload) => batches.push(payload) };
}

describe('shellHandlers', () => {
  it('serves exactly shell.open/eval/complete/close', async () => {
    const { handlers } = await setup();
    expect(Object.keys(handlers).sort()).toEqual([
      'shell.close',
      'shell.complete',
      'shell.eval',
      'shell.open',
    ]);
  });

  it("shell.open starts a session on the open connection's driver configuration", async () => {
    const { call, host, manager } = await setup();
    const controller = new AbortController();
    await expect(
      call(
        'shell.open',
        { profileId: 'p1', db: 'shop' },
        {
          signal: controller.signal,
          requestId: 'r1',
        },
      ),
    ).resolves.toEqual({ sessionId: 's1', db: 'shop' });
    expect(host.open).toHaveBeenCalledWith('p1', manager.configOf('p1'), 'shop', controller.signal);
  });

  it('shell.open answers NOT_CONNECTED without an open connection (no session started)', async () => {
    const { call, host } = await setup();
    await expect(call('shell.open', { profileId: 'p2' })).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    expect(host.open).not.toHaveBeenCalled();
  });

  it('shell.eval opens a stream; its producer streams the outputs with the stream signal', async () => {
    const { call, host, producers } = await setup();
    await expect(call('shell.eval', { sessionId: 's1', code: '1' })).resolves.toEqual({
      streamId: 'stream-1',
    });
    // Nothing is evaluated before the stream starts.
    expect(host.eval).not.toHaveBeenCalled();
    const controller = new AbortController();
    const out = sink(controller.signal);
    await expect(producers[0]?.(out)).resolves.toBe(2);
    expect(out.batches).toEqual([
      { kind: 'print', text: 'hi' },
      { kind: 'result', text: '1', value: '{"$numberInt":"1"}' },
    ]);
    expect(host.eval).toHaveBeenCalledWith('s1', '1', expect.any(Function), controller.signal);
  });

  it('shell.eval answers NOT_FOUND for an unknown session before a stream exists', async () => {
    const { call, producers } = await setup();
    await expect(call('shell.eval', { sessionId: 'nope', code: '1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(producers).toEqual([]);
  });

  it('shell.eval needs a streaming server', async () => {
    const { call, context } = await setup();
    await expect(
      call('shell.eval', { sessionId: 's1', code: '1' }, context(undefined, false)),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it.each([
    ['db.c.fi', 7, 'db.c.fi'],
    ['db.c.fi({})', 7, 'db.c.fi'],
    ['db.c.find()', 0, ''],
  ])(
    'shell.complete of %j at %i completes the text before the cursor (%j)',
    async (code, cursor, before) => {
      const { call, host } = await setup();
      const controller = new AbortController();
      await expect(
        call(
          'shell.complete',
          { sessionId: 's1', code, cursor },
          {
            signal: controller.signal,
            requestId: 'r1',
          },
        ),
      ).resolves.toEqual({ completions: ['db.c.find', 'db.c.findOne'] });
      expect(host.complete).toHaveBeenCalledWith('s1', before, controller.signal);
    },
  );

  it('shell.close answers {} and passes NOT_FOUND on', async () => {
    const { call, host } = await setup();
    await expect(call('shell.close', { sessionId: 's1' })).resolves.toEqual({});
    expect(host.close).toHaveBeenCalledWith('s1');
    await expect(call('shell.close', { sessionId: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('shellHandlers served (contract validation)', () => {
  async function served() {
    const { manager, host } = await setup();
    const [clientPort, serverPort] = portPair();
    const stop = serve(serverPort, {
      table: methods,
      route: 'backend',
      handlers: shellHandlers(manager, host as unknown as ShellHost),
    });
    const received: { id?: string; stream?: string; kind?: string; payload?: unknown }[] = [];
    clientPort.onMessage((m) => received.push(m as never));
    const response = async (id: string) => {
      await vi.waitFor(() => expect(received.find((m) => m.id === id)).toBeDefined());
      return received.find((m) => m.id === id);
    };
    return { clientPort, received, response, stop, host };
  }

  it('shell.eval is not write-guarded: it streams outputs and ends with delivered', async () => {
    const s = await served();
    s.clientPort.send({ id: 'e', method: 'shell.eval', params: { sessionId: 's1', code: '1' } });
    const answer = (await s.response('e')) as { result: { streamId: string } };
    await vi.waitFor(() =>
      expect(
        s.received.find((m) => m.stream === answer.result.streamId && m.kind === 'end'),
      ).toBeDefined(),
    );
    expect(
      s.received.filter((m) => m.stream === answer.result.streamId).map((m) => [m.kind, m.payload]),
    ).toEqual([
      ['data', { kind: 'print', text: 'hi' }],
      ['data', { kind: 'result', text: '1', value: '{"$numberInt":"1"}' }],
      ['end', { delivered: 2 }],
    ]);
    s.stop();
  });

  it('refuses invalid params by the contract (empty session id, negative cursor)', async () => {
    const s = await served();
    s.clientPort.send({ id: 'a', method: 'shell.eval', params: { sessionId: '', code: '1' } });
    s.clientPort.send({
      id: 'b',
      method: 'shell.complete',
      params: { sessionId: 's1', code: 'db.', cursor: -1 },
    });
    s.clientPort.send({ id: 'c', method: 'shell.open', params: {} });
    for (const id of ['a', 'b', 'c']) {
      expect(await s.response(id)).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    }
    expect(s.host.eval).not.toHaveBeenCalled();
    expect(s.host.complete).not.toHaveBeenCalled();
    s.stop();
  });
});
