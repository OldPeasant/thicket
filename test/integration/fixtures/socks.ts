import { randomBytes } from 'node:crypto';
import { MongoClient, type MongoClientOptions } from 'mongodb';
import {
  GenericContainer,
  Network,
  Wait,
  type StartedNetwork,
  type StartedTestContainer,
} from 'testcontainers';

import { MONGO_IMAGES, MONGOD_8_ARGS } from './mongo.ts';

/**
 * SOCKS5 fixture (task x509-proxy): a two-member replica set and a SOCKS5 proxy on a private
 * container network. The members are known as `rs-a:27017` and `rs-b:27017`, names only the proxy
 * can resolve, so a client reaches them (and discovers the set) only through the proxy. `rs-b` has
 * priority 0: it stays a secondary. Member tags: `rs-a` `{ dc: 'a' }`, `rs-b` `{ dc: 'b' }`.
 */
export const SOCKS_IMAGE = 'docker.io/serjs/go-socks5-proxy:latest';
export const SOCKS_REPLICA_SET = 'rs2';
export const PRIMARY_HOST = 'rs-a:27017';
export const SECONDARY_HOST = 'rs-b:27017';
const PROXY_PORT = 1080;

export interface SocksFixture {
  /** Replica set connection string with the member names (only resolvable behind the proxy). */
  uri: string;
  proxyHost: string;
  proxyPort: number;
  /** Generated per run; the proxy requires them. */
  proxyUsername: string;
  proxyPassword: string;
  /** Driver options for reaching the set through the proxy (for setup and checks in tests). */
  proxyOptions: MongoClientOptions;
  stop(): Promise<void>;
}

function member(network: StartedNetwork, alias: string): Promise<StartedTestContainer> {
  return new GenericContainer(MONGO_IMAGES['8'])
    .withNetwork(network)
    .withNetworkAliases(alias)
    .withCommand([
      'mongod',
      '--bind_ip_all',
      '--port',
      '27017',
      '--replSet',
      SOCKS_REPLICA_SET,
      ...MONGOD_8_ARGS,
    ])
    .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
    .withStartupTimeout(120_000)
    .start();
}

export async function startSocksFixture(): Promise<SocksFixture> {
  const proxyUsername = 'thicket-proxy';
  const proxyPassword = randomBytes(12).toString('hex');
  const network = await new Network().start();
  const containers: StartedTestContainer[] = [];
  const stop = async () => {
    await Promise.all(containers.map((c) => c.stop().catch(() => undefined)));
    await network.stop().catch(() => undefined);
  };
  try {
    const started = await Promise.allSettled([
      member(network, 'rs-a'),
      member(network, 'rs-b'),
      new GenericContainer(SOCKS_IMAGE)
        .withNetwork(network)
        .withEnvironment({ PROXY_USER: proxyUsername, PROXY_PASSWORD: proxyPassword })
        .withExposedPorts(PROXY_PORT)
        .withWaitStrategy(Wait.forLogMessage(/Start listening proxy service/))
        .withStartupTimeout(120_000)
        .start(),
    ]);
    for (const result of started) if (result.status === 'fulfilled') containers.push(result.value);
    const failed = started.find((r) => r.status === 'rejected');
    if (failed) throw (failed as PromiseRejectedResult).reason;
    const proxy = containers[2] as StartedTestContainer;

    const proxyOptions: MongoClientOptions = {
      proxyHost: proxy.getHost(),
      proxyPort: proxy.getMappedPort(PROXY_PORT),
      proxyUsername,
      proxyPassword,
    };
    await initiate(proxyOptions);
    return {
      uri: `mongodb://${PRIMARY_HOST},${SECONDARY_HOST}/?replicaSet=${SOCKS_REPLICA_SET}`,
      proxyHost: proxy.getHost(),
      proxyPort: proxy.getMappedPort(PROXY_PORT),
      proxyUsername,
      proxyPassword,
      proxyOptions,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** Initiates the set through the proxy and waits for rs-a PRIMARY and rs-b SECONDARY. */
async function initiate(proxyOptions: MongoClientOptions): Promise<void> {
  const client = new MongoClient(`mongodb://${PRIMARY_HOST}/?directConnection=true`, {
    ...proxyOptions,
    serverSelectionTimeoutMS: 30_000,
  });
  try {
    const admin = client.db('admin');
    await admin.command({
      replSetInitiate: {
        _id: SOCKS_REPLICA_SET,
        members: [
          { _id: 0, host: PRIMARY_HOST, priority: 2, tags: { dc: 'a' } },
          { _id: 1, host: SECONDARY_HOST, priority: 0, tags: { dc: 'b' } },
        ],
      },
    });
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const status = await admin.command({ replSetGetStatus: 1 }).catch(() => undefined);
      const states = (status?.['members'] as { name: string; stateStr: string }[] | undefined)
        ?.map((m) => `${m.name}=${m.stateStr}`)
        .sort();
      if (states?.join(',') === `${PRIMARY_HOST}=PRIMARY,${SECONDARY_HOST}=SECONDARY`) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`replica set ${SOCKS_REPLICA_SET} has no primary and secondary after 90 s`);
  } finally {
    await client.close();
  }
}
