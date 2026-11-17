import type { ConnStatus, Profile, ProfileDraft } from '@thicket/contract';
import type { Document, MongoClientOptions, OIDCCallbackFunction } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';

import type { OidcAuthenticator, OidcTarget } from '../auth/oidc';
import { RpcError } from '../server/rpc';
import { KnownHosts, type SshTunnel } from '../ssh';
import {
  CLOSE_CANCEL_GRACE_MS,
  ConnectionManager,
  isOpenClient,
  readServerInfo,
  topologyOf,
  type ClientLike,
  type ConnectionManagerDeps,
} from './manager';

/** Fictitious secrets; none of them is a real credential. */
const STORED_PASSWORD = 'fictitious-stored-Pw1';
const TYPED_PASSWORD = 'fictitious-typed-Pw2';
const PASSPHRASE = 'fictitious-passphrase-3';

const HELLO = { isWritablePrimary: true, setName: 'rs0', ok: 1 };
const BUILD_INFO = { version: '8.0.4', modules: [], ok: 1 };

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A fake driver client; `connect` answers what `connectWith` returns (immediate success by default). */
function fakeClient(connectWith: () => Promise<unknown> = () => Promise.resolve()) {
  const commands: Document[] = [];
  let answer = (command: Document): Promise<Document> => {
    if ('hello' in command) return Promise.resolve(HELLO);
    if ('buildInfo' in command) return Promise.resolve(BUILD_INFO);
    return Promise.resolve({ ok: 1 });
  };
  const client = {
    commands,
    connect: vi.fn(connectWith),
    close: vi.fn(() => Promise.resolve()),
    db: vi.fn(() => ({
      command: (command: Document) => {
        commands.push(command);
        return answer(command);
      },
    })),
    answerWith(fn: (command: Document) => Promise<Document>) {
      answer = fn;
    },
  };
  return client;
}

type FakeClient = ReturnType<typeof fakeClient>;

function savedProfile(id: string, extra: Partial<Profile> = {}): Profile {
  return {
    id,
    name: `Profile ${id}`,
    connectionString: 'mongodb://db.example.test:27017',
    auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'saved' },
    readOnly: false,
    production: false,
    ...extra,
  };
}

interface SetupOptions {
  profiles?: Record<string, Profile>;
  secrets?: Record<string, Record<string, string> | null>;
  loadSecrets?: (profileId: string) => Promise<Record<string, string> | null>;
  clients?: FakeClient[];
  /** Enables SSH tunnels with this opener. */
  openTunnel?: NonNullable<ConnectionManagerDeps['openTunnel']>;
  /** MONGODB-OIDC sign-in (tests pass a fake authenticator). */
  oidc?: ConnectionManagerDeps['oidc'];
}

function setup(options: SetupOptions = {}) {
  const profiles = options.profiles ?? { p1: savedProfile('p1'), p2: savedProfile('p2') };
  const secrets = options.secrets ?? {
    p1: { password: STORED_PASSWORD },
    p2: { password: STORED_PASSWORD },
  };
  const queue = [...(options.clients ?? [])];
  const created: { uri: string; options: MongoClientOptions; client: FakeClient }[] = [];
  const logs: string[] = [];
  const loadProfile = vi.fn((profileId: string) => {
    const profile = profiles[profileId];
    return profile
      ? Promise.resolve(profile)
      : Promise.reject(new RpcError('NOT_FOUND', `No profile ${profileId}`));
  });
  const loadSecrets = vi.fn(
    options.loadSecrets ?? ((profileId: string) => Promise.resolve(secrets[profileId] ?? null)),
  );
  let clock = 1000;
  const manager = new ConnectionManager({
    loadProfile,
    loadSecrets,
    createClient: (uri, clientOptions) => {
      const client = queue.shift() ?? fakeClient();
      created.push({ uri, options: clientOptions, client });
      return client;
    },
    log: (message) => logs.push(message),
    now: () => (clock += 7),
    ...(options.oidc ? { oidc: options.oidc } : {}),
    ...(options.openTunnel
      ? {
          openTunnel: options.openTunnel,
          ssh: {
            knownHosts: new KnownHosts('/nonexistent/known_hosts'),
            confirmHostKey: () => Promise.resolve(false),
          },
        }
      : {}),
  });
  return { manager, created, logs, loadProfile, loadSecrets };
}

async function rejection(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RpcError);
    return error as RpcError;
  }
  throw new Error('expected a rejection');
}

