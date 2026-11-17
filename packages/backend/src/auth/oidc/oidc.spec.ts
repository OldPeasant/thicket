import { oidcPrompt, type OidcPrompt } from '@thicket/contract';
import type { OIDCCallbackParams } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RpcError } from '../../server/rpc';
import { BrowserUnavailableError, IdpGrantError } from './flows';
import {
  DEFAULT_REDIRECT_URI,
  OidcAuthenticator,
  parseCachedTokens,
  type CachedTokens,
  type OidcEnvironment,
  type OidcTarget,
} from './oidc';
import { FakeIdp, redirectBack, type IdpAnswer } from './testing';

// Fictitious client id and tokens; the IdP is a local fake on 127.0.0.1.
const CLIENT_ID = 'thicket-test-client';
const NOW = 1_700_000_000_000;

let idp: FakeIdp;
/** What the token endpoint answers for a refresh_token grant (default: a new access token). */
let refreshAnswer: (form: Record<string, string>) => IdpAnswer;
beforeEach(async () => {
  idp = await FakeIdp.start();
  refreshAnswer = () => ({ body: { access_token: 'at-refreshed', expires_in: 300 } });
  idp.on('/token', ({ form }) => {
    switch (form['grant_type']) {
      case 'authorization_code':
        return {
          body: { access_token: 'at-browser', expires_in: 600, refresh_token: 'rt-browser' },
        };
      case 'refresh_token':
        return refreshAnswer(form);
      default:
        return {
          body: { access_token: 'at-device', expires_in: 600, refresh_token: 'rt-device' },
        };
    }
  });
  idp.on('/device', () => ({
    body: {
      device_code: 'dc-1',
      user_code: 'WDJB-MJHT',
      verification_uri: 'https://idp.example.test/device',
      expires_in: 300,
      interval: 1,
    },
  }));
});
afterEach(async () => {
  await idp.close();
});

interface Harness {
  auth: OidcAuthenticator;
  env: OidcEnvironment & {
    openBrowser: ReturnType<typeof vi.fn<(url: string) => Promise<void>>>;
    saveTokens: ReturnType<typeof vi.fn<(id: string, tokens: string | null) => Promise<void>>>;
  };
  prompts: OidcPrompt[];
  logs: string[];
  /** The browser's redirect requests (awaited so failures surface). */
  browsing: Promise<unknown>[];
}

/**
 * An authenticator whose "system browser" comes back to the loopback redirect with a code
 * (`browser: 'works'`), with an IdP error (`'denies'`), never (`'waits'`), or cannot open.
 */
function harness(browser: 'works' | 'denies' | 'waits' | 'missing' = 'works'): Harness {
  const prompts: OidcPrompt[] = [];
  const logs: string[] = [];
  const browsing: Promise<unknown>[] = [];
  const openBrowser = vi.fn((url: string) => {
    if (browser === 'missing') return Promise.reject(new Error('no display'));
    if (browser === 'works') browsing.push(redirectBack(url, { code: 'code-1' }));
    if (browser === 'denies') browsing.push(redirectBack(url, { error: 'access_denied' }));
    return Promise.resolve();
  });
  const env = {
    openBrowser,
    saveTokens: vi.fn<OidcEnvironment['saveTokens']>(() => Promise.resolve()),
    prompt: (prompt: OidcPrompt) => void prompts.push(prompt),
    redirectUri: 'http://127.0.0.1:0/redirect',
    log: (message: string) => void logs.push(message),
    now: () => NOW,
    sleep: () => Promise.resolve(),
  };
  return { auth: new OidcAuthenticator(env), env, prompts, logs, browsing };
}

function params(extra: Partial<OIDCCallbackParams> = {}): OIDCCallbackParams {
  return {
    version: 1,
    idpInfo: { issuer: idp.issuer, clientId: CLIENT_ID, requestScopes: ['api://thicket'] },
    timeoutContext: new AbortController().signal,
    ...extra,
  };
}

