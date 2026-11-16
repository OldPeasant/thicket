import { methods, privilegedMethods, type Response } from '@thicket/contract';
import { describe, expect, it, vi } from 'vitest';

import { wiringHandlers } from './handlers';
import { RpcClient, RpcError, serve, type Handler } from './rpc';
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

  it('close() rejects pending calls', async () => {
    const { client } = privileged({ 'main.ping': () => new Promise(() => undefined) });
    const pending = client.call('main.ping', {});
    client.close('gone');
    await expect(pending).rejects.toMatchObject({ code: 'INTERNAL', message: 'gone' });
  });
});
