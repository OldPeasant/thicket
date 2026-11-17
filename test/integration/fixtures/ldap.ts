import { randomBytes } from 'node:crypto';
import { release } from 'node:os';
import { MongoClient } from 'mongodb';
import {
  GenericContainer,
  Network,
  Wait,
  type StartedNetwork,
  type StartedTestContainer,
} from 'testcontainers';

/**
 * LDAP fixture (task ldap-auth): MongoDB Enterprise with access control and `PLAIN` enabled, bound
 * to an OpenLDAP server on a private container network (plain LDAP on 389, test only). Only the
 * MongoDB port is published. The server maps a user name `u` to the DN
 * `uid=u,ou=people,dc=thicket,dc=test` and checks the password with a simple bind; the user also
 * exists in `$external` (roles come from there, no LDAP authorization query).
 *
 * Every password (LDAP admin, MongoDB root, the LDAP user) is generated when the fixture starts.
 *
 * Enterprise 8.0: mongo 8.0 images refuse to start on Linux kernels 6.19.0-7.0.13
 * (SERVER-121912, see `MONGO_IMAGES`); there is no 8.2 Enterprise image to switch to.
 */
export const MONGO_ENTERPRISE_IMAGE = 'docker.io/mongodb/mongodb-enterprise-server:8.0-ubuntu2204';
export const OPENLDAP_IMAGE = 'docker.io/osixia/openldap:1.5.0';

export const LDAP_DOMAIN = 'thicket.test';
export const LDAP_BASE_DN = 'dc=thicket,dc=test';
export const LDAP_USER = 'alice';
const LDAP_ALIAS = 'thicket-ldap';
const MONGO_PORT = 27017;

/**
 * Whether `kernel` (a Linux release such as `7.0.9-200.fc44.x86_64`) is in the range where mongo
 * 8.0 images refuse to start (6.19.0 to 7.0.13, SERVER-121912).
 */
export function kernelBreaksMongo80(kernel: string): boolean {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(kernel);
  if (!match) return false;
  const [major, minor, patch] = [match[1], match[2], match[3] ?? '0'].map(Number) as [
    number,
    number,
    number,
  ];
  const v = major * 1_000_000 + minor * 1_000 + patch;
  return v >= 6_019_000 && v <= 7_000_013;
}

/**
 * The Enterprise 8.0 container did not start and the host kernel is one it refuses to run on: the
 * fixture can't run on this host (not a test failure). Tests skip with `message`.
 */
export class LdapFixtureUnsupportedError extends Error {
  override readonly name = 'LdapFixtureUnsupportedError';
}

export interface LdapFixture {
  /** Connection string of the Enterprise server (no credentials, `directConnection`). */
  uri: string;
  /** LDAP user that exists in the directory and in `$external` (readAnyDatabase). */
  username: string;
  password: string;
  /** A user that exists in `$external` but not in the directory. */
  unknownUser: string;
  stop(): Promise<void>;
}

function secret(): string {
  return randomBytes(12).toString('hex');
}

function startOpenLdap(network: StartedNetwork, adminPassword: string) {
  return new GenericContainer(OPENLDAP_IMAGE)
    .withNetwork(network)
    .withNetworkAliases(LDAP_ALIAS)
    .withEnvironment({
      LDAP_ORGANISATION: 'Thicket Test',
      LDAP_DOMAIN,
      LDAP_ADMIN_PASSWORD: adminPassword,
      LDAP_TLS: 'false',
    })
    .withWaitStrategy(Wait.forLogMessage(/slapd starting/))
    .withStartupTimeout(120_000)
    .start();
}

