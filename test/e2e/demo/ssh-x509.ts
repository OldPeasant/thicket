import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
// Default import: ssh2 is CommonJS, and Node's ESM loader (Playwright e2e) has no named `utils`.
import ssh2 from 'ssh2';
import { GenericContainer, Network, Wait, type StartedTestContainer } from 'testcontainers';

import { generateTestPki } from '../../integration/fixtures/certs.ts';
import { MONGO_IMAGES, MONGOD_8_ARGS } from '../../integration/fixtures/mongo.ts';
import { SSH_IMAGE } from '../../integration/fixtures/ssh.ts';
import { issueClientCertificate, X509_USER_SUBJECT } from '../../integration/fixtures/x509.ts';

/**
 * Demo step 10 fixture: an X.509 MongoDB server reachable only through an SSH bastion.
 *
 * A private container network holds `demo-x509` (MongoDB 8, `--auth`, `requireTLS`, server
 * certificate for `demo-x509` from a per-run CA, an `$external` user for `X509_USER_SUBJECT`) and an
 * OpenSSH server that accepts one ed25519 key. Only the SSH port is published to the host for the
 * app; the MongoDB port is published only so the fixture can create the users and seed data (the
 * app's profile names `demo-x509:27017`, which only the SSH server resolves). Keys, certificates
 * and the root password are generated per run and written to a temp folder that `stop()` deletes.
 */
export const X509_HOST = 'demo-x509';
export const X509_DB = 'fleet';
export const X509_COLL = 'trucks';
export const X509_DOCS = 12;
const SSH_PORT = 2222;
const SSH_USER = 'thicket';

export interface SshX509Fixture {
  sshHost: string;
  sshPort: number;
  sshUser: string;
  /** Unencrypted OpenSSH private key file (mode 0600). */
  sshKeyFile: string;
  /** CA certificate file (PEM) of the server certificate. */
  caFile: string;
  /** Client certificate and key (PEM bundle) of `X509_USER_SUBJECT`. */
  certKeyFile: string;
  /** What the user pastes: the X.509 profile without SSH (SSH is no URI option). */
  uri: string;
  stop(): Promise<void>;
}

export async function startSshX509Fixture(): Promise<SshX509Fixture> {
  const dir = await mkdtemp(join(tmpdir(), 'thicket-e2e-demo-x509-'));
  const write = async (name: string, content: string) => {
    const path = join(dir, name);
    await writeFile(path, content, { mode: 0o600 });
    return path;
  };
  const { certs, issuer } = generateTestPki([X509_HOST, 'localhost', '127.0.0.1']);
  const client = issueClientCertificate(issuer, X509_USER_SUBJECT);
  const key = ssh2.utils.generateKeyPairSync('ed25519', { comment: 'thicket-demo' });
  const root = { username: 'demoroot', password: randomBytes(16).toString('hex') };
  const caFile = await write('ca.pem', certs.caCert);
  const certKeyFile = await write('client.pem', client.certPem + client.keyPem);
  const sshKeyFile = await write('id_ed25519', key.private);

  const network = await new Network().start();
  const containers: StartedTestContainer[] = [];
  const stop = async () => {
    await Promise.all(containers.map((c) => c.stop().catch(() => undefined)));
    await network.stop().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  };
  try {
    const certDir = '/etc/thicket-test-tls';
    const started = await Promise.allSettled([
      new GenericContainer(MONGO_IMAGES['8'])
        .withNetwork(network)
        .withNetworkAliases(X509_HOST)
        .withExposedPorts(27017)
        .withEnvironment({
          MONGO_INITDB_ROOT_USERNAME: root.username,
          MONGO_INITDB_ROOT_PASSWORD: root.password,
        })
        .withCopyContentToContainer([
          { content: certs.serverCertKey, target: `${certDir}/server.pem`, mode: 0o644 },
          { content: certs.caCert, target: `${certDir}/ca.pem`, mode: 0o644 },
        ])
        .withCommand([
          'mongod',
          '--bind_ip_all',
          '--port',
          '27017',
          '--tlsMode',
          'requireTLS',
          '--tlsCertificateKeyFile',
          `${certDir}/server.pem`,
          '--tlsCAFile',
          `${certDir}/ca.pem`,
          '--tlsAllowConnectionsWithoutCertificates',
          ...MONGOD_8_ARGS,
        ])
        // The entrypoint starts mongod once without auth to create the root user, then for real.
        .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/, 2))
        .withStartupTimeout(120_000)
        .start(),
      new GenericContainer(SSH_IMAGE)
        .withNetwork(network)
        .withEnvironment({
          USER_NAME: SSH_USER,
          PASSWORD_ACCESS: 'false',
          PUBLIC_KEY_DIR: '/thicket-keys',
        })
        .withCopyContentToContainer([
          { content: `${key.public}\n`, target: '/thicket-keys/demo.pub', mode: 0o644 },
          {
            // Included before the main config's `AllowTcpForwarding no`: the first value wins.
            content: 'AllowTcpForwarding yes\n',
            target: '/config/sshd/sshd_config.d/thicket.conf',
            mode: 0o644,
          },
        ])
        .withExposedPorts(SSH_PORT)
        .withWaitStrategy(
          Wait.forAll([Wait.forLogMessage(/\[ls\.io-init\] done/), Wait.forListeningPorts()]),
        )
        .withStartupTimeout(120_000)
        .start(),
    ]);
    for (const result of started) if (result.status === 'fulfilled') containers.push(result.value);
    const failed = started.find((r) => r.status === 'rejected');
    if (failed) throw (failed as PromiseRejectedResult).reason;
    const [mongo, sshd] = containers as [StartedTestContainer, StartedTestContainer];

    // Users and data, from the host over the published port (`localhost` is in the certificate).
    const admin = new MongoClient(
      `mongodb://${mongo.getHost()}:${String(mongo.getMappedPort(27017))}/?directConnection=true`,
      {
        tls: true,
        ca: certs.caCert,
        tlsAllowInvalidHostnames: true,
        auth: root,
        authSource: 'admin',
        serverSelectionTimeoutMS: 30_000,
      },
    );
    try {
      await admin.db('$external').command({
        createUser: X509_USER_SUBJECT,
        roles: [{ role: 'readAnyDatabase', db: 'admin' }],
      });
      await admin
        .db(X509_DB)
        .collection(X509_COLL)
        .insertMany(
          Array.from({ length: X509_DOCS }, (_, i) => ({
            plate: `ZH ${String(1000 + i)}`,
            depot: i % 2 === 0 ? 'Zurich' : 'Basel',
          })),
        );
    } finally {
      await admin.close();
    }

    return {
      sshHost: sshd.getHost(),
      sshPort: sshd.getMappedPort(SSH_PORT),
      sshUser: SSH_USER,
      sshKeyFile,
      caFile,
      certKeyFile,
      uri:
        `mongodb://${X509_HOST}:27017/?tls=true&tlsCAFile=${encodeURIComponent(caFile)}` +
        `&tlsCertificateKeyFile=${encodeURIComponent(certKeyFile)}` +
        `&authMechanism=MONGODB-X509&directConnection=true`,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
