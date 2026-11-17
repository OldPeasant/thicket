import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MongoClient } from 'mongodb';
import { chromium, type Browser, type Page } from '@playwright/test';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { generateTestPki } from './certs.ts';

/**
 * OIDC fixture (task oidc-auth): Keycloak (HTTPS, per-run test CA) with a realm, a public client
 * for the authorization code (PKCE) and device flows, and a user; MongoDB Enterprise with
 * MONGODB-OIDC trusting that realm and an `$external` user for the Keycloak user. Nothing is
 * committed: the CA, the user's password and the root password are generated when it starts.
 *
 * Networking: the issuer URL must be the same for the test (host) and mongod (which fetches the
 * realm's keys). Keycloak listens on a free host port `P` inside its container and is published as
 * `P:P`; mongod shares Keycloak's network namespace, so `https://localhost:P` is Keycloak for both.
 */
export interface OidcFixture {
  /** Connection string of the Enterprise server (published from the shared network namespace). */
  uri: string;
  /** `https://localhost:P/realms/thicket`, what mongod announces in its IdP info. */
  issuer: string;
  /** PEM of the test CA that signed Keycloak's certificate (the OIDC client must trust it). */
  caCert: string;
  caFile: string;
  clientId: string;
  /** The Keycloak user and its generated password; it exists in `$external` as `keycloak/<name>`. */
  user: { username: string; password: string };
  /** Root user (SCRAM) of the server, for checks. */
  root: { username: string; password: string };
  stop(): Promise<void>;
}

export const OIDC_IMAGES = {
  keycloak: 'quay.io/keycloak/keycloak:26.4',
  mongodb: 'docker.io/mongodb/mongodb-enterprise-server:8.0-ubuntu2204',
} as const;

const REALM = 'thicket';
const CLIENT_ID = 'thicket-cli';
const AUDIENCE = 'thicket-mongo';
const AUTH_NAME_PREFIX = 'keycloak';
const MONGO_PORT = 27017;

function secret(): string {
  return randomBytes(16).toString('hex');
}

/** A free TCP port on the host (closed again before Keycloak takes it). */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function realm(user: { username: string; password: string }): unknown {
  return {
    realm: REALM,
    enabled: true,
    accessTokenLifespan: 300,
    users: [
      {
        username: user.username,
        enabled: true,
        email: `${user.username}@example.test`,
        emailVerified: true,
        firstName: 'Alice',
        lastName: 'Tester',
        credentials: [{ type: 'password', value: user.password, temporary: false }],
        // Keycloak's default realm roles include it; an imported user gets only what is listed.
        realmRoles: ['offline_access'],
      },
    ],
    clients: [
      {
        clientId: CLIENT_ID,
        name: 'Thicket',
        enabled: true,
        publicClient: true,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        consentRequired: false,
        // Loopback redirects on any port (RFC 8252 7.3).
        redirectUris: ['http://127.0.0.1/*', 'http://127.0.0.1:*', 'http://localhost:*'],
        attributes: {
          'pkce.code.challenge.method': 'S256',
          'oauth2.device.authorization.grant.enabled': 'true',
        },
        protocolMappers: [
          {
            name: 'mongodb-audience',
            protocol: 'openid-connect',
            protocolMapper: 'oidc-audience-mapper',
            config: {
              'included.custom.audience': AUDIENCE,
              'access.token.claim': 'true',
              'id.token.claim': 'false',
            },
          },
        ],
      },
    ],
  };
}

