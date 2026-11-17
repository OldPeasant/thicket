import { readFile } from 'node:fs/promises';

import type { Profile } from '@thicket/contract';
import { Client, type BaseAgent, type ConnectConfig } from 'ssh2';

import { RpcError } from '../server/rpc';
import { describeHostKey, type HostKeyInfo, type KnownHosts } from './known-hosts';
import { startLocalSocks, type LocalSocks } from './socks';

export type SshSettings = NonNullable<Profile['ssh']>;

/** What the user is asked when a server's host key is not in `known_hosts` yet. */
export interface HostKeyQuestion extends HostKeyInfo {
  host: string;
  port: number;
}

/**
 * Asks the user whether to trust an unknown host key (the backend broadcasts `ssh.hostKey` and waits
 * for `conn.trustHostKey`). Resolves `false` for "no", a timeout or nobody to ask.
 */
export type ConfirmHostKey = (question: HostKeyQuestion, signal: AbortSignal) => Promise<boolean>;

/** What the tunnel needs besides the profile's settings. */
export interface SshEnvironment {
  knownHosts: KnownHosts;
  confirmHostKey: ConfirmHostKey;
  /**
   * The SSH agent for `method: 'agent'`: a socket path, `pageant`, or an agent object (tests).
   * Defaults to `SSH_AUTH_SOCK` (`pageant` on Windows).
   */
  agent?: string | BaseAgent;
  log?: (message: string) => void;
}

/** Driver proxy options of an open tunnel (`proxyHost`, `proxyPort`, ...). */
export interface TunnelProxy {
  proxyHost: string;
  proxyPort: number;
  proxyUsername: string;
  proxyPassword: string;
}

export interface SshTunnel {
  readonly proxy: TunnelProxy;
  /** Channels forwarded right now (one per driver socket to a member). */
  openChannels(): number;
  /** Closes the forwarded channels, the local SOCKS port and the SSH connection. Idempotent. */
  close(): Promise<void>;
}

/** Secrets of a connect, by `SecretKind`. */
export type SshSecrets = Partial<Record<string, string>>;

/** Default time for the SSH handshake and authentication. */
export const SSH_READY_TIMEOUT_MS = 20_000;

/**
 * Connects to the SSH server of a profile, checks its host key against `known_hosts` (asking the
 * user for unknown keys, refusing changed ones), authenticates (password, private key with
 * optional passphrase, or agent) and starts a local SOCKS5 port that forwards each driver socket
 * through the SSH connection. The driver resolves `mongodb+srv://` names itself before it opens
 * sockets, so SRV works; replica set members are reached by the names the set reports, resolved by
 * the SSH server. Fails with `SSH_ERROR` (or `CANCELLED` when `signal` aborts).
 */
