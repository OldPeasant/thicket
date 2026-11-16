import type { Handler } from '@thicket/backend';
import type { ParsedParamsOf, ResultOf, Settings } from '@thicket/contract';

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
}

/** Handlers of the main-routed contract methods implemented so far. */
export function mainHandlers(deps: MainHandlerDeps): Record<string, Handler> {
  const handlers: Record<string, Handler> = {
    'app.ping': (): ResultOf<'app.ping'> => ({ process: 'main', version: deps.version }),
    ...secretsHandlers(deps.secrets),
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
export function privilegedHandlers(deps: { secrets: SecretsStore }): Record<string, Handler> {
  return {
    'main.ping': () => ({ process: 'main' }),
    'secrets.get': secretsGetHandler(deps.secrets),
  };
}