describe('ConnectionManager.open / close / status', () => {
  it('opens with the profile and stored password, then reports connected', async () => {
    const { manager, created, loadProfile, loadSecrets } = setup();
    await expect(manager.open('p1', undefined)).resolves.toEqual({
      profileId: 'p1',
      state: 'connected',
    });
    expect(loadProfile).toHaveBeenCalledWith('p1');
    expect(loadSecrets).toHaveBeenCalledWith('p1');
    expect(created).toHaveLength(1);
    expect(created[0]?.uri).toBe('mongodb://db.example.test:27017');
    expect(created[0]?.options.auth).toEqual({ username: 'alice', password: STORED_PASSWORD });
    expect(manager.statusOf('p1')).toEqual({ profileId: 'p1', state: 'connected' });
    expect(manager.client('p1')).toBe(created[0]?.client);
  });

  it('answers at once when already connected (no second connect)', async () => {
    const { manager, created } = setup();
    await manager.open('p1', undefined);
    await expect(manager.open('p1', undefined)).resolves.toMatchObject({ state: 'connected' });
    expect(created).toHaveLength(1);
  });

  it('concurrent opens of the same profile share one connect', async () => {
    const gate = deferred();
    const client = fakeClient(() => gate.promise);
    const { manager, created } = setup({ clients: [client] });
    const first = manager.open('p1', undefined);
    const second = manager.open('p1', undefined);
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    expect(manager.statusOf('p1').state).toBe('connecting');
    expect(() => manager.client('p1')).toThrow(expect.objectContaining({ code: 'NOT_CONNECTED' }));
    gate.resolve();
    await expect(first).resolves.toEqual({ profileId: 'p1', state: 'connected' });
    await expect(second).resolves.toEqual({ profileId: 'p1', state: 'connected' });
    expect(created).toHaveLength(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('several profiles are open at once and close independently', async () => {
    const one = fakeClient();
    const two = fakeClient();
    const { manager } = setup({ clients: [one, two] });
    await manager.open('p1', undefined);
    await manager.open('p2', undefined);
    expect(manager.statuses()).toEqual([
      { profileId: 'p1', state: 'connected' },
      { profileId: 'p2', state: 'connected' },
    ]);
    await manager.close('p1');
    expect(one.close).toHaveBeenCalledWith(true);
    expect(two.close).not.toHaveBeenCalled();
    expect(manager.statusOf('p1')).toEqual({ profileId: 'p1', state: 'disconnected' });
    expect(manager.client('p2')).toBe(two);
    expect(manager.statuses()).toEqual([{ profileId: 'p2', state: 'connected' }]);
  });

  it('close is idempotent and a no-op for unknown profiles', async () => {
    const client = fakeClient();
    const { manager, logs } = setup({ clients: [client] });
    await expect(manager.close('nope')).resolves.toBeUndefined();
    await manager.open('p1', undefined);
    await manager.close('p1');
    await manager.close('p1');
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(logs.filter((line) => line === 'close p1')).toHaveLength(1);
  });

  it('close swallows errors of the driver close', async () => {
    const client = fakeClient();
    client.close.mockImplementation(() => Promise.reject(new Error('sockets gone')));
    const { manager } = setup({ clients: [client] });
    await manager.open('p1', undefined);
    await expect(manager.close('p1')).resolves.toBeUndefined();
    expect(manager.statusOf('p1').state).toBe('disconnected');
  });

  it('closeAll closes every connection', async () => {
    const one = fakeClient();
    const two = fakeClient();
    const { manager } = setup({ clients: [one, two] });
    await manager.open('p1', undefined);
    await manager.open('p2', undefined);
    await manager.closeAll();
    expect(one.close).toHaveBeenCalled();
    expect(two.close).toHaveBeenCalled();
    expect(manager.statuses()).toEqual([]);
  });

  it('close while connecting answers CANCELLED to the open and closes the client', async () => {
    const gate = deferred();
    const client = fakeClient(() => gate.promise);
    const { manager } = setup({ clients: [client] });
    const opening = manager.open('p1', undefined);
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    await manager.close('p1');
    gate.resolve();
    expect((await rejection(opening)).code).toBe('CANCELLED');
    expect(client.close).toHaveBeenCalled();
    expect(manager.statusOf('p1')).toEqual({ profileId: 'p1', state: 'disconnected' });
    expect(() => manager.client('p1')).toThrow(expect.objectContaining({ code: 'NOT_CONNECTED' }));
  });

  it('a new open after close-while-connecting is not disturbed by the old connect', async () => {
    const gate = deferred();
    const stale = fakeClient(() => gate.promise);
    const fresh = fakeClient();
    const { manager } = setup({ clients: [stale, fresh] });
    const first = manager.open('p1', undefined);
    await vi.waitFor(() => expect(stale.connect).toHaveBeenCalled());
    await manager.close('p1');
    await expect(manager.open('p1', undefined)).resolves.toMatchObject({ state: 'connected' });
    gate.resolve();
    expect((await rejection(first)).code).toBe('CANCELLED');
    expect(manager.statusOf('p1')).toEqual({ profileId: 'p1', state: 'connected' });
    expect(manager.client('p1')).toBe(fresh);
    expect(fresh.close).not.toHaveBeenCalled();
  });

  it('a failed connect after close does not overwrite the state of a newer open', async () => {
    const gate = deferred();
    const stale = fakeClient(() => gate.promise);
    const { manager } = setup({ clients: [stale, fakeClient()] });
    const first = manager.open('p1', undefined);
    await vi.waitFor(() => expect(stale.connect).toHaveBeenCalled());
    await manager.close('p1');
    await manager.open('p1', undefined);
    gate.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    // The old open was closed meanwhile, so it ends CANCELLED whatever the driver said (CR-4).
    expect((await rejection(first)).code).toBe('CANCELLED');
    expect(manager.statusOf('p1')).toEqual({ profileId: 'p1', state: 'connected' });
  });

  it('close during a driver connect that then fails with "Topology is closed" answers CANCELLED', async () => {
    const gate = deferred();
    const client = fakeClient(() => gate.promise);
    // Like the driver: closing drains the server selection queue with MongoTopologyClosedError.
    client.close.mockImplementation(() => {
      gate.reject(
        Object.assign(new Error('Topology is closed'), { name: 'MongoTopologyClosedError' }),
      );
      return Promise.resolve();
    });
    const { manager, logs } = setup({ clients: [client] });
    const opening = manager.open('p1', undefined);
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    await manager.close('p1');
    const error = await rejection(opening);
    expect(error.code).toBe('CANCELLED');
    expect(error.message).toBe('The connection was closed while connecting');
    expect(manager.statusOf('p1')).toEqual({ profileId: 'p1', state: 'disconnected' });
    expect(logs).toContain('open p1: CANCELLED The connection was closed while connecting');
  });

  it('a cancelled open closes the client again once the driver connect is over (CR-1)', async () => {
    const gate = deferred();
    const client = fakeClient(() => gate.promise);
    const { manager } = setup({ clients: [client] });
    const controller = new AbortController();
    const opening = manager.open('p1', undefined, controller.signal);
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    controller.abort();
    expect((await rejection(opening)).code).toBe('CANCELLED');
    await vi.waitFor(() => expect(client.close).toHaveBeenCalled());
    const closesBefore = client.close.mock.calls.length;
    // The driver connect finishes after the cancel (e.g. after SRV resolution).
    gate.resolve();
    await vi.waitFor(() => expect(client.close.mock.calls.length).toBeGreaterThan(closesBefore));
    expect(manager.statusOf('p1')).toEqual({ profileId: 'p1', state: 'disconnected' });
  });

  it('a profile still being loaded when its open is closed creates no client', async () => {
    const profileGate = deferred<Profile>();
    const { manager, created, loadProfile } = setup();
    loadProfile.mockImplementationOnce(() => profileGate.promise);
    const opening = manager.open('p1', undefined);
    await manager.close('p1');
    profileGate.resolve(savedProfile('p1'));
    expect((await rejection(opening)).code).toBe('CANCELLED');
    expect(created).toEqual([]);
  });

  it('concurrent opens: the first caller cancelling does not fail the second (CR-3)', async () => {
    const gate = deferred();
    const client = fakeClient(() => gate.promise);
    const { manager, created } = setup({ clients: [client] });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = manager.open('p1', undefined, firstController.signal);
    const second = manager.open('p1', undefined, secondController.signal);
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    firstController.abort();
    expect((await rejection(first)).code).toBe('CANCELLED');
    expect(manager.statusOf('p1').state).toBe('connecting');
    expect(client.close).not.toHaveBeenCalled();
    gate.resolve();
    await expect(second).resolves.toEqual({ profileId: 'p1', state: 'connected' });
    expect(manager.client('p1')).toBe(client);
    expect(created).toHaveLength(1);
  });

  it('concurrent opens: when every caller cancels, the entry is gone and the client closed', async () => {
    const gate = deferred();
    const client = fakeClient(() => gate.promise);
    const { manager } = setup({ clients: [client] });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = manager.open('p1', undefined, firstController.signal);
    const second = manager.open('p1', undefined, secondController.signal);
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    firstController.abort();
    secondController.abort();
    expect((await rejection(first)).code).toBe('CANCELLED');
    expect((await rejection(second)).code).toBe('CANCELLED');
    await vi.waitFor(() => expect(client.close).toHaveBeenCalledWith(true));
    expect(manager.statusOf('p1')).toEqual({ profileId: 'p1', state: 'disconnected' });
    expect(manager.statuses()).toEqual([]);
    // The connect coming up afterwards does not bring the connection back.
    gate.resolve();
    await vi.waitFor(() => expect(client.close.mock.calls.length).toBeGreaterThan(1));
    expect(manager.statusOf('p1')).toEqual({ profileId: 'p1', state: 'disconnected' });
  });

  it('concurrent opens: a caller without a signal keeps the connect alive', async () => {
    const gate = deferred();
    const client = fakeClient(() => gate.promise);
    const { manager } = setup({ clients: [client] });
    const controller = new AbortController();
    const first = manager.open('p1', undefined);
    const second = manager.open('p1', undefined, controller.signal);
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    controller.abort();
    expect((await rejection(second)).code).toBe('CANCELLED');
    gate.resolve();
    await expect(first).resolves.toEqual({ profileId: 'p1', state: 'connected' });
    expect(client.close).not.toHaveBeenCalled();
  });

  it("a later caller's password is ignored while a connect is in progress", async () => {
    const gate = deferred();
    const client = fakeClient(() => gate.promise);
    const { manager, created } = setup({ clients: [client] });
    const first = manager.open('p1', undefined);
    const second = manager.open('p1', TYPED_PASSWORD);
    gate.resolve();
    await Promise.all([first, second]);
    expect(created).toHaveLength(1);
    expect(created[0]?.options.auth).toEqual({ username: 'alice', password: STORED_PASSWORD });
  });

  it('an abort signal cancels a pending open: CANCELLED, client closed, state forgotten', async () => {
    const client = fakeClient(() => new Promise(() => undefined));
    const { manager } = setup({ clients: [client] });
    const controller = new AbortController();
    const opening = manager.open('p1', undefined, controller.signal);
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    controller.abort();
    const error = await rejection(opening);
    expect(error.code).toBe('CANCELLED');
    expect(client.close).toHaveBeenCalledWith(true);
    expect(manager.statusOf('p1')).toEqual({ profileId: 'p1', state: 'disconnected' });
    expect(manager.statuses()).toEqual([]);
  });

  it('with a signal, a failing connect keeps its own classified error (not CANCELLED)', async () => {
    const failing = fakeClient(() =>
      Promise.reject(Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' })),
    );
    const { manager } = setup({ clients: [failing] });
    const controller = new AbortController();
    const error = await rejection(manager.open('p1', undefined, controller.signal));
    expect(error.code).toBe('DNS_ERROR');
    controller.abort(); // after the end: nothing changes
    expect(manager.statusOf('p1')).toMatchObject({ state: 'error', error: { code: 'DNS_ERROR' } });
  });

  it('an already aborted signal answers CANCELLED without waiting for the connect', async () => {
    const client = fakeClient(() => new Promise(() => undefined));
    const { manager } = setup({ clients: [client] });
    const controller = new AbortController();
    controller.abort();
    expect((await rejection(manager.open('p1', undefined, controller.signal))).code).toBe(
      'CANCELLED',
    );
    expect(manager.statusOf('p1').state).toBe('disconnected');
  });

  it('a failed open keeps state error with the classified error until the next open/close', async () => {
    const failing = fakeClient(() =>
      Promise.reject(
        Object.assign(new Error('Authentication failed.'), { name: 'MongoServerError', code: 18 }),
      ),
    );
    const { manager } = setup({ clients: [failing, fakeClient()] });
    const error = await rejection(manager.open('p1', undefined));
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).toBe('Authentication failed: Authentication failed.');
    expect(failing.close).toHaveBeenCalled();
    expect(manager.statusOf('p1')).toEqual({
      profileId: 'p1',
      state: 'error',
      error: { code: 'AUTH_FAILED', message: error.message },
    });
    expect(manager.statuses()).toEqual([manager.statusOf('p1')]);
    expect(() => manager.client('p1')).toThrow(expect.objectContaining({ code: 'NOT_CONNECTED' }));

    // The next open tries again and clears the error.
    await expect(manager.open('p1', undefined)).resolves.toEqual({
      profileId: 'p1',
      state: 'connected',
    });
  });

  it('close clears an error state', async () => {
    const failing = fakeClient(() => Promise.reject(new Error('connection timed out')));
    const { manager } = setup({ clients: [failing] });
    expect((await rejection(manager.open('p1', undefined))).code).toBe('TIMEOUT');
    await manager.close('p1');
    expect(manager.statusOf('p1')).toEqual({ profileId: 'p1', state: 'disconnected' });
  });

  it('an unknown profile answers NOT_FOUND without creating a client', async () => {
    const { manager, created } = setup();
    expect((await rejection(manager.open('missing', undefined))).code).toBe('NOT_FOUND');
    expect(created).toEqual([]);
  });

  it('SSH profiles without an SSH environment fail UNSUPPORTED before a client is created', async () => {
    const { manager, created } = setup({
      profiles: {
        p1: savedProfile('p1', {
          ssh: { host: 'bastion.example.test', port: 22, username: 'ops', method: 'agent' },
        }),
      },
    });
    expect((await rejection(manager.open('p1', undefined))).code).toBe('UNSUPPORTED');
    expect(created).toEqual([]);
  });

  it('client() answers NOT_CONNECTED for unknown profiles', () => {
    const { manager } = setup();
    expect(() => manager.client('p9')).toThrow(
      expect.objectContaining({ code: 'NOT_CONNECTED', message: expect.stringContaining('p9') }),
    );
  });
});

describe('ConnectionManager secrets', () => {
  it('a password in the request wins over the stored one', async () => {
    const { manager, created } = setup();
    await manager.open('p1', TYPED_PASSWORD);
    expect(created[0]?.options.auth).toEqual({ username: 'alice', password: TYPED_PASSWORD });
  });

  it("secretMode 'ask' ignores a stored password but keeps other stored secrets", async () => {
    const profile = savedProfile('p1', {
      auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'ask' },
      tls: { enabled: true, certificateKeyFile: '/tmp/fictitious/client.pem' },
    });
    const { manager, created } = setup({
      profiles: { p1: profile },
      secrets: { p1: { password: STORED_PASSWORD, tlsKeyPassphrase: PASSPHRASE } },
    });
    const error = await rejection(manager.open('p1', undefined));
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).toMatch(/^No password for user alice/);
    expect(created).toEqual([]);

    await manager.open('p1', TYPED_PASSWORD);
    expect(created[0]?.options).toMatchObject({
      auth: { username: 'alice', password: TYPED_PASSWORD },
      tlsCertificateKeyFilePassword: PASSPHRASE,
    });
  });

  it('loadSecrets NOT_FOUND counts as no stored secrets', async () => {
    const { manager, created } = setup({
      loadSecrets: () => Promise.reject(new RpcError('NOT_FOUND', 'no secrets')),
    });
    const error = await rejection(manager.open('p1', undefined));
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).toMatch(/No password/);
    expect(created).toEqual([]);
    await expect(manager.open('p1', TYPED_PASSWORD)).resolves.toMatchObject({
      state: 'connected',
    });
  });

  it('loadSecrets null counts as no stored secrets', async () => {
    const { manager } = setup({ secrets: { p1: null } });
    expect((await rejection(manager.open('p1', undefined))).code).toBe('AUTH_FAILED');
  });

  it('other loadSecrets errors fail the open (passed through)', async () => {
    const { manager } = setup({
      loadSecrets: () => Promise.reject(new RpcError('INTERNAL', 'main unreachable')),
    });
    const error = await rejection(manager.open('p1', undefined));
    expect(error.code).toBe('INTERNAL');
    expect(manager.statusOf('p1')).toMatchObject({ state: 'error', error: { code: 'INTERNAL' } });
  });

  it('a draft without id does not load stored secrets', async () => {
    const { manager, loadSecrets, created } = setup();
    const draft: ProfileDraft = {
      name: 'Draft',
      connectionString: 'mongodb://db.example.test',
      auth: { mechanism: 'SCRAM-SHA-1', username: 'bob', secretMode: 'saved' },
      readOnly: false,
      production: false,
    };
    await manager.test({ profile: draft }, TYPED_PASSWORD);
    expect(loadSecrets).not.toHaveBeenCalled();
    expect(created[0]?.options).toMatchObject({
      auth: { username: 'bob', password: TYPED_PASSWORD },
      authMechanism: 'SCRAM-SHA-1',
    });
  });

  it('a draft with an id equal to its saved profile uses the stored secrets (CR-2)', async () => {
    const { manager, loadSecrets, created } = setup();
    const { id, ...rest } = savedProfile('p1');
    const draft: ProfileDraft = { ...rest, id, name: 'Renamed', readOnly: true };
    await manager.test({ profile: draft }, undefined);
    expect(loadSecrets).toHaveBeenCalledWith('p1');
    expect(created[0]?.options.auth).toEqual({ username: 'alice', password: STORED_PASSWORD });
  });

  it.each([
    ['another host', { connectionString: 'mongodb://attacker.example.test:27017' }],
    [
      'other auth',
      {
        auth: {
          mechanism: 'SCRAM-SHA-1' as const,
          username: 'alice',
          secretMode: 'saved' as const,
        },
      },
    ],
    ['TLS changed', { tls: { enabled: true, allowInvalidCertificates: true } }],
    [
      'SSH added',
      {
        ssh: {
          host: 'bastion.example.test',
          port: 22,
          username: 'ops',
          method: 'agent' as const,
        },
      },
    ],
  ])('a draft with an id but %s does not get the stored secrets (CR-2)', async (_label, change) => {
    const { manager, loadSecrets, created } = setup();
    const draft: ProfileDraft = { ...savedProfile('p1'), ...change };
    const error = await rejection(manager.test({ profile: draft }, undefined));
    expect(loadSecrets).not.toHaveBeenCalled();
    // Without the stored password there is nothing to authenticate with (or SSH is refused).
    expect(['AUTH_FAILED', 'UNSUPPORTED']).toContain(error.code);
    expect(created).toEqual([]);
  });

  it('a changed draft with an id uses only the typed password (CR-2)', async () => {
    const { manager, loadSecrets, created } = setup();
    const draft: ProfileDraft = {
      ...savedProfile('p1'),
      connectionString: 'mongodb://other.example.test',
    };
    await manager.test({ profile: draft }, TYPED_PASSWORD);
    expect(loadSecrets).not.toHaveBeenCalled();
    expect(created[0]?.uri).toBe('mongodb://other.example.test');
    expect(created[0]?.options.auth).toEqual({ username: 'alice', password: TYPED_PASSWORD });
  });

  it('a draft whose id has no saved profile gets no stored secrets (CR-2)', async () => {
    const { manager, loadSecrets, created } = setup();
    const draft: ProfileDraft = { ...savedProfile('gone'), id: 'gone' };
    await manager.test({ profile: draft }, TYPED_PASSWORD);
    expect(loadSecrets).not.toHaveBeenCalled();
    expect(created[0]?.options.auth).toEqual({ username: 'alice', password: TYPED_PASSWORD });
  });

  it('other loadProfile errors for a draft with an id fail the test', async () => {
    const { manager, loadProfile, created } = setup();
    loadProfile.mockImplementationOnce(() =>
      Promise.reject(new RpcError('INTERNAL', 'main unreachable')),
    );
    const error = await rejection(manager.test({ profile: savedProfile('p1') }, undefined));
    expect(error.code).toBe('INTERNAL');
    expect(created).toEqual([]);
  });
});