function startMongoEnterprise(
  network: StartedNetwork,
  root: { username: string; password: string },
) {
  const userToDn = JSON.stringify([
    { match: '(.+)', substitution: `uid={0},ou=people,${LDAP_BASE_DN}` },
  ]);
  return (
    new GenericContainer(MONGO_ENTERPRISE_IMAGE)
      .withNetwork(network)
      .withExposedPorts(MONGO_PORT)
      .withEnvironment({
        MONGODB_INITDB_ROOT_USERNAME: root.username,
        MONGODB_INITDB_ROOT_PASSWORD: root.password,
      })
      .withCommand([
        '--bind_ip_all',
        '--setParameter',
        'authenticationMechanisms=PLAIN,SCRAM-SHA-256',
        '--ldapServers',
        `${LDAP_ALIAS}:389`,
        '--ldapTransportSecurity',
        'none',
        '--ldapBindMethod',
        'simple',
        '--ldapUserToDNMapping',
        userToDn,
      ])
      // The entrypoint starts a temporary mongod to create the root user, then the real one.
      .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/, 2))
      .withStartupTimeout(180_000)
      .start()
  );
}

/** Adds `ou=people` and the user; retries while slapd is still finishing its bootstrap. */
async function seedDirectory(
  ldap: StartedTestContainer,
  adminPassword: string,
  userPassword: string,
): Promise<void> {
  const ldif = [
    `dn: ou=people,${LDAP_BASE_DN}`,
    'objectClass: organizationalUnit',
    'ou: people',
    '',
    `dn: uid=${LDAP_USER},ou=people,${LDAP_BASE_DN}`,
    'objectClass: inetOrgPerson',
    `uid: ${LDAP_USER}`,
    'cn: Alice Test',
    'sn: Test',
    `userPassword: ${userPassword}`,
    '',
  ].join('\n');
  await ldap.copyContentToContainer([{ content: ldif, target: '/tmp/thicket.ldif', mode: 0o600 }]);
  const deadline = Date.now() + 60_000;
  for (;;) {
    const result = await ldap.exec([
      'ldapadd',
      '-x',
      '-H',
      'ldap://localhost',
      '-D',
      `cn=admin,${LDAP_BASE_DN}`,
      '-w',
      adminPassword,
      '-f',
      '/tmp/thicket.ldif',
    ]);
    if (result.exitCode === 0) return;
    if (Date.now() > deadline) {
      throw new Error(`ldapadd failed (${String(result.exitCode)}): ${result.output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function startLdapFixture(): Promise<LdapFixture> {
  const adminPassword = secret();
  const password = secret();
  const root = { username: 'ldaproot', password: secret() };
  const unknownUser = 'mallory';

  const network = await new Network().start();
  const containers: StartedTestContainer[] = [];
  const stop = async () => {
    await Promise.all(containers.map((c) => c.stop().catch(() => undefined)));
    await network.stop().catch(() => undefined);
  };
  try {
    const started = await Promise.allSettled([
      startOpenLdap(network, adminPassword),
      startMongoEnterprise(network, root),
    ]);
    for (const result of started) if (result.status === 'fulfilled') containers.push(result.value);
    const [ldapStart, mongoStart] = started;
    if (mongoStart.status === 'rejected' && process.platform === 'linux') {
      // Containers share the host kernel (Docker or Podman on Linux, no VM in between).
      const kernel = release();
      if (kernelBreaksMongo80(kernel)) {
        throw new LdapFixtureUnsupportedError(
          `${MONGO_ENTERPRISE_IMAGE} does not start on Linux ${kernel} (kernels 6.19.0-7.0.13, ` +
            `SERVER-121912) and there is no newer Enterprise image: LDAP fixture unavailable ` +
            `(${String(mongoStart.reason)})`,
        );
      }
    }
    for (const result of [ldapStart, mongoStart]) {
      if (result.status === 'rejected') throw result.reason;
    }
    const [ldap, mongo] = containers as [StartedTestContainer, StartedTestContainer];

    await seedDirectory(ldap, adminPassword, password);

    const uri = `mongodb://${mongo.getHost()}:${String(mongo.getMappedPort(MONGO_PORT))}/?directConnection=true`;
    const admin = new MongoClient(uri, { auth: root, serverSelectionTimeoutMS: 30_000 });
    try {
      for (const user of [LDAP_USER, unknownUser]) {
        await admin.db('$external').command({
          createUser: user,
          roles: [{ role: 'readAnyDatabase', db: 'admin' }],
        });
      }
    } finally {
      await admin.close();
    }

    return { uri, username: LDAP_USER, password, unknownUser, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
