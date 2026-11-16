import { RpcError, type Handler } from '@thicket/backend';
import type { ParamsOf, ResultOf } from '@thicket/contract';

import { SecretStorageUnavailableError, type SecretsStore } from './store';

/**
 * Renderer-facing secrets methods (served by `main`). Secrets go in, never out: no result
 * carries a secret value. `profiles.get`'s `storedSecrets` uses `SecretsStore.kinds()`.
 */
export function secretsHandlers(store: SecretsStore): Record<string, Handler> {
  const status = (): Promise<ResultOf<'profiles.secretStorage'>> => store.status();

  const setSecret = async (
    params: ParamsOf<'profiles.setSecret'>,
  ): Promise<ResultOf<'profiles.setSecret'>> => {
    try {
      await store.set(params.profileId, params.kind, params.value);
    } catch (error) {
      if (error instanceof SecretStorageUnavailableError)
        throw new RpcError('UNSUPPORTED', error.message);
      throw error;
    }
    return { secureStorage: (await store.status()).level === 'secure' };
  };

  const clearSecret = async (
    params: ParamsOf<'profiles.clearSecret'>,
  ): Promise<ResultOf<'profiles.clearSecret'>> => {
    await store.delete(params.profileId, params.kind);
    return {};
  };

  return {
    'profiles.secretStorage': status,
    'profiles.setSecret': setSecret,
    'profiles.clearSecret': clearSecret,
  };
}

/** `secrets.get` for the privileged main ↔ backend port only. */
export function secretsGetHandler(store: SecretsStore): Handler {
  return async (params: { profileId: string }) => ({ secrets: await store.get(params.profileId) });
}