describe('ConnectionManager logs', () => {
  it('log lines never contain passwords or passphrases (success and failure)', async () => {
    const secretsInError = `auth with ${STORED_PASSWORD} and ${PASSPHRASE} failed for mongodb://alice:${TYPED_PASSWORD}@db.example.test`;
    const failing = fakeClient(() =>
      Promise.reject(Object.assign(new Error(secretsInError), { code: 18 })),
    );
    const profile = savedProfile('p1', {
      tls: { enabled: true, certificateKeyFile: '/tmp/fictitious/client.pem' },
    });
    const { manager, logs } = setup({
      profiles: { p1: profile, p2: savedProfile('p2') },
      secrets: {
        p1: { password: STORED_PASSWORD, tlsKeyPassphrase: PASSPHRASE },
        p2: { password: STORED_PASSWORD },
      },
      clients: [failing, fakeClient(), fakeClient()],
    });
    const error = await rejection(manager.open('p1', undefined));
    await manager.open('p2', TYPED_PASSWORD);
    await manager.test({ profileId: 'p2' }, undefined);
    await manager.close('p2');

    expect(logs.length).toBeGreaterThanOrEqual(6);
    for (const text of [...logs, error.message]) {
      expect(text).not.toContain(STORED_PASSWORD);
      expect(text).not.toContain(TYPED_PASSWORD);
      expect(text).not.toContain(PASSPHRASE);
    }
    expect(logs).toContain('open p1: connecting to mongodb://db.example.test:27017');
    expect(logs.some((line) => line.startsWith('open p1: AUTH_FAILED'))).toBe(true);
    expect(logs).toContain('open p2: connected');
  });

  it('masks a user:password connection string in the log line of a draft test', async () => {
    const { manager, logs } = setup();
    const draft = {
      name: 'Leaky',
      // The contract refuses this; the manager still must not log the password.
      connectionString: `mongodb://bob:${TYPED_PASSWORD}@db.example.test`,
      readOnly: false,
      production: false,
    };
    await manager.test({ profile: draft }, undefined);
    expect(logs.join('\n')).not.toContain(TYPED_PASSWORD);
    expect(logs[0]).toMatch(/^test Leaky: connecting to mongodb:\/\/bob/);
  });

  it('works without a log function', async () => {
    const manager = new ConnectionManager({
      loadProfile: () => Promise.resolve(savedProfile('p1')),
      loadSecrets: () => Promise.resolve({ password: STORED_PASSWORD }),
      createClient: () => fakeClient(),
    });
    await expect(manager.open('p1', undefined)).resolves.toMatchObject({ state: 'connected' });
    await manager.close('p1');
  });
});

describe('ConnectionManager.test', () => {
  it('connects, pings, reads server info, disconnects; latency uses the clock', async () => {
    const client = fakeClient();
    const { manager, loadProfile } = setup({ clients: [client] });
    const result = await manager.test({ profileId: 'p1' }, undefined);
    expect(loadProfile).toHaveBeenCalledWith('p1');
    expect(result.latencyMS).toBe(7);
    expect(result.server).toMatchObject({
      version: '8.0.4',
      topology: 'replicaSet',
      enterprise: false,
    });
    expect(client.commands[0]).toEqual({ ping: 1 });
    expect(client.close).toHaveBeenCalledWith(true);
    // A test opens nothing.
    expect(manager.statuses()).toEqual([]);
  });

  it('classifies failures and still closes the client', async () => {
    const client = fakeClient(() =>
      Promise.reject(
        Object.assign(new Error('getaddrinfo ENOTFOUND nowhere.example.test'), {
          code: 'ENOTFOUND',
        }),
      ),
    );
    const { manager, logs } = setup({ clients: [client] });
    const error = await rejection(manager.test({ profileId: 'p1' }, undefined));
    expect(error.code).toBe('DNS_ERROR');
    expect(client.close).toHaveBeenCalled();
    expect(logs.at(-1)).toMatch(/^test Profile p1: DNS_ERROR Host name could not be resolved/);
  });

  it('a failing ping is classified (server error with detail)', async () => {
    const client = fakeClient();
    client.answerWith(() =>
      Promise.reject(
        Object.assign(new Error('not authorized'), {
          name: 'MongoServerError',
          code: 13,
          codeName: 'Unauthorized',
        }),
      ),
    );
    const { manager } = setup({ clients: [client] });
    const error = await rejection(manager.test({ profileId: 'p1' }, undefined));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toEqual({ serverCode: 13, codeName: 'Unauthorized' });
  });

  it('abort cancels a pending test and closes the client', async () => {
    const client = fakeClient(() => new Promise(() => undefined));
    const { manager } = setup({ clients: [client] });
    const controller = new AbortController();
    const testing = manager.test({ profileId: 'p1' }, undefined, controller.signal);
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    controller.abort();
    expect((await rejection(testing)).code).toBe('CANCELLED');
    expect(client.close).toHaveBeenCalled();
  });

  it('a cancelled test closes the client again once the driver connect is over (CR-1)', async () => {
    const gate = deferred();
    const client = fakeClient(() => gate.promise);
    const { manager } = setup({ clients: [client] });
    const controller = new AbortController();
    const testing = manager.test({ profileId: 'p1' }, undefined, controller.signal);
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    controller.abort();
    expect((await rejection(testing)).code).toBe('CANCELLED');
    expect(client.close).toHaveBeenCalledTimes(1);
    gate.resolve();
    await vi.waitFor(() => expect(client.close).toHaveBeenCalledTimes(2));
  });

  it('a test whose connect fails is closed only once', async () => {
    const client = fakeClient(() => Promise.reject(new Error('connection timed out')));
    const { manager } = setup({ clients: [client] });
    expect((await rejection(manager.test({ profileId: 'p1' }, undefined))).code).toBe('TIMEOUT');
    await Promise.resolve();
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('never reports a negative latency', async () => {
    let t = 100;
    const manager = new ConnectionManager({
      loadProfile: () => Promise.resolve(savedProfile('p1')),
      loadSecrets: () => Promise.resolve({ password: STORED_PASSWORD }),
      createClient: () => fakeClient(),
      now: () => (t -= 10),
    });
    expect((await manager.test({ profileId: 'p1' }, undefined)).latencyMS).toBe(0);
  });
});

describe('ConnectionManager.serverInfo', () => {
  it('reads hello + buildInfo of an open connection', async () => {
    const client = fakeClient();
    client.answerWith((command) =>
      Promise.resolve(
        'hello' in command
          ? { msg: 'isdbgrid', isWritablePrimary: true }
          : { version: '7.0.1', modules: ['enterprise'] },
      ),
    );
    const { manager } = setup({ clients: [client] });
    await manager.open('p1', undefined);
    const info = await manager.serverInfo('p1');
    expect(info).toMatchObject({ version: '7.0.1', topology: 'sharded', enterprise: true });
    expect(JSON.parse(info.raw)).toMatchObject({
      hello: { msg: 'isdbgrid' },
      buildInfo: { version: '7.0.1' },
    });
    expect(client.db).toHaveBeenCalledWith('admin');
  });

  it('answers NOT_CONNECTED when the profile is not open', async () => {
    const { manager } = setup();
    expect((await rejection(manager.serverInfo('p1'))).code).toBe('NOT_CONNECTED');
  });

  it('classifies driver errors', async () => {
    const client = fakeClient();
    const { manager } = setup({ clients: [client] });
    await manager.open('p1', undefined);
    client.answerWith(() =>
      Promise.reject(Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })),
    );
    expect((await rejection(manager.serverInfo('p1'))).code).toBe('NETWORK_ERROR');
  });
});

