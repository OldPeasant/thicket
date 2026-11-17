import type { ParsedParamsOf, ResultOf } from '@thicket/contract';

import type { Handler } from '../server/rpc';
import type { HostKeyPrompts } from './prompts';

/** Handler of `conn.trustHostKey`: the user's answer to an `ssh.hostKey` prompt. */
export function sshHandlers(prompts: HostKeyPrompts): Record<string, Handler> {
  return {
    'conn.trustHostKey': (
      params: ParsedParamsOf<'conn.trustHostKey'>,
    ): ResultOf<'conn.trustHostKey'> => {
      prompts.answer(params.promptId, params.trust);
      return {};
    },
  };
}