/** Starts Keycloak and the Enterprise server, creates `$external` user `keycloak/<user>`. */
export async function startOidcFixture(): Promise<OidcFixture> {
  const user = { username: 'alice', password: secret() };
  const root = { username: 'oidcroot', password: secret() };
  const { certs } = generateTestPki(['localhost', '127.0.0.1']);
  const [serverCert = '', serverKey = ''] = certs.serverCertKey.split(
    /(?=-----BEGIN (?:RSA )?PRIVATE KEY-----)/,
  );
  const port = await freePort();
  const issuer = `https://localhost:${String(port)}/realms/${REALM}`;
  const dir = await mkdtemp(join(tmpdir(), 'thicket-int-oidc-'));
  const caFile = join(dir, 'ca.pem');
  await writeFile(caFile, certs.caCert, { mode: 0o600 });

  let keycloak: StartedTestContainer | undefined;
  let mongod: StartedTestContainer | undefined;
  const stop = async (): Promise<void> => {
    await mongod?.stop().catch(() => undefined);
    await keycloak?.stop().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  };
  try {
    keycloak = await new GenericContainer(OIDC_IMAGES.keycloak)
      .withExposedPorts({ container: port, host: port }, MONGO_PORT)
      .withCopyContentToContainer([
        { content: serverCert, target: '/opt/keycloak/conf/tls.crt', mode: 0o644 },
        { content: serverKey, target: '/opt/keycloak/conf/tls.key', mode: 0o644 },
        {
          content: JSON.stringify(realm(user)),
          target: '/opt/keycloak/data/import/thicket.json',
          mode: 0o644,
        },
      ])
      .withEnvironment({
        KC_HTTPS_CERTIFICATE_FILE: '/opt/keycloak/conf/tls.crt',
        KC_HTTPS_CERTIFICATE_KEY_FILE: '/opt/keycloak/conf/tls.key',
      })
      .withCommand([
        'start-dev',
        '--import-realm',
        `--https-port=${String(port)}`,
        '--http-enabled=false',
        `--hostname=https://localhost:${String(port)}`,
      ])
      .withWaitStrategy(Wait.forLogMessage(/Listening on:/))
      .withStartupTimeout(180_000)
      .start();

    const providers = [
      {
        issuer,
        audience: AUDIENCE,
        authNamePrefix: AUTH_NAME_PREFIX,
        clientId: CLIENT_ID,
        principalName: 'preferred_username',
        useAuthorizationClaim: false,
        supportsHumanFlows: true,
      },
    ];
    mongod = await new GenericContainer(OIDC_IMAGES.mongodb)
      .withNetworkMode(`container:${keycloak.getId()}`)
      // mongod fetches the realm's keys over HTTPS with the system CA bundle: only the test CA.
      .withCopyContentToContainer([
        { content: certs.caCert, target: '/etc/ssl/certs/ca-certificates.crt', mode: 0o644 },
      ])
      .withEnvironment({
        MONGODB_INITDB_ROOT_USERNAME: root.username,
        MONGODB_INITDB_ROOT_PASSWORD: root.password,
      })
      .withCommand([
        'mongod',
        '--bind_ip_all',
        '--port',
        String(MONGO_PORT),
        '--setParameter',
        'authenticationMechanisms=SCRAM-SHA-256,MONGODB-OIDC',
        '--setParameter',
        `oidcIdentityProviders=${JSON.stringify(providers)}`,
      ])
      .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/, 2))
      .withStartupTimeout(180_000)
      .start();

    const uri = `mongodb://localhost:${String(keycloak.getMappedPort(MONGO_PORT))}/?directConnection=true`;
    const admin = new MongoClient(uri, {
      auth: root,
      authSource: 'admin',
      serverSelectionTimeoutMS: 30_000,
    });
    try {
      await admin.db('$external').command({
        createUser: `${AUTH_NAME_PREFIX}/${user.username}`,
        roles: [{ role: 'readAnyDatabase', db: 'admin' }],
      });
    } finally {
      await admin.close();
    }
    return { uri, issuer, caCert: certs.caCert, caFile, clientId: CLIENT_ID, user, root, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

/**
 * Headless Chromium that signs in on Keycloak's pages, standing in for the system browser. Keycloak
 * uses the per-run test CA, so certificate errors are ignored in this browser only.
 */
export class KeycloakBrowser {
  private browser: Browser | undefined;
  /** URLs the app asked to open (authorization code flow). */
  readonly opened: string[] = [];

  constructor(private readonly user: { username: string; password: string }) {}

  /** Authorization code flow: open the URL, sign in; Keycloak redirects to the loopback server. */
  async openAndSignIn(url: string): Promise<void> {
    this.opened.push(url);
    const page = await this.page();
    // The redirect target is the app's loopback server, which answers with a short page.
    await page.goto(url);
    await this.signIn(page);
    await page.waitForURL(/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])/, { timeout: 30_000 });
    await page.close();
  }

  /** Device flow: open the verification page (user code filled in), sign in, grant access. */
  async approveDevice(verificationUri: string, userCode: string): Promise<void> {
    const page = await this.page();
    await page.goto(verificationUri);
    const codeField = page.locator('input[name="device_user_code"]');
    if (await codeField.isVisible().catch(() => false)) {
      await codeField.fill(userCode);
      await page.locator('input[type="submit"], button[type="submit"]').first().click();
    }
    await this.signIn(page);
    // Keycloak asks to grant the device access (consent screen for the device grant).
    const accept = page.locator('#kc-login, input[name="accept"], button[name="accept"]');
    await accept.first().waitFor({ timeout: 30_000 });
    await accept.first().click();
    await page.waitForLoadState('load');
    await page.close();
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
  }

  private async page(): Promise<Page> {
    this.browser ??= await chromium.launch();
    const context = await this.browser.newContext({ ignoreHTTPSErrors: true });
    return context.newPage();
  }

  private async signIn(page: Page): Promise<void> {
    await page.locator('#username').waitFor({ timeout: 30_000 });
    await page.fill('#username', this.user.username);
    await page.fill('#password', this.user.password);
    await page.click('#kc-login');
  }
}
