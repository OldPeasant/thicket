import type {
  ConnStatus,
  ErrorSummary,
  Profile,
  ProfileDraft,
  ServerInfo,
} from '@thicket/contract';
import { isDeepStrictEqual } from 'node:util';

import {
  BSON,
  MongoClient,
  type Document,
  type MongoClientOptions,
  type RunCommandOptions,
} from 'mongodb';

import { RpcError } from '../server/rpc';
import { openSshTunnel, type SshEnvironment, type SshTunnel } from '../ssh/tunnel';
import { redact, toConnectError } from './errors';
import { clientConfig, type ConnectSecrets } from './options';

/** The part of `MongoClient` the manager uses (tests pass fakes). */
export interface ClientLike {
  connect(): Promise<unknown>;
  close(force?: boolean): Promise<void>;
  db(name: string): { command(command: Document, options?: RunCommandOptions): Promise<Document> };
}

export interface ConnectionManagerDeps {
  /** A saved profile, from `main` (`profiles.forConnect`); `NOT_FOUND` for unknown ids. */
  loadProfile(profileId: string): Promise<Profile>;
  /** A profile's stored secrets, from `main` (`secrets.get`); `null` when none are stored. */
  loadSecrets(profileId: string): Promise<Record<string, string> | null>;
  /** Defaults to `new MongoClient(uri, options)`. */
  createClient?(uri: string, options: MongoClientOptions): ClientLike;
  /** Log lines; connection strings and passwords are already masked. */
  log?(message: string): void;
  /** Clock for latencies (ms). */
  now?(): number;
  /** SSH tunnels (`known_hosts`, host key questions); without it SSH profiles are `UNSUPPORTED`. */
  ssh?: SshEnvironment;
  /** Defaults to `openSshTunnel` (tests pass fakes). */
  openTunnel?: typeof openSshTunnel;
  /**
   * State changes the manager notices by itself (not answers to `conn.*` calls), for the
   * `conn.status` broadcast: an open connection whose SSH tunnel was lost.
   */
  onStatus?(status: ConnStatus): void;
}

interface Entry {
  state: ConnStatus['state'];
  error?: ErrorSummary;
  client?: ClientLike;
  /** The SSH tunnel the client connects through, closed with the connection. */
  tunnel?: SshTunnel;
  /** Aborted when the connection is closed while connecting (stops an SSH host key question). */
  abort: AbortController;
  /** Settles when the connect in progress is over (connected or failed). */
  opening?: Promise<ConnStatus>;
  /** `open` callers waiting for `opening`; when the last one cancels, the connect is closed. */
  waiters: number;
}

/**
 * Open connections, one per profile. `conn.*` handlers use it, and later backend handlers get the
 * driver client of a connection from `client(profileId)`.
 */
export class ConnectionManager {
  private readonly entries = new Map<string, Entry>();
  private readonly createClient: (uri: string, options: MongoClientOptions) => ClientLike;
  private readonly now: () => number;

  constructor(private readonly deps: ConnectionManagerDeps) {
    this.createClient =
      deps.createClient ?? ((uri, options) => new MongoClient(uri, options) as ClientLike);
    this.now = deps.now ?? (() => performance.now());
  }

  /**
   * Connects with a saved profile or a draft, measures a ping, reads server info, disconnects.
   * A draft with an `id` uses that profile's stored secrets only when its connection string,
   * auth, TLS, SSH and proxy settings equal the saved ones; otherwise only `password` is used.
   */
  async test(
    target: { profileId: string } | { profile: ProfileDraft },
    password: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ latencyMS: number; server: ServerInfo }> {
    let profile: ProfileDraft;
    let storedFrom: string | undefined;
    if ('profileId' in target) {
      profile = await this.deps.loadProfile(target.profileId);
      storedFrom = target.profileId;
    } else {
      profile = target.profile;
      storedFrom = (await this.matchesSaved(profile)) ? profile.id : undefined;
    }
    const secrets = await this.secretsFor(profile, storedFrom, password);
    const label = `test ${profile.name}`;
    const tunnel = await this.openTunnelFor(profile, secrets, label, signal);
    let config: ReturnType<typeof clientConfig>;
    try {
      config = clientConfig(profile, secrets, tunnel?.proxy);
    } catch (error) {
      await tunnel?.close();
      throw error;
    }
    const { uri, options } = config;
    this.log(`${label}: connecting to ${uri}`, secrets);
    let client: ClientLike;
    let connecting: Promise<unknown>;
    try {
      // `new MongoClient` throws for some connection strings (e.g. directConnection with two
      // hosts): the tunnel must not outlive that.
      client = this.createClient(uri, options);
      connecting = client.connect();
    } catch (error) {
      await tunnel?.close();
      throw error;
    }
    let connected = false;
    try {
      await abortable(connecting, signal);
      connected = true;
      const start = this.now();
      await abortable(client.db('admin').command({ ping: 1 }), signal);
      const latencyMS = Math.max(0, this.now() - start);
      const server = await abortable(readServerInfo(client), signal);
      this.log(`${label}: ok (${server.version}, ${server.topology})`, secrets);
      return { latencyMS, server };
    } catch (error) {
      const failure = toConnectError(error, Object.values(secrets).filter(isString), true);
      this.log(`${label}: ${failure.code} ${failure.message}`, secrets);
      throw failure;
    } finally {
      await closeQuietly(client);
      if (!connected) {
        // Abandoned while the driver was still connecting (cancelled): a close before the driver
        // has its topology does nothing, so close again once its connect is over.
        void connecting.then(
          () => closeQuietly(client),
          () => undefined,
        );
      }
      // Closing the tunnel also ends a driver connect still in progress (its sockets fail).
      await tunnel?.close();
    }
  }

