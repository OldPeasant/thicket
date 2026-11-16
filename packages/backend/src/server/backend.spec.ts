import { privilegedMethods, type Response } from '@thicket/contract';
import { describe, expect, it, vi } from 'vitest';

import { startBackend, type ParentPortLike } from './backend';
import { sleep } from './handlers';
import type { MainPortLike } from './ports';
import { serve, type Port } from './rpc';
import { portPair } from './testing';

/** A `MainPortLike` over one end of an in-memory pair. */
function mainPort(port: Port): MainPortLike & { closeListeners: (() => void)[] } {
  const listeners = new Map<unknown, () => void>();
  const closeListeners: (() => void)[] = [];
  return {
    closeListeners,
    postMessage: (message) => port.send(message),
    on(event: 'message' | 'close', listener: ((e: { data: unknown }) => void) | (() => void)) {
      if (event === 'close') closeListeners.push(listener as () => void);
      else
        listeners.set(
          listener,
          port.onMessage((data) => listener({ data } as never)),
        );
      return this;
    },
    off(_event: 'message', listener: unknown) {
      listeners.get(listener)?.();
      return this;
    },
    start: () => undefined,
    close: () => port.close(),
  };
}

function backend() {
  let deliver: ((e: { data: unknown; ports: MainPortLike[] }) => void) | undefined;
  const parentPort: ParentPortLike = {
    on: (_event, listener) => {
      deliver = listener;
    },
  };
  const log = vi.fn();
  startBackend({ parentPort, pid: 99, log });
  return {
    log,
    send: (data: unknown, ports: MainPortLike[]) => deliver?.({ data, ports }),
  };
}

function rendererPort(b: ReturnType<typeof backend>) {
  const [renderer, backendEnd] = portPair();
  const wrapped = mainPort(backendEnd);
  b.send({ type: 'renderer', window: 1 }, [wrapped]);
  const responses: Response[] = [];
  renderer.onMessage((m) => responses.push(m as Response));
  const answer = async (id: string) => {
    await vi.waitFor(() => expect(responses.find((r) => r.id === id)).toBeDefined());
    return responses.find((r) => r.id === id);
  };
  return { renderer, answer, wrapped };
}

describe('startBackend', () => {
  it('serves the contract on renderer ports; ping reports main unreachable without a link', async () => {
    const b = backend();
    const { renderer, answer } = rendererPort(b);
    renderer.send({ id: '1', method: 'backend.ping', params: {} });
    expect(await answer('1')).toMatchObject({
      ok: true,
      result: { process: 'backend', pid: 99, mainReachable: false },
    });
  });

  it('uses the privileged port to reach main', async () => {
    const b = backend();
    const [mainEnd, backendEnd] = portPair();
    serve(mainEnd, {
      table: privilegedMethods,
      route: 'main',
      handlers: { 'main.ping': () => ({ process: 'main' }) },
    });
    b.send({ type: 'privileged' }, [mainPort(backendEnd)]);
    const { renderer, answer } = rendererPort(b);
    renderer.send({ id: '1', method: 'backend.ping', params: {} });
    expect(await answer('1')).toMatchObject({ ok: true, result: { mainReachable: true } });
  });

  it('reports main unreachable when the privileged call fails', async () => {
    const b = backend();
    const [mainEnd, backendEnd] = portPair();
    serve(mainEnd, { table: privilegedMethods, route: 'main', handlers: {} });
    b.send({ type: 'privileged' }, [mainPort(backendEnd)]);
    const { renderer, answer } = rendererPort(b);
    renderer.send({ id: '1', method: 'backend.ping', params: {} });
    expect(await answer('1')).toMatchObject({ ok: true, result: { mainReachable: false } });
  });

  it('ignores unknown control messages and messages without a port', () => {
    const b = backend();
    b.send({ type: 'other' }, [mainPort(portPair()[0])]);
    b.send({ type: 'privileged' }, []);
    expect(b.log).toHaveBeenCalledTimes(2);
  });

  it('stops serving a renderer whose port closed', async () => {
    const b = backend();
    const { renderer, wrapped, answer } = rendererPort(b);
    renderer.send({ id: 's', method: 'backend.sleep', params: { ms: 60_000 } });
    await new Promise((r) => setTimeout(r, 5));
    for (const listener of wrapped.closeListeners) listener();
    expect(b.log).toHaveBeenCalledWith('renderer 1 disconnected');
    renderer.send({ id: 'p', method: 'backend.ping', params: {} });
    await expect(answer('p')).rejects.toThrow();
  });
});

