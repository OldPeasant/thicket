import { privilegedMethods, type Profile, type Response } from '@thicket/contract';
import { describe, expect, it, vi } from 'vitest';

import { ConnectionManager } from '../connections/manager';
import { ShellHost } from '../shell';
import { startBackend, type ParentPortLike } from './backend';
import { sleep } from './handlers';
import type { MainPortLike } from './ports';
import { RpcError, serve, type Handler, type Port } from './rpc';
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

describe('startBackend: connections', () => {
  const FICTITIOUS_PASSWORD = 'fictitious-wiring-Pw';
  const profiles: Record<string, Profile> = {
    p1: {
      id: 'p1',
      name: 'Needs password',
      connectionString: 'mongodb://alice@db.example.test:27017',
      auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'saved' },
      readOnly: false,
      production: false,
    },
    ssh: {
      id: 'ssh',
      name: 'Tunnel',
      connectionString: 'mongodb://db.example.test:27017',
      ssh: { host: 'bastion.example.test', port: 22, username: 'ops', method: 'agent' },
      readOnly: true,
      production: true,
    },
    prod: {
      id: 'prod',
      name: 'Production, writable',
      connectionString: 'mongodb://db.example.test:27017',
      readOnly: false,
      production: true,
    },
  };

  /** A backend whose privileged port reaches a fake main serving profiles.forConnect/secrets.get. */
  function withMain(secrets: Record<string, string> | null = null) {
    const b = backend();
    const [mainEnd, backendEnd] = portPair();
    const forConnect = vi.fn((params: { profileId: string }) => {
      const profile = profiles[params.profileId];
      if (!profile) throw new RpcError('NOT_FOUND', `No profile ${params.profileId}`);
      return { profile };
    });
    const secretsGet = vi.fn(() => ({ secrets }));
    serve(mainEnd, {
      table: privilegedMethods,
      route: 'main',
      handlers: { 'profiles.forConnect': forConnect, 'secrets.get': secretsGet },
    });
    b.send({ type: 'privileged' }, [mainPort(backendEnd)]);
    return { ...b, forConnect, secretsGet, ...rendererPort(b) };
  }

  it('serves conn.* handlers next to the wiring diagnostics', () => {
    const parentPort: ParentPortLike = { on: () => undefined };
    const handlers = startBackend({ parentPort, pid: 1 });
    expect(Object.keys(handlers)).toEqual(
      expect.arrayContaining([
        'backend.ping',
        'backend.sleep',
        'conn.test',
        'conn.open',
        'conn.close',
        'conn.status',
        'conn.serverInfo',
      ]),
    );
  });

  it('conn.open loads the profile and secrets from main (no password → AUTH_FAILED)', async () => {
    const m = withMain(null);
    m.renderer.send({ id: 'o', method: 'conn.open', params: { profileId: 'p1' } });
    expect(await m.answer('o')).toMatchObject({
      ok: false,
      error: { code: 'AUTH_FAILED', message: expect.stringMatching(/^No password for user alice/) },
    });
    expect(m.forConnect).toHaveBeenCalledWith({ profileId: 'p1' }, expect.anything());
    expect(m.secretsGet).toHaveBeenCalledWith({ profileId: 'p1' }, expect.anything());

    m.renderer.send({ id: 's', method: 'conn.status', params: {} });
    expect(await m.answer('s')).toMatchObject({
      ok: true,
      result: {
        connections: [{ profileId: 'p1', state: 'error', error: { code: 'AUTH_FAILED' } }],
      },
    });
    m.renderer.send({ id: 'c', method: 'conn.close', params: { profileId: 'p1' } });
    expect(await m.answer('c')).toMatchObject({ ok: true, result: {} });
    m.renderer.send({ id: 's2', method: 'conn.status', params: { profileId: 'p1' } });
    expect(await m.answer('s2')).toMatchObject({
      ok: true,
      result: { connections: [{ profileId: 'p1', state: 'disconnected' }] },
    });
  });

  it('conn.open answers NOT_FOUND from main and UNSUPPORTED for SSH profiles', async () => {
    const m = withMain();
    m.renderer.send({ id: 'nf', method: 'conn.open', params: { profileId: 'missing' } });
    m.renderer.send({ id: 'ssh', method: 'conn.open', params: { profileId: 'ssh' } });
    expect(await m.answer('nf')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await m.answer('ssh')).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED' } });
  });

  it('conn.serverInfo of a profile that is not open answers NOT_CONNECTED', async () => {
    const m = withMain();
    m.renderer.send({ id: 'i', method: 'conn.serverInfo', params: { profileId: 'p1' } });
    expect(await m.answer('i')).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
  });

  it('conn.open before main sent the privileged port answers INTERNAL', async () => {
    const b = backend();
    const { renderer, answer } = rendererPort(b);
    renderer.send({ id: 'o', method: 'conn.open', params: { profileId: 'p1' } });
    expect(await answer('o')).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL', message: expect.stringMatching(/no link to main/) },
    });
  });

  it('serves the db.* and coll.* browse handlers', () => {
    const parentPort: ParentPortLike = { on: () => undefined };
    const handlers = startBackend({ parentPort, pid: 1 });
    expect(Object.keys(handlers)).toEqual(
      expect.arrayContaining([
        'db.listDatabases',
        'db.create',
        'db.drop',
        'db.stats',
        'coll.list',
        'coll.create',
        'coll.drop',
        'coll.rename',
        'coll.stats',
      ]),
    );
  });

  it('serves the docs.* query handlers, unguarded on a read-only profile', async () => {
    const parentPort: ParentPortLike = { on: () => undefined };
    expect(Object.keys(startBackend({ parentPort, pid: 1 }))).toEqual(
      expect.arrayContaining([
        'docs.find',
        'docs.count',
        'docs.estimatedCount',
        'docs.get',
        'docs.getSlice',
      ]),
    );
    const m = withMain();
    const target = { profileId: 'ssh', db: 'shop', coll: 'orders' };
    m.renderer.send({ id: 'f', method: 'docs.find', params: { ...target, filter: '{}' } });
    m.renderer.send({ id: 'c', method: 'docs.count', params: { ...target, filter: '{}' } });
    m.renderer.send({ id: 'e', method: 'docs.estimatedCount', params: target });
    m.renderer.send({ id: 'g', method: 'docs.get', params: { ...target, id: '"a"' } });
    m.renderer.send({
      id: 's',
      method: 'docs.getSlice',
      params: { ...target, id: '"a"', path: 'items', skip: 0, limit: 5 },
    });
    for (const id of ['f', 'c', 'e', 'g', 's']) {
      expect(await m.answer(id)).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
    }
  });

  const browseWrites: [string, Record<string, unknown>][] = [
    ['db.create', { db: 'shop', firstCollection: 'orders' }],
    ['db.drop', { db: 'shop' }],
    ['coll.create', { db: 'shop', coll: 'orders' }],
    ['coll.drop', { db: 'shop', coll: 'orders' }],
    ['coll.rename', { db: 'shop', coll: 'orders', newName: 'orders_old' }],
  ];

  it.each(browseWrites)(
    '%s is guarded: READ_ONLY on a read-only profile, CONFIRMATION_REQUIRED on production',
    async (method, params) => {
      const m = withMain();
      m.renderer.send({
        id: 'ro',
        method,
        params: { profileId: 'ssh', confirmed: true, ...params },
      });
      m.renderer.send({ id: 'prod', method, params: { profileId: 'prod', ...params } });
      // Allowed by the guard: reaches the handler, which finds no open connection.
      m.renderer.send({
        id: 'ok',
        method,
        params: { profileId: 'prod', confirmed: true, ...params },
      });
      expect(await m.answer('ro')).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
      expect(await m.answer('prod')).toMatchObject({
        ok: false,
        error: { code: 'CONFIRMATION_REQUIRED' },
      });
      expect(await m.answer('ok')).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
    },
  );

  const docsWrites: [string, Record<string, unknown>][] = [
    ['docs.insert', { db: 'shop', coll: 'orders', docs: ['{"a":1}'] }],
    [
      'docs.update',
      { db: 'shop', coll: 'orders', id: '1', update: '{"$set":{"a":1}}', expected: '{}' },
    ],
    ['docs.replace', { db: 'shop', coll: 'orders', id: '1', doc: '{"a":1}' }],
    ['docs.delete', { db: 'shop', coll: 'orders', id: '1' }],
    ['docs.updateMany', { db: 'shop', coll: 'orders', filter: '{}', update: '{"$set":{"a":1}}' }],
    ['docs.deleteMany', { db: 'shop', coll: 'orders', filter: '{}' }],
  ];

  it.each(docsWrites)(
    '%s is served and guarded: READ_ONLY on a read-only profile, CONFIRMATION_REQUIRED on production',
    async (method, params) => {
      const parentPort: ParentPortLike = { on: () => undefined };
      expect(Object.keys(startBackend({ parentPort, pid: 1 }))).toContain(method);
      const m = withMain();
      m.renderer.send({
        id: 'ro',
        method,
        params: { profileId: 'ssh', confirmed: true, ...params },
      });
      m.renderer.send({ id: 'prod', method, params: { profileId: 'prod', ...params } });
      // Allowed by the guard: reaches the handler, which finds no open connection.
      m.renderer.send({
        id: 'ok',
        method,
        params: { profileId: 'prod', confirmed: true, ...params },
      });
      expect(await m.answer('ro')).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
      expect(await m.answer('prod')).toMatchObject({
        ok: false,
        error: { code: 'CONFIRMATION_REQUIRED' },
      });
      expect(await m.answer('ok')).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
    },
  );

  it('docs.previewMany is served and not guarded on a read-only profile (a read)', async () => {
    const parentPort: ParentPortLike = { on: () => undefined };
    expect(Object.keys(startBackend({ parentPort, pid: 1 }))).toContain('docs.previewMany');
    const m = withMain();
    m.renderer.send({
      id: 'p',
      method: 'docs.previewMany',
      params: { profileId: 'ssh', db: 'shop', coll: 'orders', filter: '{}' },
    });
    expect(await m.answer('p')).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
  });

  it('io.* asks main for the file dialog over the privileged port; io.import is guarded', async () => {
    const b = backend();
    const [mainEnd, backendEnd] = portPair();
    const openFile = vi.fn(() => ({ path: null }));
    serve(mainEnd, {
      table: privilegedMethods,
      route: 'main',
      handlers: {
        'profiles.forConnect': (params: { profileId: string }) => ({
          profile: profiles[params.profileId],
        }),
        'dialog.openFile': openFile,
      },
    });
    b.send({ type: 'privileged' }, [mainPort(backendEnd)]);
    const { renderer, answer } = rendererPort(b);

    renderer.send({ id: 'pv', method: 'io.previewImport', params: { format: 'jsonl' } });
    expect(await answer('pv')).toEqual({ id: 'pv', ok: true, result: null });
    expect(openFile).toHaveBeenCalledWith(
      { title: 'Import documents', filters: expect.any(Array) as unknown },
      expect.anything(),
    );

    const io = { db: 'shop', coll: 'orders', fileToken: 'file-unknown' };
    renderer.send({
      id: 'ro',
      method: 'io.import',
      params: { profileId: 'ssh', confirmed: true, ...io },
    });
    renderer.send({ id: 'prod', method: 'io.import', params: { profileId: 'prod', ...io } });
    renderer.send({
      id: 'ok',
      method: 'io.import',
      params: { profileId: 'prod', confirmed: true, ...io },
    });
    // io.export is a read: not guarded, it reaches the handler (no open connection).
    renderer.send({
      id: 'ex',
      method: 'io.export',
      params: {
        profileId: 'ssh',
        db: 'shop',
        coll: 'orders',
        format: 'json',
        source: { kind: 'find', filter: '{}' },
      },
    });
    expect(await answer('ro')).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
    expect(await answer('prod')).toMatchObject({
      ok: false,
      error: { code: 'CONFIRMATION_REQUIRED' },
    });
    expect(await answer('ok')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await answer('ex')).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
    expect(openFile).toHaveBeenCalledTimes(1);
  });

  it('browse reads are not guarded on a read-only profile (NOT_CONNECTED, not READ_ONLY)', async () => {
    const m = withMain();
    m.renderer.send({ id: 'l', method: 'db.listDatabases', params: { profileId: 'ssh' } });
    m.renderer.send({
      id: 's',
      method: 'coll.stats',
      params: { profileId: 'ssh', db: 'shop', coll: 'o' },
    });
    expect(await m.answer('l')).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
    expect(await m.answer('s')).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
    expect(m.forConnect).not.toHaveBeenCalled();
  });

  it('serves shell.*; shell.open needs an open connection, eval of an unknown session NOT_FOUND', async () => {
    const parentPort: ParentPortLike = { on: () => undefined };
    expect(Object.keys(startBackend({ parentPort, pid: 1 }))).toEqual(
      expect.arrayContaining(['shell.open', 'shell.eval', 'shell.complete', 'shell.close']),
    );
    const m = withMain();
    m.renderer.send({ id: 'o', method: 'shell.open', params: { profileId: 'ssh' } });
    // Not write-guarded on a read-only production profile: the server's permissions guard it.
    m.renderer.send({
      id: 'e',
      method: 'shell.eval',
      params: { sessionId: 'unknown', code: 'db.c.drop()' },
    });
    m.renderer.send({
      id: 'c',
      method: 'shell.complete',
      params: { sessionId: 'unknown', code: 'db.', cursor: 3 },
    });
    expect(await m.answer('o')).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
    expect(await m.answer('e')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await m.answer('c')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('conn.close also closes the shell sessions of that profile, after the connection', async () => {
    const order: string[] = [];
    const closeProfile = vi
      .spyOn(ShellHost.prototype, 'closeProfile')
      .mockImplementation((profileId: string) => {
        order.push(`shells ${profileId}`);
        return Promise.resolve();
      });
    const original = ConnectionManager.prototype.close;
    const connClose = vi.spyOn(ConnectionManager.prototype, 'close').mockImplementation(function (
      this: ConnectionManager,
      profileId: string,
    ) {
      order.push(`connection ${profileId}`);
      return original.call(this, profileId);
    });
    try {
      const m = withMain();
      m.renderer.send({ id: 'c', method: 'conn.close', params: { profileId: 'prod' } });
      expect(await m.answer('c')).toMatchObject({ ok: true, result: {} });
      expect(closeProfile).toHaveBeenCalledTimes(1);
      expect(closeProfile).toHaveBeenCalledWith('prod');
      expect(order).toEqual(['connection prod', 'shells prod']);
    } finally {
      closeProfile.mockRestore();
      connClose.mockRestore();
    }
  });

  it('conn.close answers only once the shell sessions are closed', async () => {
    let finish: () => void = () => undefined;
    const closeProfile = vi
      .spyOn(ShellHost.prototype, 'closeProfile')
      .mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    try {
      const m = withMain();
      const responses: Response[] = [];
      m.renderer.onMessage((r) => responses.push(r as Response));
      m.renderer.send({ id: 'c', method: 'conn.close', params: { profileId: 'p1' } });
      await vi.waitFor(() => expect(closeProfile).toHaveBeenCalledWith('p1'));
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(responses.find((r) => r.id === 'c')).toBeUndefined();
      finish();
      expect(await m.answer('c')).toMatchObject({ ok: true, result: {} });
    } finally {
      closeProfile.mockRestore();
    }
  });

  it('shell.open answers UNSUPPORTED without a shell worker once connected', async () => {
    const parentPort: ParentPortLike = { on: () => undefined };
    const configOf = vi
      .spyOn(ConnectionManager.prototype, 'configOf')
      .mockReturnValue({ uri: 'mongodb://db.example.test:27017', options: {} });
    try {
      const handlers = startBackend({ parentPort, pid: 1 });
      const open = handlers['shell.open'] as Handler;
      await expect(
        Promise.resolve(
          open({ profileId: 'p1' } as never, {
            signal: new AbortController().signal,
            requestId: 'r',
          }),
        ),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    } finally {
      configOf.mockRestore();
    }
  });

  it('logs connection events with a prefix and without the password', async () => {
    const m = withMain(null);
    m.renderer.send({
      id: 't',
      method: 'conn.test',
      params: {
        profile: { ...profiles['ssh'], id: undefined },
        password: FICTITIOUS_PASSWORD,
      },
    });
    m.renderer.send({ id: 'o', method: 'conn.open', params: { profileId: 'p1' } });
    expect(await m.answer('t')).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED' } });
    expect(await m.answer('o')).toMatchObject({ ok: false, error: { code: 'AUTH_FAILED' } });
    const lines = m.log.mock.calls.map(([line]) => String(line));
    expect(lines).toContain(
      'connections: open p1: AUTH_FAILED No password for user alice: enter it or save it in the profile',
    );
    expect(lines.join('\n')).not.toContain(FICTITIOUS_PASSWORD);
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