  /**
   * Opens the SSH tunnel of a profile with `ssh` (undefined otherwise). Fails with `SSH_ERROR`,
   * `CANCELLED` (signal), or `UNSUPPORTED` when this manager has no SSH environment.
   */
  private async openTunnelFor(
    profile: ProfileDraft,
    secrets: ConnectSecrets,
    label: string,
    signal: AbortSignal | undefined,
    onClosed?: () => void,
  ): Promise<SshTunnel | undefined> {
    if (!profile.ssh) return undefined;
    const env = this.deps.ssh;
    if (!env) throw new RpcError('UNSUPPORTED', 'SSH tunnels are not available here');
    if (profile.proxy) {
      throw new RpcError(
        'INVALID_PARAMS',
        'A profile connects through either an SSH tunnel or a SOCKS5 proxy, not both',
      );
    }
    const ssh = profile.ssh;
    this.log(`${label}: opening SSH tunnel via ${ssh.username}@${ssh.host}:${String(ssh.port)}`);
    const open = this.deps.openTunnel ?? openSshTunnel;
    try {
      return await open(
        ssh,
        secrets,
        { ...env, log: (message) => this.log(`${label}: ${message}`, secrets) },
        {
          ...(signal ? { signal } : {}),
          ...(profile.connectTimeoutMS !== undefined
            ? { readyTimeoutMS: profile.connectTimeoutMS }
            : {}),
          ...(onClosed ? { onClosed } : {}),
        },
      );
    } catch (error) {
      const failure = toConnectError(error, Object.values(secrets).filter(isString), true);
      this.log(`${label}: ${failure.code} ${failure.message}`, secrets);
      throw failure;
    }
  }

  /**
   * Opens the connection of a saved profile; answers at once when it is already open. Callers
   * opening a profile that is already connecting share that connect, and a later caller's
   * `password` is ignored. Each caller's `signal` cancels only its own wait; the connect itself is
   * closed (and ends `CANCELLED`) when every waiting caller has cancelled.
   */
  async open(
    profileId: string,
    password: string | undefined,
    signal?: AbortSignal,
  ): Promise<ConnStatus> {
    if (signal?.aborted) throw cancelled();
    const current = this.entries.get(profileId);
    if (current?.state === 'connected') return this.statusOf(profileId);
    if (current?.opening) return this.waitFor(profileId, current, current.opening, signal);

    const entry: Entry = { state: 'connecting', waiters: 0, abort: new AbortController() };
    this.entries.set(profileId, entry);
    const opening = this.connect(profileId, entry, password).finally(() => {
      delete entry.opening;
    });
    entry.opening = opening;
    return this.waitFor(profileId, entry, opening, signal);
  }

  /** One caller's wait for a shared connect; its abort leaves the connect to the other callers. */
  private async waitFor(
    profileId: string,
    entry: Entry,
    opening: Promise<ConnStatus>,
    signal: AbortSignal | undefined,
  ): Promise<ConnStatus> {
    entry.waiters += 1;
    if (!signal) return opening;
    const leave = () => {
      entry.waiters -= 1;
      if (
        entry.waiters <= 0 &&
        entry.state === 'connecting' &&
        this.entries.get(profileId) === entry
      ) {
        void this.close(profileId);
      }
    };
    signal.addEventListener('abort', leave, { once: true });
    try {
      return await abortable(opening, signal);
    } finally {
      signal.removeEventListener('abort', leave);
    }
  }

