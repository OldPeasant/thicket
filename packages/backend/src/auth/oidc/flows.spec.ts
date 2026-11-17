import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RpcError } from '../../server/rpc';
import {
  authCodeFlow,
  BrowserUnavailableError,
  deviceFlow,
  discover,
  IdpGrantError,
  pkcePair,
  refresh,
  scopesFor,
  tokenRequest,
  type DeviceCode,
  type DeviceFlowOptions,
  type OidcMetadata,
} from './flows';
import { idpRequest, isAllowedIdpUrl } from './http';
import { FakeIdp, redirectBack } from './testing';

// Fictitious client and tokens; the IdP is a local fake on 127.0.0.1 (loopback http is allowed).
const CLIENT_ID = 'thicket-test-client';
const FIXED_NOW = 1_700_000_000_000;
const now = () => FIXED_NOW;

let idp: FakeIdp;
let meta: OidcMetadata;
beforeEach(async () => {
  idp = await FakeIdp.start();
  meta = idp.metadata() as unknown as OidcMetadata;
});
afterEach(async () => {
  await idp.close();
});

async function rejection(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RpcError);
    return error as RpcError;
  }
  throw new Error('expected a rejection');
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('base64url');

/** A port nothing listens on (a server is started and closed again). */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function refused(url: string): Promise<boolean> {
  try {
    await fetch(url);
    return false;
  } catch {
    return true;
  }
}

describe('isAllowedIdpUrl / idpRequest', () => {
  it('allows https anywhere and http only to loopback addresses', () => {
    expect(isAllowedIdpUrl(new URL('https://idp.example.test/x'))).toBe(true);
    expect(isAllowedIdpUrl(new URL('http://127.0.0.1:8080/x'))).toBe(true);
    expect(isAllowedIdpUrl(new URL('http://127.10.0.3/x'))).toBe(true);
    expect(isAllowedIdpUrl(new URL('http://localhost/x'))).toBe(true);
    expect(isAllowedIdpUrl(new URL('http://[::1]:9/x'))).toBe(true);
    expect(isAllowedIdpUrl(new URL('http://idp.example.test/x'))).toBe(false);
    expect(isAllowedIdpUrl(new URL('http://127.0.0.1.example.test/x'))).toBe(false);
    expect(isAllowedIdpUrl(new URL('ftp://idp.example.test/x'))).toBe(false);
  });

  it('refuses a plain-http IdP URL before sending anything', async () => {
    const error = await rejection(idpRequest('http://idp.example.test/token', { a: 'b' }));
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).toContain('not https');
  });

  it('answers status and parsed JSON; an unparseable body is undefined', async () => {
    idp.on('/json', () => ({ status: 201, body: { ok: true } }));
    idp.on('/text', () => ({ status: 502, raw: '<html>bad gateway</html>' }));
    await expect(idpRequest(`${idp.issuer}/json`, undefined)).resolves.toEqual({
      status: 201,
      body: { ok: true },
    });
    await expect(idpRequest(`${idp.issuer}/text`, undefined)).resolves.toEqual({
      status: 502,
      body: undefined,
    });
    expect(idp.to('/json')[0]?.method).toBe('GET');
  });

  it('POSTs a form url-encoded', async () => {
    idp.on('/form', () => ({ body: {} }));
    await idpRequest(`${idp.issuer}/form`, { a: '1 2', b: 'x&y=z' });
    expect(idp.to('/form')[0]).toEqual({
      method: 'POST',
      path: '/form',
      form: { a: '1 2', b: 'x&y=z' },
    });
  });

  it('a refused connection is NETWORK_ERROR naming the IdP host', async () => {
    const port = await freePort();
    const error = await rejection(idpRequest(`http://127.0.0.1:${String(port)}/x`, undefined));
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.message).toContain(`127.0.0.1:${String(port)}`);
  });

  it('a request that takes longer than timeoutMS is NETWORK_ERROR', async () => {
    idp.on('/slow', () => new Promise(() => undefined));
    const error = await rejection(idpRequest(`${idp.issuer}/slow`, undefined, { timeoutMS: 50 }));
    expect(error.code).toBe('NETWORK_ERROR');
  });

  it('an aborted signal is CANCELLED (already aborted and while waiting)', async () => {
    const aborted = new AbortController();
    aborted.abort();
    expect(
      (await rejection(idpRequest(`${idp.issuer}/x`, undefined, { signal: aborted.signal }))).code,
    ).toBe('CANCELLED');
    expect(idp.requests).toEqual([]);

    idp.on('/slow', () => new Promise(() => undefined));
    const later = new AbortController();
    const pending = idpRequest(`${idp.issuer}/slow`, undefined, { signal: later.signal });
    await vi.waitFor(() => expect(idp.to('/slow')).toHaveLength(1));
    later.abort();
    expect((await rejection(pending)).code).toBe('CANCELLED');
  });

  it('an answer larger than 1 MiB fails instead of being read', async () => {
    idp.on('/big', () => ({ raw: `"${'x'.repeat(2 * 1024 * 1024)}"` }));
    const error = await rejection(idpRequest(`${idp.issuer}/big`, undefined, { timeoutMS: 5000 }));
    expect(['NETWORK_ERROR', 'AUTH_FAILED']).toContain(error.code);
  });
});

