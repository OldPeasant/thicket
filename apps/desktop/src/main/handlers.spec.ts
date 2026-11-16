import { serve, type Port } from '@thicket/backend';
import {
  methods,
  parseResult,
  parseResultIn,
  privilegedMethods,
  type Response,
} from '@thicket/contract';
import { describe, expect, it, vi } from 'vitest';

import { mainHandlers, privilegedHandlers } from './handlers';

const ctx = { signal: new AbortController().signal, requestId: '1' };

describe('main handlers', () => {
  it('app.ping answers with the process and version', () => {
    const result: unknown = mainHandlers({ version: '1.2.3' })['app.ping']?.({} as never, ctx);
    expect(result).toEqual({ process: 'main', version: '1.2.3' });
    expect(parseResult('app.ping', result).ok).toBe(true);
  });

  it('the privileged handlers answer within their contract (secrets stub: none stored)', () => {
    const handlers = privilegedHandlers();
    const ping: unknown = handlers['main.ping']?.({} as never, ctx);
    const secrets: unknown = handlers['secrets.get']?.({ profileId: 'p' } as never, ctx);
    expect(parseResultIn(privilegedMethods, 'main.ping', ping).ok).toBe(true);
    expect(secrets).toEqual({ secrets: null });
    expect(parseResultIn(privilegedMethods, 'secrets.get', secrets).ok).toBe(true);
  });

  it('main handlers and privileged handlers do not share a method name', () => {
    const main = Object.keys(mainHandlers({ version: '0' }));
    const privileged = Object.keys(privilegedHandlers());
    expect(main.filter((name) => privileged.includes(name))).toEqual([]);
  });
});

/** A synchronous in-memory port: `push` delivers to the server, `sent` collects its answers. */
function fakePort() {
  const listeners = new Set<(message: unknown) => void>();
  const port = {
    sent: [] as Response[],
    send: (message: unknown) => void port.sent.push(message as Response),
    onMessage(listener: (message: unknown) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close: () => undefined,
    push: (message: unknown) => {
      for (const listener of [...listeners]) listener(message);
    },
  };
  return port satisfies Port;
}

describe("a window's main port (served with the renderer contract)", () => {
  it('answers app.ping and refuses privileged methods even if a handler for them exists', async () => {
    const port = fakePort();
    const secretsGet = vi.fn(() => ({ secrets: { password: 'fictitious' } }));
    // Even a mistaken wiring that mixes in the privileged handlers must not expose them: the
    // renderer-facing server validates against `methods`, which does not contain them.
    serve(port, {
      table: methods,
      route: 'main',
      handlers: {
        ...mainHandlers({ version: '9.9.9' }),
        ...privilegedHandlers(),
        'secrets.get': secretsGet,
      },
    });
    port.push({ id: '1', method: 'app.ping', params: {} });
    port.push({ id: '2', method: 'secrets.get', params: { profileId: 'p' } });
    port.push({ id: '3', method: 'main.ping', params: {} });
    await vi.waitFor(() => expect(port.sent).toHaveLength(3));
    const byId = new Map(port.sent.map((r) => [r.id, r]));
    expect(byId.get('1')).toEqual({
      id: '1',
      ok: true,
      result: { process: 'main', version: '9.9.9' },
    });
    expect(byId.get('2')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
    expect(byId.get('3')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
    expect(secretsGet).not.toHaveBeenCalled();
  });

  it('refuses backend methods sent to main and inherited object keys as method names', async () => {
    const port = fakePort();
    serve(port, { table: methods, route: 'main', handlers: mainHandlers({ version: '1' }) });
    port.push({ id: 'b', method: 'backend.sleep', params: { ms: 10 } });
    port.push({ id: 'p', method: '__proto__', params: {} });
    port.push({ id: 'c', method: 'constructor', params: {} });
    await vi.waitFor(() => expect(port.sent).toHaveLength(3));
    const byId = new Map(port.sent.map((r) => [r.id, r]));
    expect(byId.get('b')).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL', message: 'backend.sleep is served by backend, not by main' },
    });
    expect(byId.get('p')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
    expect(byId.get('c')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
  });
});

describe('the privileged port (main side)', () => {
  it('serves main.ping and the secrets stub, and validates secrets.get params', async () => {
    const port = fakePort();
    serve(port, { table: privilegedMethods, route: 'main', handlers: privilegedHandlers() });
    port.push({ id: 'b1', method: 'main.ping', params: {} });
    port.push({ id: 'b2', method: 'secrets.get', params: { profileId: 'p1' } });
    port.push({ id: 'b3', method: 'secrets.get', params: {} });
    port.push({ id: 'b4', method: 'app.ping', params: {} });
    await vi.waitFor(() => expect(port.sent).toHaveLength(4));
    const byId = new Map(port.sent.map((r) => [r.id, r]));
    expect(byId.get('b1')).toEqual({ id: 'b1', ok: true, result: { process: 'main' } });
    expect(byId.get('b2')).toEqual({ id: 'b2', ok: true, result: { secrets: null } });
    expect(byId.get('b3')).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    // The renderer contract is not served on the privileged port either.
    expect(byId.get('b4')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
  });
});