describe('readServerInfo / topologyOf', () => {
  it('reports unknown version and no enterprise for odd buildInfo answers', async () => {
    const client: ClientLike = {
      connect: () => Promise.resolve(),
      close: () => Promise.resolve(),
      db: () => ({
        command: (command: Document) =>
          Promise.resolve('hello' in command ? {} : { version: 8, modules: 'enterprise' }),
      }),
    };
    await expect(readServerInfo(client)).resolves.toMatchObject({
      version: 'unknown',
      topology: 'unknown',
      enterprise: false,
    });
  });

  it.each([
    [{ msg: 'isdbgrid', isWritablePrimary: true }, 'sharded'],
    [{ serviceId: 'abc', isWritablePrimary: true, setName: 'rs0' }, 'loadBalanced'],
    [{ setName: 'rs0', isWritablePrimary: false, secondary: true }, 'replicaSet'],
    [{ isWritablePrimary: true }, 'standalone'],
    [{ ismaster: true }, 'standalone'],
    [{ isWritablePrimary: false }, 'standalone'],
    [{}, 'unknown'],
    [{ setName: 42, ok: 1 }, 'unknown'],
  ])('topologyOf(%j) is %s', (hello, topology) => {
    expect(topologyOf(hello)).toBe(topology);
  });
});