describe('discover', () => {
  it('fetches the discovery document of the issuer', async () => {
    await expect(discover(idp.issuer, {})).resolves.toEqual(idp.metadata());
    expect(idp.requests.map((r) => [r.method, r.path])).toEqual([
      ['GET', '/.well-known/openid-configuration'],
    ]);
  });

  it('finds the document of an issuer with a path and a trailing slash', async () => {
    const issuer = `${idp.issuer}/realms/thicket/`;
    idp.on('/realms/thicket/.well-known/openid-configuration', () => ({
      body: { ...idp.metadata(), issuer },
    }));
    await expect(discover(issuer, {})).resolves.toMatchObject({ issuer });
  });

  it('refuses an issuer that is not a URL or not https, without a request', async () => {
    const invalid = await rejection(discover('not a url', {}));
    expect(invalid.code).toBe('AUTH_FAILED');
    expect(invalid.message).toContain('invalid OIDC issuer');
    const plain = await rejection(discover('http://idp.example.test', {}));
    expect(plain.code).toBe('AUTH_FAILED');
    expect(plain.message).toContain('not an https URL');
    expect(idp.requests).toEqual([]);
  });

  it.each([
    ['HTTP 404', { status: 404, body: { error: 'nope' } }],
    ['no JSON', { status: 200, raw: '<html></html>' }],
    ['a JSON non-object', { status: 200, body: 'issuer' }],
  ])('refuses a missing discovery document (%s)', async (_label, answer) => {
    idp.on('/.well-known/openid-configuration', () => answer);
    const error = await rejection(discover(idp.issuer, {}));
    expect(error.code).toBe('AUTH_FAILED');
  });

  it('refuses a document that names another issuer (RFC 8414 3.3)', async () => {
    idp.on('/.well-known/openid-configuration', () => ({
      body: { ...idp.metadata(), issuer: 'https://attacker.example.test' },
    }));
    const error = await rejection(discover(idp.issuer, {}));
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).toContain('names another issuer');
    expect(error.message).toContain('https://attacker.example.test');
  });

  it('an issuer differing only by a trailing slash is another issuer', async () => {
    idp.on('/.well-known/openid-configuration', () => ({
      body: { ...idp.metadata(), issuer: `${idp.issuer}/` },
    }));
    expect((await rejection(discover(idp.issuer, {}))).message).toContain('another issuer');
  });

  it.each([
    ['token_endpoint', 'http://idp.example.test/token'],
    ['authorization_endpoint', 'http://idp.example.test/auth'],
    ['device_authorization_endpoint', 'http://idp.example.test/device'],
    ['token_endpoint', 'javascript:alert(1)'],
    ['authorization_endpoint', 'not a url'],
    ['token_endpoint', 42],
  ])('refuses a document whose %s is %s (non-https)', async (field, value) => {
    idp.on('/.well-known/openid-configuration', () => ({
      body: { ...idp.metadata(), [field]: value },
    }));
    const error = await rejection(discover(idp.issuer, {}));
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).toContain('non-https endpoint');
  });

  it('accepts https endpoints on another host and missing optional endpoints', async () => {
    const document = {
      issuer: idp.issuer,
      token_endpoint: 'https://tokens.example.test/token',
    };
    idp.on('/.well-known/openid-configuration', () => ({ body: document }));
    await expect(discover(idp.issuer, {})).resolves.toEqual(document);
  });

  it('refuses a document without a token endpoint', async () => {
    const rest = idp.metadata();
    delete rest['token_endpoint'];
    idp.on('/.well-known/openid-configuration', () => ({ body: rest }));
    expect((await rejection(discover(idp.issuer, {}))).message).toContain('no token endpoint');
  });
});