export async function openSshTunnel(
  ssh: SshSettings,
  secrets: SshSecrets,
  env: SshEnvironment,
  options: { signal?: AbortSignal; readyTimeoutMS?: number } = {},
): Promise<SshTunnel> {
  const { signal } = options;
  const where = `${ssh.username}@${ssh.host}:${String(ssh.port)}`;
  const log = env.log ?? (() => undefined);
  if (signal?.aborted) throw cancelled();
  const auth = await authConfig(ssh, secrets, env);

  const client = new Client();
  /** Why the host key was refused, for a clearer error than ssh2's "verification failed". */
  let hostKeyRefusal: RpcError | undefined;
  const asking = new AbortController();
  const onAbort = () => {
    asking.abort();
    client.end();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  const readyTimeoutMS = options.readyTimeoutMS ?? SSH_READY_TIMEOUT_MS;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pauseTimeout = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const startTimeout = () => {
    pauseTimeout();
    timer = setTimeout(() => {
      timedOut = true;
      client.end();
    }, readyTimeoutMS);
  };

  const verify = async (key: Buffer): Promise<boolean> => {
    const info = describeHostKey(key);
    const status = await env.knownHosts.check(ssh.host, ssh.port, key);
    if (status === 'trusted') return true;
    if (status === 'changed') {
      hostKeyRefusal = new RpcError(
        'SSH_ERROR',
        `The SSH host key of ${ssh.host}:${String(ssh.port)} has changed (now ${info.keyType} ` +
          `${info.fingerprint}) and does not match the key Thicket trusted before. Someone may be ` +
          `intercepting the connection. If the server's key really changed, remove its line from ` +
          `${env.knownHosts.file} and connect again.`,
        { reason: 'hostKeyChanged', host: ssh.host, port: ssh.port, ...info },
      );
      return false;
    }
    // The handshake timeout doesn't run while the user decides; the question has its own.
    pauseTimeout();
    let trusted: boolean;
    try {
      trusted = await env.confirmHostKey(
        { host: ssh.host, port: ssh.port, ...info },
        asking.signal,
      );
    } finally {
      startTimeout();
    }
    if (!trusted) {
      hostKeyRefusal = new RpcError(
        'SSH_ERROR',
        `The SSH host key of ${ssh.host}:${String(ssh.port)} (${info.keyType} ${info.fingerprint}) ` +
          'was not trusted',
        { reason: 'hostKeyRejected', host: ssh.host, port: ssh.port, ...info },
      );
      return false;
    }
    await env.knownHosts.trust(ssh.host, ssh.port, key);
    log(`ssh ${where}: trusted host key ${info.keyType} ${info.fingerprint}`);
    return true;
  };

  const config: ConnectConfig = {
    host: ssh.host,
    port: ssh.port,
    username: ssh.username,
    ...auth,
    // Own timeout below (paused while the user is asked about the host key).
    readyTimeout: 0,
    keepaliveInterval: 15_000,
    keepaliveCountMax: 3,
    hostVerifier: (key: Buffer, callback: (valid: boolean) => void) => {
      verify(key).then(callback, (error: unknown) => {
        hostKeyRefusal = new RpcError(
          'SSH_ERROR',
          `Cannot check the SSH host key of ${ssh.host}:${String(ssh.port)}: ${errorText(error)}`,
        );
        callback(false);
      });
    },
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error & { level?: string }) => {
        reject(hostKeyRefusal ?? toSshError(error, ssh));
      };
      client.once('ready', () => {
        client.off('error', onError);
        resolve();
      });
      client.once('error', onError);
      client.once('close', () => {
        reject(
          signal?.aborted
            ? cancelled()
            : (hostKeyRefusal ??
                (timedOut
                  ? new RpcError('SSH_ERROR', `The SSH server ${where} did not answer in time`, {
                      reason: 'timeout',
                    })
                  : new RpcError('SSH_ERROR', `The SSH server ${where} closed the connection`))),
        );
      });
      try {
        startTimeout();
        client.connect(config);
      } catch (error) {
        reject(toSshError(error as Error, ssh));
      }
    });
  } catch (error) {
    client.end();
    throw signal?.aborted ? cancelled() : error;
  } finally {
    pauseTimeout();
    signal?.removeEventListener('abort', onAbort);
  }

  // From here on: errors of the SSH connection (keepalive timeout, server gone) close the tunnel;
  // the driver sees its sockets fail and reports the connection as lost.
  const channels = new Set<{ destroy(): void }>();
  let socks: LocalSocks | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      for (const channel of channels) channel.destroy();
      channels.clear();
      await socks?.close();
      await new Promise<void>((resolve) => {
        client.once('close', () => resolve());
        client.end();
        // `close` may never come for a connection that is already gone.
        setTimeout(resolve, 1000).unref();
      });
      log(`ssh ${where}: closed`);
    })();
    return closing;
  };
  client.on('error', (error: Error) => {
    log(`ssh ${where}: ${error.message}`);
    void close();
  });
  client.on('close', () => void close());

  try {
    socks = await startLocalSocks(
      (host, port) =>
        new Promise((resolve, reject) => {
          if (closing) {
            reject(new Error('the tunnel is closed'));
            return;
          }
          client.forwardOut('127.0.0.1', 0, host, port, (error, channel) => {
            if (error) {
              log(`ssh ${where}: cannot forward to ${host}:${String(port)}: ${error.message}`);
              reject(error);
              return;
            }
            channels.add(channel);
            channel.once('close', () => channels.delete(channel));
            resolve(channel);
          });
        }),
      (message) => log(`ssh ${where}: ${message}`),
    );
  } catch (error) {
    await close();
    throw new RpcError('SSH_ERROR', `Cannot open the local tunnel port: ${errorText(error)}`);
  }
  log(`ssh ${where}: connected, local port ${String(socks.port)}`);
  return {
    proxy: {
      proxyHost: socks.host,
      proxyPort: socks.port,
      proxyUsername: socks.username,
      proxyPassword: socks.password,
    },
    openChannels: () => channels.size,
    close,
  };
}