describe('ConnectionManager cancellation and draft secrets: edge cases', () => {
  it('waiters are counted: a caller joining after another cancelled keeps the connect alive', async () => {
    const gate = deferred();
    const client = fakeClient(() => gate.promise);
    const { manager, created } = setup({ clients: [client] });
    const a = new AbortController();
    const b = new AbortController();
    const c = new AbortController();
    const first = manager.open('p1', undefined, a.signal);
    const second = manager.open('p1', undefined, b.signal);
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    a.abort();
    expect((await rejection(first)).code).toBe('CANCELLED');
    const third = manager.open('p1', undefined, c.signal);
    b.abort();
    expect((await rejection(second)).code).toBe('CANCELLED');
    expect(manager.statusOf('p1').state).toBe('connecting');
    expect(client.close).not.toHaveBeenCalled();
    gate.resolve();
    await expect(third).resolves.toEqual({ profileId: 'p1', state: 'connected' });
    expect(created).toHaveLength(1);
    // Aborting after the open succeeded changes nothing.
    c.abort();
    await Promise.resolve();
    expect(manager.statusOf('p1').state).toBe('connected');
    expect(client.close).not.toHaveBeenCalled();
  });

  it('the only caller aborting while the profile loads: CANCELLED, no client is created', async () => {
    const profileGate = deferred<Profile>();
    const { manager, created, loadProfile, logs } = setup();
    loadProfile.mockImplementationOnce(() => profileGate.promise);
    const controller = new AbortController();
    const opening = manager.open('p1', undefined, controller.signal);
    controller.abort();
    expect((await rejection(opening)).code).toBe('CANCELLED');
    expect(manager.statusOf('p1')).toEqual({ profileId: 'p1', state: 'disconnected' });
    profileGate.resolve(savedProfile('p1'));
    await vi.waitFor(() =>
      expect(logs).toContain('open p1: CANCELLED The connection was closed while connecting'),
    );
    expect(created).toEqual([]);
    expect(manager.statuses()).toEqual([]);
  });

  it('a new open after every caller cancelled starts a fresh connect; the old one is closed', async () => {
    const gate = deferred();
    const stale = fakeClient(() => gate.promise);
    const fresh = fakeClient();
    const { manager } = setup({ clients: [stale, fresh] });
    const controller = new AbortController();
    const first = manager.open('p1', undefined, controller.signal);
    await vi.waitFor(() => expect(stale.connect).toHaveBeenCalled());
    controller.abort();
    expect((await rejection(first)).code).toBe('CANCELLED');
    await expect(manager.open('p1', undefined)).resolves.toMatchObject({ state: 'connected' });
    gate.resolve();
    await vi.waitFor(() => expect(stale.close.mock.calls.length).toBeGreaterThan(1));
    expect(manager.client('p1')).toBe(fresh);
    expect(fresh.close).not.toHaveBeenCalled();
  });

  it('test() with an already aborted signal answers CANCELLED and closes the client after its connect', async () => {
    const gate = deferred();
    const client = fakeClient(() => gate.promise);
    const { manager } = setup({ clients: [client] });
    const controller = new AbortController();
    controller.abort();
    const error = await rejection(manager.test({ profileId: 'p1' }, undefined, controller.signal));
    expect(error.code).toBe('CANCELLED');
    expect(client.close).toHaveBeenCalledTimes(1);
    gate.resolve();
    await vi.waitFor(() => expect(client.close).toHaveBeenCalledTimes(2));
    expect(client.commands).toEqual([]);
  });

  it('a cancelled test whose connect later fails is not closed again and raises no unhandled error', async () => {
    const gate = deferred();
    const client = fakeClient(() => gate.promise);
    const { manager } = setup({ clients: [client] });
    const controller = new AbortController();
    const testing = manager.test({ profileId: 'p1' }, undefined, controller.signal);
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    controller.abort();
    expect((await rejection(testing)).code).toBe('CANCELLED');
    gate.reject(Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('a test whose ping fails after connecting is closed once (no second close)', async () => {
    const client = fakeClient();
    client.answerWith(() => Promise.reject(new Error('connection timed out')));
    const { manager } = setup({ clients: [client] });
    expect((await rejection(manager.test({ profileId: 'p1' }, undefined))).code).toBe('TIMEOUT');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('draft matching ignores key order and fields that do not change the target', async () => {
    const { manager, loadSecrets, created } = setup();
    const draft: ProfileDraft = {
      id: 'p1',
      name: 'Edited name',
      // Same values as the saved profile, keys in another order.
      auth: { secretMode: 'saved', username: 'alice', mechanism: 'SCRAM-SHA-256' },
      connectionString: 'mongodb://db.example.test:27017',
      appName: 'Other app',
      readPreference: 'nearest',
      serverSelectionTimeoutMS: 1234,
      readOnly: true,
      production: true,
    };
    await manager.test({ profile: draft }, undefined);
    expect(loadSecrets).toHaveBeenCalledWith('p1');
    expect(created[0]?.options).toMatchObject({
      auth: { username: 'alice', password: STORED_PASSWORD },
      appName: 'Other app',
      readPreference: 'nearest',
      serverSelectionTimeoutMS: 1234,
    });
  });

  it('a CANCELLED answer from main (e.g. privileged port replaced) forgets the entry', async () => {
    const { manager, loadProfile, created } = setup();
    loadProfile.mockImplementationOnce(() =>
      Promise.reject(new RpcError('CANCELLED', 'Replaced by a new privileged port')),
    );
    expect((await rejection(manager.open('p1', undefined))).code).toBe('CANCELLED');
    expect(manager.statusOf('p1')).toEqual({ profileId: 'p1', state: 'disconnected' });
    expect(manager.statuses()).toEqual([]);
    expect(created).toEqual([]);
  });

  it('a draft that drops the auth section of its saved profile gets no stored secrets', async () => {
    const { manager, loadSecrets, created } = setup();
    const withoutAuth: ProfileDraft = { ...savedProfile('p1') };
    delete withoutAuth.auth;
    await manager.test({ profile: withoutAuth }, undefined);
    expect(loadSecrets).not.toHaveBeenCalled();
    expect(created[0]?.options.auth).toBeUndefined();
  });
});

describe('ConnectionManager proxy and X.509 (task x509-proxy)', () => {
  const PROXY_PASSWORD = 'fictitious-proxy-Pw4';
  const PROXY = { host: 'proxy.example.test', port: 1080, username: 'pat' };

  function proxySetup() {
    return setup({
      profiles: { p1: savedProfile('p1', { proxy: PROXY }) },
      secrets: { p1: { password: STORED_PASSWORD, proxyPassword: PROXY_PASSWORD } },
    });
  }

  it('a saved profile with a proxy connects with the stored proxy password', async () => {
    const { manager, created } = proxySetup();
    await manager.open('p1', undefined);
    expect(created[0]?.options).toMatchObject({
      proxyHost: 'proxy.example.test',
      proxyPort: 1080,
      proxyUsername: 'pat',
      proxyPassword: PROXY_PASSWORD,
    });
    await manager.close('p1');
  });

  it('a draft with an id and the same proxy (keys reordered) gets the stored proxy password', async () => {
    const { manager, loadSecrets, created } = proxySetup();
    const draft: ProfileDraft = {
      ...savedProfile('p1'),
      proxy: { username: 'pat', port: 1080, host: 'proxy.example.test' },
    };
    await manager.test({ profile: draft }, undefined);
    expect(loadSecrets).toHaveBeenCalledWith('p1');
    expect(created[0]?.options.proxyPassword).toBe(PROXY_PASSWORD);
  });

  it.each([
    ['another proxy host', { ...PROXY, host: 'attacker.example.test' }],
    ['another proxy port', { ...PROXY, port: 1081 }],
    ['another proxy user', { ...PROXY, username: 'mallory' }],
  ])(
    'a draft with an id but %s gets no stored secrets (no proxy password leaves)',
    async (_label, proxy) => {
      const { manager, loadSecrets, created } = proxySetup();
      const draft: ProfileDraft = { ...savedProfile('p1'), proxy };
      // The typed DB password lets clientConfig get as far as the proxy check.
      const error = await rejection(manager.test({ profile: draft }, TYPED_PASSWORD));
      expect(loadSecrets).not.toHaveBeenCalled();
      expect(error.code).toBe('AUTH_FAILED');
      expect(error.message).toMatch(/proxy user/);
      expect(created).toEqual([]);
    },
  );

  it('a draft with an id that removes the proxy gets no stored secrets', async () => {
    const { manager, loadSecrets, created } = proxySetup();
    const draft: ProfileDraft = { ...savedProfile('p1') };
    await manager.test({ profile: draft }, TYPED_PASSWORD);
    expect(loadSecrets).not.toHaveBeenCalled();
    expect(created[0]?.options).not.toHaveProperty('proxyHost');
    expect(created[0]?.options.auth).toEqual({ username: 'alice', password: TYPED_PASSWORD });
  });

  it('a draft with an id that adds a proxy without user gets no stored secrets', async () => {
    const { manager, loadSecrets, created } = setup({
      secrets: { p1: { password: STORED_PASSWORD, proxyPassword: PROXY_PASSWORD } },
    });
    const draft: ProfileDraft = {
      ...savedProfile('p1'),
      proxy: { host: 'proxy.example.test', port: 1080 },
    };
    await manager.test({ profile: draft }, TYPED_PASSWORD);
    expect(loadSecrets).not.toHaveBeenCalled();
    expect(created[0]?.options).toMatchObject({ proxyHost: 'proxy.example.test', proxyPort: 1080 });
    expect(created[0]?.options).not.toHaveProperty('proxyPassword');
    expect(JSON.stringify(created[0]?.options)).not.toContain(STORED_PASSWORD);
  });

  it('the proxy password never reaches log lines or the error message', async () => {
    const client = fakeClient(() =>
      Promise.reject(
        Object.assign(new Error(`socks auth for pat:${PROXY_PASSWORD} rejected`), {
          code: 'ECONNREFUSED',
        }),
      ),
    );
    const { manager, logs } = setup({
      profiles: { p1: savedProfile('p1', { proxy: PROXY }) },
      secrets: { p1: { password: STORED_PASSWORD, proxyPassword: PROXY_PASSWORD } },
      clients: [client],
    });
    const error = await rejection(manager.open('p1', undefined));
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.message).not.toContain(PROXY_PASSWORD);
    expect(manager.statusOf('p1').error?.message).not.toContain(PROXY_PASSWORD);
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) expect(line).not.toContain(PROXY_PASSWORD);
  });

  function userNotFound(): Error {
    return Object.assign(
      new Error('Could not find user "CN=nobody,O=Example" for db "$external"'),
      {
        name: 'MongoServerError',
        code: 11,
        codeName: 'UserNotFound',
      },
    );
  }

  it('UserNotFound while opening is AUTH_FAILED (X.509 subject without a user)', async () => {
    const client = fakeClient(() => Promise.reject(userNotFound()));
    const { manager } = setup({ clients: [client] });
    const error = await rejection(manager.open('p1', undefined));
    expect(error.code).toBe('AUTH_FAILED');
    expect(manager.statusOf('p1')).toMatchObject({
      state: 'error',
      error: { code: 'AUTH_FAILED' },
    });
  });

  it('UserNotFound while testing (connect or ping) is AUTH_FAILED', async () => {
    const failingConnect = fakeClient(() => Promise.reject(userNotFound()));
    const failingPing = fakeClient();
    failingPing.answerWith(() => Promise.reject(userNotFound()));
    const { manager } = setup({ clients: [failingConnect, failingPing] });
    expect((await rejection(manager.test({ profileId: 'p1' }, undefined))).code).toBe(
      'AUTH_FAILED',
    );
    expect((await rejection(manager.test({ profileId: 'p1' }, undefined))).code).toBe(
      'AUTH_FAILED',
    );
  });

  it('UserNotFound on an open connection (serverInfo) stays SERVER_ERROR', async () => {
    const client = fakeClient();
    const { manager } = setup({ clients: [client] });
    await manager.open('p1', undefined);
    client.answerWith(() => Promise.reject(userNotFound()));
    const error = await rejection(manager.serverInfo('p1'));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toEqual({ serverCode: 11, codeName: 'UserNotFound' });
    await manager.close('p1');
  });

  it('opens an X.509 profile from $external without sending the stored password', async () => {
    const { manager, created } = setup({
      profiles: {
        p1: savedProfile('p1', {
          auth: { mechanism: 'MONGODB-X509', secretMode: 'none' },
          tls: { enabled: true, certificateKeyFile: '/tmp/fictitious/client.pem' },
        }),
      },
      secrets: { p1: { password: STORED_PASSWORD, tlsKeyPassphrase: PASSPHRASE } },
    });
    await manager.open('p1', undefined);
    expect(created[0]?.options).toMatchObject({
      authMechanism: 'MONGODB-X509',
      authSource: '$external',
      tlsCertificateKeyFile: '/tmp/fictitious/client.pem',
      tlsCertificateKeyFilePassword: PASSPHRASE,
    });
    expect(JSON.stringify(created[0]?.options)).not.toContain(STORED_PASSWORD);
    await manager.close('p1');
  });
});

describe('ConnectionManager MONGODB-AWS (task aws-auth)', () => {
  /** Fictitious AWS values; none of them is a real credential. */
  const KEY_ID = 'AKIAFICTITIOUSKEY123';
  const AWS_SECRET = 'fictitious/aws+Secret+Key9';
  const AWS_TOKEN = 'fictitious-aws-session-Token8';

  function awsProfile(id: string, auth: Partial<NonNullable<Profile['auth']>> = {}): Profile {
    return savedProfile(id, {
      connectionString: 'mongodb+srv://cluster0.example.test/?retryWrites=true',
      auth: { mechanism: 'MONGODB-AWS', username: KEY_ID, secretMode: 'saved', ...auth },
    });
  }

  async function credentialsOf(options: MongoClientOptions | undefined): Promise<unknown> {
    const provider = options?.authMechanismProperties?.AWS_CREDENTIAL_PROVIDER;
    expect(provider).toBeTypeOf('function');
    return provider?.();
  }

  function awsError(message: string): Error {
    return Object.assign(new Error(message), { name: 'MongoAWSError' });
  }

  it('open: the stored secret access key and session token reach the credential provider', async () => {
    const { manager, created, loadSecrets } = setup({
      profiles: { p1: awsProfile('p1') },
      secrets: { p1: { awsSecretAccessKey: AWS_SECRET, awsSessionToken: AWS_TOKEN } },
    });
    await expect(manager.open('p1', undefined)).resolves.toMatchObject({ state: 'connected' });
    expect(loadSecrets).toHaveBeenCalledWith('p1');
    const options = created[0]?.options;
    expect(created[0]?.uri).toBe('mongodb+srv://cluster0.example.test/?retryWrites=true');
    expect(options).toMatchObject({ authMechanism: 'MONGODB-AWS', authSource: '$external' });
    expect(options?.auth).toBeUndefined();
    expect(await credentialsOf(options)).toEqual({
      accessKeyId: KEY_ID,
      secretAccessKey: AWS_SECRET,
      sessionToken: AWS_TOKEN,
    });
    // The secrets travel only inside the provider closure, never as plain option values.
    expect(JSON.stringify(options)).not.toContain(AWS_SECRET);
    expect(JSON.stringify(options)).not.toContain(AWS_TOKEN);
    await manager.close('p1');
  });

  it('open: the stored secret and token never reach log lines, the error or the status', async () => {
    const client = fakeClient(() =>
      Promise.reject(awsError(`STS refused ${KEY_ID} / ${AWS_SECRET} with token ${AWS_TOKEN}`)),
    );
    const { manager, logs } = setup({
      profiles: { p1: awsProfile('p1') },
      secrets: { p1: { awsSecretAccessKey: AWS_SECRET, awsSessionToken: AWS_TOKEN } },
      clients: [client],
    });
    const error = await rejection(manager.open('p1', undefined));
    expect(error.code).toBe('AUTH_FAILED');
    for (const text of [error.message, manager.statusOf('p1').error?.message ?? '', ...logs]) {
      expect(text).not.toContain(AWS_SECRET);
      expect(text).not.toContain(AWS_TOKEN);
    }
    expect(error.message).toContain('****');
    expect(logs.some((line) => line.includes('AUTH_FAILED'))).toBe(true);
    expect(manager.statusOf('p1')).toMatchObject({
      state: 'error',
      error: { code: 'AUTH_FAILED' },
    });
    expect(client.close).toHaveBeenCalled();
  });

  it('test: a typed secret is used and masked in the logs, and wins over the stored one', async () => {
    const typed = 'fictitious-typed-aws-Secret7';
    const client = fakeClient(() => Promise.reject(awsError(`signature for ${typed} rejected`)));
    const { manager, created, logs } = setup({
      profiles: { p1: awsProfile('p1') },
      secrets: { p1: { awsSecretAccessKey: AWS_SECRET } },
      clients: [client],
    });
    const error = await rejection(manager.test({ profileId: 'p1' }, typed));
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).not.toContain(typed);
    for (const line of logs) expect(line).not.toContain(typed);
    expect(await credentialsOf(created[0]?.options)).toEqual({
      accessKeyId: KEY_ID,
      secretAccessKey: typed,
    });
  });

  it("secretMode 'ask': the stored secret access key is not used; the typed one is", async () => {
    const asked = setup({
      profiles: { p1: awsProfile('p1', { secretMode: 'ask' }) },
      secrets: { p1: { awsSecretAccessKey: AWS_SECRET } },
    });
    const error = await rejection(asked.manager.open('p1', undefined));
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).toContain(KEY_ID);
    expect(error.message).not.toContain(AWS_SECRET);
    expect(asked.created).toEqual([]);

    const typed = setup({
      profiles: { p1: awsProfile('p1', { secretMode: 'ask' }) },
      secrets: { p1: { awsSecretAccessKey: AWS_SECRET } },
    });
    await typed.manager.open('p1', 'fictitious-typed-aws-Secret7');
    expect(await credentialsOf(typed.created[0]?.options)).toMatchObject({
      secretAccessKey: 'fictitious-typed-aws-Secret7',
    });
    await typed.manager.close('p1');
  });

  it('a saved access key ID without a stored secret answers AUTH_FAILED before creating a client', async () => {
    const { manager, created } = setup({
      profiles: { p1: awsProfile('p1') },
      secrets: { p1: null },
    });
    const error = await rejection(manager.open('p1', undefined));
    expect(error.code).toBe('AUTH_FAILED');
    expect(created).toEqual([]);
    expect(manager.statusOf('p1')).toMatchObject({
      state: 'error',
      error: { code: 'AUTH_FAILED' },
    });
  });

  it('default chain: no provider and no secrets are passed; a chain failure is AUTH_FAILED', async () => {
    const chainFailure = Object.assign(new Error('Could not load credentials from any providers'), {
      name: 'MongoServerSelectionError',
      cause: awsError('Could not load credentials from any providers'),
    });
    const client = fakeClient(() => Promise.reject(chainFailure));
    const { manager, created } = setup({
      profiles: {
        p1: savedProfile('p1', { auth: { mechanism: 'MONGODB-AWS', secretMode: 'none' } }),
      },
      secrets: { p1: { password: STORED_PASSWORD, awsSecretAccessKey: AWS_SECRET } },
      clients: [fakeClient(), client],
    });
    await manager.open('p1', undefined);
    const options = created[0]?.options;
    expect(options).toMatchObject({ authMechanism: 'MONGODB-AWS', authSource: '$external' });
    expect(options?.auth).toBeUndefined();
    expect(options?.authMechanismProperties).toBeUndefined();
    expect(JSON.stringify(options)).not.toContain(AWS_SECRET);
    expect(JSON.stringify(options)).not.toContain(STORED_PASSWORD);
    await manager.close('p1');

    const error = await rejection(manager.open('p1', undefined));
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).toMatch(/^Authentication failed: /);
  });

  it('a draft with an id and the same AWS auth gets the stored secret; another key ID gets none', async () => {
    const same = setup({
      profiles: { p1: awsProfile('p1') },
      secrets: { p1: { awsSecretAccessKey: AWS_SECRET, awsSessionToken: AWS_TOKEN } },
    });
    await same.manager.test({ profile: { ...awsProfile('p1') } }, undefined);
    expect(await credentialsOf(same.created[0]?.options)).toMatchObject({
      secretAccessKey: AWS_SECRET,
      sessionToken: AWS_TOKEN,
    });

    const other = setup({
      profiles: { p1: awsProfile('p1') },
      secrets: { p1: { awsSecretAccessKey: AWS_SECRET, awsSessionToken: AWS_TOKEN } },
    });
    const changed: ProfileDraft = awsProfile('p1', { username: 'AKIAOTHERFICTITIOUS1' });
    const error = await rejection(other.manager.test({ profile: changed }, undefined));
    expect(other.loadSecrets).not.toHaveBeenCalled();
    expect(error.code).toBe('AUTH_FAILED');
    expect(other.created).toEqual([]);
  });
});