function cache(extra: Partial<CachedTokens> = {}): string {
  return JSON.stringify({
    v: 1,
    issuer: idp.issuer,
    clientId: CLIENT_ID,
    accessToken: 'at-stored',
    refreshToken: 'rt-stored',
    expiresAt: NOW + 3_600_000,
    ...extra,
  } satisfies CachedTokens);
}

const target = (extra: Partial<OidcTarget> = {}): OidcTarget => ({
  profileId: 'p1',
  profileName: 'Fictitious OIDC',
  ...extra,
});

function signIn(h: Harness, t: OidcTarget = target(), p: OIDCCallbackParams = params()) {
  return h.auth.callbackFor(t)(p);
}

async function rejection(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RpcError);
    return error as RpcError;
  }
  throw new Error('expected a rejection');
}

const grants = () => idp.to('/token').map((r) => r.form['grant_type']);

describe('OidcAuthenticator: interactive sign-in', () => {
  it('signs in with the browser, answers the driver and stores the tokens for the profile', async () => {
    const h = harness();
    await expect(signIn(h)).resolves.toEqual({
      accessToken: 'at-browser',
      expiresInSeconds: 600,
      refreshToken: 'rt-browser',
    });
    expect(h.env.openBrowser).toHaveBeenCalledTimes(1);
    const url = new URL(h.env.openBrowser.mock.calls[0]?.[0] ?? '');
    expect(url.searchParams.get('scope')).toBe('openid api://thicket offline_access');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(h.env.saveTokens).toHaveBeenCalledTimes(1);
    const [profileId, saved] = h.env.saveTokens.mock.calls[0] ?? [];
    expect(profileId).toBe('p1');
    expect(parseCachedTokens(saved ?? undefined)).toEqual({
      v: 1,
      issuer: idp.issuer,
      clientId: CLIENT_ID,
      accessToken: 'at-browser',
      expiresAt: NOW + 600_000,
      refreshToken: 'rt-browser',
    });
    await Promise.all(h.browsing);
  });

  it('announces the browser prompt and its end with one prompt id; no token in the events', async () => {
    const h = harness();
    await signIn(h);
    const [browser, finished] = h.prompts;
    expect(h.prompts).toHaveLength(2);
    expect(browser).toMatchObject({
      kind: 'browser',
      profileId: 'p1',
      profileName: 'Fictitious OIDC',
      url: h.env.openBrowser.mock.calls[0]?.[0],
    });
    expect(finished).toEqual({
      kind: 'finished',
      ok: true,
      promptId: browser?.promptId,
      profileId: 'p1',
      profileName: 'Fictitious OIDC',
    });
    for (const prompt of h.prompts) expect(oidcPrompt.safeParse(prompt).success).toBe(true);
    expect(JSON.stringify(h.prompts)).not.toMatch(/at-browser|rt-browser|code-1/);
  });

  it('a failed sign-in ends its prompt with ok: false', async () => {
    const h = harness('denies');
    const error = await rejection(signIn(h));
    expect(error).toBeInstanceOf(IdpGrantError);
    expect(h.prompts.map((p) => p.kind)).toEqual(['browser', 'finished']);
    expect(h.prompts[1]).toMatchObject({ ok: false });
    expect(h.env.saveTokens).not.toHaveBeenCalled();
  });

  it("oidcFlow 'deviceCode' shows a device code instead of opening the browser", async () => {
    const h = harness();
    await expect(signIn(h, target({ flow: 'deviceCode' }))).resolves.toMatchObject({
      accessToken: 'at-device',
      refreshToken: 'rt-device',
    });
    expect(h.env.openBrowser).not.toHaveBeenCalled();
    expect(h.prompts).toEqual([
      {
        kind: 'device',
        promptId: expect.any(String) as string,
        profileId: 'p1',
        profileName: 'Fictitious OIDC',
        userCode: 'WDJB-MJHT',
        verificationUri: 'https://idp.example.test/device',
        expiresInSeconds: 300,
      },
      expect.objectContaining({ kind: 'finished', ok: true, promptId: h.prompts[0]?.promptId }),
    ]);
    for (const prompt of h.prompts) expect(oidcPrompt.safeParse(prompt).success).toBe(true);
  });

  it.each([undefined, 'auto'] as const)(
    'oidcFlow %s falls back to the device flow when no browser can be opened',
    async (flow) => {
      const h = harness('missing');
      const t = target(flow ? { flow } : {});
      await expect(signIn(h, t)).resolves.toMatchObject({ accessToken: 'at-device' });
      expect(h.env.openBrowser).toHaveBeenCalledTimes(1);
      expect(h.prompts.map((p) => p.kind)).toEqual(['browser', 'device', 'finished']);
      expect(new Set(h.prompts.map((p) => p.promptId)).size).toBe(1);
      expect(h.prompts[2]).toMatchObject({ ok: true });
      expect(h.logs.some((l) => l.includes('falling back to the device flow'))).toBe(true);
    },
  );

  it("oidcFlow 'authCode' does not fall back: the browser error is the answer", async () => {
    const h = harness('missing');
    const error = await rejection(signIn(h, target({ flow: 'authCode' })));
    expect(error).toBeInstanceOf(BrowserUnavailableError);
    expect(idp.to('/device')).toEqual([]);
    expect(h.prompts.map((p) => p.kind)).toEqual(['browser', 'finished']);
    expect(h.prompts[1]).toMatchObject({ ok: false });
  });

  it('auto does not fall back when the IdP has no device endpoint', async () => {
    const document = idp.metadata();
    delete document['device_authorization_endpoint'];
    idp.on('/.well-known/openid-configuration', () => ({ body: document }));
    const h = harness('missing');
    expect(await rejection(signIn(h))).toBeInstanceOf(BrowserUnavailableError);
  });

  it('auto does not fall back when the user denied the sign-in in the browser', async () => {
    const h = harness('denies');
    await rejection(signIn(h));
    expect(idp.to('/device')).toEqual([]);
  });

  it('cancelling the connect while the browser is open answers CANCELLED and ends the prompt', async () => {
    const h = harness('waits');
    const abort = new AbortController();
    const pending = signIn(h, target({ signal: abort.signal }));
    await vi.waitFor(() => expect(h.prompts).toHaveLength(1));
    abort.abort();
    const error = await rejection(pending);
    expect(error.code).toBe('CANCELLED');
    expect(h.prompts[1]).toMatchObject({ kind: 'finished', ok: false });
    expect(h.env.saveTokens).not.toHaveBeenCalled();
  });

  it("the driver's timeout also ends a waiting sign-in as CANCELLED", async () => {
    const h = harness('waits');
    const timeout = new AbortController();
    const pending = signIn(h, target(), params({ timeoutContext: timeout.signal }));
    await vi.waitFor(() => expect(h.prompts).toHaveLength(1));
    timeout.abort(new Error('driver timeout'));
    expect((await rejection(pending)).code).toBe('CANCELLED');
  });

  it('fails without IdP information from the server', async () => {
    const h = harness();
    const rest = params();
    delete rest.idpInfo;
    const error = await rejection(signIn(h, target(), rest));
    expect(error.code).toBe('AUTH_FAILED');
    expect(idp.requests).toEqual([]);
  });

  it('uses the mongosh/Compass redirect URI by default', () => {
    expect(DEFAULT_REDIRECT_URI).toBe('http://localhost:27097/redirect');
  });
});

