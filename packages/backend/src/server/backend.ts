import { methods } from '@thicket/contract';

import { wiringHandlers } from './handlers';
import { fromMainPort, type MainPortLike } from './ports';
import { isBackendControlMessage } from './protocol';
import { RpcClient, serve, type Handler } from './rpc';

/** Electron's `process.parentPort` in a utilityProcess (only what the backend uses). */
export interface ParentPortLike {
  on(
    event: 'message',
    listener: (event: { data: unknown; ports: MainPortLike[] }) => void,
  ): unknown;
}

export interface BackendOptions {
  parentPort: ParentPortLike;
  pid: number;
  log?: (message: string) => void;
}

/**
 * The backend process: answers the contract on every renderer port `main` hands over and keeps
 * one privileged link back to `main`. Returns the handler table (for tests).
 */
export function startBackend(options: BackendOptions): Record<string, Handler> {
  const log = options.log ?? (() => undefined);
  let privileged: RpcClient | undefined;
  const handlers = wiringHandlers({ pid: options.pid, privileged: () => privileged });

  options.parentPort.on('message', (event) => {
    const [raw] = event.ports;
    if (!isBackendControlMessage(event.data) || !raw) {
      log(`ignored control message ${JSON.stringify(event.data)}`);
      return;
    }
    if (event.data.type === 'privileged') {
      privileged?.close('Replaced by a new privileged port');
      privileged = new RpcClient(fromMainPort(raw), 'b');
      return;
    }
    const window = event.data.window;
    let stop: () => void = () => undefined;
    const port = fromMainPort(raw, () => {
      stop();
      log(`renderer ${window} disconnected`);
    });
    stop = serve(port, {
      table: methods,
      route: 'backend',
      handlers,
      onError: (error) => log(`renderer ${window}: ${String(error)}`),
    });
  });
  return handlers;
}
