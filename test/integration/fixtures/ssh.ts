import { randomBytes } from 'node:crypto';
import {
  GenericContainer,
  Network,
  Wait,
  type StartedNetwork,
  type StartedTestContainer,
} from 'testcontainers';

import { generateTestKeyPair } from '../../../packages/backend/src/ssh/testing.ts';
import { MONGO_IMAGES, MONGOD_8_ARGS } from './mongo.ts';

/**
 * SSH fixture (task ssh-tunnel): a two-member replica set and an OpenSSH server on a private
 * container network. Only the SSH port is published; the members are known as `ssh-rs-a:27017` and
 * `ssh-rs-b:27017`, names only the SSH server can resolve, so a client reaches them (and discovers
 * the set) only through the tunnel. `ssh-rs-b` has priority 0: it stays a secondary.
 *
 * The SSH user accepts a password and two ed25519 keys (one encrypted with a passphrase), all
 * generated per run. TCP forwarding is switched on (the image's default is off).
 */
export const SSH_IMAGE = 'lscr.io/linuxserver/openssh-server:latest';
export const SSH_REPLICA_SET = 'rs3';
export const SSH_PRIMARY = 'ssh-rs-a:27017';
export const SSH_SECONDARY = 'ssh-rs-b:27017';
export const SSH_USER = 'thicket';
const SSH_PORT = 2222;

export interface SshFixture {
  /** Replica set connection string with the member names (only resolvable behind SSH). */
  uri: string;
  sshHost: string;
  sshPort: number;
  password: string;
  /** OpenSSH format private keys. */
  privateKey: string;
  encryptedKey: string;
  passphrase: string;
  /** Established TCP connections to sshd inside its container. */
  sshConnections(): Promise<number>;
  /** Connections a member has from the SSH server (= tunnelled ones), read inside its container. */
  mongoConnections(member: 'primary' | 'secondary'): Promise<number>;
  /** Kills every SSH session of the test user inside the sshd container (the listener stays). */
  dropSshSessions(): Promise<void>;
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
      SSH_REPLICA_SET,
      ...MONGOD_8_ARGS,
    ])
    .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
    .withStartupTimeout(120_000)
    .start();
}

export async function startSshFixture(): Promise<SshFixture> {
  const password = randomBytes(12).toString('hex');
  const passphrase = randomBytes(12).toString('hex');
  const plain = generateTestKeyPair({ comment: 'thicket-plain' });
  const encrypted = generateTestKeyPair({
    comment: 'thicket-encrypted',
    passphrase,
    cipher: 'aes256-ctr',
  });
  const network = await new Network().start();
  const containers: StartedTestContainer[] = [];
  const stop = async () => {
    await Promise.all(containers.map((c) => c.stop().catch(() => undefined)));
    await network.stop().catch(() => undefined);
  };
  try {
    const started = await Promise.allSettled([
      member(network, 'ssh-rs-a'),
      member(network, 'ssh-rs-b'),
      new GenericContainer(SSH_IMAGE)
        .withNetwork(network)
        .withEnvironment({
          USER_NAME: SSH_USER,
          USER_PASSWORD: password,
          PASSWORD_ACCESS: 'true',
          PUBLIC_KEY_DIR: '/thicket-keys',
        })
        .withCopyContentToContainer([
          { content: `${plain.public}\n`, target: '/thicket-keys/plain.pub', mode: 0o644 },
          { content: `${encrypted.public}\n`, target: '/thicket-keys/encrypted.pub', mode: 0o644 },
          {
            // Included before the main config's `AllowTcpForwarding no`: the first value wins.
            content: 'AllowTcpForwarding yes\n',
            target: '/config/sshd/sshd_config.d/thicket.conf',
            mode: 0o644,
          },
        ])
        .withExposedPorts(SSH_PORT)
        // sshd logs to a file; the init finishes after the service is up.
        .withWaitStrategy(
          Wait.forAll([Wait.forLogMessage(/\[ls\.io-init\] done/), Wait.forListeningPorts()]),
        )
        .withStartupTimeout(120_000)
        .start(),
    ]);
    for (const result of started) if (result.status === 'fulfilled') containers.push(result.value);
    const failed = started.find((r) => r.status === 'rejected');
    if (failed) throw (failed as PromiseRejectedResult).reason;
    const [primary, secondary, sshd] = containers as [
      StartedTestContainer,
      StartedTestContainer,
      StartedTestContainer,
    ];
    await initiate(primary);

    return {
      uri: `mongodb://${SSH_PRIMARY},${SSH_SECONDARY}/?replicaSet=${SSH_REPLICA_SET}`,
      sshHost: sshd.getHost(),
      sshPort: sshd.getMappedPort(SSH_PORT),
      password,
      privateKey: plain.private,
      encryptedKey: encrypted.private,
      passphrase,
      sshConnections: () => establishedOn(sshd, SSH_PORT),
      mongoConnections: async (which) => {
        const target = which === 'primary' ? primary : secondary;
        // Every tunnelled connection comes from sshd's address; the members' own replication
        // connections and this mongosh don't.
        const sshdIp = sshd.getIpAddress(network.getName());
        const out = await mongosh(
          target,
          `db.getSiblingDB('admin').aggregate([{ $currentOp: { allUsers: true, idleConnections: true } }])` +
            `.toArray().filter((op) => String(op.client).startsWith('${sshdIp}:')).length`,
        );
        return Number(out.trim());
      },
      dropSshSessions: async () => {
        // Session processes are named `sshd: thicket...` / `sshd-session: thicket...`. No shell:
        // its own command line would match the pattern too.
        const result = await sshd.exec(['pkill', '-KILL', '-f', `: ${SSH_USER}`]);
        if (result.exitCode !== 0) {
          throw new Error(
            `pkill found no SSH session (${String(result.exitCode)}): ${result.output}`,
          );
        }
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function mongosh(container: StartedTestContainer, script: string): Promise<string> {
  const result = await container.exec(['mongosh', '--quiet', '--eval', script]);
  if (result.exitCode !== 0) {
    throw new Error(`mongosh failed (${String(result.exitCode)}): ${result.output}`);
  }
  return result.stdout;
}

/** Initiates the set inside the primary's container; waits for PRIMARY and SECONDARY. */
async function initiate(primary: StartedTestContainer): Promise<void> {
  await mongosh(
    primary,
    `rs.initiate({ _id: '${SSH_REPLICA_SET}', members: [` +
      `{ _id: 0, host: '${SSH_PRIMARY}', priority: 2 }, ` +
      `{ _id: 1, host: '${SSH_SECONDARY}', priority: 0 }] })`,
  );
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const states = await mongosh(
      primary,
      "try { rs.status().members.map((m) => m.name + '=' + m.stateStr).sort().join(',') } catch (e) { '' }",
    ).catch(() => '');
    if (states.trim() === `${SSH_PRIMARY}=PRIMARY,${SSH_SECONDARY}=SECONDARY`) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`replica set ${SSH_REPLICA_SET} has no primary and secondary after 90 s`);
}

/** ESTABLISHED TCP connections with local port `port` (from /proc/net/tcp and tcp6). */
async function establishedOn(container: StartedTestContainer, port: number): Promise<number> {
  const result = await container.exec(['cat', '/proc/net/tcp', '/proc/net/tcp6']);
  const hexPort = port.toString(16).toUpperCase().padStart(4, '0');
  return result.stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols[1]?.endsWith(`:${hexPort}`) && cols[3] === '01').length;
}