describe('startBackend: privileged port isolation', () => {
  it('a renderer cannot call privileged methods through the backend', async () => {
    const b = backend();
    const [mainEnd, backendEnd] = portPair();
    const secretsGet = vi.fn(() => ({ secrets: { password: 'fictitious' } }));
    serve(mainEnd, {
      table: privilegedMethods,
      route: 'main',
      handlers: { 'main.ping': () => ({ process: 'main' }), 'secrets.get': secretsGet },
    });
    b.send({ type: 'privileged' }, [mainPort(backendEnd)]);
    const { renderer, answer } = rendererPort(b);
    renderer.send({ id: 's', method: 'secrets.get', params: { profileId: 'p1' } });
    renderer.send({ id: 'm', method: 'main.ping', params: {} });
    expect(await answer('s')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
    expect(await answer('m')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
    expect(secretsGet).not.toHaveBeenCalled();
    // Nothing the renderer sent was forwarded to main.
    expect(backendEnd.sent).toEqual([]);
  });

  it('a new privileged port replaces the old one; calls on the old one fail at once', async () => {
    const b = backend();
    const [silentMain, silentBackend] = portPair();
    serve(silentMain, {
      table: privilegedMethods,
      route: 'main',
      handlers: { 'main.ping': () => new Promise(() => undefined) },
    });
    b.send({ type: 'privileged' }, [mainPort(silentBackend)]);
    const { renderer, answer } = rendererPort(b);
    renderer.send({ id: '1', method: 'backend.ping', params: {} });
    await vi.waitFor(() => expect(silentBackend.sent).toHaveLength(1));

    const [liveMain, liveBackend] = portPair();
    serve(liveMain, {
      table: privilegedMethods,
      route: 'main',
      handlers: { 'main.ping': () => ({ process: 'main' }) },
    });
    b.send({ type: 'privileged' }, [mainPort(liveBackend)]);
    // The pending call is rejected by the replacement, well before its 2 s timeout.
    expect(await answer('1')).toMatchObject({ ok: true, result: { mainReachable: false } });
    renderer.send({ id: '2', method: 'backend.ping', params: {} });
    expect(await answer('2')).toMatchObject({ ok: true, result: { mainReachable: true } });
  });

  it('serves several renderer ports independently', async () => {
    const b = backend();
    const one = rendererPort(b);
    const two = rendererPort(b);
    one.renderer.send({ id: 'x', method: 'backend.sleep', params: { ms: 60_000 } });
    two.renderer.send({ id: 'x', method: 'backend.ping', params: {} });
    expect(await two.answer('x')).toMatchObject({ ok: true });
    one.renderer.send({ cancel: 'x' });
    expect(await one.answer('x')).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
  });

  it('logs malformed renderer messages with the window id', async () => {
    const b = backend();
    const { renderer, answer } = rendererPort(b);
    renderer.send({ id: 'bad', params: {} });
    expect(await answer('bad')).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    expect(b.log).toHaveBeenCalledWith(expect.stringMatching(/^renderer 1: Error: Malformed/));
  });

  it('ignores a renderer control message without a numeric window id', () => {
    const b = backend();
    b.send({ type: 'renderer', window: '1' }, [mainPort(portPair()[0])]);
    b.send(null, [mainPort(portPair()[0])]);
    expect(b.log).toHaveBeenCalledTimes(2);
  });
});

describe('sleep', () => {
  it('resolves after the time and no longer listens to the signal', async () => {
    const controller = new AbortController();
    await expect(sleep(1, controller.signal)).resolves.toBeUndefined();
    controller.abort(); // after the end: nothing happens
  });

  it('rejects with CANCELLED when aborted while waiting', async () => {
    const controller = new AbortController();
    const waiting = sleep(60_000, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('rejects at once with CANCELLED when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1000, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
