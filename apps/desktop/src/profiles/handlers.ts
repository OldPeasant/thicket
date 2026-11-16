import { RpcError, type Handler } from '@thicket/backend';
import type { ParsedParamsOf, ResultOf } from '@thicket/contract';

import { ProfileNotFoundError, ProfilesReadOnlyError, type ProfilesStore } from './store';

async function mapErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProfileNotFoundError) throw new RpcError('NOT_FOUND', error.message);
    if (error instanceof ProfilesReadOnlyError) throw new RpcError('UNSUPPORTED', error.message);
    throw error;
  }
}

/**
 * `profiles.list/get/save/delete/duplicate` (served by `main`). `secrets` are the secrets
 * handlers (`secretsHandlers`): `profiles.setSecret` is only passed on for an existing profile, so
 * no secret is stored under an id that `connections.json` doesn't know.
 */
export function profilesHandlers(
  store: ProfilesStore,
  secrets: Record<string, Handler> = {},
): Record<string, Handler> {
  const handlers: Record<string, Handler> = {
    'profiles.list': async (): Promise<ResultOf<'profiles.list'>> => ({
      profiles: await store.list(),
    }),
    'profiles.get': (params: ParsedParamsOf<'profiles.get'>): Promise<ResultOf<'profiles.get'>> =>
      mapErrors(() => store.get(params.profileId)),
    'profiles.save': (
      params: ParsedParamsOf<'profiles.save'>,
    ): Promise<ResultOf<'profiles.save'>> =>
      mapErrors(async () => ({ profile: await store.save(params.profile) })),
    'profiles.delete': (
      params: ParsedParamsOf<'profiles.delete'>,
    ): Promise<ResultOf<'profiles.delete'>> =>
      mapErrors(async () => {
        await store.delete(params.profileId);
        return {};
      }),
    'profiles.duplicate': (
      params: ParsedParamsOf<'profiles.duplicate'>,
    ): Promise<ResultOf<'profiles.duplicate'>> =>
      mapErrors(async () => ({ profile: await store.duplicate(params.profileId) })),
  };
  const setSecret = secrets['profiles.setSecret'];
  if (setSecret) {
    handlers['profiles.setSecret'] = async (
      params: ParsedParamsOf<'profiles.setSecret'>,
      context: Parameters<Handler>[1],
    ): Promise<unknown> => {
      if (!(await store.has(params.profileId)))
        throw new RpcError('NOT_FOUND', `No profile with id ${params.profileId}`);
      return setSecret(params as never, context);
    };
  }
  return handlers;
}
