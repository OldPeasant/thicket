import type { Port } from '@thicket/backend';
import type { Event, Request } from '@thicket/contract';
import { describe, expect, it, vi } from 'vitest';

import { Bridge, MAX_BUFFERED_EVENTS } from './bridge';
import { fromDomPort, isPortMessage, type DomPortLike } from './ports';

/** A port whose peer is the test: `sent` collects what the bridge sends, `push` delivers. */
function fakePort() {
  const listeners = new Set<(message: unknown) => void>();
  const port = {
    sent: [] as unknown[],
    closed: false,
    send: (message: unknown) => void port.sent.push(message),
    onMessage(listener: (message: unknown) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close: () => {
      port.closed = true;
    },
    push: (message: unknown) => {
      for (const listener of [...listeners]) listener(message);
    },
  };
  return port satisfies Port;
}

const req = (id: string, method: string, params: unknown = {}): Request => ({ id, method, params });

describe('Bridge', () => {
  it('routes requests by route(method) and resolves them with their responses', async () => {
    const bridge = new Bridge();
    const main = fakePort();
    const backend = fakePort();
    bridge.setPort('main', main);
    bridge.setPort('backend', backend);
    const a = bridge.request(req('1', 'app.ping'));
    const b = bridge.request(req('2', 'backend.ping'));
    expect(main.sent).toEqual([req('1', 'app.ping')]);
    expect(backend.sent).toEqual([req('2', 'backend.ping')]);
    backend.push({ id: '2', ok: true, result: { process: 'backend' } });
    main.push({ id: '1', ok: true, result: { process: 'main' } });
    await expect(a).resolves.toEqual({ id: '1', ok: true, result: { process: 'main' } });
    await expect(b).resolves.toEqual({ id: '2', ok: true, result: { process: 'backend' } });
  });

  it('ignores a response from the wrong process', async () => {
    const bridge = new Bridge();
    const main = fakePort();
    const backend = fakePort();
    bridge.setPort('main', main);
    bridge.setPort('backend', backend);
    const answer = bridge.request(req('1', 'backend.ping'));
    main.push({ id: '1', ok: true, result: 'spoofed' });
    backend.push({ id: '1', ok: true, result: 'real' });
    await expect(answer).resolves.toMatchObject({ result: 'real' });
  });

  it('queues requests until the port arrives', async () => {
    const bridge = new Bridge();
    const answer = bridge.request(req('1', 'backend.ping'));
    const backend = fakePort();
    bridge.setPort('backend', backend);
    expect(backend.sent).toEqual([req('1', 'backend.ping')]);
    backend.push({ id: '1', ok: true, result: {} });
    await expect(answer).resolves.toMatchObject({ ok: true });
  });

  it('answers unknown methods locally and rejects malformed or duplicate requests', async () => {
    const bridge = new Bridge();
    bridge.setPort('main', fakePort());
    await expect(bridge.request(req('1', 'secrets.get'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_METHOD' },
    });
    await expect(bridge.request({ id: '', method: 'x', params: {} })).rejects.toThrow(TypeError);
    void bridge.request(req('d', 'app.ping'));
    await expect(bridge.request(req('d', 'app.ping'))).rejects.toThrow(/already in use/);
  });

  it('sends cancel to the process that serves the request', () => {
    const bridge = new Bridge();
    const main = fakePort();
    const backend = fakePort();
    bridge.setPort('main', main);
    bridge.setPort('backend', backend);
    void bridge.request(req('s', 'backend.sleep', { ms: 1000 }));
    bridge.cancel('s');
    expect(backend.sent).toContainEqual({ cancel: 's' });
    expect(main.sent).toEqual([]);
    bridge.cancel('unknown');
    bridge.cancel('');
    expect(backend.sent).toHaveLength(2);
  });

  it('cancels a queued request locally', async () => {
    const bridge = new Bridge();
    const answer = bridge.request(req('q', 'backend.sleep', { ms: 1000 }));
    bridge.cancel('q');
    await expect(answer).resolves.toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    const backend = fakePort();
    bridge.setPort('backend', backend);
    expect(backend.sent).toEqual([]);
  });

  it('routes a stream cancel to the stream owner and forgets it after the end', async () => {
    const bridge = new Bridge();
    const backend = fakePort();
    bridge.setPort('main', fakePort());
    bridge.setPort('backend', backend);
    const answer = bridge.request(req('f', 'backend.ping'));
    backend.push({ id: 'f', ok: true, result: { streamId: 'st1' } });
    await answer;
    bridge.cancel('st1');
    expect(backend.sent).toContainEqual({ cancel: 'st1' });
    backend.push({ stream: 'st1', kind: 'end', payload: { delivered: 0 } });
    bridge.cancel('st1');
    expect(backend.sent.filter((m) => JSON.stringify(m) === '{"cancel":"st1"}')).toHaveLength(1);
  });

  it('delivers events to stream listeners and buffers early events of a new stream', async () => {
    const bridge = new Bridge();
    const backend = fakePort();
    bridge.setPort('backend', backend);
    const answer = bridge.request(req('f', 'backend.ping'));
    backend.push({ id: 'f', ok: true, result: { streamId: 'st' } });
    backend.push({ stream: 'st', kind: 'data', payload: 1 });
    await answer;
    const seen: Event[] = [];
    const off = bridge.on('st', (e) => seen.push(e));
    backend.push({ stream: 'st', kind: 'data', payload: 2 });
    off();
    backend.push({ stream: 'st', kind: 'data', payload: 3 });
    expect(seen.map((e) => e.payload)).toEqual([1, 2]);
  });

  it('on(listener) gets every event', () => {
    const bridge = new Bridge();
    const main = fakePort();
    bridge.setPort('main', main);
    const seen: Event[] = [];
    const off = bridge.on((e) => seen.push(e));
    main.push({ stream: 'app.theme', kind: 'data', payload: { x: 1 } });
    off();
    main.push({ stream: 'app.theme', kind: 'data', payload: { x: 2 } });
    expect(seen).toEqual([{ stream: 'app.theme', kind: 'data', payload: { x: 1 } }]);
    expect(() => bridge.on(42 as never, undefined as never)).toThrow(TypeError);
  });

  it('caps the buffer of a stream nobody listens to', async () => {
    const report = vi.fn();
    const bridge = new Bridge(report);
    const backend = fakePort();
    bridge.setPort('backend', backend);
    const answer = bridge.request(req('f', 'backend.ping'));
    backend.push({ id: 'f', ok: true, result: { streamId: 'st' } });
    await answer;
    for (let i = 0; i <= MAX_BUFFERED_EVENTS; i++) {
      backend.push({ stream: 'st', kind: 'data', payload: i });
    }
    expect(report).toHaveBeenCalledTimes(1);
    const seen: unknown[] = [];
    bridge.on('st', (e) => seen.push(e.payload));
    expect(seen).toHaveLength(MAX_BUFFERED_EVENTS);
  });

  it('a throwing listener does not break delivery', () => {
    const report = vi.fn();
    const bridge = new Bridge(report);
    const main = fakePort();
    bridge.setPort('main', main);
    const ok = vi.fn();
    bridge.on('app.theme', () => {
      throw new Error('listener bug');
    });
    bridge.on('app.theme', ok);
    main.push({ stream: 'app.theme', kind: 'data', payload: {} });
    expect(ok).toHaveBeenCalled();
    expect(report).toHaveBeenCalled();
  });

  it('reports malformed messages', () => {
    const report = vi.fn();
    const bridge = new Bridge(report);
    const main = fakePort();
    bridge.setPort('main', main);
    main.push({ nonsense: true });
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('after a backend restart: fails what ran there, swaps the port, emits backend.restarted', async () => {
    const bridge = new Bridge();
    const oldPort = fakePort();
    bridge.setPort('backend', oldPort);
    const running = bridge.request(req('r', 'backend.sleep', { ms: 1000 }));
    const streamStart = bridge.request(req('f', 'backend.ping'));
    oldPort.push({ id: 'f', ok: true, result: { streamId: 'st' } });
    await streamStart;
    const streamEvents: Event[] = [];
    bridge.on('st', (e) => streamEvents.push(e));
    const restarts: Event[] = [];
    bridge.on('backend.restarted', (e) => restarts.push(e));

    const newPort = fakePort();
    bridge.setPort('backend', newPort, { restarts: 1, reason: 'backend process exited' });

    expect(oldPort.closed).toBe(true);
    await expect(running).resolves.toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(streamEvents).toMatchObject([{ stream: 'st', kind: 'error' }]);
    expect(restarts).toEqual([
      {
        stream: 'backend.restarted',
        kind: 'data',
        payload: { restarts: 1, reason: 'backend process exited' },
      },
    ]);
    oldPort.push({ id: 'r', ok: true, result: {} }); // old port is no longer listened to
    const next = bridge.request(req('n', 'backend.ping'));
    expect(newPort.sent).toEqual([req('n', 'backend.ping')]);
    newPort.push({ id: 'n', ok: true, result: { pid: 2 } });
    await expect(next).resolves.toMatchObject({ result: { pid: 2 } });
  });
});

describe('preload ports', () => {
  it('validates port messages', () => {
    expect(isPortMessage({ target: 'main' })).toBe(true);
    expect(isPortMessage({ target: 'backend', restarted: { restarts: 1, reason: 'x' } })).toBe(
      true,
    );
    expect(isPortMessage({ target: 'backend', restarted: { restarts: 'x' } })).toBe(false);
    expect(isPortMessage({ target: 'other' })).toBe(false);
    expect(isPortMessage(null)).toBe(false);
  });

  it('wraps a DOM MessagePort', () => {
    const listeners = new Set<(e: { data: unknown }) => void>();
    const dom: DomPortLike & { posted: unknown[] } = {
      posted: [],
      postMessage: (m) => void dom.posted.push(m),
      addEventListener: (_t, l) => void listeners.add(l),
      removeEventListener: (_t, l) => void listeners.delete(l),
      start: vi.fn(),
      close: vi.fn(),
    };
    const port = fromDomPort(dom);
    expect(dom.start).toHaveBeenCalled();
    port.send('hi');
    expect(dom.posted).toEqual(['hi']);
    const got: unknown[] = [];
    const off = port.onMessage((m) => got.push(m));
    for (const l of listeners) l({ data: 'x' });
    off();
    expect(listeners.size).toBe(0);
    expect(got).toEqual(['x']);
    port.close();
    expect(dom.close).toHaveBeenCalled();
  });
});
