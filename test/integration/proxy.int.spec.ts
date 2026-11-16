import type { MongoClient } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ConnectionManager, RpcError, type ConnectionManagerDeps } from '@thicket/backend';
import type { Profile } from '@thicket/contract';

import {
  PRIMARY_HOST,
  SECONDARY_HOST,
  SOCKS_REPLICA_SET,
  startSocksFixture,
  type SocksFixture,
} from './fixtures/socks.ts';

// SOCKS5 proxy, read preference (+ tags) and write concern through the connection manager (task
// x509-proxy). The replica set members' names resolve only behind the proxy, so every successful
// connect here went through it.

let socks: SocksFixture;
beforeAll(async () => {
  socks = await startSocksFixture();
});
afterAll(async () => {
  await socks?.stop();
});

const managers: ConnectionManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.closeAll()));
});

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

function proxied(id: string, extra: Partial<Profile> = {}): Profile {
  return {
    id,
    name: `Proxy ${id}`,
    connectionString: socks.uri,
    proxy: { host: socks.proxyHost, port: socks.proxyPort, username: socks.proxyUsername },
    serverSelectionTimeoutMS: 10_000,
    readOnly: false,
    production: false,
    ...extra,
  };
}

/** Manager and stored proxy password for these profiles. */
function open(...profiles: Profile[]) {
  const secrets = Object.fromEntries(
    profiles.map((p) => [p.id, { proxyPassword: socks.proxyPassword }]),
  );
  return setup(profiles, secrets);
}

async function failure(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw new Error(`expected an RpcError, got ${String(error)}`, { cause: error });
  }
  throw new Error('expected a failure');
}

/** `hello` sent with the connection's own read preference (from the profile). */
async function helloOf(client: MongoClient) {
  return client.db('admin').command({ hello: 1 }, { readPreference: client.readPreference });
}

/** Addresses of the servers whose connections `run` checked out. */
async function serversUsed(client: MongoClient, run: () => Promise<unknown>): Promise<string[]> {
  const used = new Set<string>();
  const listener = (event: { address: string }) => used.add(event.address);
  client.on('connectionCheckedOut', listener);
  try {
    await run();
  } finally {
    client.off('connectionCheckedOut', listener);
  }
  return [...used];
}

describe('SOCKS5 proxy', () => {
  it('connects to the replica set through the proxy, with the stored proxy password', async () => {
    const p = proxied('via-proxy');
    const { manager, logs } = open(p);
    await expect(manager.open(p.id, undefined)).resolves.toMatchObject({ state: 'connected' });
    const info = await manager.serverInfo(p.id);
    expect(info.topology).toBe('replicaSet');
    const raw = JSON.parse(info.raw) as {
      hello: { setName: string; hosts: string[]; passives?: string[] };
    };
    expect(raw.hello.setName).toBe(SOCKS_REPLICA_SET);
    // The priority-0 secondary is listed as a passive member.
    expect(raw.hello.hosts).toEqual([PRIMARY_HOST]);
    expect(raw.hello.passives).toEqual([SECONDARY_HOST]);
    expect(logs.join('\n')).not.toContain(socks.proxyPassword);
  });

  it('conn.test through the proxy reports the replica set', async () => {
    const p = proxied('test-via-proxy');
    const { manager } = open(p);
    const result = await manager.test({ profileId: p.id }, undefined);
    expect(result.server.topology).toBe('replicaSet');
  });

  it('without the proxy the member names do not resolve (DNS_ERROR)', async () => {
    // Long enough for the host's resolver to answer ENOTFOUND (slow with search domains).
    const direct = proxied('direct', { serverSelectionTimeoutMS: 20_000 });
    delete direct.proxy;
    const { manager } = setup([direct]);
    const error = await failure(manager.test({ profileId: direct.id }, undefined));
    expect(error.code).toBe('DNS_ERROR');
  });

  it('a wrong proxy password does not connect and is not logged', async () => {
    const p = proxied('wrong-proxy-password', { serverSelectionTimeoutMS: 3_000 });
    const wrong = 'wrong-proxy-password-value';
    const { manager, logs } = setup([p], { [p.id]: { proxyPassword: wrong } });
    const error = await failure(manager.open(p.id, undefined));
    expect(manager.statusOf(p.id)).toMatchObject({ state: 'error' });
    expect(error.message).not.toContain(wrong);
    expect(logs.join('\n')).not.toContain(wrong);
  });
});

describe('read preference', () => {
  it('secondaryPreferred routes reads to the secondary (hello.me)', async () => {
    const p = proxied('secondary-preferred', { readPreference: 'secondaryPreferred' });
    const { manager } = open(p);
    await manager.open(p.id, undefined);
    const client = manager.client(p.id) as unknown as MongoClient;

    const hello = await helloOf(client);
    expect(hello['me']).toBe(SECONDARY_HOST);
    expect(hello['secondary']).toBe(true);

    // A query follows the same read preference.
    const used = await serversUsed(client, () =>
      client.db('thicket_readpref').collection('items').find({}).toArray(),
    );
    expect(used).toEqual([SECONDARY_HOST]);
  });

  it('primary (the default) reads from the primary', async () => {
    const p = proxied('primary');
    const { manager } = open(p);
    await manager.open(p.id, undefined);
    const client = manager.client(p.id) as unknown as MongoClient;
    const hello = await helloOf(client);
    expect(hello['me']).toBe(PRIMARY_HOST);
    expect(hello['isWritablePrimary']).toBe(true);
  });

  it.each([
    ['a', PRIMARY_HOST],
    ['b', SECONDARY_HOST],
  ])('nearest with tag set dc=%s reads from %s', async (dc, host) => {
    const p = proxied(`tags-${dc}`, {
      readPreference: 'nearest',
      readPreferenceTags: [[{ name: 'dc', value: dc }]],
    });
    const { manager } = open(p);
    await manager.open(p.id, undefined);
    const client = manager.client(p.id) as unknown as MongoClient;
    expect((await helloOf(client))['me']).toBe(host);
  });
});

describe('write concern', () => {
  it('w: 2 from the profile waits for the secondary: a secondary read sees the write', async () => {
    const writer = proxied('w2', { writeConcern: { w: 2, wtimeoutMS: 10_000 } });
    const reader = proxied('reader', { readPreference: 'secondary' });
    const { manager } = open(writer, reader);
    await manager.open(writer.id, undefined);
    await manager.open(reader.id, undefined);
    const writes = manager.client(writer.id) as unknown as MongoClient;
    const reads = manager.client(reader.id) as unknown as MongoClient;
    expect(writes.writeConcern?.w).toBe(2);

    const marker = `w2-${Date.now()}`;
    await writes.db('thicket_wc').collection('items').insertOne({ marker });
    const used = await serversUsed(reads, async () => {
      const found = await reads.db('thicket_wc').collection('items').findOne({ marker });
      expect(found?.['marker']).toBe(marker);
    });
    expect(used).toEqual([SECONDARY_HOST]);
  });

  it('w: 3 from the profile cannot be satisfied by two members: the server says so', async () => {
    const p = proxied('w3', { writeConcern: { w: 3, wtimeoutMS: 2_000 } });
    const { manager } = open(p);
    await manager.open(p.id, undefined);
    const client = manager.client(p.id) as unknown as MongoClient;
    await expect(
      client.db('thicket_wc').collection('items').insertOne({ marker: 'w3' }),
    ).rejects.toThrow(/write concern|Not enough data-bearing nodes/i);
  });
});
