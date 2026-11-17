import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { RpcError } from '../../server/rpc';
import { idpRequest, isAllowedIdpUrl, isLoopbackHost, type OidcHttpOptions } from './http';

/** The parts of the IdP's discovery document (`/.well-known/openid-configuration`) we use. */
export interface OidcMetadata {
  issuer: string;
  authorization_endpoint?: string;
  token_endpoint: string;
  device_authorization_endpoint?: string;
  scopes_supported?: string[];
}

/** Tokens from the IdP. `expiresAt` is ms since the epoch (from `expires_in`). */
export interface TokenSet {
  accessToken: string;
  expiresAt?: number;
  refreshToken?: string;
}

/** The IdP refused a grant (`error` in a token answer), e.g. `invalid_grant` for a dead refresh token. */
export class IdpGrantError extends RpcError {
  constructor(
    readonly error: string,
    description: string | undefined,
  ) {
    super(
      'AUTH_FAILED',
      `The identity provider refused the sign-in: ${error}${description ? ` (${description})` : ''}`,
    );
  }
}

/** Fetches and checks the issuer's discovery document. */
export async function discover(issuer: string, http: OidcHttpOptions): Promise<OidcMetadata> {
  let issuerUrl: URL;
  try {
    issuerUrl = new URL(issuer);
  } catch {
    throw new RpcError('AUTH_FAILED', `The server announced an invalid OIDC issuer: ${issuer}`);
  }
  if (!isAllowedIdpUrl(issuerUrl)) {
    throw new RpcError('AUTH_FAILED', `The OIDC issuer ${issuer} is not an https URL`);
  }
  const url = `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  const answer = await idpRequest(url, undefined, http);
  const meta = answer.body as Partial<OidcMetadata> | undefined;
  if (answer.status !== 200 || !meta || typeof meta !== 'object') {
    throw new RpcError(
      'AUTH_FAILED',
      `The OIDC issuer ${issuer} has no discovery document (HTTP ${String(answer.status)})`,
    );
  }
  // RFC 8414 3.3: the document must name the issuer it was fetched for.
  if (meta.issuer !== issuer) {
    throw new RpcError(
      'AUTH_FAILED',
      `The OIDC discovery document of ${issuer} names another issuer (${String(meta.issuer)})`,
    );
  }
  const endpoints = [
    meta.token_endpoint,
    meta.authorization_endpoint,
    meta.device_authorization_endpoint,
  ];
  for (const endpoint of endpoints) {
    if (endpoint === undefined) continue;
    if (typeof endpoint !== 'string' || !isAllowedIdpUrl(safeUrl(endpoint))) {
      throw new RpcError('AUTH_FAILED', `The OIDC issuer ${issuer} has a non-https endpoint`);
    }
  }
  if (typeof meta.token_endpoint !== 'string') {
    throw new RpcError('AUTH_FAILED', `The OIDC issuer ${issuer} has no token endpoint`);
  }
  return meta as OidcMetadata;
}

function safeUrl(text: string): URL {
  try {
    return new URL(text);
  } catch {
    return new URL('invalid:');
  }
}

/** `openid`, the server's `requestScopes` and `offline_access` (for a refresh token) when offered. */
export function scopesFor(meta: OidcMetadata, requestScopes: readonly string[] = []): string {
  const scopes = new Set(['openid', ...requestScopes]);
  if (!meta.scopes_supported || meta.scopes_supported.includes('offline_access')) {
    scopes.add('offline_access');
  }
  return [...scopes].join(' ');
}

/** POSTs a grant to the token endpoint. */
export async function tokenRequest(
  meta: OidcMetadata,
  form: Record<string, string>,
  http: OidcHttpOptions,
  now: () => number = Date.now,
): Promise<TokenSet> {
  const answer = await idpRequest(meta.token_endpoint, form, http);
  const body = (answer.body ?? {}) as Record<string, unknown>;
  if (answer.status !== 200 || typeof body['access_token'] !== 'string') {
    if (typeof body['error'] === 'string') {
      throw new IdpGrantError(
        body['error'],
        typeof body['error_description'] === 'string' ? body['error_description'] : undefined,
      );
    }
    throw new RpcError(
      'AUTH_FAILED',
      `The identity provider answered the token request with HTTP ${String(answer.status)}`,
    );
  }
  const expiresIn = body['expires_in'];
  return {
    accessToken: body['access_token'],
    ...(typeof expiresIn === 'number' && expiresIn > 0
      ? { expiresAt: now() + expiresIn * 1000 }
      : {}),
    ...(typeof body['refresh_token'] === 'string' ? { refreshToken: body['refresh_token'] } : {}),
  };
}

/** A new access token for a refresh token. */
export function refresh(
  meta: OidcMetadata,
  clientId: string,
  refreshToken: string,
  http: OidcHttpOptions,
  now?: () => number,
): Promise<TokenSet> {
  return tokenRequest(
    meta,
    { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId },
    http,
    now,
  );
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

/** RFC 7636 PKCE pair (S256). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export interface AuthCodeOptions {
  clientId: string;
  scope: string;
  /** Loopback redirect URI; port 0 takes a free port. */
  redirectUri: string;
  /** Opens the URL in the system browser; rejects when no browser can be opened. */
  openBrowser(url: string): Promise<void>;
  /** Called with the authorization URL before the browser opens (to show it in the app). */
  onUrl?(url: string): void;
  http: OidcHttpOptions;
  signal: AbortSignal;
  now?: () => number;
}

/** The browser could not be opened: the caller may fall back to the device flow. */
export class BrowserUnavailableError extends RpcError {
  constructor(reason: string) {
    super('AUTH_FAILED', `Cannot open the system browser for the OIDC sign-in: ${reason}`);
  }
}

/**
 * Authorization code flow with PKCE (RFC 7636) and a loopback redirect (RFC 8252): a local HTTP
 * server takes the redirect, the code is exchanged at the token endpoint.
 */
export async function authCodeFlow(
  meta: OidcMetadata,
  options: AuthCodeOptions,
): Promise<TokenSet> {
  if (meta.authorization_endpoint === undefined) {
    throw new RpcError(
      'AUTH_FAILED',
      `The OIDC issuer ${meta.issuer} has no authorization endpoint`,
    );
  }
  const { verifier, challenge } = pkcePair();
  const state = base64url(randomBytes(24));
  const receiver = await LoopbackReceiver.start(options.redirectUri, state);
  try {
    const url = new URL(meta.authorization_endpoint);
    url.searchParams.set('client_id', options.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', receiver.redirectUri);
    url.searchParams.set('scope', options.scope);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    const authUrl = url.toString();
    const code = receiver.code(options.signal);
    // A rejected code wait must not be unhandled while the browser opens.
    code.catch(() => undefined);
    options.onUrl?.(authUrl);
    try {
      await options.openBrowser(authUrl);
    } catch (error) {
      if (error instanceof RpcError && error.code === 'CANCELLED') throw error;
      throw new BrowserUnavailableError(error instanceof Error ? error.message : String(error));
    }
    return await tokenRequest(
      meta,
      {
        grant_type: 'authorization_code',
        code: await code,
        redirect_uri: receiver.redirectUri,
        client_id: options.clientId,
        code_verifier: verifier,
      },
      { ...options.http, signal: options.signal },
      options.now,
    );
  } finally {
    receiver.close();
  }
}

const PAGE_STYLE =
  'font-family:system-ui,sans-serif;background:#0b0f14;color:#d8e6f0;display:flex;' +
  'align-items:center;justify-content:center;height:100vh;margin:0';

function page(title: string, text: string): string {
  const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title></head>` +
    `<body style="${PAGE_STYLE}"><main><h1>${escape(title)}</h1><p>${escape(text)}</p></main>` +
    '</body></html>'
  );
}

