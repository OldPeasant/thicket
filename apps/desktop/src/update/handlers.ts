import type { Handler } from '@thicket/backend';
import type { ResultOf } from '@thicket/contract';

import { isReleaseUrl, type UpdateChecker } from './checker';

/** `app.checkForUpdate`, served by main. */
export function updateHandlers(checker: Pick<UpdateChecker, 'check'>): Record<string, Handler> {
  return {
    'app.checkForUpdate': (): Promise<ResultOf<'app.checkForUpdate'>> => checker.check(),
  };
}

/**
 * `setWindowOpenHandler` that lets the update notice's link through to the user's browser: a
 * release page of Thicket is opened externally. Inside Thicket every window open is still denied.
 */
export function openReleaseLink(
  url: string,
  openExternal: (url: string) => Promise<void>,
  log: (message: string) => void = () => undefined,
): { action: 'deny' } {
  if (isReleaseUrl(url)) {
    openExternal(url).catch((error: unknown) => log(`could not open ${url}: ${String(error)}`));
  }
  return { action: 'deny' };
}
