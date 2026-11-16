import { MongoClient } from 'mongodb';
import { afterEach, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  ConnectionManager,
  RpcError,
  connHandlers,
  type ConnectionManagerDeps,
} from '@thicket/backend';
import type { Profile, ProfileDraft } from '@thicket/contract';

// Connection manager against the real fixtures (task conn-manager): SCRAM, wrong passwords, TLS,
// DNS failures, replica set / standalone topology, several connections, masked logs.

const mongo = inject('mongo');
const tlsCaFile = inject('tlsCaFile');

const USER = 'conn_manager_user';
const PASSWORD = 'Pa55-w0rd!conn-manager';
const WRONG = 'wrong-Pa55!conn-manager';
const STANDALONES = ['mongo8', 'mongo7'] as const;

/** Creates the SCRAM test user (SHA-1 and SHA-256) on a fixture; the server runs without --auth. */
async function createUser(uri: string): Promise<void> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const admin = client.db('admin');
    const existing = await admin.command({ usersInfo: USER });
    if ((existing['users'] as unknown[]).length === 0) {
      await admin.command({
        createUser: USER,
        pwd: PASSWORD,
        roles: [{ role: 'readAnyDatabase', db: 'admin' }],
        mechanisms: ['SCRAM-SHA-1', 'SCRAM-SHA-256'],
      });
    }
  } finally {
    await client.close();
  }
}

function profile(
  id: string,
  fields: Partial<Profile> & Pick<Profile, 'connectionString'>,
): Profile {
  return { id, name: `Profile ${id}`, readOnly: false, production: false, ...fields };
}

/** A manager whose "main" knows `profiles` and stores `secrets`; collects every log line. */
function setup(profiles: Profile[], secrets: Record<string, Record<string, string>> = {}) {
  const logs: string[] = [];
  const deps: ConnectionManagerDeps = {
    loadProfile: (id) => {
      const found = profiles.find((p) => p.id === id);
      return found
        ? Promise.resolve(found)
        : Promise.reject(new RpcError('NOT_FOUND', `No profile with id ${id}`));
    },
    loadSecrets: (id) => Promise.resolve(secrets[id] ?? null),
    log: (message) => logs.push(message),
  };
  const manager = new ConnectionManager(deps);
  managers.push(manager);
  return { manager, logs };
}

const managers: ConnectionManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.closeAll()));
});

async function failure(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw new Error(`expected an RpcError, got ${String(error)}`, { cause: error });
  }
  throw new Error('expected a failure');
}

beforeAll(async () => {
  await Promise.all(
    [...STANDALONES, 'mongo8rs' as const].map((name) => createUser(mongo[name].uri)),
  );
});

