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

describe('sleep', () => {
  it('rejects at once with CANCELLED when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1000, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