describe('ConnectionManager SSH tunnels', () => {
  const SSH = {
    host: 'bastion.example.test',
    port: 22,
    username: 'ops',
    method: 'password' as const,
  };
  const PROXY = {
    proxyHost: '127.0.0.1',
    proxyPort: 40999,
    proxyUsername: 'tunnel-user',
    proxyPassword: 'tunnel-pass',
  };

  function fakeTunnel() {
    const tunnel = {
      proxy: PROXY,
      openChannels: () => 0,
      close: vi.fn(() => Promise.resolve()),
    } satisfies SshTunnel;
    return tunnel;
  }

  function sshSetup(
    open: NonNullable<ConnectionManagerDeps['openTunnel']>,
    clients?: FakeClient[],
  ) {
    return setup({
      profiles: { p1: savedProfile('p1', { ssh: SSH }) },
      secrets: { p1: { password: STORED_PASSWORD, sshPassword: 'fictitious-ssh-Pw4' } },
      openTunnel: open,
      ...(clients ? { clients } : {}),
    });
  }

  it('opens the tunnel with the stored SSH secrets and closes it with the connection', async () => {
    const tunnel = fakeTunnel();
    const open = vi.fn(() => Promise.resolve(tunnel));
    const { manager, created } = sshSetup(open);
    await manager.open('p1', undefined);
    expect(open).toHaveBeenCalledWith(
      SSH,
      expect.objectContaining({ sshPassword: 'fictitious-ssh-Pw4' }),
      expect.anything(),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(created[0]?.options).toMatchObject(PROXY);
    expect(tunnel.close).not.toHaveBeenCalled();
    await manager.close('p1');
    expect(created[0]?.client.close).toHaveBeenCalled();
    expect(tunnel.close).toHaveBeenCalledTimes(1);
  });

  it('closes the tunnel when the driver cannot connect', async () => {
    const tunnel = fakeTunnel();
    const failing = fakeClient(() => Promise.reject(new Error('connect ECONNREFUSED')));
    const { manager } = sshSetup(() => Promise.resolve(tunnel), [failing]);
    await rejection(manager.open('p1', undefined));
    expect(tunnel.close).toHaveBeenCalledTimes(1);
  });

  it('an SSH failure leaves the connection in error without creating a client', async () => {
    const { manager, created } = sshSetup(() =>
      Promise.reject(new RpcError('SSH_ERROR', 'SSH authentication failed')),
    );
    expect((await rejection(manager.open('p1', undefined))).code).toBe('SSH_ERROR');
    expect(created).toEqual([]);
    expect(manager.statusOf('p1')).toMatchObject({ state: 'error', error: { code: 'SSH_ERROR' } });
  });

  it('close() while the tunnel opens aborts it and answers CANCELLED', async () => {
    let seen: AbortSignal | undefined;
    const { manager, created } = sshSetup((_ssh, _secrets, _env, options) => {
      seen = options?.signal;
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(new RpcError('CANCELLED', 'cancelled')),
        );
      });
    });
    const opening = manager.open('p1', undefined);
    await vi.waitFor(() => expect(seen).toBeDefined());
    await manager.close('p1');
    expect(seen?.aborted).toBe(true);
    expect((await rejection(opening)).code).toBe('CANCELLED');
    expect(created).toEqual([]);
    expect(manager.statusOf('p1').state).toBe('disconnected');
  });

  it('conn.test closes its tunnel after the test', async () => {
    const tunnel = fakeTunnel();
    const { manager } = sshSetup(() => Promise.resolve(tunnel));
    await manager.test({ profileId: 'p1' }, undefined);
    expect(tunnel.close).toHaveBeenCalledTimes(1);
  });

  it('conn.test closes its tunnel when the driver client cannot be created (CR-2)', async () => {
    const tunnel = fakeTunnel();
    const manager = new ConnectionManager({
      loadProfile: () => Promise.resolve(savedProfile('p1', { ssh: SSH })),
      loadSecrets: () =>
        Promise.resolve({ password: STORED_PASSWORD, sshPassword: 'fictitious-ssh-Pw4' }),
      createClient: () => {
        throw new Error('directConnection option requires exactly one host');
      },
      openTunnel: () => Promise.resolve(tunnel),
      ssh: {
        knownHosts: new KnownHosts('/nonexistent/known_hosts'),
        confirmHostKey: () => Promise.resolve(false),
      },
    });
    await expect(manager.test({ profileId: 'p1' }, undefined)).rejects.toThrow(/directConnection/);
    expect(tunnel.close).toHaveBeenCalledTimes(1);
  });

  it('a tunnel lost while connected → error state broadcast, client closed, next open rebuilds (CR-3)', async () => {
    const tunnels: ReturnType<typeof fakeTunnel>[] = [];
    const closedHooks: (() => void)[] = [];
    const statuses: ConnStatus[] = [];
    const created: FakeClient[] = [];
    const manager = new ConnectionManager({
      loadProfile: () => Promise.resolve(savedProfile('p1', { ssh: SSH })),
      loadSecrets: () => Promise.resolve({ password: STORED_PASSWORD }),
      createClient: () => {
        const client = fakeClient();
        created.push(client);
        return client;
      },
      openTunnel: (_ssh, _secrets, _env, options) => {
        const tunnel = fakeTunnel();
        tunnels.push(tunnel);
        if (options?.onClosed) closedHooks.push(options.onClosed);
        return Promise.resolve(tunnel);
      },
      onStatus: (status) => statuses.push(status),
      ssh: {
        knownHosts: new KnownHosts('/nonexistent/known_hosts'),
        confirmHostKey: () => Promise.resolve(false),
      },
    });
    await manager.open('p1', undefined);
    expect(closedHooks).toHaveLength(1);
    expect(statuses).toEqual([]);

    closedHooks[0]?.();
    await vi.waitFor(() => expect(created[0]?.close).toHaveBeenCalled());
    expect(manager.statusOf('p1')).toMatchObject({
      state: 'error',
      error: {
        code: 'SSH_ERROR',
        message: expect.stringMatching(/SSH tunnel was closed/) as unknown,
      },
    });
    expect(statuses).toEqual([manager.statusOf('p1')]);
    expect(() => manager.client('p1')).toThrow(RpcError);

    // Open again: a new tunnel and a new client, connected.
    expect((await manager.open('p1', undefined)).state).toBe('connected');
    expect(tunnels).toHaveLength(2);
    expect(created).toHaveLength(2);
    expect(manager.client('p1')).toBe(created[1]);
    // A late hook of the old tunnel changes nothing.
    closedHooks[0]?.();
    expect(manager.statusOf('p1').state).toBe('connected');
    await manager.close('p1');
    expect(tunnels[1]?.close).toHaveBeenCalledTimes(1);
  });

  it('refuses SSH together with a SOCKS5 proxy before opening a tunnel', async () => {
    const open = vi.fn(() => Promise.resolve(fakeTunnel()));
    const { manager } = setup({
      profiles: {
        p1: savedProfile('p1', { ssh: SSH, proxy: { host: 'proxy.example.test', port: 1080 } }),
      },
      openTunnel: open,
    });
    expect((await rejection(manager.open('p1', undefined))).code).toBe('INVALID_PARAMS');
    expect(open).not.toHaveBeenCalled();
  });

  it("the profile's connectTimeoutMS is the SSH handshake timeout; without it the tunnel's default applies", async () => {
    const open = vi.fn<NonNullable<ConnectionManagerDeps['openTunnel']>>(() =>
      Promise.resolve(fakeTunnel()),
    );
    const { manager } = setup({
      profiles: {
        timed: savedProfile('timed', { ssh: SSH, connectTimeoutMS: 7_500 }),
        plain: savedProfile('plain', { ssh: SSH }),
      },
      secrets: { timed: { password: STORED_PASSWORD }, plain: { password: STORED_PASSWORD } },
      openTunnel: open,
    });
    await manager.open('timed', undefined);
    await manager.open('plain', undefined);
    expect(open.mock.calls[0]?.[3]).toMatchObject({ readyTimeoutMS: 7_500 });
    expect(open.mock.calls[1]?.[3]).not.toHaveProperty('readyTimeoutMS');
  });
});

describe('ConnectionManager MONGODB-AWS through an SSH tunnel (task aws-auth, after ssh-tunnel)', () => {
  /** Fictitious values; none of them is a real credential. */
  const KEY_ID = 'AKIAFICTITIOUSKEY789';
  const AWS_SECRET = 'fictitious/aws+Secret+Key3';
  const AWS_TOKEN = 'fictitious-aws-session-Token2';
  const SSH = {
    host: 'bastion.example.test',
    port: 22,
    username: 'ops',
    method: 'password' as const,
  };
  const PROXY = {
    proxyHost: '127.0.0.1',
    proxyPort: 40777,
    proxyUsername: 'tunnel-user',
    proxyPassword: 'fictitious-tunnel-Pw6',
  };

  function awsSshProfile(id: string, auth: Partial<NonNullable<Profile['auth']>> = {}): Profile {
    return savedProfile(id, {
      connectionString: 'mongodb+srv://cluster0.example.test/?retryWrites=true',
      auth: { mechanism: 'MONGODB-AWS', username: KEY_ID, secretMode: 'saved', ...auth },
      ssh: SSH,
    });
  }

  function tunnelOpener() {
    const tunnel = {
      proxy: PROXY,
      openChannels: () => 0,
      close: vi.fn(() => Promise.resolve()),
    } satisfies SshTunnel;
    const open = vi.fn<NonNullable<ConnectionManagerDeps['openTunnel']>>(() =>
      Promise.resolve(tunnel),
    );
    return { tunnel, open };
  }

  it('open: the driver gets the tunnel proxy and the AWS credential provider together', async () => {
    const { tunnel, open } = tunnelOpener();
    const { manager, created } = setup({
      profiles: { p1: awsSshProfile('p1') },
      secrets: {
        p1: {
          awsSecretAccessKey: AWS_SECRET,
          awsSessionToken: AWS_TOKEN,
          sshPassword: 'fictitious-ssh-Pw5',
        },
      },
      openTunnel: open,
    });
    await expect(manager.open('p1', undefined)).resolves.toMatchObject({ state: 'connected' });
    expect(open).toHaveBeenCalledTimes(1);
    const options = created[0]?.options;
    expect(options).toMatchObject({
      ...PROXY,
      authMechanism: 'MONGODB-AWS',
      authSource: '$external',
    });
    expect(options?.auth).toBeUndefined();
    expect(await options?.authMechanismProperties?.AWS_CREDENTIAL_PROVIDER?.()).toEqual({
      accessKeyId: KEY_ID,
      secretAccessKey: AWS_SECRET,
      sessionToken: AWS_TOKEN,
    });
    await manager.close('p1');
    expect(tunnel.close).toHaveBeenCalledTimes(1);
  });

  it('open: a missing AWS secret after the tunnel opened is AUTH_FAILED and closes the tunnel', async () => {
    const { tunnel, open } = tunnelOpener();
    const { manager, created } = setup({
      profiles: { p1: awsSshProfile('p1') },
      secrets: { p1: { sshPassword: 'fictitious-ssh-Pw5' } },
      openTunnel: open,
    });
    const error = await rejection(manager.open('p1', undefined));
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).toContain(KEY_ID);
    expect(created).toEqual([]);
    expect(tunnel.close).toHaveBeenCalledTimes(1);
    expect(manager.statusOf('p1')).toMatchObject({
      state: 'error',
      error: { code: 'AUTH_FAILED' },
    });
  });

  it('test: a user name in the connection string is AUTH_FAILED and closes the tunnel', async () => {
    const { tunnel, open } = tunnelOpener();
    const profile = {
      ...awsSshProfile('p1'),
      connectionString: `mongodb://${KEY_ID}@db.example.test:27017/?authMechanism=MONGODB-AWS`,
    };
    const { manager, created } = setup({
      profiles: { p1: profile },
      secrets: { p1: { awsSecretAccessKey: AWS_SECRET } },
      openTunnel: open,
    });
    const error = await rejection(manager.test({ profileId: 'p1' }, undefined));
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).toContain('connection string');
    expect(created).toEqual([]);
    expect(tunnel.close).toHaveBeenCalledTimes(1);
  });

  it('test: a MongoAWSError through the tunnel is AUTH_FAILED, masked, and the tunnel is closed', async () => {
    const { tunnel, open } = tunnelOpener();
    const failing = fakeClient(() =>
      Promise.reject(
        Object.assign(new Error(`STS refused ${KEY_ID} / ${AWS_SECRET}`), {
          name: 'MongoAWSError',
        }),
      ),
    );
    const { manager, logs } = setup({
      profiles: { p1: awsSshProfile('p1') },
      secrets: { p1: { awsSecretAccessKey: AWS_SECRET } },
      openTunnel: open,
      clients: [failing],
    });
    const error = await rejection(manager.test({ profileId: 'p1' }, undefined));
    expect(error.code).toBe('AUTH_FAILED');
    for (const text of [error.message, ...logs]) expect(text).not.toContain(AWS_SECRET);
    expect(tunnel.close).toHaveBeenCalledTimes(1);
  });
});

