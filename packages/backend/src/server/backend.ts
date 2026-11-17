import { join } from 'node:path';

import { BROADCAST_STREAMS, methods, type Event, type Profile } from '@thicket/contract';

import { aggHandlers } from '../agg';
import { browseHandlers } from '../browse';
import { ConnectionManager, connHandlers } from '../connections';
import { docsQueryHandlers } from '../docs/query';
import { docsWriteHandlers } from '../docs/write';
import { guardWrites } from '../guard';
import { dialogsOverLink, ioHandlers } from '../io';
import { HostKeyPrompts, KnownHosts, sshHandlers } from '../ssh';
import { wiringHandlers, type PrivilegedLink } from './handlers';
import { fromMainPort, type MainPortLike } from './ports';
import { isBackendControlMessage } from './protocol';
import { RpcClient, RpcError, serve, type Handler } from './rpc';

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
  /**
   * Electron's `userData` folder (`THICKET_USER_DATA`, set by main when it starts the backend);
   * holds `known_hosts`. Without it SSH tunnels answer `UNSUPPORTED`.
   */
  userData?: string;
}

/**
 * The backend process: answers the contract on every renderer port `main` hands over and keeps
 * one privileged link back to `main`. Returns the handler table (for tests).
 */
export function startBackend(options: BackendOptions): Record<string, Handler> {
  const log = options.log ?? (() => undefined);
  let privileged: RpcClient | undefined;
  const link = (): PrivilegedLink => {
    if (!privileged) throw new RpcError('INTERNAL', 'The backend has no link to main yet');
    return privileged;
  };
  // Senders of the connected renderer ports, for the backend's broadcasts (`ssh.hostKey`,
  // `conn.status` of a connection whose SSH tunnel was lost).
  const renderers = new Set<(event: Event) => void>();
  const prompts = new HostKeyPrompts((prompt) => {
    for (const send of renderers) {
      send({ stream: BROADCAST_STREAMS.sshHostKey, kind: 'data', payload: prompt });
    }
    return renderers.size;
  });
  const loadProfile = async (profileId: string): Promise<Profile> =>
    ((await link().call('profiles.forConnect', { profileId })) as { profile: Profile }).profile;
  const connections = new ConnectionManager({
    loadProfile,
    loadSecrets: async (profileId) =>
      (
        (await link().call('secrets.get', { profileId })) as {
          secrets: Record<string, string> | null;
        }
      ).secrets,
    log: (message) => log(`connections: ${message}`),
    onStatus: (status) => {
      for (const send of renderers) {
        send({ stream: BROADCAST_STREAMS.connStatus, kind: 'data', payload: status });
      }
    },
    ...(options.userData !== undefined
      ? {
          ssh: {
            knownHosts: new KnownHosts(join(options.userData, 'known_hosts')),
            confirmHostKey: (question, signal) => prompts.ask(question, signal),
          },
        }
      : {}),
  });
  // Every write handler goes through the guard; it checks the profile as main has it now.
  const handlers = guardWrites(
    {
      ...wiringHandlers({ pid: options.pid, privileged: () => privileged }),
      ...connHandlers(connections),
      ...sshHandlers(prompts),
      ...browseHandlers(connections),
      ...docsQueryHandlers(connections),
      ...docsWriteHandlers(connections),
      ...aggHandlers(connections),
      // File dialogs can stay open as long as the user likes: no timeout.
      ...ioHandlers(
        connections,
        dialogsOverLink((method, params) => link().call(method, params)),
      ),
    },
    loadProfile,
  );

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
    const send = (message: Event) => port.send(message);
    const port = fromMainPort(raw, () => {
      stop();
      renderers.delete(send);
      log(`renderer ${window} disconnected`);
    });
    renderers.add(send);
    stop = serve(port, {
      table: methods,
      route: 'backend',
      handlers,
      onError: (error) => log(`renderer ${window}: ${String(error)}`),
    });
  });
  return handlers;
}