describe.each(STANDALONES)('SCRAM on %s', (name) => {
  const scram = (mechanism: 'SCRAM-SHA-1' | 'SCRAM-SHA-256', secretMode: 'saved' | 'ask') =>
    profile(`${name}-${mechanism}-${secretMode}`, {
      connectionString: mongo[name].uri,
      auth: { mechanism, username: USER, authSource: 'admin', secretMode },
      serverSelectionTimeoutMS: 5_000,
    });

  it.each(['SCRAM-SHA-1', 'SCRAM-SHA-256'] as const)(
    'connects with %s and a saved password',
    async (mechanism) => {
      const p = scram(mechanism, 'saved');
      const { manager } = setup([p], { [p.id]: { password: PASSWORD } });
      await expect(manager.open(p.id, undefined)).resolves.toEqual({
        profileId: p.id,
        state: 'connected',
      });
      const info = await manager.serverInfo(p.id);
      expect(info.version.startsWith(`${mongo[name].version}.`)).toBe(true);
      expect(info.topology).toBe('standalone');
      expect(info.enterprise).toBe(false);
      const raw = JSON.parse(info.raw) as { buildInfo: { version: string } };
      expect(raw.buildInfo.version).toBe(info.version);
    },
  );

  it('conn.test with an asked password reports latency and server info', async () => {
    const p = scram('SCRAM-SHA-256', 'ask');
    const { manager } = setup([p]);
    const result = await manager.test({ profileId: p.id }, PASSWORD);
    expect(result.latencyMS).toBeGreaterThanOrEqual(0);
    expect(result.server.topology).toBe('standalone');
    // The test connection is closed again.
    expect(manager.statuses()).toEqual([]);
  });

  it('a wrong password is AUTH_FAILED (test and open), and the status keeps the error', async () => {
    const p = scram('SCRAM-SHA-256', 'saved');
    const { manager, logs } = setup([p], { [p.id]: { password: WRONG } });
    const tested = await failure(manager.test({ profileId: p.id }, undefined));
    expect(tested.code).toBe('AUTH_FAILED');
    const opened = await failure(manager.open(p.id, undefined));
    expect(opened.code).toBe('AUTH_FAILED');
    expect(manager.statusOf(p.id)).toMatchObject({
      state: 'error',
      error: { code: 'AUTH_FAILED' },
    });
    expect(() => manager.client(p.id)).toThrow(/no open connection/);
    // Logs mask passwords: neither the wrong one nor the right one appears anywhere.
    expect(logs.length).toBeGreaterThan(0);
    for (const line of [...logs, tested.message, opened.message]) {
      expect(line).not.toContain(WRONG);
      expect(line).not.toContain(PASSWORD);
    }
  });

  it('tests an unsaved draft (user from the URI); its typed password never reaches the log', async () => {
    const draft: ProfileDraft = {
      name: 'draft',
      connectionString: `mongodb://${USER}@${mongo[name].host}:${mongo[name].port}/?directConnection=true`,
      auth: { mechanism: 'SCRAM-SHA-256', authSource: 'admin', secretMode: 'ask' },
      readOnly: false,
      production: false,
    };
    const { manager, logs } = setup([]);
    await expect(manager.test({ profile: draft }, PASSWORD)).resolves.toMatchObject({
      server: { topology: 'standalone' },
    });
    expect(await failure(manager.test({ profile: draft }, WRONG))).toMatchObject({
      code: 'AUTH_FAILED',
    });
    expect(logs.join('\n')).not.toContain(PASSWORD);
    expect(logs.join('\n')).not.toContain(WRONG);
  });
});

describe('replica set fixture', () => {
  it('reports the replicaSet topology and authenticates with SCRAM', async () => {
    const p = profile('rs', {
      connectionString: mongo.mongo8rs.uri,
      auth: {
        mechanism: 'SCRAM-SHA-256',
        username: USER,
        authSource: 'admin',
        secretMode: 'saved',
      },
    });
    const { manager } = setup([p], { rs: { password: PASSWORD } });
    await manager.open('rs', undefined);
    const info = await manager.serverInfo('rs');
    expect(info.topology).toBe('replicaSet');
    const raw = JSON.parse(info.raw) as { hello: { setName: string } };
    expect(raw.hello.setName).toBe(mongo.mongo8rs.replicaSet);
  });
});

describe.each(['mongo8tls', 'mongo7tls'] as const)('TLS on %s', (name) => {
  const tlsProfile = (id: string, tls: Profile['tls']) =>
    profile(id, { connectionString: mongo[name].uri, tls, serverSelectionTimeoutMS: 5_000 });

  it('without the CA file is TLS_ERROR', async () => {
    const p = tlsProfile('no-ca', { enabled: true });
    const { manager } = setup([p]);
    const error = await failure(manager.test({ profileId: p.id }, undefined));
    expect(error.code).toBe('TLS_ERROR');
    expect(error.message).toMatch(/^TLS connection failed: /);
  });

  it('with the CA file connects', async () => {
    const p = tlsProfile('ca', { enabled: true, caFile: tlsCaFile });
    const { manager } = setup([p]);
    await expect(manager.test({ profileId: p.id }, undefined)).resolves.toMatchObject({
      server: { topology: 'standalone' },
    });
  });

  it('with allowInvalidCertificates connects without the CA file', async () => {
    const p = tlsProfile('insecure', { enabled: true, allowInvalidCertificates: true });
    const { manager } = setup([p]);
    await expect(manager.test({ profileId: p.id }, undefined)).resolves.toMatchObject({
      server: { topology: 'standalone' },
    });
  });

  it('a plain connection to a TLS-only server fails', async () => {
    const p = tlsProfile('plain', { enabled: false });
    const { manager } = setup([p]);
    const error = await failure(manager.test({ profileId: p.id }, undefined));
    expect(['NETWORK_ERROR', 'TIMEOUT', 'TLS_ERROR']).toContain(error.code);
  });
});

