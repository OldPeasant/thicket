import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BaseAgent, utils, type ParsedKey } from 'ssh2';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  ConnectionManager,
  KnownHosts,
  RpcError,
  hostPattern,
  openSshTunnel,
  serve,
  startBackend,
  type ConnectionManagerDeps,
  type HostKeyQuestion,
  type MainPortLike,
  type ParentPortLike,
  type Port,
  type SshTunnel,
} from '@thicket/backend';
import {
  BROADCAST_STREAMS,
  privilegedMethods,
  type Event,
  type Profile,
  type Response,
} from '@thicket/contract';
import type { MongoClient } from 'mongodb';

import { portPair } from '../../packages/backend/src/server/testing';
import {
  SSH_PRIMARY,
  SSH_REPLICA_SET,
  SSH_SECONDARY,
  SSH_USER,
  startSshFixture,
  type SshFixture,
} from './fixtures/ssh.ts';

// SSH tunnels through an sshd container in front of a two-member replica set (task ssh-tunnel).
// The members' names resolve only on the SSH server, so every successful connect went through it.

let fx: SshFixture;
let dir: string;
let keyFile: string;
let encryptedKeyFile: string;
beforeAll(async () => {
  fx = await startSshFixture();
  dir = await mkdtemp(join(tmpdir(), 'thicket-ssh-'));
  keyFile = join(dir, 'id_plain');
  encryptedKeyFile = join(dir, 'id_encrypted');
  await writeFile(keyFile, fx.privateKey, { mode: 0o600 });
  await writeFile(encryptedKeyFile, fx.encryptedKey, { mode: 0o600 });
});
afterAll(async () => {
  await fx?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const managers: ConnectionManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.closeAll()));
});

let knownHostsCount = 0;
/** A fresh, empty known_hosts file per call. */
function freshKnownHosts(): KnownHosts {
  knownHostsCount += 1;
  return new KnownHosts(join(dir, `known_hosts_${String(knownHostsCount)}`));
}

type Ssh = NonNullable<Profile['ssh']>;

function tunnelled(id: string, ssh: Partial<Ssh> = {}, extra: Partial<Profile> = {}): Profile {
  return {
    id,
    name: `SSH ${id}`,
    connectionString: fx.uri,
    ssh: { host: fx.sshHost, port: fx.sshPort, username: SSH_USER, method: 'password', ...ssh },
    serverSelectionTimeoutMS: 15_000,
    readOnly: false,
    production: false,
    ...extra,
  };
}

interface SetupOptions {
  knownHosts?: KnownHosts;
  trust?: boolean;
  secrets?: Record<string, string>;
  agent?: BaseAgent;
}

function setup(profile: Profile, options: SetupOptions = {}) {
  const questions: HostKeyQuestion[] = [];
  const tunnels: SshTunnel[] = [];
  const knownHosts = options.knownHosts ?? freshKnownHosts();
  const deps: ConnectionManagerDeps = {
    loadProfile: (id) =>
      id === profile.id
        ? Promise.resolve(profile)
        : Promise.reject(new RpcError('NOT_FOUND', `No profile with id ${id}`)),
    loadSecrets: () => Promise.resolve(options.secrets ?? { sshPassword: fx.password }),
    ssh: {
      knownHosts,
      confirmHostKey: (question) => {
        questions.push(question);
        return Promise.resolve(options.trust ?? true);
      },
      ...(options.agent ? { agent: options.agent } : {}),
    },
    openTunnel: async (...args) => {
      const tunnel = await openSshTunnel(...args);
      tunnels.push(tunnel);
      return tunnel;
    },
  };
  const manager = new ConnectionManager(deps);
  managers.push(manager);
  return { manager, questions, tunnels, knownHosts };
}

async function failure(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw new Error(`expected an RpcError, got ${String(error)}`, { cause: error });
  }
  throw new Error('expected a failure');
}

/** The members the driver talks to, seen from a `hello` on the open connection. */
async function helloHosts(manager: ConnectionManager, id: string) {
  const hello = await manager.client(id).db('admin').command({ hello: 1 });
  // A priority 0 member is listed in `passives`.
  const members = [
    ...(hello['hosts'] as string[]),
    ...((hello['passives'] as string[] | undefined) ?? []),
  ];
  return { setName: hello['setName'] as string, hosts: members.sort() };
}

