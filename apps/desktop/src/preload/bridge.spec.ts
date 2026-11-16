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

describe('Bridge: cancel races', () => {
  it('a cancelled request resolves once with CANCELLED; a late result is ignored', async () => {
    const bridge = new Bridge();
    const backend = fakePort();
    bridge.setPort('backend', backend);
    const answer = bridge.request(req('s', 'backend.sleep', { ms: 60_000 }));
    bridge.cancel('s');
    backend.push({ id: 's', ok: false, error: { code: 'CANCELLED', message: 'cancelled' } });
    backend.push({ id: 's', ok: true, result: { sleptMs: 60_000 } });
    await expect(answer).resolves.toEqual({
      id: 's',
      ok: false,
      error: { code: 'CANCELLED', message: 'cancelled' },
    });
  });

  it('a cancel after the response arrived sends nothing', async () => {
    const bridge = new Bridge();
    const backend = fakePort();
    bridge.setPort('backend', backend);
    const answer = bridge.request(req('p', 'backend.ping'));
    backend.push({
      id: 'p',
      ok: true,
      result: { process: 'backend', pid: 1, mainReachable: true },
    });
    await answer;
    bridge.cancel('p');
    expect(backend.sent).toEqual([req('p', 'backend.ping')]);
  });

  it('a request id is free again once its request settled', async () => {
    const bridge = new Bridge();
    const backend = fakePort();
    bridge.setPort('backend', backend);
    const first = bridge.request(req('x', 'backend.ping'));
    backend.push({ id: 'x', ok: true, result: {} });
    await first;
    const second = bridge.request(req('x', 'backend.ping'));
    backend.push({ id: 'x', ok: true, result: { again: true } });
    await expect(second).resolves.toMatchObject({ result: { again: true } });
  });

  it('cancelling one queued request leaves the others queued in order', async () => {
    const bridge = new Bridge();
    void bridge.request(req('a', 'backend.ping'));
    const b = bridge.request(req('b', 'backend.sleep', { ms: 10 }));
    void bridge.request(req('c', 'backend.ping'));
    bridge.cancel('b');
    await expect(b).resolves.toMatchObject({ error: { code: 'CANCELLED' } });
    const backend = fakePort();
    bridge.setPort('backend', backend);
    expect(backend.sent).toEqual([req('a', 'backend.ping'), req('c', 'backend.ping')]);
  });

  it('a request waiting for the main port is not cancelled on the backend port', () => {
    const bridge = new Bridge();
    const backend = fakePort();
    bridge.setPort('backend', backend);
    const answer = bridge.request(req('m', 'app.ping'));
    bridge.cancel('m');
    expect(backend.sent).toEqual([]);
    return expect(answer).resolves.toMatchObject({ error: { code: 'CANCELLED' } });
  });
});

describe('Bridge: privileged methods are not reachable from the renderer', () => {
  it('answers privileged and inherited method names UNKNOWN_METHOD without sending anything', async () => {
    const bridge = new Bridge();
    const main = fakePort();
    const backend = fakePort();
    bridge.setPort('main', main);
    bridge.setPort('backend', backend);
    for (const method of ['secrets.get', 'main.ping', '__proto__', 'constructor', 'toString']) {
      await expect(
        bridge.request(req(`id-${method}`, method, { profileId: 'p' })),
      ).resolves.toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
    }
    expect(main.sent).toEqual([]);
    expect(backend.sent).toEqual([]);
  });

  it('only sends the envelope fields, never extra properties of the request object', () => {
    const bridge = new Bridge();
    const main = fakePort();
    bridge.setPort('main', main);
    void bridge.request({ ...req('1', 'app.ping'), extra: 'x' } as Request);
    expect(main.sent).toEqual([req('1', 'app.ping')]);
  });
});

describe('Bridge: reconnects and restarts', () => {
  it('a new main port (page reload) fails main requests but emits no backend.restarted', async () => {
    const bridge = new Bridge();
    const firstMain = fakePort();
    const backend = fakePort();
    bridge.setPort('main', firstMain);
    bridge.setPort('backend', backend);
    const mainReq = bridge.request(req('m', 'app.ping'));
    const backendReq = bridge.request(req('b', 'backend.ping'));
    const events: Event[] = [];
    bridge.on((e) => events.push(e));
    bridge.setPort('main', fakePort());
    expect(firstMain.closed).toBe(true);
    await expect(mainReq).resolves.toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(events).toEqual([]);
    backend.push({ id: 'b', ok: true, result: { still: 'running' } });
    await expect(backendReq).resolves.toMatchObject({ ok: true });
  });

  it('on(listener) also gets backend.restarted; a first backend port emits nothing', () => {
    const bridge = new Bridge();
    const events: Event[] = [];
    bridge.on((e) => events.push(e));
    bridge.setPort('backend', fakePort());
    expect(events).toEqual([]);
    bridge.setPort('backend', fakePort(), { restarts: 1, reason: 'backend process exited' });
    expect(events).toEqual([
      {
        stream: 'backend.restarted',
        kind: 'data',
        payload: { restarts: 1, reason: 'backend process exited' },
      },
    ]);
  });

  it('a stream of the dead backend gets one error event, and its id can no longer be cancelled', async () => {
    const bridge = new Bridge();
    const oldPort = fakePort();
    bridge.setPort('backend', oldPort);
    const start = bridge.request(req('f', 'backend.ping'));
    oldPort.push({ id: 'f', ok: true, result: { streamId: 'st' } });
    await start;
    const seen: Event[] = [];
    bridge.on('st', (e) => seen.push(e));
    const newPort = fakePort();
    bridge.setPort('backend', newPort, { restarts: 1, reason: 'x' });
    bridge.setPort('backend', fakePort(), { restarts: 2, reason: 'y' });
    expect(seen.filter((e) => e.kind === 'error')).toHaveLength(1);
    bridge.cancel('st');
    expect(newPort.sent).toEqual([]);
  });

  it('main streams survive a backend restart', async () => {
    const bridge = new Bridge();
    const main = fakePort();
    bridge.setPort('main', main);
    bridge.setPort('backend', fakePort());
    const start = bridge.request(req('t', 'app.ping'));
    main.push({ id: 't', ok: true, result: { streamId: 'main-stream' } });
    await start;
    const seen: Event[] = [];
    bridge.on('main-stream', (e) => seen.push(e));
    bridge.setPort('backend', fakePort(), { restarts: 1, reason: 'x' });
    expect(seen).toEqual([]);
    bridge.cancel('main-stream');
    expect(main.sent).toContainEqual({ cancel: 'main-stream' });
  });
});

