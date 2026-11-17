import { MongoClient } from 'mongodb';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import type { TestCertificates } from './certs.ts';

/**
 * Images of the fixtures. 8.x is 8.2: mongo 8.0 images refuse to start on Linux kernels
 * 6.19.0-7.0.13 (SERVER-121912), 8.2 starts there.
 */
export const MONGO_IMAGES = {
  '8': 'docker.io/library/mongo:8.2',
  '7': 'docker.io/library/mongo:7.0',
} as const;

export type MongoMajor = keyof typeof MONGO_IMAGES;

/** Every fixture the global setup starts, by name. */
export const FIXTURE_NAMES = ['mongo8', 'mongo8rs', 'mongo7', 'mongo8tls', 'mongo7tls'] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

export interface FixtureSpec {
  version: MongoMajor;
  /** Single-node replica set `rs0` instead of a standalone server. */
  replicaSet?: boolean;
  /** `requireTLS` with the test CA's server certificate; clients without a certificate are allowed. */
  tls?: boolean;
  /**
   * Access control on (`--auth`) with this root user, created by the image's entrypoint. Not used
   * by the shared fixtures (they run without auth); tests that need permissions start their own.
   * Generate the password at test time. Standalone only (a replica set would need a key file).
   */
  auth?: { username: string; password: string };
}

export const FIXTURE_SPECS: Record<FixtureName, FixtureSpec> = {
  mongo8: { version: '8' },
  mongo8rs: { version: '8', replicaSet: true },
  mongo7: { version: '7' },
  mongo8tls: { version: '8', tls: true },
  mongo7tls: { version: '7', tls: true },
};

/** What tests get for a fixture (via `inject('mongo')`). Plain JSON: it crosses to the test workers. */
export interface FixtureInfo {
  /** Connection string without TLS options; for TLS fixtures the test adds `tls`/`tlsCAFile`. */
  uri: string;
  host: string;
  port: number;
  version: MongoMajor;
  replicaSet?: string;
  tls: boolean;
}

const CONTAINER_PORT = 27017;
const CERT_DIR = '/etc/thicket-test-tls';
const REPLICA_SET = 'rs0';

export interface StartedFixture {
  info: FixtureInfo;
  container: StartedTestContainer;
}

export async function startFixture(
  spec: FixtureSpec,
  certs: TestCertificates | undefined,
): Promise<StartedFixture> {
  const command = ['mongod', '--bind_ip_all', '--port', String(CONTAINER_PORT)];
  let container = new GenericContainer(MONGO_IMAGES[spec.version])
    .withExposedPorts(CONTAINER_PORT)
    .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
    .withStartupTimeout(120_000);

  if (spec.replicaSet) command.push('--replSet', REPLICA_SET);
  if (spec.auth) {
    if (spec.replicaSet) throw new Error('auth fixtures are standalone only');
    // The entrypoint starts mongod once without auth to create the root user, then for real.
    container = container
      .withEnvironment({
        MONGO_INITDB_ROOT_USERNAME: spec.auth.username,
        MONGO_INITDB_ROOT_PASSWORD: spec.auth.password,
      })
      .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/, 2));
  }
  if (spec.tls) {
    if (!certs) throw new Error('TLS fixture needs certificates');
    command.push(
      '--tlsMode',
      'requireTLS',
      '--tlsCertificateKeyFile',
      `${CERT_DIR}/server.pem`,
      '--tlsCAFile',
      `${CERT_DIR}/ca.pem`,
      '--tlsAllowConnectionsWithoutCertificates',
    );
    container = container.withCopyContentToContainer([
      { content: certs.serverCertKey, target: `${CERT_DIR}/server.pem`, mode: 0o644 },
      { content: certs.caCert, target: `${CERT_DIR}/ca.pem`, mode: 0o644 },
    ]);
  }

  const started = await container.withCommand(command).start();
  try {
    const host = started.getHost();
    const port = started.getMappedPort(CONTAINER_PORT);
    // directConnection: the replica set member is known as localhost:27017 inside the container,
    // which is not reachable from the host; the driver must not try to discover it.
    const uri = `mongodb://${host}:${port}/?directConnection=true`;
    // A TLS replica set (the e2e demo's stand-in for Atlas) is initiated over TLS with the test CA.
    if (spec.replicaSet) await initiateReplicaSet(uri, spec.tls ? certs?.caCert : undefined);
    return {
      container: started,
      info: {
        uri,
        host,
        port,
        version: spec.version,
        tls: spec.tls ?? false,
        ...(spec.replicaSet ? { replicaSet: REPLICA_SET } : {}),
      },
    };
  } catch (error) {
    await started.stop().catch(() => undefined);
    throw error;
  }
}

/**
 * Initiates the single-member set and waits until the member is a writable primary. `caCert`
 * (PEM): connect with TLS, trusting that CA.
 */
async function initiateReplicaSet(uri: string, caCert?: string): Promise<void> {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 30_000,
    ...(caCert === undefined ? {} : { tls: true, ca: caCert }),
  });
  try {
    const admin = client.db('admin');
    await admin.command({
      replSetInitiate: {
        _id: REPLICA_SET,
        members: [{ _id: 0, host: `localhost:${CONTAINER_PORT}` }],
      },
    });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const hello = await admin.command({ hello: 1 });
      if (hello['isWritablePrimary'] === true) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`replica set ${REPLICA_SET} has no primary after 60 s`);
  } finally {
    await client.close();
  }
}