describe('scopesFor', () => {
  const base: OidcMetadata = { issuer: 'https://idp.example.test', token_endpoint: 'https://t' };

  it('asks for openid, the requested scopes and offline_access when offered or unknown', () => {
    expect(scopesFor(base)).toBe('openid offline_access');
    expect(scopesFor(base, ['api', 'openid'])).toBe('openid api offline_access');
    expect(scopesFor({ ...base, scopes_supported: ['openid', 'offline_access'] }, ['api'])).toBe(
      'openid api offline_access',
    );
  });

  it('leaves out offline_access when the IdP lists its scopes without it', () => {
    expect(scopesFor({ ...base, scopes_supported: ['openid', 'profile'] }, ['api'])).toBe(
      'openid api',
    );
  });
});

describe('tokenRequest / refresh', () => {
  it('posts the grant and maps the answer; expires_in becomes expiresAt via the clock', async () => {
    idp.on('/token', () => ({
      body: { access_token: 'at-1', expires_in: 300, refresh_token: 'rt-1', token_type: 'Bearer' },
    }));
    await expect(tokenRequest(meta, { grant_type: 'x', a: 'b' }, {}, now)).resolves.toEqual({
      accessToken: 'at-1',
      expiresAt: FIXED_NOW + 300_000,
      refreshToken: 'rt-1',
    });
    expect(idp.to('/token')[0]?.form).toEqual({ grant_type: 'x', a: 'b' });
  });

  it.each([0, -5, '300', null])('ignores an expires_in of %s', async (expiresIn) => {
    idp.on('/token', () => ({ body: { access_token: 'at-1', expires_in: expiresIn } }));
    await expect(tokenRequest(meta, {}, {}, now)).resolves.toEqual({ accessToken: 'at-1' });
  });

  it('an error answer is an IdpGrantError carrying the OAuth error code', async () => {
    idp.on('/token', () => ({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'Token is not active' },
    }));
    const error = await rejection(tokenRequest(meta, {}, {}));
    expect(error).toBeInstanceOf(IdpGrantError);
    expect(error.code).toBe('AUTH_FAILED');
    expect((error as IdpGrantError).error).toBe('invalid_grant');
    expect(error.message).toContain('invalid_grant (Token is not active)');
  });

  it('an error without a description has no empty parentheses', async () => {
    idp.on('/token', () => ({ status: 400, body: { error: 'invalid_client' } }));
    const error = await rejection(tokenRequest(meta, {}, {}));
    expect(error.message).toMatch(/invalid_client$/);
  });

  it.each([
    ['HTTP 500 without JSON', { status: 500, raw: 'oops' }, 'HTTP 500'],
    ['HTTP 200 without access_token', { status: 200, body: { token_type: 'Bearer' } }, 'HTTP 200'],
    ['HTTP 401 with an access_token', { status: 401, body: { access_token: 'x' } }, 'HTTP 401'],
  ])('%s is AUTH_FAILED, not a grant error', async (_label, answer, text) => {
    idp.on('/token', () => answer);
    const error = await rejection(tokenRequest(meta, {}, {}));
    expect(error).not.toBeInstanceOf(IdpGrantError);
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).toContain(text);
  });

  it('refresh sends the refresh_token grant with the client id', async () => {
    idp.on('/token', () => ({ body: { access_token: 'at-2', expires_in: 60 } }));
    await expect(refresh(meta, CLIENT_ID, 'rt-old', {}, now)).resolves.toEqual({
      accessToken: 'at-2',
      expiresAt: FIXED_NOW + 60_000,
    });
    expect(idp.to('/token')[0]?.form).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'rt-old',
      client_id: CLIENT_ID,
    });
  });
});

