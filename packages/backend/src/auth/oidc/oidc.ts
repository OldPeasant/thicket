import { randomUUID } from 'node:crypto';

import type { OidcFlow, OidcPrompt } from '@thicket/contract';
import type { OIDCCallbackFunction, OIDCCallbackParams, OIDCResponse } from 'mongodb';

import { RpcError } from '../../server/rpc';
import {
  authCodeFlow,
  BrowserUnavailableError,
  deviceFlow,
  discover,
  IdpGrantError,
  refresh,
  scopesFor,
  type OidcMetadata,
  type TokenSet,
} from './flows';
import type { OidcHttpOptions } from './http';

/**
 * Redirect URI of the authorization code flow: the one MongoDB's tools (mongosh, Compass) use, so
 * an IdP application registered for them works with Thicket too.
 */
export const DEFAULT_REDIRECT_URI = 'http://localhost:27097/redirect';

/** An access token this close to its expiry is not reused (ms). */
const EXPIRY_MARGIN_MS = 60_000;

/** What the OIDC sign-in needs from the rest of the app. */
export interface OidcEnvironment {
  /** Opens a sign-in page in the system browser (main's `shell.openExternal`); rejects if it can't. */
  openBrowser(url: string): Promise<void>;
  /** Persists a profile's token cache (`oidcTokens` secret; `null` clears it). */
  saveTokens(profileId: string, tokens: string | null): Promise<void>;
  /** Tells the windows that a sign-in waits for the user, or is over (`oidc.prompt`). */
  prompt?(prompt: OidcPrompt): void;
  /** Loopback redirect URI (default `DEFAULT_REDIRECT_URI`; port 0 takes a free port). */
  redirectUri?: string;
  /** Extra CA certificates (PEM) to trust for the IdP. */
  ca?: string;
  log?(message: string): void;
  now?(): number;
  /** Device flow poll wait (tests). */
  sleep?(ms: number, signal: AbortSignal): Promise<void>;
}

/** The `oidcTokens` secret: the tokens of one profile and the IdP they belong to. */
export interface CachedTokens {
  v: 1;
  issuer: string;
  clientId: string;
  accessToken: string;
  expiresAt?: number;
  refreshToken?: string;
}

/** One connect's view of a profile. */
export interface OidcTarget {
  /** Saved profile id; without it (an unsaved draft) nothing is cached. */
  profileId?: string;
  profileName: string;
  flow?: OidcFlow;
  /** The stored `oidcTokens` secret, as `secrets.get` returned it. */
  stored?: string;
  /** Ends a sign-in in progress (connect cancelled or closed). */
  signal?: AbortSignal;
}

export function parseCachedTokens(text: string | undefined): CachedTokens | undefined {
  if (text === undefined) return undefined;
  try {
    const value = JSON.parse(text) as Partial<CachedTokens> | null;
    if (
      value?.v === 1 &&
      typeof value.issuer === 'string' &&
      typeof value.clientId === 'string' &&
      typeof value.accessToken === 'string' &&
      (value.expiresAt === undefined || typeof value.expiresAt === 'number') &&
      (value.refreshToken === undefined || typeof value.refreshToken === 'string')
    ) {
      return value as CachedTokens;
    }
  } catch {
    // An unreadable cache is no cache.
  }
  return undefined;
}

/**
 * MONGODB-OIDC sign-in for the driver's human callback (`OIDC_HUMAN_CALLBACK`).
 *
 * For each callback, in this order:
 * 1. The driver passes a refresh token (re-authentication of an open client): refresh with it.
 * 2. The profile's cache (`oidcTokens`, newest in this process first, else the stored one) for the
 *    same issuer and client: refresh with its refresh token; with none, reuse its access token
 *    while it is valid. Refreshing first means a new connect never sends an access token the IdP
 *    has revoked meanwhile, and never opens the browser while the refresh token is alive.
 * 3. Interactive sign-in: authorization code flow in the system browser (loopback redirect), or
 *    the device flow (`oidcFlow: 'deviceCode'`, or `auto` when the browser can't be opened).
 * New tokens are cached in memory and persisted through `saveTokens` (the keychain via main).
 */
export class OidcAuthenticator {
  /** Newest tokens per profile id in this process (also when they could not be persisted). */
  private readonly memory = new Map<string, CachedTokens>();
  private readonly metadata = new Map<string, Promise<OidcMetadata>>();

  constructor(private readonly env: OidcEnvironment) {}

  /** The driver callback for one connect of `target`. */
  callbackFor(target: OidcTarget): OIDCCallbackFunction {
    return (params) => this.signIn(target, params);
  }

  /** Forgets a profile's tokens (memory and keychain). */
  async forget(profileId: string): Promise<void> {
    this.memory.delete(profileId);
    await this.env.saveTokens(profileId, null);
  }

  private now(): number {
    return this.env.now?.() ?? Date.now();
  }

  private log(message: string): void {
    this.env.log?.(message);
  }

