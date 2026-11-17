import type { Handler } from '@thicket/backend';
import type { ParsedParamsOf, ResultOf, Settings } from '@thicket/contract';

import { dialogHandlers, type NativeDialogs } from '../dialogs';
import {
  importExportHandlers,
  profileForConnectHandler,
  profilesHandlers,
  type ProfilesStore,
} from '../profiles';
import { secretsGetHandler, secretsHandlers, type SecretsStore } from '../secrets';

/** What the settings handlers need from the `SettingsStore`. */
export interface SettingsAccess {
  get(): Settings;
  set(changes: Partial<Settings>): Promise<Settings>;
}

export interface MainHandlerDeps {
  version: string;
  secrets: SecretsStore;
  /** Serves `app.settings.get/set` when given. */
  settings?: SettingsAccess;
  /** Serves `profiles.list/get/save/delete/duplicate` when given. */
  profiles?: ProfilesStore;
  /** With `profiles`: serves `profiles.importCompass/importUris/export` (native file dialogs). */
  dialogs?: NativeDialogs;
}

/** Handlers of the main-routed contract methods implemented so far. */
export function mainHandlers(deps: MainHandlerDeps): Record<string, Handler> {
  const secrets = secretsHandlers(deps.secrets);
  const handlers: Record<string, Handler> = {
    'app.ping': (): ResultOf<'app.ping'> => ({ process: 'main', version: deps.version }),
    ...secrets,
    ...(deps.profiles ? profilesHandlers(deps.profiles, secrets) : {}),
    ...(deps.profiles && deps.dialogs
      ? importExportHandlers({
          profiles: deps.profiles,
          secrets: deps.secrets,
          dialogs: deps.dialogs,
        })
      : {}),
  };
  const store = deps.settings;
  if (store) {
    handlers['app.settings.get'] = (): ResultOf<'app.settings.get'> => ({
      settings: store.get(),
    });
    handlers['app.settings.set'] = async (
      params: ParsedParamsOf<'app.settings.set'>,
    ): Promise<ResultOf<'app.settings.set'>> => ({ settings: await store.set(params.settings) });
  }
  return handlers;
}

/** Handlers of the privileged main ↔ backend port (never served to a renderer). */
export function privilegedHandlers(deps: {
  secrets: SecretsStore;
  /** Serves `profiles.forConnect` when given. */
  profiles?: ProfilesStore;
  /** Serves `dialog.saveFile` / `dialog.openFile` when given. */
  dialogs?: NativeDialogs;
}): Record<string, Handler> {
  const handlers: Record<string, Handler> = {
    'main.ping': () => ({ process: 'main' }),
    'secrets.get': secretsGetHandler(deps.secrets),
  };
  const profiles = deps.profiles;
  if (profiles) handlers['profiles.forConnect'] = profileForConnectHandler(profiles);
  return deps.dialogs ? { ...handlers, ...dialogHandlers(deps.dialogs) } : handlers;
}