/** The local server that receives the authorization code (one redirect, then it closes). */
class LoopbackReceiver {
  private settle?: { resolve(code: string): void; reject(error: Error): void };
  private result?: { code: string } | { error: Error };

  private constructor(
    private readonly servers: Server[],
    readonly redirectUri: string,
    private readonly path: string,
    private readonly state: string,
  ) {
    for (const server of servers) server.on('request', (req, res) => this.handle(req, res));
  }

  static async start(redirectUri: string, state: string): Promise<LoopbackReceiver> {
    const url = new URL(redirectUri);
    if (url.protocol !== 'http:' || !isLoopbackHost(url.hostname)) {
      throw new RpcError(
        'INVALID_PARAMS',
        `The OIDC redirect URI ${redirectUri} is not a loopback URL`,
      );
    }
    // `localhost` may resolve to either address family in the browser: listen on both.
    const hosts =
      url.hostname === 'localhost' ? ['127.0.0.1', '::1'] : [url.hostname.replace(/^\[|\]$/g, '')];
    let port = Number(url.port || '80');
    const servers: Server[] = [];
    try {
      for (const [index, host] of hosts.entries()) {
        const server = createServer();
        try {
          port = await listen(server, host, port);
          servers.push(server);
        } catch (error) {
          // The IPv6 loopback is optional (systems without IPv6).
          if (index === 0) throw error;
        }
      }
    } catch (error) {
      for (const server of servers) server.close();
      const code = (error as NodeJS.ErrnoException).code ?? String(error);
      throw new BrowserUnavailableError(
        `cannot listen on ${url.hostname}:${url.port || '80'} for the sign-in redirect (${code})`,
      );
    }
    url.port = String(port);
    return new LoopbackReceiver(servers, url.toString(), url.pathname, state);
  }