describe('Bridge: event buffering', () => {
  it('a stream end event is buffered and delivered to a late subscriber', async () => {
    const bridge = new Bridge();
    const backend = fakePort();
    bridge.setPort('backend', backend);
    const start = bridge.request(req('f', 'backend.ping'));
    backend.push({ id: 'f', ok: true, result: { streamId: 'st' } });
    backend.push({ stream: 'st', kind: 'data', payload: 1 });
    backend.push({ stream: 'st', kind: 'end', payload: { delivered: 1 } });
    await start;
    const seen: string[] = [];
    bridge.on('st', (e) => seen.push(e.kind));
    expect(seen).toEqual(['data', 'end']);
  });

  it('events of streams nobody announced are dropped silently, not buffered', () => {
    const report = vi.fn();
    const bridge = new Bridge(report);
    const backend = fakePort();
    bridge.setPort('backend', backend);
    backend.push({ stream: 'unknown', kind: 'data', payload: 1 });
    const seen: Event[] = [];
    bridge.on('unknown', (e) => seen.push(e));
    expect(seen).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it('a second listener of a stream does not replay the buffer again', async () => {
    const bridge = new Bridge();
    const backend = fakePort();
    bridge.setPort('backend', backend);
    const start = bridge.request(req('f', 'backend.ping'));
    backend.push({ id: 'f', ok: true, result: { streamId: 'st' } });
    backend.push({ stream: 'st', kind: 'data', payload: 1 });
    await start;
    const first: unknown[] = [];
    const second: unknown[] = [];
    bridge.on('st', (e) => first.push(e.payload));
    bridge.on('st', (e) => second.push(e.payload));
    backend.push({ stream: 'st', kind: 'data', payload: 2 });
    expect(first).toEqual([1, 2]);
    expect(second).toEqual([2]);
  });

  it('once an on(listener) exists, events of a new stream go to it instead of the buffer', async () => {
    const report = vi.fn();
    const bridge = new Bridge(report);
    const backend = fakePort();
    bridge.setPort('backend', backend);
    const start = bridge.request(req('f', 'backend.ping'));
    backend.push({ id: 'f', ok: true, result: { streamId: 'st' } }); // nobody listens yet
    await start;
    const all: unknown[] = [];
    bridge.on((e) => all.push(e.payload));
    for (let i = 0; i <= MAX_BUFFERED_EVENTS; i++) {
      backend.push({ stream: 'st', kind: 'data', payload: i });
    }
    expect(all).toHaveLength(MAX_BUFFERED_EVENTS + 1);
    expect(report).not.toHaveBeenCalled(); // nothing was dropped
  });

  it('an unsubscribe function can be called twice', () => {
    const bridge = new Bridge();
    const main = fakePort();
    bridge.setPort('main', main);
    const a = vi.fn();
    const b = vi.fn();
    const offA = bridge.on('app.theme', a);
    bridge.on('app.theme', b);
    offA();
    offA();
    main.push({ stream: 'app.theme', kind: 'data', payload: {} });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('on() with a stream but no listener throws', () => {
    const bridge = new Bridge();
    expect(() => bridge.on('app.theme', undefined as never)).toThrow(TypeError);
  });
});

describe('Bridge: malformed input', () => {
  it('rejects requests without params or with a non-string id', async () => {
    const bridge = new Bridge();
    await expect(bridge.request({ id: '1', method: 'app.ping' } as Request)).rejects.toThrow(
      TypeError,
    );
    await expect(
      bridge.request({ id: 1, method: 'app.ping', params: {} } as unknown as Request),
    ).rejects.toThrow(TypeError);
    await expect(bridge.request(null as unknown as Request)).rejects.toThrow(TypeError);
  });

  it('cancel ignores non-string ids', () => {
    const bridge = new Bridge();
    const main = fakePort();
    bridge.setPort('main', main);
    bridge.cancel(42 as unknown as string);
    bridge.cancel(undefined as unknown as string);
    expect(main.sent).toEqual([]);
  });

  it('ignores responses for unknown ids without reporting them', () => {
    const report = vi.fn();
    const bridge = new Bridge(report);
    const main = fakePort();
    bridge.setPort('main', main);
    main.push({ id: 'nobody', ok: true, result: {} });
    expect(report).not.toHaveBeenCalled();
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

  it('refuses port messages with other shapes', () => {
    expect(isPortMessage(undefined)).toBe(false);
    expect(isPortMessage('main')).toBe(false);
    expect(isPortMessage({})).toBe(false);
    expect(isPortMessage({ target: 'backend', restarted: null })).toBe(false);
    expect(isPortMessage({ target: 'privileged' })).toBe(false);
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
