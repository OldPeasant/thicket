import type { Profile } from '@thicket/contract';
import { describe, expect, it, vi } from 'vitest';

import { RpcError, type Handler } from '../server/rpc';
import { connHandlers } from './handlers';
import { ConnectionManager, type ClientLike } from './manager';

const PASSWORD = 'fictitious-handler-Pw';

const profile: Profile = {
  id: 'p1',
  name: 'Local',
  connectionString: 'mongodb://db.example.test:27017',
  readOnly: false,
  production: false,
};

function client(connect: () => Promise<unknown> = () => Promise.resolve()): ClientLike {
  return {
    connect,
    close: () => Promise.resolve(),
    db: () => ({
      command: (command) =>
        Promise.resolve(
          'buildInfo' in command ? { version: '8.0.0' } : { isWritablePrimary: true, ok: 1 },
        ),
    }),
  };
}

function setup() {
  const createClient = vi.fn<(uri: string, options: unknown) => ClientLike>(() => client());
  const manager = new ConnectionManager({
    loadProfile: (id) =>
      id === 'p1' ? Promise.resolve(profile) : Promise.reject(new RpcError('NOT_FOUND', id)),
    loadSecrets: () => Promise.resolve(null),
    createClient,
  });
  const handlers = connHandlers(manager);
  const call = (method: string, params: unknown, signal = new AbortController().signal) =>
    Promise.resolve((handlers[method] as Handler)(params as never, { signal, requestId: 'r1' }));
  return { handlers, call, createClient, manager };
}

describe('connHandlers', () => {
  it('serves exactly conn.test/open/close/status/serverInfo', () => {
    expect(Object.keys(setup().handlers).sort()).toEqual([
      'conn.close',
      'conn.open',
      'conn.serverInfo',
      'conn.status',
      'conn.test',
    ]);
  });

  it('conn.test with a profileId loads the saved profile', async () => {
    const { call, createClient } = setup();
    await expect(call('conn.test', { profileId: 'p1' })).resolves.toMatchObject({
      latencyMS: expect.any(Number),
      server: { version: '8.0.0', topology: 'standalone' },
    });
    expect(createClient).toHaveBeenCalledWith('mongodb://db.example.test:27017', expect.anything());
  });

  it('conn.test with a draft uses the draft and the request password', async () => {
    const { call, createClient } = setup();
    const draft = {
      name: 'Draft',
      connectionString: 'mongodb://other.example.test',
      auth: { mechanism: 'SCRAM-SHA-256', username: 'erin', secretMode: 'ask' },
      readOnly: false,
      production: false,
    };
    await call('conn.test', { profile: draft, password: PASSWORD });
    expect(createClient).toHaveBeenCalledWith(
      'mongodb://other.example.test',
      expect.objectContaining({ auth: { username: 'erin', password: PASSWORD } }),
    );
  });

  it('conn.open, conn.status (one and all), conn.serverInfo, conn.close', async () => {
    const { call } = setup();
    await expect(call('conn.open', { profileId: 'p1' })).resolves.toEqual({
      profileId: 'p1',
      state: 'connected',
    });
    await expect(call('conn.status', { profileId: 'p1' })).resolves.toEqual({
      connections: [{ profileId: 'p1', state: 'connected' }],
    });
    await expect(call('conn.status', { profileId: 'p2' })).resolves.toEqual({
      connections: [{ profileId: 'p2', state: 'disconnected' }],
    });
    await expect(call('conn.status', {})).resolves.toEqual({
      connections: [{ profileId: 'p1', state: 'connected' }],
    });
    await expect(call('conn.serverInfo', { profileId: 'p1' })).resolves.toMatchObject({
      version: '8.0.0',
    });
    await expect(call('conn.close', { profileId: 'p1' })).resolves.toEqual({});
    await expect(call('conn.status', {})).resolves.toEqual({ connections: [] });
    await expect(call('conn.serverInfo', { profileId: 'p1' })).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
  });

  it('conn.open passes the request signal (cancel → CANCELLED)', async () => {
    const manager = new ConnectionManager({
      loadProfile: () => Promise.resolve(profile),
      loadSecrets: () => Promise.resolve(null),
      createClient: () => client(() => new Promise(() => undefined)),
    });
    const controller = new AbortController();
    const opening = (connHandlers(manager)['conn.open'] as Handler)({ profileId: 'p1' } as never, {
      signal: controller.signal,
      requestId: 'r1',
    }) as Promise<unknown>;
    await vi.waitFor(() => expect(manager.statusOf('p1').state).toBe('connecting'));
    controller.abort();
    await expect(opening).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