  private async connect(
    profileId: string,
    entry: Entry,
    password: string | undefined,
  ): Promise<ConnStatus> {
    let secrets: ConnectSecrets = {};
    try {
      const profile = await this.deps.loadProfile(profileId);
      secrets = await this.secretsFor(profile, profileId, password);
      if (this.entries.get(profileId) !== entry) throw closedWhileConnecting();
      const tunnel = await this.openTunnelFor(
        profile,
        secrets,
        `open ${profileId}`,
        entry.abort.signal,
        () => void this.tunnelLost(profileId, entry),
      );
      if (tunnel) entry.tunnel = tunnel;
      if (this.entries.get(profileId) !== entry) throw closedWhileConnecting();
      const { uri, options } = clientConfig(profile, secrets, tunnel?.proxy);
      this.log(`open ${profileId}: connecting to ${uri}`, secrets);
      const client = this.createClient(uri, options);
      entry.client = client;
      // No caller's signal here: the connect is shared, `waitFor` handles cancellation. A close
      // meanwhile may come before the driver has its topology (and do nothing), so the client is
      // closed again below once the driver's connect is over.
      await client.connect();
      if (this.entries.get(profileId) !== entry) {
        // Closed (or replaced) while connecting.
        await closeQuietly(client);
        throw closedWhileConnecting();
      }
      entry.state = 'connected';
      this.log(`open ${profileId}: connected`, secrets);
      return this.statusOf(profileId);
    } catch (error) {
      // Closed (or replaced) meanwhile: the driver's error (e.g. "Topology is closed") is a
      // consequence of that close, so the answer is CANCELLED whatever it says.
      const failure =
        this.entries.get(profileId) !== entry
          ? closedWhileConnecting()
          : toConnectError(error, Object.values(secrets).filter(isString), true);
      if (entry.client) await closeQuietly(entry.client);
      delete entry.client;
      await entry.tunnel?.close();
      delete entry.tunnel;
      if (this.entries.get(profileId) === entry) {
        if (failure.code === 'CANCELLED') {
          this.entries.delete(profileId);
        } else {
          entry.state = 'error';
          entry.error = { code: failure.code, message: failure.message };
        }
      }
      this.log(`open ${profileId}: ${failure.code} ${failure.message}`, secrets);
      throw failure;
    }
  }

  /**
   * The SSH tunnel of an open connection closed by itself (session lost): the connection is
   * `error` from now on, its client is closed and the new state is broadcast. The next `open`
   * builds a new tunnel. While still connecting, the failing driver connect handles it.
   */
  private async tunnelLost(profileId: string, entry: Entry): Promise<void> {
    if (this.entries.get(profileId) !== entry || entry.state !== 'connected') return;
    entry.state = 'error';
    entry.error = {
      code: 'SSH_ERROR',
      message: 'The SSH tunnel was closed (connection to the SSH server lost); open it again',
    };
    const client = entry.client;
    delete entry.client;
    delete entry.tunnel;
    this.log(`open ${profileId}: SSH_ERROR ${entry.error.message}`);
    this.deps.onStatus?.(this.statusOf(profileId));
    if (client) await closeQuietly(client);
  }

  /** Closes the connection of a profile; nothing happens when it isn't open. */
  async close(profileId: string): Promise<void> {
    const entry = this.entries.get(profileId);
    if (!entry) return;
    this.entries.delete(profileId);
    entry.abort.abort();
    if (entry.client) await closeQuietly(entry.client);
    await entry.tunnel?.close();
    this.log(`close ${profileId}`);
  }

