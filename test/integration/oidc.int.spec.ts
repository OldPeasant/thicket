import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  ConnectionManager,
  OidcAuthenticator,
  parseCachedTokens,
  RpcError,
  type OidcEnvironment,
} from '@thicket/backend';
import type { OidcFlow, OidcPrompt, Profile } from '@thicket/contract';

import { KeycloakBrowser, startOidcFixture, type OidcFixture } from './fixtures/oidc.ts';

// MONGODB-OIDC through the connection manager (task oidc-auth): MongoDB Enterprise trusting a
// Keycloak realm. Headless Chromium stands in for the system browser and signs in on Keycloak's
// pages; an in-memory map stands in for the keychain (main's `oidc.saveTokens` / `secrets.get`).

let oidc: OidcFixture;
let browser: KeycloakBrowser;
beforeAll(async () => {
  oidc = await startOidcFixture();
  browser = new KeycloakBrowser(oidc.user);
});
afterAll(async () => {
  await browser?.close();
  await oidc?.stop();
});

const managers: ConnectionManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.closeAll()));
});

/** The keychain: `oidcTokens` per profile id, as main stores it. */
type Keychain = Map<string, string>;

interface Harness {
  manager: ConnectionManager;
  /** URLs handed to "the system browser". */
  opened: string[];
  prompts: OidcPrompt[];
  logs: string[];
  /** Background browser work (sign-ins); awaited so failures surface. */
  pending: Promise<void>[];
}

function oidcProfile(id: string, flow?: OidcFlow): Profile {
  return {
    id,
    name: `OIDC ${id}`,
    connectionString: oidc.uri,
    auth: { mechanism: 'MONGODB-OIDC', secretMode: 'none', ...(flow ? { oidcFlow: flow } : {}) },
    serverSelectionTimeoutMS: 10_000,
    readOnly: false,
    production: false,
  };
}

/**
 * A backend as `startBackend` builds it, with a fresh `OidcAuthenticator` (no tokens in memory,
 * like after an app restart): tokens can only come from `keychain`.
 */
function backend(
  profiles: Profile[],
  keychain: Keychain,
  options: { browserWorks?: boolean } = {},
): Harness {
  const opened: string[] = [];
  const prompts: OidcPrompt[] = [];
  const logs: string[] = [];
  const pending: Promise<void>[] = [];
  const env: OidcEnvironment = {
    openBrowser: (url) => {
      opened.push(url);
      if (options.browserWorks === false) {
        return Promise.reject(new Error('no browser on this machine'));
      }
      // Like shell.openExternal: resolves once the browser has the URL; the user signs in later.
      pending.push(browser.openAndSignIn(url));
      return Promise.resolve();
    },
    saveTokens: (profileId, tokens) => {
      if (tokens === null) keychain.delete(profileId);
      else keychain.set(profileId, tokens);
      return Promise.resolve();
    },
    prompt: (prompt) => {
      prompts.push(prompt);
      if (prompt.kind === 'device') {
        pending.push(
          browser.approveDevice(
            prompt.verificationUriComplete ?? prompt.verificationUri,
            prompt.userCode,
          ),
        );
      }
    },
    // A free port per sign-in: parallel test runs must not fight over mongosh's 27097.
    redirectUri: 'http://127.0.0.1:0/callback',
    ca: oidc.caCert,
    log: (message) => logs.push(message),
  };
  const manager = new ConnectionManager({
    loadProfile: (id) => {
      const found = profiles.find((p) => p.id === id);
      return found
        ? Promise.resolve(found)
        : Promise.reject(new RpcError('NOT_FOUND', `No profile with id ${id}`));
    },
    loadSecrets: (id) => {
      const tokens = keychain.get(id);
      return Promise.resolve(tokens !== undefined ? { oidcTokens: tokens } : null);
    },
    oidc: new OidcAuthenticator(env),
    log: (message) => logs.push(message),
  });
  managers.push(manager);
  return { manager, opened, prompts, logs, pending };
}

/** The authenticated user of the open connection, from `connectionStatus`. */
async function authenticatedUsers(manager: ConnectionManager, profileId: string) {
  const status = await manager.client(profileId).db('admin').command({ connectionStatus: 1 });
  return (status['authInfo'] as { authenticatedUsers: { user: string; db: string }[] })
    .authenticatedUsers;
}

const ALICE = () => [{ user: `keycloak/${oidc.user.username}`, db: '$external' }];