  /** The authorization code, once the browser comes back with it. */
  code(signal: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (this.result) {
        if ('code' in this.result) resolve(this.result.code);
        else reject(this.result.error);
        return;
      }
      const onAbort = () => reject(new RpcError('CANCELLED', 'Sign-in cancelled'));
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      this.settle = {
        resolve: (code) => {
          signal.removeEventListener('abort', onAbort);
          resolve(code);
        },
        reject: (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      };
    });
  }

  close(): void {
    for (const server of this.servers) {
      server.close();
      server.closeAllConnections();
    }
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://loopback');
    if (req.method !== 'GET' || url.pathname !== this.path || this.result) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    const params = url.searchParams;
    // Another page's redirect (or a forged one) does not end the wait.
    if (params.get('state') !== this.state) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('Sign-in failed', 'This sign-in answer does not belong to Thicket’s request.'));
      return;
    }
    const error = params.get('error');
    const code = params.get('code');
    if (error !== null || code === null) {
      const description = params.get('error_description') ?? undefined;
      this.finish({ error: new IdpGrantError(error ?? 'no_code', description) });
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        page('Sign-in failed', `${error ?? 'no code'}${description ? `: ${description}` : ''}`),
      );
      return;
    }
    this.finish({ code });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page('Signed in', 'Thicket is connecting. You can close this tab.'));
  }

  private finish(result: { code: string } | { error: Error }): void {
    this.result = result;
    if ('code' in result) this.settle?.resolve(result.code);
    else this.settle?.reject(result.error);
  }
}

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    });
  });
}

/** What the user needs for the device flow (RFC 8628). */
export interface DeviceCode {
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresInSeconds: number;
}

export interface DeviceFlowOptions {
  clientId: string;
  scope: string;
  onCode(code: DeviceCode): void;
  http: OidcHttpOptions;
  signal: AbortSignal;
  now?: () => number;
  /** Waits between polls (tests make it fast). */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new RpcError('CANCELLED', 'Sign-in cancelled'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new RpcError('CANCELLED', 'Sign-in cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Device authorization grant (RFC 8628): show a code, poll until the user approved it. */
export async function deviceFlow(
  meta: OidcMetadata,
  options: DeviceFlowOptions,
): Promise<TokenSet> {
  const endpoint = meta.device_authorization_endpoint;
  if (endpoint === undefined) {
    throw new RpcError(
      'AUTH_FAILED',
      `The OIDC issuer ${meta.issuer} does not offer the device flow`,
    );
  }
  const http = { ...options.http, signal: options.signal };
  const answer = await idpRequest(
    endpoint,
    { client_id: options.clientId, scope: options.scope },
    http,
  );
  const body = (answer.body ?? {}) as Record<string, unknown>;
  const deviceCode = body['device_code'];
  const userCode = body['user_code'];
  const verificationUri = body['verification_uri'] ?? body['verification_url'];
  if (
    answer.status !== 200 ||
    typeof deviceCode !== 'string' ||
    typeof userCode !== 'string' ||
    typeof verificationUri !== 'string'
  ) {
    if (typeof body['error'] === 'string') {
      throw new IdpGrantError(
        body['error'],
        typeof body['error_description'] === 'string' ? body['error_description'] : undefined,
      );
    }
    throw new RpcError(
      'AUTH_FAILED',
      `The identity provider refused the device sign-in (HTTP ${String(answer.status)})`,
    );
  }
  const now = options.now ?? Date.now;
  const expiresIn = typeof body['expires_in'] === 'number' ? body['expires_in'] : 600;
  const deadline = now() + expiresIn * 1000;
  let interval = (typeof body['interval'] === 'number' ? body['interval'] : 5) * 1000;
  const complete = body['verification_uri_complete'];
  options.onCode({
    userCode,
    verificationUri,
    ...(typeof complete === 'string' ? { verificationUriComplete: complete } : {}),
    expiresInSeconds: expiresIn,
  });
  const sleep = options.sleep ?? abortableSleep;
  for (;;) {
    await sleep(interval, options.signal);
    if (now() > deadline) {
      throw new RpcError('AUTH_FAILED', 'The device sign-in code expired before it was approved');
    }
    try {
      return await tokenRequest(
        meta,
        {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCode,
          client_id: options.clientId,
        },
        http,
        now,
      );
    } catch (error) {
      if (!(error instanceof IdpGrantError)) throw error;
      if (error.error === 'authorization_pending') continue;
      if (error.error === 'slow_down') {
        interval += 5000;
        continue;
      }
      throw error;
    }
  }
}