/** Authentication part of the ssh2 config for the profile's method. */
async function authConfig(
  ssh: SshSettings,
  secrets: SshSecrets,
  env: SshEnvironment,
): Promise<Partial<ConnectConfig>> {
  const where = `${ssh.username}@${ssh.host}`;
  switch (ssh.method) {
    case 'password': {
      const password = secrets['sshPassword'];
      if (password === undefined) {
        throw new RpcError('SSH_ERROR', `No SSH password for ${where}: save it in the profile`, {
          reason: 'authentication',
        });
      }
      return { password, tryKeyboard: false };
    }
    case 'privateKey': {
      if (ssh.privateKeyFile === undefined) {
        throw new RpcError('SSH_ERROR', `No SSH private key file chosen for ${where}`, {
          reason: 'authentication',
        });
      }
      let privateKey: Buffer;
      try {
        privateKey = await readFile(ssh.privateKeyFile);
      } catch (error) {
        const reason = (error as NodeJS.ErrnoException).code ?? String(error);
        throw new RpcError(
          'SSH_ERROR',
          `Cannot read the SSH private key file ${ssh.privateKeyFile} (${reason})`,
          { reason: 'authentication' },
        );
      }
      const passphrase = secrets['sshKeyPassphrase'];
      return passphrase === undefined ? { privateKey } : { privateKey, passphrase };
    }
    case 'agent': {
      const agent =
        env.agent ??
        (process.platform === 'win32' ? 'pageant' : (process.env['SSH_AUTH_SOCK'] ?? undefined));
      if (agent === undefined || agent === '') {
        throw new RpcError(
          'SSH_ERROR',
          'No SSH agent is running (SSH_AUTH_SOCK is not set): start one or choose another method',
          { reason: 'authentication' },
        );
      }
      return { agent };
    }
  }
}

/** ssh2's errors as `SSH_ERROR` with a readable message (no secrets: ssh2 never puts them there). */
export function toSshError(error: Error & { level?: string; code?: string }, ssh: SshSettings) {
  const where = `${ssh.host}:${String(ssh.port)}`;
  const text = error.message;
  if (/passphrase|bad decrypt|Cannot parse privateKey|Unsupported key format/i.test(text)) {
    const encrypted = /no passphrase given/i.test(text);
    return new RpcError(
      'SSH_ERROR',
      encrypted
        ? `The SSH private key is encrypted: save its passphrase in the profile`
        : `Cannot use the SSH private key (wrong passphrase or unsupported format): ${text}`,
      { reason: 'authentication' },
    );
  }
  if (error.level === 'client-authentication') {
    return new RpcError(
      'SSH_ERROR',
      `SSH authentication failed for ${ssh.username}@${where} (method ${ssh.method})`,
      { reason: 'authentication' },
    );
  }
  if (error.level === 'client-timeout') {
    return new RpcError('SSH_ERROR', `The SSH server ${where} did not answer in time`, {
      reason: 'timeout',
    });
  }
  if (error.level === 'agent') {
    return new RpcError('SSH_ERROR', `The SSH agent failed: ${text}`, { reason: 'authentication' });
  }
  if (error.code !== undefined && /^(E[A-Z]+|ENOTFOUND)$/.test(error.code)) {
    return new RpcError('SSH_ERROR', `Cannot reach the SSH server ${where} (${error.code})`, {
      reason: 'network',
    });
  }
  return new RpcError('SSH_ERROR', `SSH connection to ${where} failed: ${text}`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cancelled(): RpcError {
  return new RpcError('CANCELLED', 'The operation was cancelled');
}