describe('pkcePair', () => {
  it('is an S256 pair: the challenge is the base64url SHA-256 of a 43-char verifier', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(sha256(verifier));
  });

  it('is random per call', () => {
    expect(pkcePair().verifier).not.toBe(pkcePair().verifier);
  });
});

describe('authCodeFlow', () => {
  /** Options whose "browser" runs `browse(url)` in the background once the URL was opened. */
  function options(
    browse: (url: string) => Promise<unknown> = (url) => redirectBack(url, { code: 'code-1' }),
    signal = new AbortController().signal,
  ) {
    const background: Promise<unknown>[] = [];
    const calls: string[] = [];
    const openBrowser = vi.fn((url: string) => {
      calls.push('openBrowser');
      background.push(browse(url));
      return Promise.resolve();
    });
    const onUrl = vi.fn(() => void calls.push('onUrl'));
    return {
      background,
      calls,
      openBrowser,
      onUrl,
      opts: {
        clientId: CLIENT_ID,
        scope: 'openid offline_access',
        redirectUri: 'http://127.0.0.1:0/redirect',
        openBrowser,
        onUrl,
        http: {},
        signal,
        now,
      },
    };
  }

  beforeEach(() => {
    idp.on('/token', () => ({
      body: { access_token: 'at-code', expires_in: 120, refresh_token: 'rt-code' },
    }));
  });

  it('opens the authorization URL with PKCE and state, takes the redirect, exchanges the code', async () => {
    const { opts, openBrowser, onUrl, calls, background } = options();
    await expect(authCodeFlow(meta, opts)).resolves.toEqual({
      accessToken: 'at-code',
      expiresAt: FIXED_NOW + 120_000,
      refreshToken: 'rt-code',
    });
    expect(calls).toEqual(['onUrl', 'openBrowser']);
    const url = new URL(openBrowser.mock.calls[0]?.[0] ?? '');
    expect(onUrl).toHaveBeenCalledWith(url.toString());
    expect(`${url.origin}${url.pathname}`).toBe(`${idp.issuer}/auth`);
    const params = Object.fromEntries(url.searchParams);
    expect(params).toMatchObject({
      client_id: CLIENT_ID,
      response_type: 'code',
      scope: 'openid offline_access',
      code_challenge_method: 'S256',
    });
    expect(params['state']).toMatch(/^[A-Za-z0-9_-]{32}$/);
    // Port 0 was replaced with the port actually listened on.
    const redirect = new URL(params['redirect_uri'] ?? '');
    expect(redirect.hostname).toBe('127.0.0.1');
    expect(redirect.pathname).toBe('/redirect');
    expect(Number(redirect.port)).toBeGreaterThan(0);

    const form = idp.to('/token')[0]?.form ?? {};
    expect(form).toMatchObject({
      grant_type: 'authorization_code',
      code: 'code-1',
      redirect_uri: params['redirect_uri'],
      client_id: CLIENT_ID,
    });
    expect(sha256(form['code_verifier'] ?? '')).toBe(params['code_challenge']);

    const [page] = (await Promise.all(background)) as { status: number; text: string }[];
    expect(page?.status).toBe(200);
    expect(page?.text).toContain('Signed in');
    // The loopback server is closed once the flow is over.
    expect(await refused(params['redirect_uri'] ?? '')).toBe(true);
  });

  it('every flow gets a fresh state and PKCE verifier', async () => {
    const first = options();
    const second = options();
    await authCodeFlow(meta, first.opts);
    await authCodeFlow(meta, second.opts);
    const state = (o: typeof first) =>
      new URL(o.openBrowser.mock.calls[0]?.[0] ?? '').searchParams.get('state');
    expect(state(first)).not.toBe(state(second));
    const [a, b] = idp.to('/token').map((r) => r.form['code_verifier']);
    expect(a).not.toBe(b);
  });

  it('ignores a redirect with another state, another path or method; the right one still counts', async () => {
    const answers: { status: number | 'closed'; text: string }[] = [];
    const { opts, background } = options(async (url) => {
      answers.push(await redirectBack(url, { code: 'forged', state: 'not-the-state' }));
      answers.push(await redirectBack(url, { code: 'forged' }, '/elsewhere'));
      const redirect = new URL(new URL(url).searchParams.get('redirect_uri') ?? '');
      answers.push({ status: (await fetch(redirect, { method: 'POST' })).status, text: '' });
      answers.push(await redirectBack(url, { code: 'code-1' }));
      // After the answer the receiver takes no further redirect. The flow closes the receiver as
      // soon as the token arrived, which may be before or after this request (only the test was
      // wrong: on Windows and macOS the close usually wins, so the request finds no listener).
      answers.push(
        await redirectBack(url, { code: 'late' }).catch(() => ({ status: 'closed' as const, text: '' })),
      );
    });
    await expect(authCodeFlow(meta, opts)).resolves.toMatchObject({ accessToken: 'at-code' });
    await Promise.all(background);
    expect(answers.slice(0, 4).map((a) => a.status)).toEqual([400, 404, 404, 200]);
    expect([404, 'closed']).toContain(answers[4]?.status);
    expect(answers[0]?.text).toContain('does not belong');
    expect(idp.to('/token').map((r) => r.form['code'])).toEqual(['code-1']);
  });

  it('an error redirect ends the flow with an IdpGrantError, no token request', async () => {
    let page: { status: number; text: string } | undefined;
    const { opts } = options(async (url) => {
      page = await redirectBack(url, {
        error: 'access_denied',
        error_description: 'User said no',
      });
    });
    const error = await rejection(authCodeFlow(meta, opts));
    expect(error).toBeInstanceOf(IdpGrantError);
    expect((error as IdpGrantError).error).toBe('access_denied');
    expect(error.message).toContain('User said no');
    expect(idp.to('/token')).toEqual([]);
    await vi.waitFor(() => expect(page?.status).toBe(400));
    expect(page?.text).toContain('access_denied: User said no');
  });

  it('a redirect without code or error is a no_code grant error', async () => {
    const { opts } = options((url) => redirectBack(url, {}));
    const error = await rejection(authCodeFlow(meta, opts));
    expect((error as IdpGrantError).error).toBe('no_code');
  });

  it('escapes the IdP error text in the redirect page (no HTML injection)', async () => {
    let page: { status: number; text: string } | undefined;
    const { opts } = options(async (url) => {
      page = await redirectBack(url, {
        error: 'x',
        error_description: '<script>alert("pwned")</script>',
      });
    });
    await rejection(authCodeFlow(meta, opts));
    await vi.waitFor(() => expect(page).toBeDefined());
    expect(page?.text).not.toContain('<script>');
    expect(page?.text).toContain('&#60;script&#62;');
  });

  it('a refused code exchange is an IdpGrantError', async () => {
    idp.on('/token', () => ({ status: 400, body: { error: 'invalid_grant' } }));
    const { opts } = options();
    expect(((await rejection(authCodeFlow(meta, opts))) as IdpGrantError).error).toBe(
      'invalid_grant',
    );
  });

  it('cancelling while waiting for the browser answers CANCELLED and frees the port', async () => {
    const abort = new AbortController();
    let opened = '';
    const { opts } = options((url) => {
      opened = url;
      return Promise.resolve();
    }, abort.signal);
    const flow = authCodeFlow(meta, opts);
    await vi.waitFor(() => expect(opened).not.toBe(''));
    abort.abort();
    expect((await rejection(flow)).code).toBe('CANCELLED');
    expect(await refused(new URL(opened).searchParams.get('redirect_uri') ?? '')).toBe(true);
    expect(idp.to('/token')).toEqual([]);
  });

  it('an already cancelled sign-in answers CANCELLED without exchanging a code', async () => {
    const abort = new AbortController();
    abort.abort();
    const { opts } = options(() => Promise.resolve(), abort.signal);
    expect((await rejection(authCodeFlow(meta, opts))).code).toBe('CANCELLED');
    expect(idp.to('/token')).toEqual([]);
  });

  it('a browser that cannot be opened is a BrowserUnavailableError; the port is freed', async () => {
    const { opts } = options();
    let redirect = '';
    opts.openBrowser = vi.fn((url: string) => {
      redirect = new URL(url).searchParams.get('redirect_uri') ?? '';
      return Promise.reject(new Error('xdg-open not found'));
    });
    const error = await rejection(authCodeFlow(meta, opts));
    expect(error).toBeInstanceOf(BrowserUnavailableError);
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).toContain('xdg-open not found');
    expect(await refused(redirect)).toBe(true);
  });

  it('a CANCELLED answer from openBrowser stays CANCELLED (no device fallback)', async () => {
    const { opts } = options();
    opts.openBrowser = vi.fn(() => Promise.reject(new RpcError('CANCELLED', 'port replaced')));
    const error = await rejection(authCodeFlow(meta, opts));
    expect(error).not.toBeInstanceOf(BrowserUnavailableError);
    expect(error.code).toBe('CANCELLED');
  });

  it('a busy redirect port is a BrowserUnavailableError before the browser opens', async () => {
    const busy: Server = createServer();
    await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = busy.address() as AddressInfo;
      const { opts, openBrowser } = options();
      opts.redirectUri = `http://127.0.0.1:${String(port)}/redirect`;
      const error = await rejection(authCodeFlow(meta, opts));
      expect(error).toBeInstanceOf(BrowserUnavailableError);
      expect(error.message).toContain('EADDRINUSE');
      expect(openBrowser).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => busy.close(() => resolve()));
    }
  });

  it.each(['https://localhost:0/redirect', 'http://app.example.test/redirect'])(
    'refuses the non-loopback redirect URI %s',
    async (redirectUri) => {
      const { opts, openBrowser } = options();
      opts.redirectUri = redirectUri;
      const error = await rejection(authCodeFlow(meta, opts));
      expect(error.code).toBe('INVALID_PARAMS');
      expect(openBrowser).not.toHaveBeenCalled();
    },
  );

  it('a localhost redirect URI keeps the name localhost and answers on 127.0.0.1', async () => {
    const { opts, openBrowser } = options();
    opts.redirectUri = 'http://localhost:0/redirect';
    await expect(authCodeFlow(meta, opts)).resolves.toMatchObject({ accessToken: 'at-code' });
    const url = new URL(openBrowser.mock.calls[0]?.[0] ?? '');
    expect(new URL(url.searchParams.get('redirect_uri') ?? '').hostname).toBe('localhost');
  });

  it('refuses an issuer without an authorization endpoint before listening', async () => {
    const rest = { ...meta };
    delete rest.authorization_endpoint;
    const { opts, openBrowser } = options();
    const error = await rejection(authCodeFlow(rest, opts));
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).toContain('no authorization endpoint');
    expect(openBrowser).not.toHaveBeenCalled();
  });
});