  /** Closes every connection (backend shutdown). */
  async closeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.close(id)));
  }

  /** State of one connection (`disconnected` when it isn't known). */
  statusOf(profileId: string): ConnStatus {
    const entry = this.entries.get(profileId);
    if (!entry) return { profileId, state: 'disconnected' };
    return entry.error && entry.state === 'error'
      ? { profileId, state: entry.state, error: entry.error }
      : { profileId, state: entry.state };
  }

  /** State of every known connection (open, opening or failed). */
  statuses(): ConnStatus[] {
    return [...this.entries.keys()].map((id) => this.statusOf(id));
  }

  /** The driver client of an open connection; `NOT_CONNECTED` otherwise. */
  client(profileId: string): ClientLike {
    const entry = this.entries.get(profileId);
    if (entry?.state !== 'connected' || !entry.client) {
      throw new RpcError('NOT_CONNECTED', `The profile ${profileId} has no open connection`);
    }
    return entry.client;
  }

  /** Server version, topology and build info of an open connection. */
  async serverInfo(profileId: string): Promise<ServerInfo> {
    const client = this.client(profileId);
    try {
      return await readServerInfo(client);
    } catch (error) {
      throw toConnectError(error);
    }
  }

  /**
   * Secrets for a connect: the stored ones of the profile `storedFrom` (none when undefined),
   * with `password` from the request winning. With `secretMode: 'ask'` a stored password is
   * ignored.
   */
  private async secretsFor(
    profile: ProfileDraft,
    storedFrom: string | undefined,
    password: string | undefined,
  ): Promise<ConnectSecrets> {
    const stored = storedFrom !== undefined ? await this.loadStored(storedFrom) : null;
    const secrets: ConnectSecrets = { ...(stored ?? {}) };
    if (profile.auth?.secretMode === 'ask') delete secrets['password'];
    if (password !== undefined) secrets['password'] = password;
    return secrets;
  }

  /**
   * Whether a draft with an `id` still targets what its saved profile targets (same connection
   * string, auth, TLS, SSH and proxy settings), so that profile's stored secrets may be used for it. A
   * draft that changed any of these (another host, TLS off, ...) must not receive them.
   */
  private async matchesSaved(draft: ProfileDraft): Promise<boolean> {
    if (draft.id === undefined) return false;
    let saved: Profile;
    try {
      saved = await this.deps.loadProfile(draft.id);
    } catch (error) {
      if (error instanceof RpcError && error.code === 'NOT_FOUND') return false;
      throw error;
    }
    return (
      saved.connectionString === draft.connectionString &&
      isDeepStrictEqual(saved.auth, draft.auth) &&
      isDeepStrictEqual(saved.tls, draft.tls) &&
      isDeepStrictEqual(saved.ssh, draft.ssh) &&
      isDeepStrictEqual(saved.proxy, draft.proxy)
    );
  }

  private async loadStored(profileId: string): Promise<Record<string, string> | null> {
    try {
      return await this.deps.loadSecrets(profileId);
    } catch (error) {
      if (error instanceof RpcError && error.code === 'NOT_FOUND') return null;
      throw error;
    }
  }

  private log(message: string, secrets: ConnectSecrets = {}): void {
    this.deps.log?.(redact(message, Object.values(secrets).filter(isString)));
  }
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

async function closeQuietly(client: ClientLike): Promise<void> {
  try {
    await client.close(true);
  } catch {
    // Closing a client that never connected (or lost its sockets) may fail; nothing to do.
  }
}

function cancelled(): RpcError {
  return new RpcError('CANCELLED', 'The operation was cancelled');
}

function closedWhileConnecting(): RpcError {
  return new RpcError('CANCELLED', 'The connection was closed while connecting');
}

/** True while `client` is still the open connection of the profile (not closed or replaced). */
export function isOpenClient(
  manager: ConnectionManager,
  profileId: string,
  client: unknown,
): boolean {
  try {
    return manager.client(profileId) === client;
  } catch {
    return false;
  }
}

/** Rejects with `CANCELLED` as soon as `signal` aborts (the operation itself runs on). */
export function abortable<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) {
    operation.catch(() => undefined);
    return Promise.reject(cancelled());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(cancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** `hello` + `buildInfo` → `ServerInfo`. */
export async function readServerInfo(client: ClientLike): Promise<ServerInfo> {
  const admin = client.db('admin');
  const [hello, buildInfo] = await Promise.all([
    admin.command({ hello: 1 }),
    admin.command({ buildInfo: 1 }),
  ]);
  return {
    version: typeof buildInfo['version'] === 'string' ? buildInfo['version'] : 'unknown',
    topology: topologyOf(hello),
    enterprise: isEnterprise(buildInfo),
    raw: BSON.EJSON.stringify({ hello, buildInfo }, { relaxed: false }),
  };
}

/** Topology as seen from the `hello` answer of the server the client talks to. */
export function topologyOf(hello: Document): ServerInfo['topology'] {
  if (hello['msg'] === 'isdbgrid') return 'sharded';
  if (hello['serviceId'] !== undefined) return 'loadBalanced';
  if (typeof hello['setName'] === 'string') return 'replicaSet';
  if (hello['isWritablePrimary'] !== undefined || hello['ismaster'] !== undefined)
    return 'standalone';
  return 'unknown';
}

function isEnterprise(buildInfo: Document): boolean {
  const modules: unknown = buildInfo['modules'];
  return Array.isArray(modules) && modules.includes('enterprise');
}