describe('isOpenClient', () => {
  it('is true only for the client of the open connection of that profile', async () => {
    const { manager, created } = setup();
    await manager.open('p1', undefined);
    const client = created[0]?.client;
    expect(isOpenClient(manager, 'p1', client)).toBe(true);
    expect(isOpenClient(manager, 'p1', fakeClient())).toBe(false);
    expect(isOpenClient(manager, 'p2', client)).toBe(false);
    await manager.close('p1');
  });

  it('is false (does not throw) for a profile that was never opened', () => {
    const { manager } = setup();
    expect(isOpenClient(manager, 'p1', fakeClient())).toBe(false);
    expect(isOpenClient(manager, 'unknown', undefined)).toBe(false);
  });

  it('is false for a client after its connection was closed, and after a reopen', async () => {
    const { manager, created } = setup();
    await manager.open('p1', undefined);
    const first = created[0]?.client;
    await manager.close('p1');
    expect(isOpenClient(manager, 'p1', first)).toBe(false);
    await manager.open('p1', undefined);
    expect(isOpenClient(manager, 'p1', first)).toBe(false);
    expect(isOpenClient(manager, 'p1', created[1]?.client)).toBe(true);
    await manager.close('p1');
  });
});

describe('ConnectionManager.cancelOnClose', () => {
  it('close aborts the running work and waits for it before closing the client', async () => {
    const { manager, created } = setup();
    await manager.open('p1', undefined);
    const client = created[0]?.client as FakeClient;
    const order: string[] = [];
    client.close.mockImplementation(() => {
      order.push('client closed');
      return Promise.resolve();
    });
    const running = manager.cancelOnClose('p1', client, undefined, (signal) => {
      return new Promise<number>((_, reject) => {
        signal.addEventListener('abort', () => {
          // The cleanup (killOp) still has the open client.
          setTimeout(() => {
            order.push('work cleaned up');
            reject(new RpcError('CANCELLED', 'cancelled'));
          }, 10);
        });
      });
    });
    running.catch(() => undefined);
    await manager.close('p1');
    expect(order).toEqual(['work cleaned up', 'client closed']);
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('passes the caller signal through and returns the work result', async () => {
    const { manager, created } = setup();
    await manager.open('p1', undefined);
    const client = created[0]?.client as FakeClient;
    await expect(
      manager.cancelOnClose('p1', client, undefined, () => Promise.resolve(7)),
    ).resolves.toBe(7);
    const caller = new AbortController();
    let seen: AbortSignal | undefined;
    const running = manager.cancelOnClose('p1', client, caller.signal, (signal) => {
      seen = signal;
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    });
    caller.abort();
    await expect(running).rejects.toThrow('aborted');
    expect(seen?.aborted).toBe(true);
    // Finished work is not waited for by a later close.
    await manager.close('p1');
    expect(client.close).toHaveBeenCalledWith(true);
  });

  it('refuses work for a client that is not the open connection', async () => {
    const { manager, created } = setup();
    await manager.open('p1', undefined);
    const client = created[0]?.client as FakeClient;
    const work = vi.fn(() => Promise.resolve(1));
    const error = await rejection(manager.cancelOnClose('p2', client, undefined, work));
    expect(error).toMatchObject({ code: 'CANCELLED', message: 'The connection was closed' });
    await manager.close('p1');
    await rejection(manager.cancelOnClose('p1', client, undefined, work));
    expect(work).not.toHaveBeenCalled();
  });

  it('closes the client after the grace time when the work does not settle', async () => {
    vi.useFakeTimers();
    try {
      const { manager, created } = setup();
      await manager.open('p1', undefined);
      const client = created[0]?.client as FakeClient;
      void manager.cancelOnClose(
        'p1',
        client,
        undefined,
        () => new Promise<never>(() => undefined),
      );
      const closing = manager.close('p1');
      await vi.advanceTimersByTimeAsync(CLOSE_CANCEL_GRACE_MS - 1);
      expect(client.close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await closing;
      expect(client.close).toHaveBeenCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ConnectionManager.cancelOnClose (edge cases)', () => {
  /** A work whose cleanup after an abort finishes (rejects CANCELLED) only once `release` runs. */
  function slowCleanupWork(order: string[], label: string) {
    const cleanup = deferred();
    const work = (signal: AbortSignal) =>
      new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => {
          void cleanup.promise.then(() => {
            order.push(`${label} cleaned up`);
            reject(new RpcError('CANCELLED', 'The operation was cancelled'));
          });
        });
      });
    return { work, release: () => cleanup.resolve() };
  }

  /** Lets pending promise callbacks and short timers run. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('a work that throws synchronously rejects with its error and is not waited for by close', async () => {
    vi.useFakeTimers();
    try {
      const { manager, created } = setup();
      await manager.open('p1', undefined);
      const client = created[0]?.client as FakeClient;
      const boom = new Error('synchronous boom');
      const work = vi.fn((): Promise<never> => {
        throw boom;
      });
      await expect(manager.cancelOnClose('p1', client, undefined, work)).rejects.toBe(boom);
      expect(work).toHaveBeenCalledTimes(1);
      // No timer advanced: close does not wait for a grace time.
      await manager.close('p1');
      expect(client.close).toHaveBeenCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a caller signal that is already aborted gives the work an aborted signal', async () => {
    const { manager, created } = setup();
    await manager.open('p1', undefined);
    const client = created[0]?.client as FakeClient;
    const caller = new AbortController();
    caller.abort();
    let seen: boolean | undefined;
    await expect(
      manager.cancelOnClose('p1', client, caller.signal, (signal) => {
        seen = signal.aborted;
        return Promise.resolve('ran');
      }),
    ).resolves.toBe('ran');
    expect(seen).toBe(true);
    await manager.close('p1');
  });

  it('a caller abort after the work settled no longer reaches the work signal', async () => {
    const { manager, created } = setup();
    await manager.open('p1', undefined);
    const client = created[0]?.client as FakeClient;
    const caller = new AbortController();
    let seen: AbortSignal | undefined;
    await manager.cancelOnClose('p1', client, caller.signal, (signal) => {
      seen = signal;
      return Promise.resolve(1);
    });
    caller.abort();
    expect(seen?.aborted).toBe(false);
    await manager.close('p1');
  });

  it('close waits for a work the caller aborted already while its cleanup still runs', async () => {
    const { manager, created } = setup();
    await manager.open('p1', undefined);
    const client = created[0]?.client as FakeClient;
    const order: string[] = [];
    client.close.mockImplementation(() => {
      order.push('client closed');
      return Promise.resolve();
    });
    const caller = new AbortController();
    const slow = slowCleanupWork(order, 'work');
    const running = manager.cancelOnClose('p1', client, caller.signal, slow.work);
    running.catch(() => undefined);
    caller.abort();
    const closing = manager.close('p1');
    await settle();
    // The cleanup has not finished: the client is still open.
    expect(client.close).not.toHaveBeenCalled();
    slow.release();
    await closing;
    expect(order).toEqual(['work cleaned up', 'client closed']);
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('close cancels every running work of the profile and waits for all of them', async () => {
    const { manager, created } = setup();
    await manager.open('p1', undefined);
    const client = created[0]?.client as FakeClient;
    const order: string[] = [];
    client.close.mockImplementation(() => {
      order.push('client closed');
      return Promise.resolve();
    });
    const a = slowCleanupWork(order, 'a');
    const b = slowCleanupWork(order, 'b');
    const runA = manager.cancelOnClose('p1', client, undefined, a.work);
    const runB = manager.cancelOnClose('p1', client, undefined, b.work);
    runA.catch(() => undefined);
    runB.catch(() => undefined);
    const closing = manager.close('p1');
    b.release();
    await settle();
    expect(client.close).not.toHaveBeenCalled();
    a.release();
    await closing;
    expect(order).toEqual(['b cleaned up', 'a cleaned up', 'client closed']);
    await expect(runA).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(runB).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('closing one profile does not cancel the work of another', async () => {
    const { manager, created } = setup();
    await manager.open('p1', undefined);
    await manager.open('p2', undefined);
    const client2 = created[1]?.client as FakeClient;
    let aborted = false;
    const finish = deferred<string>();
    const running = manager.cancelOnClose('p2', client2, undefined, (signal) => {
      signal.addEventListener('abort', () => (aborted = true));
      return finish.promise;
    });
    await manager.close('p1');
    expect(aborted).toBe(false);
    expect(client2.close).not.toHaveBeenCalled();
    finish.resolve('done');
    await expect(running).resolves.toBe('done');
    await manager.close('p2');
  });

  it('closeAll cancels the running work before closing the clients', async () => {
    const { manager, created } = setup();
    await manager.open('p1', undefined);
    const client = created[0]?.client as FakeClient;
    const order: string[] = [];
    client.close.mockImplementation(() => {
      order.push('client closed');
      return Promise.resolve();
    });
    const slow = slowCleanupWork(order, 'work');
    const running = manager.cancelOnClose('p1', client, undefined, slow.work);
    running.catch(() => undefined);
    const closing = manager.closeAll();
    slow.release();
    await closing;
    expect(order).toEqual(['work cleaned up', 'client closed']);
  });

  it('refuses work while the profile is still connecting', async () => {
    const connecting = deferred();
    const client = fakeClient(() => connecting.promise);
    const { manager } = setup({ clients: [client] });
    const opening = manager.open('p1', undefined);
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    const work = vi.fn(() => Promise.resolve(1));
    const error = await rejection(manager.cancelOnClose('p1', client, undefined, work));
    expect(error).toMatchObject({ code: 'CANCELLED', message: 'The connection was closed' });
    expect(work).not.toHaveBeenCalled();
    connecting.resolve();
    await opening;
    await manager.close('p1');
  });

  it('a work that settles after the grace time still answers its own outcome', async () => {
    vi.useFakeTimers();
    try {
      const { manager, created } = setup();
      await manager.open('p1', undefined);
      const client = created[0]?.client as FakeClient;
      const late = deferred<never>();
      const running = manager.cancelOnClose('p1', client, undefined, () => late.promise);
      running.catch(() => undefined);
      const closing = manager.close('p1');
      await vi.advanceTimersByTimeAsync(CLOSE_CANCEL_GRACE_MS);
      await closing;
      expect(client.close).toHaveBeenCalledWith(true);
      late.reject(new Error('Topology is closed'));
      await expect(running).rejects.toThrow('Topology is closed');
      // The profile opens and closes again without waiting for the old work.
      await manager.open('p1', undefined);
      await manager.close('p1');
      expect(created[1]?.client.close).toHaveBeenCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ConnectionManager: MONGODB-OIDC (task oidc-auth)', () => {
  /** Fictitious token cache, as main's secrets.get returns the `oidcTokens` secret. */
  const STORED_TOKENS = '{"v":1,"issuer":"https://idp.example.test","fictitious":"oidc-cache-7"}';

  function oidcProfile(id: string, oidcFlow?: 'auto' | 'authCode' | 'deviceCode'): Profile {
    return savedProfile(id, {
      auth: { mechanism: 'MONGODB-OIDC', secretMode: 'none', ...(oidcFlow ? { oidcFlow } : {}) },
    });
  }

  /** A stand-in authenticator: records each target and hands out a distinct callback. */
  function fakeOidc() {
    const targets: OidcTarget[] = [];
    const callbacks: OIDCCallbackFunction[] = [];
    const callbackFor = vi.fn((target: OidcTarget) => {
      targets.push(target);
      const callback: OIDCCallbackFunction = () => Promise.resolve({ accessToken: 'x' });
      callbacks.push(callback);
      return callback;
    });
    const refused = vi.fn<(target: OidcTarget) => Promise<boolean>>(() => Promise.resolve(true));
    return {
      callbackFor,
      refused,
      targets,
      callbacks,
      oidc: { callbackFor, refused } as unknown as OidcAuthenticator,
    };
  }

  it('an OIDC profile without an authenticator is UNSUPPORTED (open and test), no client', async () => {
    const { manager, created } = setup({
      profiles: { p1: oidcProfile('p1') },
      secrets: { p1: null },
    });
    expect((await rejection(manager.open('p1', undefined))).code).toBe('UNSUPPORTED');
    expect((await rejection(manager.test({ profileId: 'p1' }, undefined))).code).toBe(
      'UNSUPPORTED',
    );
    expect(created).toEqual([]);
  });

  it('open passes profile id, name, flow, stored tokens and an abort signal to the callback', async () => {
    const fake = fakeOidc();
    const { manager, created } = setup({
      profiles: { p1: oidcProfile('p1', 'deviceCode') },
      secrets: { p1: { oidcTokens: STORED_TOKENS } },
      oidc: fake.oidc,
    });
    await manager.open('p1', undefined);
    expect(fake.targets).toEqual([
      {
        profileId: 'p1',
        profileName: 'Profile p1',
        flow: 'deviceCode',
        stored: STORED_TOKENS,
        signal: expect.any(AbortSignal) as AbortSignal,
      },
    ]);
    expect(created[0]?.options).toMatchObject({
      authMechanism: 'MONGODB-OIDC',
      authSource: '$external',
    });
    expect(created[0]?.options.authMechanismProperties?.OIDC_HUMAN_CALLBACK).toBe(
      fake.callbacks[0],
    );
    await manager.close('p1');
  });

  it('without a flow or stored tokens the target has neither', async () => {
    const fake = fakeOidc();
    const { manager } = setup({
      profiles: { p1: oidcProfile('p1') },
      secrets: { p1: null },
      oidc: fake.oidc,
    });
    await manager.open('p1', undefined);
    expect(fake.targets[0]).not.toHaveProperty('flow');
    expect(fake.targets[0]).not.toHaveProperty('stored');
    expect(fake.targets[0]).toMatchObject({ profileId: 'p1' });
    await manager.close('p1');
  });

  it('closing a connect in progress aborts the sign-in signal', async () => {
    const fake = fakeOidc();
    const gate = deferred();
    const client = fakeClient(() => gate.promise);
    const { manager } = setup({
      profiles: { p1: oidcProfile('p1') },
      secrets: { p1: null },
      clients: [client],
      oidc: fake.oidc,
    });
    const opening = manager.open('p1', undefined);
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    const signal = fake.targets[0]?.signal;
    expect(signal?.aborted).toBe(false);
    await manager.close('p1');
    expect(signal?.aborted).toBe(true);
    gate.resolve();
    expect((await rejection(opening)).code).toBe('CANCELLED');
  });

  it("test of a saved profile passes its id, stored tokens and the caller's signal", async () => {
    const fake = fakeOidc();
    const { manager } = setup({
      profiles: { p1: oidcProfile('p1') },
      secrets: { p1: { oidcTokens: STORED_TOKENS } },
      oidc: fake.oidc,
    });
    const abort = new AbortController();
    await manager.test({ profileId: 'p1' }, undefined, abort.signal);
    expect(fake.targets[0]).toMatchObject({ profileId: 'p1', stored: STORED_TOKENS });
    expect(fake.targets[0]?.signal).toBe(abort.signal);
  });

  it('test of an unsaved draft caches nothing: no profile id, no stored tokens, no signal', async () => {
    const fake = fakeOidc();
    const { manager, loadSecrets } = setup({ oidc: fake.oidc });
    const draft: ProfileDraft = { ...oidcProfile('p1'), name: 'Draft' };
    delete draft.id;
    await manager.test({ profile: draft }, undefined);
    expect(loadSecrets).not.toHaveBeenCalled();
    expect(fake.targets).toEqual([{ profileName: 'Draft' }]);
  });

  it('a draft equal to its saved profile gets that profile id and its stored tokens', async () => {
    const fake = fakeOidc();
    const { manager } = setup({
      profiles: { p1: oidcProfile('p1') },
      secrets: { p1: { oidcTokens: STORED_TOKENS } },
      oidc: fake.oidc,
    });
    await manager.test({ profile: { ...oidcProfile('p1'), name: 'Renamed' } }, undefined);
    expect(fake.targets[0]).toMatchObject({
      profileId: 'p1',
      profileName: 'Renamed',
      stored: STORED_TOKENS,
    });
  });

  it('a draft with an id but another connection string gets neither id nor tokens', async () => {
    const fake = fakeOidc();
    const { manager } = setup({
      profiles: { p1: oidcProfile('p1') },
      secrets: { p1: { oidcTokens: STORED_TOKENS } },
      oidc: fake.oidc,
    });
    await manager.test(
      { profile: { ...oidcProfile('p1'), connectionString: 'mongodb://other.example.test' } },
      undefined,
    );
    expect(fake.targets[0]).not.toHaveProperty('profileId');
    expect(fake.targets[0]).not.toHaveProperty('stored');
  });

  it('non-OIDC profiles never ask the authenticator', async () => {
    const fake = fakeOidc();
    const { manager } = setup({ oidc: fake.oidc });
    await manager.open('p1', undefined);
    await manager.test({ profileId: 'p2' }, undefined);
    expect(fake.callbackFor).not.toHaveBeenCalled();
    await manager.close('p1');
  });

  const authFailed = () =>
    Promise.reject(
      Object.assign(new Error('Authentication failed.'), { name: 'MongoServerError', code: 18 }),
    );

  it('an AUTH_FAILED open or test tells the authenticator, which forgets the refused tokens', async () => {
    const fake = fakeOidc();
    const { manager, logs } = setup({
      profiles: { p1: oidcProfile('p1') },
      secrets: { p1: { oidcTokens: STORED_TOKENS } },
      clients: [fakeClient(authFailed), fakeClient(authFailed)],
      oidc: fake.oidc,
    });
    expect((await rejection(manager.open('p1', undefined))).code).toBe('AUTH_FAILED');
    expect(fake.refused).toHaveBeenCalledTimes(1);
    expect(fake.refused).toHaveBeenLastCalledWith(fake.targets[0]);
    expect((await rejection(manager.test({ profileId: 'p1' }, undefined))).code).toBe(
      'AUTH_FAILED',
    );
    expect(fake.refused).toHaveBeenCalledTimes(2);
    expect(fake.refused).toHaveBeenLastCalledWith(fake.targets[1]);
    expect(logs.join('\n')).toContain('forgot the refused OIDC tokens');
    await manager.close('p1');
  });

  it('other connect failures keep the tokens', async () => {
    const fake = fakeOidc();
    const refusedConnect = () =>
      Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    const { manager } = setup({
      profiles: { p1: oidcProfile('p1') },
      secrets: { p1: { oidcTokens: STORED_TOKENS } },
      clients: [fakeClient(refusedConnect), fakeClient(refusedConnect)],
      oidc: fake.oidc,
    });
    expect((await rejection(manager.open('p1', undefined))).code).toBe('NETWORK_ERROR');
    expect((await rejection(manager.test({ profileId: 'p1' }, undefined))).code).toBe(
      'NETWORK_ERROR',
    );
    expect(fake.refused).not.toHaveBeenCalled();
    await manager.close('p1');
  });

  it('a failing forget is logged; the answer stays AUTH_FAILED', async () => {
    const fake = fakeOidc();
    fake.refused.mockRejectedValueOnce(new Error('keychain locked'));
    const { manager, logs } = setup({
      profiles: { p1: oidcProfile('p1') },
      secrets: { p1: { oidcTokens: STORED_TOKENS } },
      clients: [fakeClient(authFailed)],
      oidc: fake.oidc,
    });
    expect((await rejection(manager.open('p1', undefined))).code).toBe('AUTH_FAILED');
    expect(logs.join('\n')).toContain('cannot forget the refused OIDC tokens');
    await manager.close('p1');
  });

  it('the stored token cache never reaches the log lines', async () => {
    const fake = fakeOidc();
    const client = fakeClient(() => Promise.reject(new Error(`failed with ${STORED_TOKENS}`)));
    const { manager, logs } = setup({
      profiles: { p1: oidcProfile('p1') },
      secrets: { p1: { oidcTokens: STORED_TOKENS } },
      clients: [client],
      oidc: fake.oidc,
    });
    await rejection(manager.open('p1', undefined));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toContain('oidc-cache-7');
  });
});