  private async signIn(target: OidcTarget, params: OIDCCallbackParams): Promise<OIDCResponse> {
    const idp = params.idpInfo;
    if (!idp) {
      throw new RpcError('AUTH_FAILED', 'The server sent no OIDC identity provider information');
    }
    const signal = target.signal
      ? AbortSignal.any([target.signal, params.timeoutContext])
      : params.timeoutContext;
    const http: OidcHttpOptions = {
      ...(this.env.ca !== undefined ? { ca: this.env.ca } : {}),
      signal,
    };
    const label = `oidc ${target.profileName}`;
    const meta = await this.discover(idp.issuer, http);
    const clientId = idp.clientId;

    const refreshWith = async (refreshToken: string): Promise<OIDCResponse | undefined> => {
      try {
        const tokens = await refresh(meta, clientId, refreshToken, http, () => this.now());
        this.log(`${label}: refreshed the access token`);
        return await this.remember(target, idp.issuer, clientId, {
          ...tokens,
          // Some IdPs don't rotate refresh tokens: keep the one that still works.
          refreshToken: tokens.refreshToken ?? refreshToken,
        });
      } catch (error) {
        if (error instanceof IdpGrantError) {
          this.log(`${label}: refresh refused (${error.error}), signing in again`);
          return undefined;
        }
        throw error;
      }
    };

    if (params.refreshToken !== undefined) {
      const answer = await refreshWith(params.refreshToken);
      if (answer) return answer;
    } else {
      const cached = this.cached(target);
      if (cached && cached.issuer === idp.issuer && cached.clientId === clientId) {
        if (cached.refreshToken !== undefined) {
          const answer = await refreshWith(cached.refreshToken);
          if (answer) return answer;
        } else if (
          cached.expiresAt !== undefined &&
          cached.expiresAt - EXPIRY_MARGIN_MS > this.now()
        ) {
          this.log(`${label}: reusing the cached access token`);
          return toResponse(cached, this.now());
        }
      }
    }

    const tokens = await this.interactive(target, meta, clientId, idp.requestScopes, http, signal);
    return this.remember(target, idp.issuer, clientId, tokens);
  }

  private cached(target: OidcTarget): CachedTokens | undefined {
    if (target.profileId === undefined) return undefined;
    return this.memory.get(target.profileId) ?? parseCachedTokens(target.stored);
  }

  private async remember(
    target: OidcTarget,
    issuer: string,
    clientId: string,
    tokens: TokenSet,
  ): Promise<OIDCResponse> {
    const cached: CachedTokens = {
      v: 1,
      issuer,
      clientId,
      accessToken: tokens.accessToken,
      ...(tokens.expiresAt !== undefined ? { expiresAt: tokens.expiresAt } : {}),
      ...(tokens.refreshToken !== undefined ? { refreshToken: tokens.refreshToken } : {}),
    };
    const profileId = target.profileId;
    if (profileId !== undefined) {
      this.memory.set(profileId, cached);
      try {
        await this.env.saveTokens(profileId, JSON.stringify(cached));
      } catch (error) {
        // Still signed in; only the next app start will ask again.
        this.log(`oidc ${target.profileName}: cannot store the tokens (${String(error)})`);
      }
    }
    return toResponse(cached, this.now());
  }

  /** Discovery documents are cached per issuer for this process (a failed fetch is retried). */
  private discover(issuer: string, http: OidcHttpOptions): Promise<OidcMetadata> {
    let meta = this.metadata.get(issuer);
    if (!meta) {
      meta = discover(issuer, http);
      this.metadata.set(issuer, meta);
      meta.catch(() => this.metadata.delete(issuer));
    }
    return meta;
  }

  private async interactive(
    target: OidcTarget,
    meta: OidcMetadata,
    clientId: string,
    requestScopes: string[] | undefined,
    http: OidcHttpOptions,
    signal: AbortSignal,
  ): Promise<TokenSet> {
    const flow = target.flow ?? 'auto';
    const scope = scopesFor(meta, requestScopes);
    const label = `oidc ${target.profileName}`;
    const promptId = randomUUID();
    const base = {
      promptId,
      profileName: target.profileName,
      ...(target.profileId !== undefined ? { profileId: target.profileId } : {}),
    };
    let prompted = false;
    const prompt = (value: OidcPrompt) => {
      prompted = true;
      this.env.prompt?.(value);
    };
    const common = { clientId, scope, http, signal, now: () => this.now() };
    const device = () => {
      this.log(`${label}: device sign-in`);
      return deviceFlow(meta, {
        ...common,
        ...(this.env.sleep ? { sleep: this.env.sleep } : {}),
        onCode: (code) => prompt({ ...base, kind: 'device', ...code }),
      });
    };
    let ok = false;
    try {
      let tokens: TokenSet;
      if (flow === 'deviceCode') {
        tokens = await device();
      } else {
        try {
          this.log(`${label}: browser sign-in`);
          tokens = await authCodeFlow(meta, {
            ...common,
            redirectUri: this.env.redirectUri ?? DEFAULT_REDIRECT_URI,
            openBrowser: (url) => this.env.openBrowser(url),
            onUrl: (url) => prompt({ ...base, kind: 'browser', url }),
          });
        } catch (error) {
          const canFallBack =
            flow === 'auto' &&
            error instanceof BrowserUnavailableError &&
            meta.device_authorization_endpoint !== undefined;
          if (!canFallBack) throw error;
          this.log(`${label}: ${error.message}; falling back to the device flow`);
          tokens = await device();
        }
      }
      ok = true;
      return tokens;
    } catch (error) {
      if (signal.aborted && !(error instanceof RpcError && error.code === 'CANCELLED')) {
        throw new RpcError('CANCELLED', 'Sign-in cancelled');
      }
      throw error;
    } finally {
      if (prompted) this.env.prompt?.({ ...base, kind: 'finished', ok });
    }
  }
}

function toResponse(tokens: CachedTokens, now: number): OIDCResponse {
  return {
    accessToken: tokens.accessToken,
    ...(tokens.expiresAt !== undefined
      ? { expiresInSeconds: Math.max(0, Math.floor((tokens.expiresAt - now) / 1000)) }
      : {}),
    ...(tokens.refreshToken !== undefined ? { refreshToken: tokens.refreshToken } : {}),
  };
}
