import { RpcError, type Handler } from '@thicket/backend';
import type { PrivilegedParamsOf } from '@thicket/contract';

import type { SecretsStore } from '../secrets';

export interface OidcMainDeps {
  /** Electron's `shell.openExternal`. */
  openExternal(url: string): Promise<void>;
  secrets: Pick<SecretsStore, 'status' | 'set' | 'delete'>;
  /** Whether a profile still exists (tokens of a deleted profile are not stored). */
  hasProfile?(profileId: string): Promise<boolean>;
  log?(message: string): void;
}

/**
 * Privileged handlers for the backend's MONGODB-OIDC sign-in:
 * - `oidc.openBrowser`: opens the IdP's sign-in page in the system browser. Only `http:`/`https:`
 *   URLs (the contract checks it, and again here: `openExternal` would run any scheme's handler).
 * - `oidc.saveTokens`: keeps a profile's token cache as its `oidcTokens` secret in `secrets.bin`,
 *   only with secure storage (OS keychain); otherwise `saved: false` and the backend keeps the
 *   tokens in memory for this session.
 */
export function oidcHandlers(deps: OidcMainDeps): Record<string, Handler> {
  return {
    'oidc.openBrowser': async (params: PrivilegedParamsOf<'oidc.openBrowser'>) => {
      let url: URL;
      try {
        url = new URL(params.url);
      } catch {
        throw new RpcError('INVALID_PARAMS', 'Not a URL');
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new RpcError('INVALID_PARAMS', `Refusing to open a ${url.protocol} URL`);
      }
      try {
        await deps.openExternal(url.toString());
      } catch (error) {
        throw new RpcError('UNSUPPORTED', `No browser could be opened: ${String(error)}`);
      }
      return {};
    },
    'oidc.saveTokens': async (params: PrivilegedParamsOf<'oidc.saveTokens'>) => {
      const { profileId, tokens } = params;
      try {
        if (tokens === null) {
          await deps.secrets.delete(profileId, 'oidcTokens');
          return { saved: true };
        }
        if ((await deps.secrets.status()).level !== 'secure') return { saved: false };
        if (deps.hasProfile && !(await deps.hasProfile(profileId))) return { saved: false };
        await deps.secrets.set(profileId, 'oidcTokens', tokens);
        return { saved: true };
      } catch (error) {
        deps.log?.(`oidc.saveTokens ${profileId}: ${String(error)}`);
        return { saved: false };
      }
    },
  };
}
