import type { Handler } from '@thicket/backend';
import type { ResultOf } from '@thicket/contract';

import type { UpdateChecker } from './checker';

/** `app.checkForUpdate`, served by main. */
export function updateHandlers(checker: Pick<UpdateChecker, 'check'>): Record<string, Handler> {
  return {
    'app.checkForUpdate': (): Promise<ResultOf<'app.checkForUpdate'>> => checker.check(),
  };
}