describe('SSH tunnel authentication', () => {
  it('password: unknown host key → question, trusted → connects to the replica set', async () => {
    const { manager, questions, knownHosts } = setup(tunnelled('pw'));
    await expect(manager.open('pw', undefined)).resolves.toMatchObject({ state: 'connected' });

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      host: fx.sshHost,
      port: fx.sshPort,
      keyType: expect.stringMatching(/^(ssh-|ecdsa-)/),
      fingerprint: expect.stringMatching(/^SHA256:[A-Za-z0-9+/]{43}$/),
    });
    const saved = await readFile(knownHosts.file, 'utf8');
    expect(saved).toContain(hostPattern(fx.sshHost, fx.sshPort));

    expect(await helloHosts(manager, 'pw')).toEqual({
      setName: SSH_REPLICA_SET,
      hosts: [SSH_PRIMARY, SSH_SECONDARY].sort(),
    });
    // The secondary is reached through its own forwarded channel.
    const client = manager.client('pw') as unknown as MongoClient;
    const fromSecondary = await client
      .db('admin')
      .command({ hello: 1 }, { readPreference: 'secondary' });
    expect(fromSecondary['me']).toBe(SSH_SECONDARY);
    const info = await manager.serverInfo('pw');
    expect(info.topology).toBe('replicaSet');
  });

  it('a host key in known_hosts is not asked about again', async () => {
    const knownHosts = freshKnownHosts();
    const first = setup(tunnelled('again1'), { knownHosts });
    await first.manager.open('again1', undefined);
    expect(first.questions).toHaveLength(1);
    const second = setup(tunnelled('again2'), { knownHosts });
    await expect(second.manager.open('again2', undefined)).resolves.toMatchObject({
      state: 'connected',
    });
    expect(second.questions).toEqual([]);
  });

  it('private key without passphrase', async () => {
    const { manager } = setup(tunnelled('key', { method: 'privateKey', privateKeyFile: keyFile }), {
      secrets: {},
    });
    await expect(manager.open('key', undefined)).resolves.toMatchObject({ state: 'connected' });
    expect((await helloHosts(manager, 'key')).setName).toBe(SSH_REPLICA_SET);
  });

  it('private key with passphrase (sshKeyPassphrase secret)', async () => {
    const { manager } = setup(
      tunnelled('enc', { method: 'privateKey', privateKeyFile: encryptedKeyFile }),
      { secrets: { sshKeyPassphrase: fx.passphrase } },
    );
    await expect(manager.open('enc', undefined)).resolves.toMatchObject({ state: 'connected' });
    expect((await helloHosts(manager, 'enc')).setName).toBe(SSH_REPLICA_SET);
  });

  it('an encrypted key without its passphrase → SSH_ERROR that says so', async () => {
    const { manager } = setup(
      tunnelled('nopass', { method: 'privateKey', privateKeyFile: encryptedKeyFile }),
      { secrets: {} },
    );
    const error = await failure(manager.open('nopass', undefined));
    expect(error.code).toBe('SSH_ERROR');
    expect(error.message).toMatch(/passphrase/);
  });

  it('a wrong passphrase → SSH_ERROR', async () => {
    const { manager } = setup(
      tunnelled('badpass', { method: 'privateKey', privateKeyFile: encryptedKeyFile }),
      { secrets: { sshKeyPassphrase: 'not-the-passphrase' } },
    );
    const error = await failure(manager.open('badpass', undefined));
    expect(error.code).toBe('SSH_ERROR');
    expect(error.message).not.toContain('not-the-passphrase');
  });

  it('a wrong password → SSH_ERROR authentication failed, password not in the message', async () => {
    const { manager } = setup(tunnelled('badpw'), {
      secrets: { sshPassword: 'fictitious-wrong-ssh-pw' },
    });
    const error = await failure(manager.open('badpw', undefined));
    expect(error.code).toBe('SSH_ERROR');
    expect(error.message).toMatch(/authentication failed/);
    expect(error.message).not.toContain('fictitious-wrong-ssh-pw');
    expect(manager.statusOf('badpw')).toMatchObject({ state: 'error' });
  });

  it('agent: signs with a key the agent holds', async () => {
    const parsed = utils.parseKey(fx.privateKey);
    if (parsed instanceof Error) throw parsed;
    const key = parsed;
    class TestAgent extends BaseAgent<ParsedKey> {
      getIdentities(cb: (err: Error | undefined, keys?: ParsedKey[]) => void): void {
        cb(undefined, [key]);
      }
      sign(
        _pubKey: ParsedKey,
        data: Buffer,
        options: { hash?: string } | ((err: Error | undefined, sig?: Buffer) => void),
        cb?: (err: Error | undefined, sig?: Buffer) => void,
      ): void {
        const done = typeof options === 'function' ? options : cb;
        const hash = typeof options === 'function' ? undefined : options.hash;
        const signature = key.sign(data, hash);
        if (signature instanceof Error) done?.(signature);
        else done?.(undefined, signature);
      }
    }
    const { manager } = setup(tunnelled('agent', { method: 'agent' }), {
      secrets: {},
      agent: new TestAgent(),
    });
    await expect(manager.open('agent', undefined)).resolves.toMatchObject({ state: 'connected' });
  });

  it('conn.test through the tunnel reports the replica set and closes the tunnel', async () => {
    const { manager, tunnels } = setup(tunnelled('test'));
    const result = await manager.test({ profileId: 'test' }, undefined);
    expect(result.server.topology).toBe('replicaSet');
    expect(tunnels).toHaveLength(1);
    expect(tunnels[0]?.openChannels()).toBe(0);
    await expect(portIsClosed(tunnels[0]?.proxy.proxyPort ?? 0)).resolves.toBe(true);
  });
});