describe('unknown hosts', () => {
  it('a host name that does not resolve is DNS_ERROR', async () => {
    const p = profile('dns', {
      connectionString: 'mongodb://thicket-no-such-host.invalid:27017/',
      serverSelectionTimeoutMS: 3_000,
    });
    const { manager } = setup([p]);
    const error = await failure(manager.open(p.id, undefined));
    expect(error.code).toBe('DNS_ERROR');
    expect(manager.statusOf(p.id)).toMatchObject({ state: 'error', error: { code: 'DNS_ERROR' } });
  });

  it('an SRV name that does not resolve is DNS_ERROR', async () => {
    const p = profile('srv', {
      connectionString: 'mongodb+srv://cluster0.thicket-no-such-host.invalid/',
      serverSelectionTimeoutMS: 3_000,
    });
    const { manager } = setup([p]);
    expect((await failure(manager.test({ profileId: p.id }, undefined))).code).toBe('DNS_ERROR');
  });

  it('a closed port is NETWORK_ERROR', async () => {
    const p = profile('closed', {
      connectionString: 'mongodb://127.0.0.1:1/?directConnection=true',
      serverSelectionTimeoutMS: 2_000,
    });
    const { manager } = setup([p]);
    expect((await failure(manager.test({ profileId: p.id }, undefined))).code).toBe(
      'NETWORK_ERROR',
    );
  });
});

describe('several connections', () => {
  const ids = ['m8', 'm7', 'rs', 'tls'];
  let profiles: Profile[] = [];
  beforeAll(() => {
    profiles = [
      profile('m8', { connectionString: mongo.mongo8.uri }),
      profile('m7', { connectionString: mongo.mongo7.uri }),
      profile('rs', { connectionString: mongo.mongo8rs.uri }),
      profile('tls', {
        connectionString: mongo.mongo8tls.uri,
        tls: { enabled: true, caFile: tlsCaFile },
      }),
    ];
  });

  it('open at once and close independently (through the conn.* handlers)', async () => {
    const { manager } = setup(profiles);
    const handlers = connHandlers(manager);
    const ctx = { signal: new AbortController().signal, requestId: 'r' };
    const call = (method: string, params: unknown) =>
      (handlers[method] as (p: never, c: typeof ctx) => unknown)(params as never, ctx);

    const opened = await Promise.all(ids.map((profileId) => call('conn.open', { profileId })));
    expect(opened).toEqual(ids.map((profileId) => ({ profileId, state: 'connected' })));
    expect(await call('conn.status', {})).toEqual({
      connections: ids.map((profileId) => ({ profileId, state: 'connected' })),
    });

    await call('conn.close', { profileId: 'm7' });
    expect(await call('conn.status', { profileId: 'm7' })).toEqual({
      connections: [{ profileId: 'm7', state: 'disconnected' }],
    });
    expect(
      (await failure(Promise.resolve().then(() => call('conn.serverInfo', { profileId: 'm7' }))))
        .code,
    ).toBe('NOT_CONNECTED');
    // The others still work.
    for (const id of ['m8', 'rs', 'tls']) {
      const ping = await manager.client(id).db('admin').command({ ping: 1 });
      expect(ping['ok']).toBe(1);
    }
    expect(await call('conn.serverInfo', { profileId: 'rs' })).toMatchObject({
      topology: 'replicaSet',
    });

    // Reopening one doesn't touch the others; closing twice is harmless.
    await call('conn.open', { profileId: 'm7' });
    await call('conn.close', { profileId: 'm8' });
    await call('conn.close', { profileId: 'm8' });
    const status = (await call('conn.status', {})) as { connections: { profileId: string }[] };
    expect(status.connections.map((c) => c.profileId).sort()).toEqual(['m7', 'rs', 'tls']);
    expect((await manager.client('m7').db('admin').command({ ping: 1 }))['ok']).toBe(1);
  });
});
