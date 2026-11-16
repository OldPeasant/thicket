import { serve, type Port } from '@thicket/backend';
import { methods, privilegedMethods, route, type Response } from '@thicket/contract';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mainHandlers, privilegedHandlers } from '../main/handlers';
import { SecretsStore } from './store';
import { FakeSafeStorage } from './testing';

/*
 * Contract test for "the renderer cannot request a secret" (behaviour): main's renderer-facing
 * port answers the secrets methods without the stored value and refuses `secrets.get`, which only
 * the privileged port serves. The schema half (no renderer-visible result has a secret field) is
 * `packages/contract/src/no-secrets.spec.ts`.
 */

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

describe("main's renderer port never answers with a stored secret", () => {
  const SECRET = 'fictitious-Secret-4711';
  let dir: string;
  let store: SecretsStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'thicket-secrets-contract-'));
    store = new SecretsStore({
      file: path.join(dir, 'secrets.bin'),
      safeStorage: new FakeSafeStorage(),
      platform: 'linux',
    });
    await store.set('p1', 'password', SECRET);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('serves the secrets methods without the value and refuses secrets.get', async () => {
    const port = fakePort();
    const handlers = mainHandlers({ version: '0.0.0', secrets: store });
    serve(port, { table: methods, route: 'main', handlers });
    const requests = [
      { id: 'status', method: 'profiles.secretStorage', params: {} },
      {
        id: 'set',
        method: 'profiles.setSecret',
        params: { profileId: 'p1', kind: 'sshPassword', value: SECRET },
      },
      { id: 'get', method: 'secrets.get', params: { profileId: 'p1' } },
      { id: 'ping', method: 'main.ping', params: {} },
      { id: 'clear', method: 'profiles.clearSecret', params: { profileId: 'p2' } },
    ];
    for (const request of requests) port.push(request);
    await vi.waitFor(() => expect(port.sent).toHaveLength(requests.length));
    const byId = new Map(port.sent.map((response) => [response.id, response]));
    expect(byId.get('status')).toMatchObject({ ok: true, result: { level: 'secure' } });
    expect(byId.get('set')).toEqual({ id: 'set', ok: true, result: { secureStorage: true } });
    expect(byId.get('get')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
    expect(byId.get('ping')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
    expect(byId.get('clear')).toEqual({ id: 'clear', ok: true, result: {} });
    expect(JSON.stringify(port.sent)).not.toContain(SECRET);
    // The secret is still stored: the backend gets it over the privileged port.
    expect(await store.get('p1')).toEqual({ password: SECRET, sshPassword: SECRET });
  });

  it('the main handlers do not include any privileged method', () => {
    const handlers = mainHandlers({ version: '0.0.0', secrets: store });
    for (const name of Object.keys(privilegedMethods))
      expect(Object.hasOwn(handlers, name)).toBe(false);
    for (const name of Object.keys(handlers)) expect(route(name)).toBe('main');
  });

  it('the privileged port serves secrets.get to the backend', async () => {
    const port = fakePort();
    serve(port, {
      table: privilegedMethods,
      route: 'main',
      handlers: privilegedHandlers({ secrets: store }),
    });
    port.push({ id: 'g1', method: 'secrets.get', params: { profileId: 'p1' } });
    port.push({ id: 'g2', method: 'secrets.get', params: { profileId: 'none' } });
    port.push({ id: 'g3', method: 'profiles.secretStorage', params: {} });
    await vi.waitFor(() => expect(port.sent).toHaveLength(3));
    const byId = new Map(port.sent.map((response) => [response.id, response]));
    expect(byId.get('g1')).toEqual({
      id: 'g1',
      ok: true,
      result: { secrets: { password: SECRET } },
    });
    expect(byId.get('g2')).toEqual({ id: 'g2', ok: true, result: { secrets: null } });
    expect(byId.get('g3')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
  });
});