describe('SSH host keys', () => {
  it('a rejected unknown host key → SSH_ERROR, nothing saved', async () => {
    const { manager, questions, knownHosts } = setup(tunnelled('reject'), { trust: false });
    const error = await failure(manager.open('reject', undefined));
    expect(error.code).toBe('SSH_ERROR');
    expect(error.message).toMatch(/not trusted/);
    expect(questions).toHaveLength(1);
    await expect(readFile(knownHosts.file, 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it('a changed host key → refused with a clear error, without asking', async () => {
    const knownHosts = freshKnownHosts();
    const other = utils.generateKeyPairSync('ed25519').public.split(' ')[1] ?? '';
    // The same host with another key of each type the server might offer.
    const rsa = utils.generateKeyPairSync('ecdsa', { bits: 256 }).public.split(' ');
    await writeFile(
      knownHosts.file,
      `${hostPattern(fx.sshHost, fx.sshPort)} ssh-ed25519 ${other}\n` +
        `${hostPattern(fx.sshHost, fx.sshPort)} ${rsa[0] ?? ''} ${rsa[1] ?? ''}\n`,
    );
    const { manager, questions } = setup(tunnelled('changed'), { knownHosts });
    const error = await failure(manager.open('changed', undefined));
    expect(error.code).toBe('SSH_ERROR');
    expect(error.message).toMatch(/host key of .* has changed/);
    expect(error.message).toContain(knownHosts.file);
    expect(error.detail).toMatchObject({ reason: 'hostKeyChanged' });
    expect(questions).toEqual([]);
  });
});

describe('SSH tunnel lifetime', () => {
  it('closing the connection closes the tunnel: no SSH session, no member connection left', async () => {
    // Earlier tests closed their connections: nothing may be left over from them either.
    await vi.waitFor(
      async () => {
        expect(await fx.sshConnections()).toBe(0);
        expect(await fx.mongoConnections('primary')).toBe(0);
        expect(await fx.mongoConnections('secondary')).toBe(0);
      },
      { timeout: 15_000, interval: 250 },
    );

    const { manager, tunnels } = setup(tunnelled('life'));
    await manager.open('life', undefined);
    await helloHosts(manager, 'life');
    expect(await fx.sshConnections()).toBe(1);
    expect(tunnels[0]?.openChannels()).toBeGreaterThan(0);
    // Both members are reached through the tunnel (monitoring + pooled connections).
    await vi.waitFor(
      async () => {
        expect(await fx.mongoConnections('primary')).toBeGreaterThan(0);
        expect(await fx.mongoConnections('secondary')).toBeGreaterThan(0);
      },
      { timeout: 15_000, interval: 250 },
    );

    await manager.close('life');
    expect(tunnels[0]?.openChannels()).toBe(0);
    await expect(portIsClosed(tunnels[0]?.proxy.proxyPort ?? 0)).resolves.toBe(true);
    await vi.waitFor(
      async () => {
        expect(await fx.sshConnections()).toBe(0);
        expect(await fx.mongoConnections('primary')).toBe(0);
        expect(await fx.mongoConnections('secondary')).toBe(0);
      },
      { timeout: 15_000, interval: 250 },
    );
  });

  it('a failed driver connect closes its tunnel too', async () => {
    const sshBefore = await fx.sshConnections();
    // A replica set name the members don't have: the driver finds no suitable server.
    const { manager, tunnels } = setup(
      tunnelled(
        'wrongset',
        {},
        {
          connectionString: `mongodb://${SSH_PRIMARY}/?replicaSet=nope`,
          serverSelectionTimeoutMS: 2_000,
        },
      ),
    );
    await failure(manager.open('wrongset', undefined));
    expect(tunnels).toHaveLength(1);
    await expect(portIsClosed(tunnels[0]?.proxy.proxyPort ?? 0)).resolves.toBe(true);
    await vi.waitFor(async () => expect(await fx.sshConnections()).toBe(sshBefore), {
      timeout: 10_000,
      interval: 250,
    });
  });
});

describe('SSH tunnel lost while connected (backend, CR-3)', () => {
  it('a dropped SSH session → conn.status error broadcast, tunnel port closed; open again reconnects', async () => {
    const userData = await mkdtemp(join(dir, 'userdata-lost-'));
    const profile = tunnelled('lost');
    let deliver: ((e: { data: unknown; ports: MainPortLike[] }) => void) | undefined;
    const parentPort: ParentPortLike = {
      on: (_event, listener) => {
        deliver = listener;
      },
    };
    startBackend({ parentPort, pid: 1, userData });
    const [mainEnd, backendPrivileged] = portPair();
    const stopMain = serve(mainEnd, {
      table: privilegedMethods,
      route: 'main',
      handlers: {
        'profiles.forConnect': () => ({ profile }),
        'secrets.get': () => ({ secrets: { sshPassword: fx.password } }),
      },
    });
    deliver?.({ data: { type: 'privileged' }, ports: [mainPort(backendPrivileged)] });
    const [renderer, backendRenderer] = portPair();
    deliver?.({ data: { type: 'renderer', window: 1 }, ports: [mainPort(backendRenderer)] });
    const messages: unknown[] = [];
    renderer.onMessage((message) => messages.push(message));
    const response = (id: string) => messages.find((m) => (m as Response).id === id) as Response;
    const answered = (id: string, timeout = 30_000) =>
      vi.waitFor(
        () => {
          expect(response(id)).toBeDefined();
          return response(id);
        },
        { timeout },
      );
    const statuses = () =>
      messages
        .filter((m) => (m as Event).stream === BROADCAST_STREAMS.connStatus)
        .map((m) => (m as Event).payload as { profileId: string; state: string; error?: unknown });
    const sshBefore = await fx.sshConnections();
    try {
      // First open: trust the unknown host key, so known_hosts in userData holds it.
      renderer.send({ id: 'open1', method: 'conn.open', params: { profileId: 'lost' } });
      const prompt = await vi.waitFor(
        () => {
          const event = messages.find(
            (m) => (m as Event).stream === BROADCAST_STREAMS.sshHostKey,
          ) as Event | undefined;
          expect(event).toBeDefined();
          return event?.payload as { promptId: string };
        },
        { timeout: 15_000 },
      );
      renderer.send({
        id: 'trust',
        method: 'conn.trustHostKey',
        params: { promptId: prompt.promptId, trust: true },
      });
      expect(await answered('open1')).toMatchObject({ ok: true, result: { state: 'connected' } });
      expect(await fx.sshConnections()).toBe(sshBefore + 1);
      expect(statuses()).toEqual([]);

      await fx.dropSshSessions();

      const lost = await vi.waitFor(
        () => {
          const status = statuses().find((s) => s.profileId === 'lost');
          expect(status).toBeDefined();
          return status;
        },
        { timeout: 15_000, interval: 100 },
      );
      expect(lost).toMatchObject({
        profileId: 'lost',
        state: 'error',
        error: { code: 'SSH_ERROR', message: expect.stringMatching(/SSH tunnel was closed/) },
      });
      renderer.send({ id: 'list', method: 'conn.status', params: { profileId: 'lost' } });
      expect(await answered('list')).toMatchObject({
        ok: true,
        result: { connections: [{ profileId: 'lost', state: 'error' }] },
      });

      // Open again: a new tunnel and client, no new host key question (the key is known now).
      renderer.send({ id: 'open2', method: 'conn.open', params: { profileId: 'lost' } });
      expect(await answered('open2')).toMatchObject({ ok: true, result: { state: 'connected' } });
      expect(
        messages.filter((m) => (m as Event).stream === BROADCAST_STREAMS.sshHostKey),
      ).toHaveLength(1);
      renderer.send({ id: 'info', method: 'conn.serverInfo', params: { profileId: 'lost' } });
      expect(await answered('info')).toMatchObject({
        ok: true,
        result: { topology: 'replicaSet' },
      });
      expect(await fx.sshConnections()).toBe(sshBefore + 1);
    } finally {
      renderer.send({ id: 'close', method: 'conn.close', params: { profileId: 'lost' } });
      await answered('close');
      stopMain();
    }
    await vi.waitFor(async () => expect(await fx.sshConnections()).toBe(sshBefore), {
      timeout: 15_000,
      interval: 250,
    });
  });
});

/** True when nothing listens on 127.0.0.1:`port` any more. */
function portIsClosed(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });
}

// --- The real backend: `ssh.hostKey` broadcast to the renderer, answered with conn.trustHostKey.

function mainPort(port: Port): MainPortLike {
  const listeners = new Map<unknown, () => void>();
  return {
    postMessage: (message) => port.send(message),
    on(event: 'message' | 'close', listener: ((e: { data: unknown }) => void) | (() => void)) {
      if (event === 'message') {
        listeners.set(
          listener,
          port.onMessage((data) => (listener as (e: { data: unknown }) => void)({ data })),
        );
      }
      return this;
    },
    off(_event: 'message', listener: unknown) {
      listeners.get(listener)?.();
      return this;
    },
    start: () => undefined,
    close: () => port.close(),
  };
}

describe('backend: host key prompt over the renderer port', () => {
  it('unknown host key → ssh.hostKey event, conn.trustHostKey → connects; known_hosts in userData', async () => {
    const userData = await mkdtemp(join(dir, 'userdata-'));
    const profile = tunnelled('backend');
    let deliver: ((e: { data: unknown; ports: MainPortLike[] }) => void) | undefined;
    const parentPort: ParentPortLike = {
      on: (_event, listener) => {
        deliver = listener;
      },
    };
    startBackend({ parentPort, pid: 1, userData });

    const [mainEnd, backendPrivileged] = portPair();
    const stopMain = serve(mainEnd, {
      table: privilegedMethods,
      route: 'main',
      handlers: {
        'profiles.forConnect': () => ({ profile }),
        'secrets.get': () => ({ secrets: { sshPassword: fx.password } }),
      },
    });
    deliver?.({ data: { type: 'privileged' }, ports: [mainPort(backendPrivileged)] });
    const [renderer, backendRenderer] = portPair();
    deliver?.({ data: { type: 'renderer', window: 1 }, ports: [mainPort(backendRenderer)] });

    const messages: unknown[] = [];
    renderer.onMessage((message) => messages.push(message));
    const response = (id: string) => messages.find((m) => (m as Response).id === id) as Response;
    try {
      renderer.send({ id: 'open', method: 'conn.open', params: { profileId: 'backend' } });
      const prompt = await vi.waitFor(
        () => {
          const event = messages.find(
            (m) => (m as Event).stream === BROADCAST_STREAMS.sshHostKey,
          ) as Event | undefined;
          expect(event).toBeDefined();
          return event?.payload as { promptId: string; host: string; fingerprint: string };
        },
        { timeout: 15_000 },
      );
      expect(prompt).toMatchObject({ host: fx.sshHost, port: fx.sshPort });
      expect(response('open')).toBeUndefined();

      renderer.send({
        id: 'trust',
        method: 'conn.trustHostKey',
        params: { promptId: prompt.promptId, trust: true },
      });
      await vi.waitFor(() => expect(response('open')).toBeDefined(), { timeout: 30_000 });
      expect(response('trust')).toMatchObject({ ok: true });
      expect(response('open')).toMatchObject({ ok: true, result: { state: 'connected' } });
      expect(await readFile(join(userData, 'known_hosts'), 'utf8')).toContain(
        hostPattern(fx.sshHost, fx.sshPort),
      );

      // Answering again: the question is over.
      renderer.send({
        id: 'again',
        method: 'conn.trustHostKey',
        params: { promptId: prompt.promptId, trust: true },
      });
      await vi.waitFor(() => expect(response('again')).toBeDefined());
      expect(response('again')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    } finally {
      renderer.send({ id: 'close', method: 'conn.close', params: { profileId: 'backend' } });
      await vi.waitFor(() => expect(response('close')).toBeDefined());
      stopMain();
    }
  });
});