describe('MONGODB-OIDC with Keycloak', () => {
  it('authorization code flow: the browser signs in on Keycloak and the connect succeeds', async () => {
    const keychain: Keychain = new Map();
    const profile = oidcProfile('code');
    const { manager, opened, prompts, pending } = backend([profile], keychain);

    const status = await manager.open(profile.id, undefined);
    await Promise.all(pending);

    expect(status.state).toBe('connected');
    expect(await authenticatedUsers(manager, profile.id)).toEqual(ALICE());
    // The authorization request: Keycloak's endpoint, PKCE S256, the loopback redirect.
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0] ?? '');
    expect(url.origin + url.pathname).toBe(`${oidc.issuer}/protocol/openid-connect/auth`);
    expect(url.searchParams.get('client_id')).toBe(oidc.clientId);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(prompts.map((p) => p.kind)).toEqual(['browser', 'finished']);
    expect(prompts.at(-1)).toMatchObject({ kind: 'finished', ok: true, profileId: profile.id });
    // The tokens are in the keychain, for the issuer and client the server announced.
    const cached = parseCachedTokens(keychain.get(profile.id));
    expect(cached).toMatchObject({ issuer: oidc.issuer, clientId: oidc.clientId });
    expect(cached?.refreshToken).toBeTypeOf('string');
  });

  it('token reuse: a second connect (also after a restart) does not open the browser', async () => {
    const keychain: Keychain = new Map();
    const profile = oidcProfile('reuse');
    const first = backend([profile], keychain);
    await first.manager.open(profile.id, undefined);
    await Promise.all(first.pending);
    expect(first.opened).toHaveLength(1);

    // Same backend: close and connect again.
    await first.manager.close(profile.id);
    const again = await first.manager.open(profile.id, undefined);
    expect(again.state).toBe('connected');
    expect(first.opened).toHaveLength(1);
    expect(await authenticatedUsers(first.manager, profile.id)).toEqual(ALICE());

    // A new backend process (nothing in memory): the tokens come from the keychain.
    await first.manager.closeAll();
    const second = backend([profile], keychain);
    const status = await second.manager.open(profile.id, undefined);
    expect(status.state).toBe('connected');
    expect(second.opened).toEqual([]);
    expect(second.prompts).toEqual([]);
    expect(second.logs.some((line) => line.includes('refreshed the access token'))).toBe(true);
    expect(await authenticatedUsers(second.manager, profile.id)).toEqual(ALICE());
  });

  it('a dead refresh token in the keychain leads to a new browser sign-in', async () => {
    const keychain: Keychain = new Map();
    const profile = oidcProfile('stale');
    keychain.set(
      profile.id,
      JSON.stringify({
        v: 1,
        issuer: oidc.issuer,
        clientId: oidc.clientId,
        accessToken: 'not-a-token',
        refreshToken: 'not-a-refresh-token',
      }),
    );
    const { manager, opened, pending } = backend([profile], keychain);
    const status = await manager.open(profile.id, undefined);
    await Promise.all(pending);
    expect(status.state).toBe('connected');
    expect(opened).toHaveLength(1);
    expect(parseCachedTokens(keychain.get(profile.id))?.refreshToken).not.toBe(
      'not-a-refresh-token',
    );
  });

  it('device flow: the user code is shown, approved on Keycloak, and the connect succeeds', async () => {
    const keychain: Keychain = new Map();
    const profile = oidcProfile('device', 'deviceCode');
    const { manager, opened, prompts, pending } = backend([profile], keychain);

    const status = await manager.open(profile.id, undefined);
    await Promise.all(pending);

    expect(status.state).toBe('connected');
    expect(await authenticatedUsers(manager, profile.id)).toEqual(ALICE());
    expect(opened).toEqual([]);
    const device = prompts.find((p) => p.kind === 'device');
    expect(device).toMatchObject({
      kind: 'device',
      profileId: profile.id,
      verificationUri: `${oidc.issuer}/device`,
    });
    expect(prompts.at(-1)).toMatchObject({ kind: 'finished', ok: true });
    expect(parseCachedTokens(keychain.get(profile.id))?.refreshToken).toBeTypeOf('string');
  });

  it('auto flow falls back to the device flow when no browser can be opened', async () => {
    const keychain: Keychain = new Map();
    const profile = oidcProfile('fallback', 'auto');
    const { manager, opened, prompts, pending } = backend([profile], keychain, {
      browserWorks: false,
    });

    const status = await manager.open(profile.id, undefined);
    await Promise.all(pending);

    expect(status.state).toBe('connected');
    expect(opened).toHaveLength(1);
    expect(prompts.map((p) => p.kind)).toEqual(['browser', 'device', 'finished']);
    expect(await authenticatedUsers(manager, profile.id)).toEqual(ALICE());
  });

  it('closing the connection while the sign-in waits cancels it', async () => {
    const keychain: Keychain = new Map();
    const profile = oidcProfile('cancel', 'deviceCode');
    const opened: OidcPrompt[] = [];
    const manager = new ConnectionManager({
      loadProfile: () => Promise.resolve(profile),
      loadSecrets: () => Promise.resolve(null),
      oidc: new OidcAuthenticator({
        openBrowser: () => Promise.resolve(),
        saveTokens: () => Promise.resolve(),
        // Nobody approves the code.
        prompt: (prompt) => opened.push(prompt),
        ca: oidc.caCert,
      }),
    });
    managers.push(manager);
    const opening = manager.open(profile.id, undefined);
    await expect.poll(() => opened.some((p) => p.kind === 'device')).toBe(true);
    await manager.close(profile.id);
    const error = await opening.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe('CANCELLED');
    await expect.poll(() => opened.at(-1)?.kind).toBe('finished');
    expect(keychain.size).toBe(0);
  });
});
