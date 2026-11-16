import type { Handler } from '@thicket/backend';
import type { ResultOf } from '@thicket/contract';

/** Handlers of the main-routed contract methods implemented so far. */
export function mainHandlers(deps: { version: string }): Record<string, Handler> {
  const ping = (): ResultOf<'app.ping'> => ({ process: 'main', version: deps.version });
  return { 'app.ping': ping };
}

/**
 * Handlers of the privileged main ↔ backend port. `secrets.get` is a stub until the secrets
 * store exists: no profile has stored secrets yet.
 */
export function privilegedHandlers(): Record<string, Handler> {
  return {
    'main.ping': () => ({ process: 'main' }),
    'secrets.get': () => ({ secrets: null }),
  };
}