describe('deviceFlow', () => {
  /** Options with a fake clock whose `sleep` only advances it (or the real sleep). */
  function options(extra: { signal?: AbortSignal; realSleep?: boolean } = {}) {
    const clock = { t: FIXED_NOW };
    const waits: number[] = [];
    const codes: DeviceCode[] = [];
    const opts: DeviceFlowOptions = {
      clientId: CLIENT_ID,
      scope: 'openid',
      onCode: (code: DeviceCode) => void codes.push(code),
      http: {},
      signal: extra.signal ?? new AbortController().signal,
      now: () => clock.t,
    };
    if (!extra.realSleep) {
      opts.sleep = (ms: number) => {
        waits.push(ms);
        clock.t += ms;
        return Promise.resolve();
      };
    }
    return { waits, codes, opts };
  }

  function deviceAnswer(extra: Record<string, unknown> = {}) {
    idp.on('/device', () => ({
      body: {
        device_code: 'dc-1',
        user_code: 'WDJB-MJHT',
        verification_uri: 'https://idp.example.test/device',
        verification_uri_complete: 'https://idp.example.test/device?user_code=WDJB-MJHT',
        expires_in: 300,
        interval: 2,
        ...extra,
      },
    }));
  }

  /** The token endpoint answers `errors` in turn, then tokens. */
  function polls(...errors: string[]) {
    let n = 0;
    idp.on('/token', () => {
      const error = errors[n++];
      return error !== undefined
        ? { status: 400, body: { error } }
        : { body: { access_token: 'at-device', expires_in: 60, refresh_token: 'rt-device' } };
    });
  }

  it('shows the code, polls through authorization_pending and slow_down, then has tokens', async () => {
    deviceAnswer();
    polls('authorization_pending', 'slow_down', 'authorization_pending');
    const { opts, waits, codes } = options();
    await expect(deviceFlow(meta, opts)).resolves.toEqual({
      accessToken: 'at-device',
      // The clock moved 18 s while polling.
      expiresAt: FIXED_NOW + 18_000 + 60_000,
      refreshToken: 'rt-device',
    });
    expect(codes).toEqual([
      {
        userCode: 'WDJB-MJHT',
        verificationUri: 'https://idp.example.test/device',
        verificationUriComplete: 'https://idp.example.test/device?user_code=WDJB-MJHT',
        expiresInSeconds: 300,
      },
    ]);
    // slow_down adds 5 s to the interval for every later poll (RFC 8628 3.5).
    expect(waits).toEqual([2000, 2000, 7000, 7000]);

    const start = idp.to('/device')[0]?.form ?? {};
    expect(start).toMatchObject({
      client_id: CLIENT_ID,
      scope: 'openid',
      code_challenge_method: 'S256',
    });
    const tokenForms = idp.to('/token').map((r) => r.form);
    expect(tokenForms).toHaveLength(4);
    for (const form of tokenForms) {
      expect(form).toMatchObject({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: 'dc-1',
        client_id: CLIENT_ID,
      });
      expect(sha256(form['code_verifier'] ?? '')).toBe(start['code_challenge']);
    }
  });

  it('accepts verification_url and defaults to 600 s / 5 s without expires_in and interval', async () => {
    idp.on('/device', () => ({
      body: { device_code: 'dc', user_code: 'ABCD', verification_url: 'https://g.example.test' },
    }));
    polls('authorization_pending');
    const { opts, waits, codes } = options();
    await deviceFlow(meta, opts);
    expect(codes).toEqual([
      { userCode: 'ABCD', verificationUri: 'https://g.example.test', expiresInSeconds: 600 },
    ]);
    expect(waits).toEqual([5000, 5000]);
  });

  it('gives up once the code expired, without another poll', async () => {
    deviceAnswer({ expires_in: 5, interval: 2 });
    polls(...Array<string>(10).fill('authorization_pending'));
    const { opts, waits } = options();
    const error = await rejection(deviceFlow(meta, opts));
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).toContain('expired');
    // Polls at +2 s and +4 s; at +6 s the 5 s code is over.
    expect(waits).toEqual([2000, 2000, 2000]);
    expect(idp.to('/token')).toHaveLength(2);
  });

  it.each(['access_denied', 'expired_token', 'invalid_grant'])(
    'stops polling on %s',
    async (code) => {
      deviceAnswer();
      polls('authorization_pending', code);
      const { opts } = options();
      const error = await rejection(deviceFlow(meta, opts));
      expect((error as IdpGrantError).error).toBe(code);
      expect(idp.to('/token')).toHaveLength(2);
    },
  );

  it('a non-OAuth token answer (HTTP 500) stops polling', async () => {
    deviceAnswer();
    idp.on('/token', () => ({ status: 500, raw: 'down' }));
    const { opts } = options();
    const error = await rejection(deviceFlow(meta, opts));
    expect(error).not.toBeInstanceOf(IdpGrantError);
    expect(error.message).toContain('HTTP 500');
    expect(idp.to('/token')).toHaveLength(1);
  });

  it('a refused device authorization is an IdpGrantError (OAuth error) or AUTH_FAILED', async () => {
    idp.on('/device', () => ({ status: 401, body: { error: 'unauthorized_client' } }));
    const { opts, codes } = options();
    expect(((await rejection(deviceFlow(meta, opts))) as IdpGrantError).error).toBe(
      'unauthorized_client',
    );
    idp.on('/device', () => ({ status: 200, body: { device_code: 'dc' } }));
    const incomplete = await rejection(deviceFlow(meta, opts));
    expect(incomplete).not.toBeInstanceOf(IdpGrantError);
    expect(incomplete.message).toContain('refused the device sign-in (HTTP 200)');
    expect(codes).toEqual([]);
    expect(idp.to('/token')).toEqual([]);
  });

  it('refuses an issuer without a device endpoint', async () => {
    const rest = { ...meta };
    delete rest.device_authorization_endpoint;
    const error = await rejection(deviceFlow(rest, options().opts));
    expect(error.message).toContain('does not offer the device flow');
    expect(idp.requests).toEqual([]);
  });

  it('cancelling while waiting between polls answers CANCELLED (real sleep)', async () => {
    deviceAnswer({ interval: 30 });
    polls();
    const abort = new AbortController();
    const { opts, codes } = options({ signal: abort.signal, realSleep: true });
    const flow = deviceFlow(meta, opts);
    await vi.waitFor(() => expect(codes).toHaveLength(1));
    abort.abort();
    expect((await rejection(flow)).code).toBe('CANCELLED');
    expect(idp.to('/token')).toEqual([]);
  });

  it('polls with the real sleep after the interval', async () => {
    deviceAnswer({ interval: 0.01 });
    polls('authorization_pending');
    const { opts } = options({ realSleep: true });
    await expect(deviceFlow(meta, { ...opts, now: Date.now })).resolves.toMatchObject({
      accessToken: 'at-device',
    });
    expect(idp.to('/token')).toHaveLength(2);
  });

  it('an already aborted signal answers CANCELLED before asking the IdP', async () => {
    const abort = new AbortController();
    abort.abort();
    deviceAnswer();
    const error = await rejection(deviceFlow(meta, options({ signal: abort.signal }).opts));
    expect(error.code).toBe('CANCELLED');
    expect(idp.requests).toEqual([]);
  });
});