describe('OidcAuthenticator: token cache', () => {
  it('a second connect in the same process refreshes instead of opening the browser', async () => {
    const h = harness();
    await signIn(h);
    h.prompts.length = 0;
    // The IdP does not rotate refresh tokens: the old one is kept.
    await expect(signIn(h)).resolves.toEqual({
      accessToken: 'at-refreshed',
      expiresInSeconds: 300,
      refreshToken: 'rt-browser',
    });
    expect(h.env.openBrowser).toHaveBeenCalledTimes(1);
    expect(h.prompts).toEqual([]);
    expect(idp.to('/token')[1]?.form).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'rt-browser',
      client_id: CLIENT_ID,
    });
    expect(parseCachedTokens(h.env.saveTokens.mock.calls[1]?.[1] ?? undefined)).toMatchObject({
      accessToken: 'at-refreshed',
      refreshToken: 'rt-browser',
    });
  });

  it('a stored refresh token is used first (after an app restart); a rotated one is saved', async () => {
    refreshAnswer = () => ({
      body: { access_token: 'at-new', expires_in: 300, refresh_token: 'rt-rotated' },
    });
    const h = harness();
    await expect(signIn(h, target({ stored: cache() }))).resolves.toEqual({
      accessToken: 'at-new',
      expiresInSeconds: 300,
      refreshToken: 'rt-rotated',
    });
    expect(h.env.openBrowser).not.toHaveBeenCalled();
    expect(idp.to('/token')[0]?.form['refresh_token']).toBe('rt-stored');
    expect(parseCachedTokens(h.env.saveTokens.mock.calls[0]?.[1] ?? undefined)).toMatchObject({
      refreshToken: 'rt-rotated',
    });
  });

  it('a stored access token without refresh token is reused while it is valid', async () => {
    const h = harness();
    const stored = cache({ refreshToken: undefined, expiresAt: NOW + 120_000 });
    await expect(signIn(h, target({ stored }))).resolves.toEqual({
      accessToken: 'at-stored',
      expiresInSeconds: 120,
    });
    expect(idp.to('/token')).toEqual([]);
    expect(h.env.openBrowser).not.toHaveBeenCalled();
    expect(h.env.saveTokens).not.toHaveBeenCalled();
    expect(h.logs.some((l) => l.includes('reusing the cached access token'))).toBe(true);
  });

  it.each([
    ['inside the 60 s margin', NOW + 59_000],
    ['expired', NOW - 1],
    ['without expiry', undefined],
  ])('an access token %s is not reused: interactive sign-in', async (_label, expiresAt) => {
    const h = harness();
    const stored = cache({ refreshToken: undefined, expiresAt });
    await expect(signIn(h, target({ stored }))).resolves.toMatchObject({
      accessToken: 'at-browser',
    });
    expect(h.env.openBrowser).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['another issuer', { issuer: 'https://other-idp.example.test' }],
    ['another client', { clientId: 'other-client' }],
  ])('a cache for %s is ignored (no refresh request)', async (_label, change) => {
    const h = harness();
    await expect(signIn(h, target({ stored: cache(change) }))).resolves.toMatchObject({
      accessToken: 'at-browser',
    });
    expect(grants()).toEqual(['authorization_code']);
  });

  it('a dead refresh token (invalid_grant) leads to an interactive sign-in that replaces it', async () => {
    refreshAnswer = () => ({ status: 400, body: { error: 'invalid_grant' } });
    const h = harness();
    await expect(signIn(h, target({ stored: cache() }))).resolves.toMatchObject({
      accessToken: 'at-browser',
      refreshToken: 'rt-browser',
    });
    expect(grants()).toEqual(['refresh_token', 'authorization_code']);
    expect(h.logs.some((l) => l.includes('refresh refused (invalid_grant)'))).toBe(true);
    expect(parseCachedTokens(h.env.saveTokens.mock.calls[0]?.[1] ?? undefined)).toMatchObject({
      refreshToken: 'rt-browser',
    });
  });

  it('a refresh that fails without an OAuth error (IdP down) fails the connect, no browser', async () => {
    refreshAnswer = () => ({ status: 503, raw: 'maintenance' });
    const h = harness();
    const error = await rejection(signIn(h, target({ stored: cache() })));
    expect(error).not.toBeInstanceOf(IdpGrantError);
    expect(error.message).toContain('HTTP 503');
    expect(h.env.openBrowser).not.toHaveBeenCalled();
  });

  it("the driver's refresh token (re-authentication) is used instead of the cache", async () => {
    const h = harness();
    await expect(
      signIn(h, target({ stored: cache() }), params({ refreshToken: 'rt-driver' })),
    ).resolves.toMatchObject({ accessToken: 'at-refreshed', refreshToken: 'rt-driver' });
    expect(idp.to('/token').map((r) => r.form['refresh_token'])).toEqual(['rt-driver']);
  });

  it('a dead driver refresh token leads to an interactive sign-in (cache not tried)', async () => {
    refreshAnswer = () => ({ status: 400, body: { error: 'invalid_grant' } });
    const h = harness();
    await expect(
      signIn(h, target({ stored: cache() }), params({ refreshToken: 'rt-driver' })),
    ).resolves.toMatchObject({ accessToken: 'at-browser' });
    expect(grants()).toEqual(['refresh_token', 'authorization_code']);
  });

  it('tokens in memory win over the stored secret of the connect', async () => {
    const h = harness();
    await signIn(h);
    await signIn(h, target({ stored: cache() }));
    expect(idp.to('/token')[1]?.form['refresh_token']).toBe('rt-browser');
  });

  it('caches are per profile', async () => {
    const h = harness();
    await signIn(h);
    await signIn(h, target({ profileId: 'p2' }));
    expect(h.env.openBrowser).toHaveBeenCalledTimes(2);
    expect(h.env.saveTokens.mock.calls.map((c) => c[0])).toEqual(['p1', 'p2']);
  });

  it('without a profile id (unsaved draft) nothing is cached, stored or reused', async () => {
    const h = harness();
    const draft = target({ profileId: undefined, stored: cache() });
    await signIn(h, draft);
    await signIn(h, draft);
    expect(grants()).toEqual(['authorization_code', 'authorization_code']);
    expect(h.env.saveTokens).not.toHaveBeenCalled();
    expect(h.prompts[0]).not.toHaveProperty('profileId');
    expect(oidcPrompt.safeParse(h.prompts[0]).success).toBe(true);
  });

  it('a failing saveTokens is tolerated: signed in, logged, kept in memory', async () => {
    const h = harness();
    h.env.saveTokens.mockRejectedValue(new Error('keychain locked'));
    await expect(signIn(h)).resolves.toMatchObject({ accessToken: 'at-browser' });
    expect(h.logs.some((l) => l.includes('cannot store the tokens') && l.includes('locked'))).toBe(
      true,
    );
    await signIn(h);
    expect(h.env.openBrowser).toHaveBeenCalledTimes(1);
    expect(grants()).toEqual(['authorization_code', 'refresh_token']);
  });

  it('forget drops the memory and clears the stored tokens', async () => {
    const h = harness();
    await signIn(h);
    await h.auth.forget('p1');
    expect(h.env.saveTokens).toHaveBeenLastCalledWith('p1', null);
    await signIn(h);
    expect(h.env.openBrowser).toHaveBeenCalledTimes(2);
  });

  it('tokens the server refused are forgotten: the next connect signs in interactively', async () => {
    const h = harness();
    // Answered from the stored cache (refresh, no browser); the server then refuses the token.
    const first = target({ stored: cache() });
    await signIn(h, first);
    expect(h.env.openBrowser).not.toHaveBeenCalled();
    await expect(h.auth.refused(first)).resolves.toBe(true);
    expect(h.env.saveTokens).toHaveBeenLastCalledWith('p1', null);
    // Main cleared the keychain, so the next connect has no stored tokens either.
    await signIn(h, target());
    expect(h.env.openBrowser).toHaveBeenCalledTimes(1);
    expect(grants()).toEqual(['refresh_token', 'authorization_code']);
  });

  it('refused forgets nothing when the callback handed out no tokens, or for a draft', async () => {
    idp.on('/.well-known/openid-configuration', () => ({ status: 503, body: {} }));
    const h = harness();
    const failed = target({ stored: cache() });
    await rejection(signIn(h, failed));
    await expect(h.auth.refused(failed)).resolves.toBe(false);
    await expect(h.auth.refused(target())).resolves.toBe(false);
    // A draft signed in (no profile id) has nothing cached to forget.
    const document = idp.metadata();
    idp.on('/.well-known/openid-configuration', () => ({ body: document }));
    const draft: OidcTarget = { profileName: 'Draft' };
    await signIn(h, draft);
    await expect(h.auth.refused(draft)).resolves.toBe(false);
    expect(h.env.saveTokens).not.toHaveBeenCalled();
  });

  it('log lines never contain tokens', async () => {
    refreshAnswer = () => ({ status: 400, body: { error: 'invalid_grant' } });
    const h = harness();
    await signIn(h, target({ stored: cache() }));
    expect(h.logs.length).toBeGreaterThan(0);
    expect(h.logs.join('\n')).not.toMatch(/at-|rt-|code-1/);
  });
});

