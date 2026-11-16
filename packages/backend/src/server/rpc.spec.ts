import { methods, privilegedMethods, type Response } from '@thicket/contract';
import { describe, expect, it, vi } from 'vitest';

import { wiringHandlers } from './handlers';
import {
  RpcClient,
  RpcError,
  STREAM_CANCEL_GRACE_MS,
  serve,
  type Handler,
  type StreamProducer,
  type StreamSink,
} from './rpc';
import { portPair } from './testing';

function setup(handlers: Record<string, Handler>, onError = vi.fn()) {
  const [client, server] = portPair();
  const stop = serve(server, { table: methods, route: 'backend', handlers, onError });
  const responses: Response[] = [];
  client.onMessage((m) => responses.push(m as Response));
  const answer = async (id: string) => {
    await vi.waitFor(() => expect(responses.find((r) => r.id === id)).toBeDefined());
    return responses.find((r) => r.id === id);
  };
  return { client, server, stop, responses, answer, onError };
}

const handlers = wiringHandlers({ pid: 7, privileged: () => undefined });

describe('serve', () => {
  it('answers a request with the validated result', async () => {
    const { client, answer } = setup(handlers);
    client.send({ id: '1', method: 'backend.ping', params: {} });
    expect(await answer('1')).toEqual({
      id: '1',
      ok: true,
      result: { process: 'backend', pid: 7, mainReachable: false },
    });
  });

  it('refuses invalid params, unknown methods and methods of another process', async () => {
    const { client, answer } = setup(handlers);
    client.send({ id: 'a', method: 'backend.sleep', params: { ms: -1 } });
    client.send({ id: 'b', method: 'nope.nope', params: {} });
    client.send({ id: 'c', method: 'app.ping', params: {} });
    client.send({ id: 'd', method: 'db.listDatabases', params: { profileId: 'p' } });
    expect(await answer('a')).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    expect(await answer('b')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
    expect(await answer('c')).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL', message: 'app.ping is served by main, not by backend' },
    });
    expect(await answer('d')).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED' } });
  });

  it('cancels a running request: CANCELLED at once, the handler result is dropped', async () => {
    const { client, answer, responses } = setup(handlers);
    client.send({ id: 's', method: 'backend.sleep', params: { ms: 60_000 } });
    await new Promise((r) => setTimeout(r, 5));
    client.send({ cancel: 's' });
    expect(await answer('s')).toEqual({
      id: 's',
      ok: false,
      error: { code: 'CANCELLED', message: 'The operation was cancelled' },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(responses.filter((r) => r.id === 's')).toHaveLength(1);
  });

  it('ignores cancels of unknown or finished requests', async () => {
    const { client, answer, responses } = setup(handlers);
    client.send({ cancel: 'never' });
    client.send({ id: 'p', method: 'backend.ping', params: {} });
    await answer('p');
    client.send({ cancel: 'p' });
    await new Promise((r) => setTimeout(r, 10));
    expect(responses).toHaveLength(1);
  });

  it('maps thrown errors: RpcError keeps its code, others become INTERNAL', async () => {
    const onError = vi.fn();
    const { client, answer } = setup(
      {
        'backend.ping': () => {
          throw new RpcError('NOT_FOUND', 'gone', { why: 1 });
        },
        'backend.sleep': () => {
          throw new Error('boom');
        },
      },
      onError,
    );
    client.send({ id: '1', method: 'backend.ping', params: {} });
    client.send({ id: '2', method: 'backend.sleep', params: { ms: 1 } });
    expect(await answer('1')).toEqual({
      id: '1',
      ok: false,
      error: { code: 'NOT_FOUND', message: 'gone', detail: { why: 1 } },
    });
    expect(await answer('2')).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL', message: 'Unexpected error: boom' },
    });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('answers INTERNAL when a handler returns a result that breaks the contract', async () => {
    const { client, answer, onError } = setup({ 'backend.ping': () => ({ process: 'main' }) });
    client.send({ id: '1', method: 'backend.ping', params: {} });
    expect(await answer('1')).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(onError).toHaveBeenCalled();
  });

  it('answers malformed requests that carry an id, drops others and duplicate ids', async () => {
    const { client, answer, responses, onError } = setup(handlers);
    client.send({ id: 'm', params: {} });
    client.send('garbage');
    expect(await answer('m')).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    client.send({ id: 'dup', method: 'backend.sleep', params: { ms: 30 } });
    client.send({ id: 'dup', method: 'backend.ping', params: {} });
    expect(await answer('dup')).toEqual({ id: 'dup', ok: true, result: { sleptMs: 30 } });
    expect(responses.filter((r) => r.id === 'dup')).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(3);
  });

  it('a cancel sent right behind its request (same tick) still answers CANCELLED once', async () => {
    const { client, answer, responses } = setup(handlers);
    client.send({ id: 'r', method: 'backend.sleep', params: { ms: 60_000 } });
    client.send({ cancel: 'r' });
    expect(await answer('r')).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(responses.filter((r) => r.id === 'r')).toHaveLength(1);
  });

  it('drops the late result of a handler that ignores the abort signal', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const signals: AbortSignal[] = [];
    const { client, answer, responses } = setup({
      'backend.sleep': (_p, ctx) => {
        signals.push(ctx.signal);
        return new Promise((resolve) => (finish = resolve));
      },
    });
    client.send({ id: 'i', method: 'backend.sleep', params: { ms: 5 } });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    client.send({ cancel: 'i' });
    expect(await answer('i')).toMatchObject({ error: { code: 'CANCELLED' } });
    expect(signals[0]?.aborted).toBe(true);
    finish({ sleptMs: 5 });
    await new Promise((r) => setTimeout(r, 10));
    expect(responses.filter((r) => r.id === 'i')).toEqual([
      { id: 'i', ok: false, error: { code: 'CANCELLED', message: 'The operation was cancelled' } },
    ]);
  });

  it('a cancel only aborts its own request', async () => {
    const { client, answer } = setup(handlers);
    client.send({ id: 'a', method: 'backend.sleep', params: { ms: 20 } });
    client.send({ id: 'b', method: 'backend.sleep', params: { ms: 60_000 } });
    client.send({ cancel: 'b' });
    expect(await answer('b')).toMatchObject({ error: { code: 'CANCELLED' } });
    expect(await answer('a')).toEqual({ id: 'a', ok: true, result: { sleptMs: 20 } });
  });

  it('an id can be reused after its request was cancelled', async () => {
    const { client, answer, responses } = setup(handlers);
    client.send({ id: 'r', method: 'backend.sleep', params: { ms: 60_000 } });
    client.send({ cancel: 'r' });
    await answer('r');
    client.send({ id: 'r', method: 'backend.ping', params: {} });
    await vi.waitFor(() => expect(responses.filter((x) => x.id === 'r')).toHaveLength(2));
    expect(responses.filter((x) => x.id === 'r')[1]).toMatchObject({ ok: true });
  });

  it('refuses inherited object keys as method names', async () => {
    const { client, answer } = setup({ ...handlers, toString: () => 'x' });
    client.send({ id: 't', method: 'toString', params: {} });
    client.send({ id: 'p', method: '__proto__', params: {} });
    expect(await answer('t')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
    expect(await answer('p')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
  });

  it('maps a thrown non-Error value to INTERNAL', async () => {
    const { client, answer } = setup({
      'backend.ping': () => {
        throw 'plain string';
      },
    });
    client.send({ id: '1', method: 'backend.ping', params: {} });
    expect(await answer('1')).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL', message: 'Unexpected error: plain string' },
    });
  });

  it('stop() aborts running requests and stops answering', async () => {
    const seen: AbortSignal[] = [];
    const { client, stop, responses } = setup({
      'backend.sleep': (_p, ctx) => {
        seen.push(ctx.signal);
        return new Promise(() => undefined);
      },
    });
    client.send({ id: '1', method: 'backend.sleep', params: { ms: 5 } });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    stop();
    expect(seen[0]?.aborted).toBe(true);
    client.send({ id: '2', method: 'backend.ping', params: {} });
    await new Promise((r) => setTimeout(r, 10));
    expect(responses).toEqual([]);
  });
});

