import type {
  ConnStatus,
  ErrorSummary,
  Profile,
  ProfileDraft,
  ServerInfo,
} from '@thicket/contract';
import { BSON, MongoClient, type Document, type MongoClientOptions } from 'mongodb';

import { RpcError } from '../server/rpc';
import { redact, toConnectError } from './errors';
import { clientConfig, type ConnectSecrets } from './options';

/** The part of `MongoClient` the manager uses (tests pass fakes). */
export interface ClientLike {
  connect(): Promise<unknown>;
  close(force?: boolean): Promise<void>;
  db(name: string): { command(command: Document): Promise<Document> };
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
}

interface Entry {
  state: ConnStatus['state'];
  error?: ErrorSummary;
  client?: ClientLike;
  /** Settles when the connect in progress is over (connected or failed). */
  opening?: Promise<ConnStatus>;
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

  /** Connects with a saved profile or a draft, measures a ping, reads server info, disconnects. */
  async test(
    target: { profileId: string } | { profile: ProfileDraft },
    password: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ latencyMS: number; server: ServerInfo }> {
    const profile =
      'profileId' in target ? await this.deps.loadProfile(target.profileId) : target.profile;
    const secrets = await this.secretsFor(profile, password);
    const { uri, options } = clientConfig(profile, secrets);
    const label = `test ${profile.name}`;
    this.log(`${label}: connecting to ${uri}`, secrets);
    const client = this.createClient(uri, options);
    try {
      await abortable(client.connect(), signal);
      const start = this.now();
      await abortable(client.db('admin').command({ ping: 1 }), signal);
      const latencyMS = Math.max(0, this.now() - start);
      const server = await abortable(readServerInfo(client), signal);
      this.log(`${label}: ok (${server.version}, ${server.topology})`, secrets);
      return { latencyMS, server };
    } catch (error) {
      const failure = toConnectError(error, Object.values(secrets).filter(isString));
      this.log(`${label}: ${failure.code} ${failure.message}`, secrets);
      throw failure;
    } finally {
      await closeQuietly(client);
    }
  }

  /** Opens the connection of a saved profile; answers at once when it is already open. */
  async open(
    profileId: string,
    password: string | undefined,
    signal?: AbortSignal,
  ): Promise<ConnStatus> {
    const current = this.entries.get(profileId);
    if (current?.state === 'connected') return this.statusOf(profileId);
    if (current?.opening) return current.opening;

    const entry: Entry = { state: 'connecting' };
    this.entries.set(profileId, entry);
    entry.opening = this.connect(profileId, entry, password, signal).finally(() => {
      delete entry.opening;
    });
    return entry.opening;
  }

  private async connect(
    profileId: string,
    entry: Entry,
    password: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<ConnStatus> {
    let secrets: ConnectSecrets = {};
    try {
      const profile = await this.deps.loadProfile(profileId);
      secrets = await this.secretsFor(profile, password);
      const { uri, options } = clientConfig(profile, secrets);
      this.log(`open ${profileId}: connecting to ${uri}`, secrets);
      const client = this.createClient(uri, options);
      entry.client = client;
      await abortable(client.connect(), signal);
      if (this.entries.get(profileId) !== entry) {
        // Closed (or replaced) while connecting.
        await closeQuietly(client);
        throw new RpcError('CANCELLED', 'The connection was closed while connecting');
      }
      entry.state = 'connected';
      this.log(`open ${profileId}: connected`, secrets);
      return this.statusOf(profileId);
    } catch (error) {
      const failure = toConnectError(error, Object.values(secrets).filter(isString));
      if (entry.client) await closeQuietly(entry.client);
      delete entry.client;
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

  /** Closes the connection of a profile; nothing happens when it isn't open. */
  async close(profileId: string): Promise<void> {
    const entry = this.entries.get(profileId);
    if (!entry) return;
    this.entries.delete(profileId);
    if (entry.client) await closeQuietly(entry.client);
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
   * Secrets for a connect: the stored ones (profiles with an id), with `password` from the
   * request winning. With `secretMode: 'ask'` a stored password is ignored.
   */
  private async secretsFor(
    profile: ProfileDraft,
    password: string | undefined,
  ): Promise<ConnectSecrets> {
    const stored = profile.id !== undefined ? await this.loadStored(profile.id) : null;
    const secrets: ConnectSecrets = { ...(stored ?? {}) };
    if (profile.auth?.secretMode === 'ask') delete secrets['password'];
    if (password !== undefined) secrets['password'] = password;
    return secrets;
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

/** Rejects with `CANCELLED` as soon as `signal` aborts (the operation itself runs on). */
function abortable<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return operation;
  const cancelled = () => new RpcError('CANCELLED', 'The operation was cancelled');
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