describe('OidcAuthenticator: discovery', () => {
  it('fetches the discovery document once per issuer', async () => {
    const h = harness();
    await signIn(h);
    await signIn(h, target({ profileId: 'p2' }));
    expect(idp.to('/.well-known/openid-configuration')).toHaveLength(1);
  });

  it('retries a discovery that failed', async () => {
    let fail = true;
    const document = idp.metadata();
    idp.on('/.well-known/openid-configuration', () =>
      fail ? { status: 503, raw: '' } : { body: document },
    );
    const h = harness();
    expect((await rejection(signIn(h))).code).toBe('AUTH_FAILED');
    fail = false;
    await expect(signIn(h)).resolves.toMatchObject({ accessToken: 'at-browser' });
    expect(idp.to('/.well-known/openid-configuration')).toHaveLength(2);
  });

  it("cancelling one connect during discovery does not fail another profile's connect", async () => {
    const document = idp.metadata();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    idp.on('/.well-known/openid-configuration', async () => {
      await gate;
      return { body: document };
    });
    const h = harness();
    const first = new AbortController();
    const cancelled = signIn(h, target({ signal: first.signal }));
    const other = signIn(h, target({ profileId: 'p2', signal: new AbortController().signal }));
    await vi.waitFor(() => expect(idp.to('/.well-known/openid-configuration')).toHaveLength(1));
    first.abort();
    release();
    expect((await rejection(cancelled)).code).toBe('CANCELLED');
    await expect(other).resolves.toMatchObject({ accessToken: 'at-browser' });
  });
});

