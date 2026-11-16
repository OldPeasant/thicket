import { serve, type Port } from '@thicket/backend';
import {
  methods,
  parseResult,
  parseResultIn,
  privilegedMethods,
  type Response,
} from '@thicket/contract';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfilesStore } from '../profiles';
import { SecretsStore } from '../secrets';
import { FakeSafeStorage } from '../secrets/testing';
import { mainHandlers, privilegedHandlers } from './handlers';

const ctx = { signal: new AbortController().signal, requestId: '1' };

/** A store whose file never exists: reads find nothing, these tests write nothing. */
function emptyStore() {
  return new SecretsStore({
    file: '/nonexistent/thicket-test/secrets.bin',
    safeStorage: new FakeSafeStorage(),
    platform: 'linux',
  });
}
const deps = (version: string) => ({ version, secrets: emptyStore() });

describe('main handlers', () => {
  it('app.ping answers with the process and version', () => {
    const result: unknown = mainHandlers(deps('1.2.3'))['app.ping']?.({} as never, ctx);
    expect(result).toEqual({ process: 'main', version: '1.2.3' });
    expect(parseResult('app.ping', result).ok).toBe(true);
  });

  it('the privileged handlers answer within their contract (nothing stored)', async () => {
    const handlers = privilegedHandlers({ secrets: emptyStore() });
    const ping: unknown = handlers['main.ping']?.({} as never, ctx);
    const secrets: unknown = await handlers['secrets.get']?.({ profileId: 'p' } as never, ctx);
    expect(parseResultIn(privilegedMethods, 'main.ping', ping).ok).toBe(true);
    expect(secrets).toEqual({ secrets: null });
    expect(parseResultIn(privilegedMethods, 'secrets.get', secrets).ok).toBe(true);
  });

  it('main handlers and privileged handlers do not share a method name', () => {
    const main = Object.keys(mainHandlers(deps('0')));
    const privileged = Object.keys(privilegedHandlers({ secrets: emptyStore() }));
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
        ...mainHandlers(deps('9.9.9')),
        ...privilegedHandlers({ secrets: emptyStore() }),
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
    serve(port, { table: methods, route: 'main', handlers: mainHandlers(deps('1')) });
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

describe('main handlers with a ProfilesStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'thicket-main-profiles-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function withProfiles() {
    const secrets = new SecretsStore({
      file: path.join(dir, 'secrets.bin'),
      safeStorage: new FakeSafeStorage(),
      platform: 'linux',
    });
    const profiles = new ProfilesStore({ file: path.join(dir, 'connections.json'), secrets });
    return mainHandlers({ version: '1', secrets, profiles });
  }

  it('serves profiles.* only when a ProfilesStore is given', () => {
    const profileMethods = [
      'profiles.list',
      'profiles.get',
      'profiles.save',
      'profiles.delete',
      'profiles.duplicate',
    ];
    expect(Object.keys(mainHandlers(deps('1')))).not.toEqual(
      expect.arrayContaining(['profiles.list']),
    );
    expect(Object.keys(withProfiles())).toEqual(
      expect.arrayContaining([
        ...profileMethods,
        'profiles.setSecret',
        'profiles.clearSecret',
        'profiles.secretStorage',
      ]),
    );
    // Still no overlap with the privileged port.
    const privileged = Object.keys(privilegedHandlers({ secrets: emptyStore() }));
    expect(Object.keys(withProfiles()).filter((name) => privileged.includes(name))).toEqual([]);
  });

  it('gates profiles.setSecret on the profile existing (over the main port)', async () => {
    const port = fakePort();
    serve(port, { table: methods, route: 'main', handlers: withProfiles() });
    port.push({
      id: 's1',
      method: 'profiles.setSecret',
      params: { profileId: 'ghost', kind: 'password', value: 'fictitious' },
    });
    await vi.waitFor(() => expect(port.sent).toHaveLength(1));
    expect(port.sent[0]).toMatchObject({ id: 's1', ok: false, error: { code: 'NOT_FOUND' } });
    await expect(readdir(dir)).resolves.toEqual([]);

    port.push({
      id: 'p1',
      method: 'profiles.save',
      params: {
        profile: {
          name: 'Fictitious',
          connectionString: 'mongodb://alice@db.example.test',
          auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'saved' },
          readOnly: false,
          production: false,
        },
      },
    });
    await vi.waitFor(() => expect(port.sent).toHaveLength(2));
    const saved = port.sent[1] as { ok: true; result: { profile: { id: string } } };
    expect(saved).toMatchObject({ id: 'p1', ok: true });
    port.push({
      id: 's2',
      method: 'profiles.setSecret',
      params: { profileId: saved.result.profile.id, kind: 'password', value: 'fictitious' },
    });
    port.push({ id: 'l1', method: 'profiles.list', params: {} });
    await vi.waitFor(() => expect(port.sent).toHaveLength(4));
    const byId = new Map(port.sent.map((r) => [r.id, r]));
    expect(byId.get('s2')).toMatchObject({ ok: true, result: { secureStorage: true } });
    expect(byId.get('l1')).toMatchObject({ ok: true });
    expect(JSON.stringify(port.sent)).not.toContain('"fictitious"');
  });
});

describe('the privileged port (main side)', () => {
  it('serves main.ping and secrets.get, and validates secrets.get params', async () => {
    const port = fakePort();
    const handlers = privilegedHandlers({ secrets: emptyStore() });
    serve(port, { table: privilegedMethods, route: 'main', handlers });
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
