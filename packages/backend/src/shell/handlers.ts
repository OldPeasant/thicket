import type { ParsedParamsOf, ResultOf } from '@thicket/contract';

import type { ConnectionManager } from '../connections/manager';
import { RpcError, type Handler, type HandlerContext } from '../server/rpc';
import type { ShellHost } from './host';

/**
 * Handlers of `shell.open/eval/complete/close`. `shell.open` needs the profile's open connection
 * (`NOT_CONNECTED` otherwise) and starts a session with its own client on the same driver
 * configuration. `shell.eval` streams the outputs; cancelling the stream interrupts the
 * evaluation. Not write-guarded: the server's permissions are the shell's only guard (SPEC M4).
 */
export function shellHandlers(
  manager: ConnectionManager,
  host: ShellHost,
): Record<string, Handler> {
  return {
    'shell.open': async (
      p: ParsedParamsOf<'shell.open'>,
      c: HandlerContext,
    ): Promise<ResultOf<'shell.open'>> =>
      host.open(p.profileId, manager.configOf(p.profileId), p.db, c.signal),
    'shell.eval': (p: ParsedParamsOf<'shell.eval'>, c: HandlerContext): ResultOf<'shell.eval'> => {
      if (!c.openStream) throw new RpcError('INTERNAL', 'shell.eval needs a streaming server');
      // Unknown sessions fail the request itself, before a stream exists.
      if (!host.has(p.sessionId)) {
        throw new RpcError('NOT_FOUND', `No shell session ${p.sessionId}`);
      }
      const streamId = c.openStream((sink) =>
        host.eval(p.sessionId, p.code, (output) => sink.send(output), sink.signal),
      );
      return { streamId };
    },
    'shell.complete': async (
      p: ParsedParamsOf<'shell.complete'>,
      c: HandlerContext,
    ): Promise<ResultOf<'shell.complete'>> => ({
      completions: await host.complete(p.sessionId, p.code.slice(0, p.cursor), c.signal),
    }),
    'shell.close': async (p: ParsedParamsOf<'shell.close'>): Promise<ResultOf<'shell.close'>> => {
      await host.close(p.sessionId);
      return {};
    },
  };
}
