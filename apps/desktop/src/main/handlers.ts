import type { Handler } from '@thicket/backend';
import type { ResultOf } from '@thicket/contract';

import { secretsGetHandler, secretsHandlers, type SecretsStore } from '../secrets';

/** Handlers of the main-routed contract methods implemented so far. */
export function mainHandlers(deps: {
  version: string;
  secrets: SecretsStore;
}): Record<string, Handler> {
  const ping = (): ResultOf<'app.ping'> => ({ process: 'main', version: deps.version });
  return { 'app.ping': ping, ...secretsHandlers(deps.secrets) };
}

/** Handlers of the privileged main ↔ backend port (never served to a renderer). */
export function privilegedHandlers(deps: { secrets: SecretsStore }): Record<string, Handler> {
  return {
    'main.ping': () => ({ process: 'main' }),
    'secrets.get': secretsGetHandler(deps.secrets),
  };
}