describe('RpcClient', () => {
  function privileged(handlers: Record<string, Handler>) {
    const [a, b] = portPair();
    serve(b, { table: privilegedMethods, route: 'main', handlers });
    return { client: new RpcClient(a, 'b'), port: a };
  }

  it('resolves results and rejects failures as RpcError', async () => {
    const { client } = privileged({ 'main.ping': () => ({ process: 'main' }) });
    await expect(client.call('main.ping', {})).resolves.toEqual({ process: 'main' });
    await expect(client.call('secrets.get', { profileId: 'p' })).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
    await expect(client.call('secrets.get', {})).rejects.toBeInstanceOf(RpcError);
  });

  it('times out, and sends a cancel for the late request', async () => {
    const { client, port } = privileged({ 'main.ping': () => new Promise(() => undefined) });
    await expect(client.call('main.ping', {}, { timeoutMs: 5 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    expect(port.sent).toContainEqual({ cancel: 'b1' });
  });

  it('ignores a late answer after a timeout and unrelated messages', async () => {
    const [a, b] = portPair();
    const client = new RpcClient(a, 'b');
    const late = client.call('main.ping', {}, { timeoutMs: 5 });
    await expect(late).rejects.toMatchObject({ code: 'TIMEOUT' });
    b.send({ id: 'b1', ok: true, result: { process: 'main' } }); // too late
    b.send({ id: 'zzz', ok: true, result: {} }); // unknown id
    b.send('garbage');
    b.send({ stream: 's', kind: 'data', payload: 1 });
    await new Promise((r) => setTimeout(r, 10));
    const next = client.call('main.ping', {}, { timeoutMs: 1000 });
    b.send({ id: 'b2', ok: true, result: { process: 'main' } });
    await expect(next).resolves.toEqual({ process: 'main' });
  });

  it('a call answered before its timeout does not send a cancel', async () => {
    const { client, port } = privileged({ 'main.ping': () => ({ process: 'main' }) });
    await expect(client.call('main.ping', {}, { timeoutMs: 20 })).resolves.toEqual({
      process: 'main',
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(port.sent).toEqual([{ id: 'b1', method: 'main.ping', params: {} }]);
  });

  it('close() rejects pending calls', async () => {
    const { client } = privileged({ 'main.ping': () => new Promise(() => undefined) });
    const pending = client.call('main.ping', {});
    client.close('gone');
    await expect(pending).rejects.toMatchObject({ code: 'INTERNAL', message: 'gone' });
  });
});

describe('serve: streams', () => {
  const FIND = { profileId: 'p1', db: 'shop', coll: 'orders', filter: '{}' };
  const doc = (n: number) => `{"_id":{"$numberInt":"${n}"}}`;

  interface Message {
    id?: string;
    stream?: string;
    kind?: string;
    payload?: unknown;
    ok?: boolean;
    result?: unknown;
    error?: unknown;
  }

  /** A promise with its resolve/reject exposed (controls the order explicitly). */
  function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  /** Serves `docs.find` with a handler that opens one stream with `producer` (or `handler`). */
  function streaming(producer: StreamProducer, onError = vi.fn(), handler?: Handler) {
    const [client, server] = portPair();
    const started: StreamSink[] = [];
    const stop = serve(server, {
      table: methods,
      route: 'backend',
      onError,
      handlers: {
        'docs.find':
          handler ??
          ((_p, ctx) => ({
            streamId: ctx.openStream?.((sink) => {
              started.push(sink);
              return producer(sink);
            }),
          })),
      },
    });
    const received: Message[] = [];
    client.onMessage((m) => received.push(m as Message));
    const eventsOf = (stream: string) => received.filter((m) => m.stream === stream);
    const final = async (stream: string) => {
      await vi.waitFor(() =>
        expect(eventsOf(stream).filter((e) => e.kind !== 'data')).toHaveLength(1),
      );
      return eventsOf(stream).at(-1);
    };
    const open = async (id = 'f1') => {
      client.send({ id, method: 'docs.find', params: FIND });
      await vi.waitFor(() => expect(received.find((m) => m.id === id)).toBeDefined());
      return received.find((m) => m.id === id);
    };
    const openId = async (id = 'f1') => ((await open(id))?.result as { streamId: string }).streamId;
    return { client, server, stop, received, eventsOf, final, open, openId, started, onError };
  }

  const settleTicks = () => new Promise((r) => setTimeout(r, 15));

  it('answers { streamId } first, then sends data events and end with the delivered count', async () => {
    let sentBeforeStart = -1;
    const s = streaming((sink) => {
      sentBeforeStart = s.server.sent.length;
      sink.send({ docs: [doc(1), doc(2)] });
      sink.send({ docs: [doc(3)] });
      return Promise.resolve(3);
    });
    const response = await s.open();
    expect(response).toMatchObject({
      id: 'f1',
      ok: true,
      result: { streamId: expect.any(String) },
    });
    const streamId = (response?.result as { streamId: string }).streamId;
    expect(streamId).toMatch(/^stream-/);
    expect(await s.final(streamId)).toEqual({
      stream: streamId,
      kind: 'end',
      payload: { delivered: 3 },
    });
    // The producer started only after the response was on the port.
    expect(sentBeforeStart).toBe(1);
    expect(s.received.map((m) => m.id ?? m.kind)).toEqual(['f1', 'data', 'data', 'end']);
    expect(s.eventsOf(streamId).slice(0, 2)).toEqual([
      { stream: streamId, kind: 'data', payload: { docs: [doc(1), doc(2)] } },
      { stream: streamId, kind: 'data', payload: { docs: [doc(3)] } },
    ]);
    expect(s.started[0]?.streamId).toBe(streamId);
  });

  it.each([
    ['NaN', Number.NaN],
    ['a negative number', -1],
    ['a fraction', 1.5],
  ])('end counts the data events sent when the producer resolves with %s', async (_n, count) => {
    const s = streaming((sink) => {
      sink.send({ docs: [doc(1)] });
      sink.send({ docs: [doc(2)] });
      return Promise.resolve(count);
    });
    const streamId = await s.openId();
    expect(await s.final(streamId)).toMatchObject({ kind: 'end', payload: { delivered: 2 } });
  });

  it('a producer rejecting with an RpcError ends the stream with its code (not reported)', async () => {
    const s = streaming((sink) => {
      sink.send({ docs: [doc(1)] });
      return Promise.reject(new RpcError('SERVER_ERROR', 'bad filter', { serverCode: 2 }));
    });
    const streamId = await s.openId();
    expect(await s.final(streamId)).toEqual({
      stream: streamId,
      kind: 'error',
      payload: { code: 'SERVER_ERROR', message: 'bad filter', detail: { serverCode: 2 } },
    });
    expect(s.eventsOf(streamId)).toHaveLength(2);
    expect(s.onError).not.toHaveBeenCalled();
  });

  it('other producer failures (rejected or thrown synchronously) end with INTERNAL and are reported', async () => {
    const rejected = streaming(() => Promise.reject(new Error('boom')));
    const a = await rejected.openId();
    expect(await rejected.final(a)).toMatchObject({
      kind: 'error',
      payload: { code: 'INTERNAL', message: 'Unexpected error: boom' },
    });
    expect(rejected.onError).toHaveBeenCalledTimes(1);

    const thrown = streaming(() => {
      throw new Error('sync boom');
    });
    const b = await thrown.openId();
    expect(await thrown.final(b)).toMatchObject({
      kind: 'error',
      payload: { code: 'INTERNAL', message: 'Unexpected error: sync boom' },
    });
    expect(thrown.onError).toHaveBeenCalledTimes(1);
  });

  it('data that breaks the stream schema ends the stream with INTERNAL and aborts the producer', async () => {
    const finish = deferred<number>();
    const s = streaming((sink) => {
      sink.send({ docs: [doc(1)] });
      sink.send({ docs: 'not an array' });
      sink.send({ docs: [doc(2)] }); // ignored: the stream is over
      return finish.promise;
    });
    const streamId = await s.openId();
    expect(await s.final(streamId)).toEqual({
      stream: streamId,
      kind: 'error',
      payload: { code: 'INTERNAL', message: 'Invalid stream data for docs.find' },
    });
    expect(s.started[0]?.signal.aborted).toBe(true);
    expect(s.onError).toHaveBeenCalledTimes(1);
    finish.resolve(2);
    await settleTicks();
    expect(s.eventsOf(streamId).map((e) => e.kind)).toEqual(['data', 'error']);
  });

  it('a cancel aborts the producer, drops later data and sends CANCELLED once it settled', async () => {
    const finish = deferred<number>();
    const s = streaming((sink) => {
      sink.send({ docs: [doc(1)] });
      return finish.promise;
    });
    const streamId = await s.openId();
    await vi.waitFor(() => expect(s.eventsOf(streamId)).toHaveLength(1));
    s.client.send({ cancel: streamId });
    await vi.waitFor(() => expect(s.started[0]?.signal.aborted).toBe(true));
    s.started[0]?.send({ docs: [doc(2)] }); // after the abort: dropped
    await settleTicks();
    // Still cleaning up: no final event yet.
    expect(s.eventsOf(streamId).map((e) => e.kind)).toEqual(['data']);
    // The producer finishes normally after the abort: the stream still ends CANCELLED.
    finish.resolve(5);
    expect(await s.final(streamId)).toEqual({
      stream: streamId,
      kind: 'error',
      payload: { code: 'CANCELLED', message: 'The operation was cancelled' },
    });
    await settleTicks();
    expect(s.eventsOf(streamId).map((e) => e.kind)).toEqual(['data', 'error']);
    // Not an id of a running request: no response is sent for the cancel.
    expect(s.received.filter((m) => m.id !== undefined)).toHaveLength(1);
  });

  it('a cancelled producer that rejects with its own error still ends CANCELLED (not reported)', async () => {
    const s = streaming(
      (sink) =>
        new Promise((_resolve, reject) => {
          sink.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const streamId = await s.openId();
    await vi.waitFor(() => expect(s.started).toHaveLength(1));
    s.client.send({ cancel: streamId });
    expect(await s.final(streamId)).toMatchObject({
      kind: 'error',
      payload: { code: 'CANCELLED' },
    });
    expect(s.onError).not.toHaveBeenCalled();
  });

  it('a producer that ignores the cancel gets CANCELLED after STREAM_CANCEL_GRACE_MS', async () => {
    vi.useFakeTimers();
    try {
      const finish = deferred<number>();
      const s = streaming(() => finish.promise);
      s.client.send({ id: 'f1', method: 'docs.find', params: FIND });
      await vi.advanceTimersByTimeAsync(5);
      const streamId = (s.received[0]?.result as { streamId: string }).streamId;
      s.client.send({ cancel: streamId });
      await vi.advanceTimersByTimeAsync(STREAM_CANCEL_GRACE_MS - 10);
      expect(s.eventsOf(streamId)).toEqual([]);
      await vi.advanceTimersByTimeAsync(20);
      expect(s.eventsOf(streamId)).toEqual([
        {
          stream: streamId,
          kind: 'error',
          payload: { code: 'CANCELLED', message: 'The operation was cancelled' },
        },
      ]);
      // A late settle sends nothing more.
      finish.resolve(1);
      await vi.advanceTimersByTimeAsync(10);
      expect(s.eventsOf(streamId)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a stream is not started when its request fails after opening it', async () => {
    const producer = vi.fn(() => Promise.resolve(0));
    const thrown = streaming(producer, vi.fn(), (_p, ctx) => {
      ctx.openStream?.(producer);
      throw new RpcError('NOT_CONNECTED', 'no connection');
    });
    expect(await thrown.open()).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });

    // A result that breaks the contract fails the request too.
    const invalid = streaming(producer, vi.fn(), (_p, ctx) => {
      ctx.openStream?.(producer);
      return { streamId: '' };
    });
    expect(await invalid.open()).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    await settleTicks();
    expect(producer).not.toHaveBeenCalled();
    expect([...thrown.received, ...invalid.received].filter((m) => m.stream)).toEqual([]);
  });

  it('a stream opened by a request cancelled meanwhile never starts', async () => {
    const proceed = deferred<undefined>();
    const producer = vi.fn(() => Promise.resolve(0));
    const s = streaming(producer, vi.fn(), async (_p, ctx) => {
      await proceed.promise;
      return { streamId: ctx.openStream?.(producer) };
    });
    s.client.send({ id: 'f1', method: 'docs.find', params: FIND });
    s.client.send({ cancel: 'f1' });
    await vi.waitFor(() =>
      expect(s.received).toEqual([
        {
          id: 'f1',
          ok: false,
          error: { code: 'CANCELLED', message: 'The operation was cancelled' },
        },
      ]),
    );
    proceed.resolve(undefined);
    await settleTicks();
    expect(producer).not.toHaveBeenCalled();
    expect(s.received).toHaveLength(1);
  });

  it('a cancel of a finished stream id is ignored', async () => {
    const s = streaming(() => Promise.resolve(0));
    const streamId = await s.openId();
    await s.final(streamId);
    s.client.send({ cancel: streamId });
    await settleTicks();
    expect(s.eventsOf(streamId)).toHaveLength(1);
  });

  it('a stream cancel only cancels its own stream', async () => {
    const finishes = [deferred<number>(), deferred<number>()];
    let n = 0;
    const s = streaming(() => (finishes[n++] ?? deferred<number>()).promise);
    const a = await s.openId('a');
    const b = await s.openId('b');
    expect(a).not.toBe(b);
    await vi.waitFor(() => expect(s.started).toHaveLength(2));
    s.client.send({ cancel: a });
    await vi.waitFor(() => expect(s.started[0]?.signal.aborted).toBe(true));
    expect(s.started[1]?.signal.aborted).toBe(false);
    finishes[0]?.resolve(0);
    finishes[1]?.resolve(0);
    expect(await s.final(a)).toMatchObject({ kind: 'error', payload: { code: 'CANCELLED' } });
    expect(await s.final(b)).toMatchObject({ kind: 'end', payload: { delivered: 0 } });
  });

  it('stop() aborts running streams; a later cancel finds nothing', async () => {
    const finish = deferred<number>();
    const s = streaming(() => finish.promise);
    const streamId = await s.openId();
    await vi.waitFor(() => expect(s.started).toHaveLength(1));
    s.stop();
    expect(s.started[0]?.signal.aborted).toBe(true);
    s.client.send({ cancel: streamId });
    await settleTicks();
    expect(s.received.filter((m) => m.stream === streamId)).toHaveLength(0);
  });

  it('stop() stops sending stream events, also when the producer settles later', async () => {
    const finish = deferred<number>();
    const s = streaming(() => finish.promise);
    const streamId = await s.openId();
    await vi.waitFor(() => expect(s.started).toHaveLength(1));
    s.stop();
    s.started[0]?.send({ docs: [doc(1)] });
    finish.resolve(1);
    await settleTicks();
    // Like requests after stop(): nothing more is sent.
    expect(s.received.filter((m) => m.stream === streamId)).toEqual([]);
  });
});
