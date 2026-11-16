import type { ParsedParamsOf, ResultOf } from '@thicket/contract';

import { RpcError, type Handler, type HandlerContext } from './rpc';

/** How the backend reaches `main` over the privileged port (`undefined` until main sent it). */
export interface PrivilegedLink {
  call(method: string, params: unknown, options?: { timeoutMs?: number }): Promise<unknown>;
}

export interface BackendHandlerDeps {
  pid: number;
  privileged: () => PrivilegedLink | undefined;
}

/** Resolves after `ms`, or rejects with `CANCELLED` when the signal aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancelled = () => new RpcError('CANCELLED', 'The operation was cancelled');
    if (signal.aborted) {
      reject(cancelled());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Handlers of the `backend.*` wiring diagnostics. */
export function wiringHandlers(deps: BackendHandlerDeps): Record<string, Handler> {
  const ping = async (): Promise<ResultOf<'backend.ping'>> => {
    const link = deps.privileged();
    let mainReachable = false;
    if (link) {
      try {
        const answer = (await link.call('main.ping', {}, { timeoutMs: 2000 })) as {
          process?: unknown;
        };
        mainReachable = answer.process === 'main';
      } catch {
        mainReachable = false;
      }
    }
    return { process: 'backend', pid: deps.pid, mainReachable };
  };
  const sleepFor = async (
    params: ParsedParamsOf<'backend.sleep'>,
    context: HandlerContext,
  ): Promise<ResultOf<'backend.sleep'>> => {
    await sleep(params.ms, context.signal);
    return { sleptMs: params.ms };
  };
  return { 'backend.ping': ping, 'backend.sleep': sleepFor };
}