describe('parseCachedTokens', () => {
  it('reads a valid cache', () => {
    const value: CachedTokens = {
      v: 1,
      issuer: 'https://idp.example.test',
      clientId: CLIENT_ID,
      accessToken: 'at',
    };
    expect(parseCachedTokens(JSON.stringify(value))).toEqual(value);
    expect(
      parseCachedTokens(JSON.stringify({ ...value, expiresAt: 5, refreshToken: 'r' })),
    ).toEqual({ ...value, expiresAt: 5, refreshToken: 'r' });
  });

  it.each([
    ['nothing', undefined],
    ['not JSON', '{nope'],
    ['null', 'null'],
    ['a string', '"tokens"'],
    ['another version', JSON.stringify({ v: 2, issuer: 'i', clientId: 'c', accessToken: 'a' })],
    ['no access token', JSON.stringify({ v: 1, issuer: 'i', clientId: 'c' })],
    ['a numeric issuer', JSON.stringify({ v: 1, issuer: 1, clientId: 'c', accessToken: 'a' })],
    [
      'a string expiry',
      JSON.stringify({ v: 1, issuer: 'i', clientId: 'c', accessToken: 'a', expiresAt: '5' }),
    ],
    [
      'a numeric refresh token',
      JSON.stringify({ v: 1, issuer: 'i', clientId: 'c', accessToken: 'a', refreshToken: 5 }),
    ],
  ])('treats %s as no cache', (_label, text) => {
    expect(parseCachedTokens(text)).toBeUndefined();
  });

  it('an unreadable stored cache leads to an interactive sign-in', async () => {
    const h = harness();
    await signIn(h, target({ stored: '{corrupt' }));
    expect(grants()).toEqual(['authorization_code']);
  });
});
