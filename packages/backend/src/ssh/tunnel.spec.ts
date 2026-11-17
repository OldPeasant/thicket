import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import {
  connect,
  createServer,
  type AddressInfo,
  type Server as NetServer,
  Socket,
} from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SocksClient } from 'socks';
import { Server, utils, type Connection } from 'ssh2';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { RpcError } from '../server/rpc';
import { describeHostKey, hostPattern, KnownHosts } from './known-hosts';
import {
  openSshTunnel,
  toSshError,
  type HostKeyQuestion,
  type SshEnvironment,
  type SshSettings,
  type SshTunnel,
} from './tunnel';

// openSshTunnel against an in-process ssh2 server on 127.0.0.1 (no Docker, no network).

const USER = 'tunnel-tester';
const PASSWORD = 'fictitious-ssh-Pw1';
const PASSPHRASE = 'fictitious-key-passphrase';

const hostKey = utils.generateKeyPairSync('ed25519');
const otherHostKey = utils.generateKeyPairSync('ed25519');
const userKey = utils.generateKeyPairSync('ed25519');
const encryptedUserKey = utils.generateKeyPairSync('ed25519', {
  passphrase: PASSPHRASE,
  cipher: 'aes256-ctr',
  rounds: 16,
});

/** The wire-format public key of an OpenSSH `type base64 comment` line. */
function wire(publicLine: string): Buffer {
  return Buffer.from(publicLine.split(' ')[1] ?? '', 'base64');
}

interface SshServerOptions {
  /** Refuse direct-tcpip channels. */
  refuseForwarding?: boolean;
  /** Close every client right after authentication. */
  dropAfterReady?: boolean;
  /** Delay before dropping (0: synchronously in the server's `ready`). */
  dropDelayMS?: number;
  hostKeyPrivate?: string;
}

interface SshServerFixture {
  port: number;
  /** Server-side client connections still open. */
  clients: Set<Connection>;
  forwards: { destIP: string; destPort: number }[];
  close(): Promise<void>;
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function listen(server: NetServer): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

async function startSshServer(options: SshServerOptions = {}): Promise<SshServerFixture> {
  const clients = new Set<Connection>();
  const forwards: { destIP: string; destPort: number }[] = [];
  const allowed = [wire(userKey.public), wire(encryptedUserKey.public)];
  const server = new Server({ hostKeys: [options.hostKeyPrivate ?? hostKey.private] }, (conn) => {
    clients.add(conn);
    conn.on('close', () => clients.delete(conn));
    conn.on('error', () => undefined);
    conn.on('authentication', (ctx) => {
      if (ctx.username !== USER) return ctx.reject();
      if (ctx.method === 'password') {
        return ctx.password === PASSWORD ? ctx.accept() : ctx.reject();
      }
      if (ctx.method === 'publickey') {
        if (!allowed.some((key) => key.equals(ctx.key.data))) return ctx.reject();
        if (!ctx.signature || !ctx.blob) return ctx.accept();
        const publicKey = [userKey, encryptedUserKey]
          .map((pair) => utils.parseKey(pair.public))
          .find(
            (parsed) => !(parsed instanceof Error) && parsed.getPublicSSH().equals(ctx.key.data),
          );
        if (!publicKey || publicKey instanceof Error) return ctx.reject();
        return publicKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true
          ? ctx.accept()
          : ctx.reject();
      }
      return ctx.reject(['password', 'publickey']);
    });
    conn.on('ready', () => {
      if (options.dropAfterReady) {
        if (options.dropDelayMS === 0) conn.end();
        else setTimeout(() => conn.end(), options.dropDelayMS ?? 20);
        return;
      }
      conn.on('tcpip', (accept, reject, info) => {
        forwards.push({ destIP: info.destIP, destPort: info.destPort });
        if (options.refuseForwarding) {
          reject();
          return;
        }
        const upstream = createConnectionTo(info.destIP, info.destPort);
        upstream.once('connect', () => {
          const channel = accept();
          channel.pipe(upstream).pipe(channel);
          channel.on('close', () => upstream.destroy());
          upstream.on('close', () => channel.close());
        });
        upstream.once('error', () => reject());
      });
    });
  });
  const port = await listen(server);
  const fixture: SshServerFixture = {
    port,
    clients,
    forwards,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of clients) client.end();
        server.close(() => resolve());
      }),
  };
  cleanups.push(() => fixture.close());
  return fixture;
}

function createConnectionTo(host: string, port: number): Socket {
  return connect(port, host);
}

/** A TCP echo server on 127.0.0.1 (the "mongod" behind the SSH server). */
async function startEcho(): Promise<{ port: number; sockets: Set<Socket> }> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.pipe(socket);
  });
  const port = await listen(server);
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  );
  return { port, sockets };
}

let dir: string;
let keyFile: string;
let encryptedKeyFile: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'thicket-tunnel-'));
  keyFile = join(dir, 'id_plain');
  encryptedKeyFile = join(dir, 'id_encrypted');
  await writeFile(keyFile, userKey.private, { mode: 0o600 });
  await writeFile(encryptedKeyFile, encryptedUserKey.private, { mode: 0o600 });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

let fileCount = 0;
function freshKnownHosts(): KnownHosts {
  fileCount += 1;
  return new KnownHosts(join(dir, `known_hosts_${String(fileCount)}`));
}

function settings(port: number, extra: Partial<SshSettings> = {}): SshSettings {
  return { host: '127.0.0.1', port, username: USER, method: 'password', ...extra };
}

function environment(
  knownHosts: KnownHosts,
  confirm: (q: HostKeyQuestion, s: AbortSignal) => Promise<boolean> = () => Promise.resolve(true),
  extra: Partial<SshEnvironment> = {},
) {
  const questions: HostKeyQuestion[] = [];
  const log = vi.fn<(message: string) => void>();
  const env: SshEnvironment = {
    knownHosts,
    confirmHostKey: (question, signal) => {
      questions.push(question);
      return confirm(question, signal);
    },
    log,
    ...extra,
  };
  return { env, questions, log };
}

async function open(...args: Parameters<typeof openSshTunnel>): Promise<SshTunnel> {
  const tunnel = await openSshTunnel(...args);
  cleanups.push(() => tunnel.close());
  return tunnel;
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

/** Opens a socket through the tunnel's SOCKS port to 127.0.0.1:`port`. */
async function through(tunnel: SshTunnel, port: number): Promise<Socket> {
  const { socket } = await SocksClient.createConnection({
    command: 'connect',
    proxy: {
      host: tunnel.proxy.proxyHost,
      port: tunnel.proxy.proxyPort,
      type: 5,
      userId: tunnel.proxy.proxyUsername,
      password: tunnel.proxy.proxyPassword,
    },
    destination: { host: '127.0.0.1', port },
    timeout: 5_000,
  });
  cleanups.push(() => void socket.destroy());
  return socket;
}

async function echo(socket: Socket, text: string): Promise<string> {
  return new Promise((resolve) => {
    socket.once('data', (data: Buffer) => resolve(data.toString()));
    socket.write(text);
  });
}

function portIsClosed(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnectionTo('127.0.0.1', port);
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });
}

describe('openSshTunnel: host keys', () => {
  it('unknown host key → question with type and fingerprint; trusted → saved, connects', async () => {
    const ssh = await startSshServer();
    const knownHosts = freshKnownHosts();
    const { env, questions, log } = environment(knownHosts);
    const tunnel = await open(settings(ssh.port), { sshPassword: PASSWORD }, env);
    expect(questions).toEqual([
      { host: '127.0.0.1', port: ssh.port, ...describeHostKey(wire(hostKey.public)) },
    ]);
    expect(questions[0]?.keyType).toBe('ssh-ed25519');
    expect(await readFile(knownHosts.file, 'utf8')).toBe(
      `${hostPattern('127.0.0.1', ssh.port)} ssh-ed25519 ${wire(hostKey.public).toString('base64')}\n`,
    );
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/trusted host key ssh-ed25519 SHA256:/));
    expect(tunnel.proxy.proxyHost).toBe('127.0.0.1');
    expect(tunnel.openChannels()).toBe(0);

    // Known now: the next connect does not ask again.
    const again = environment(knownHosts);
    await open(settings(ssh.port), { sshPassword: PASSWORD }, again.env);
    expect(again.questions).toEqual([]);
  });

  it('a rejected host key → SSH_ERROR hostKeyRejected, nothing saved, no session left', async () => {
    const ssh = await startSshServer();
    const knownHosts = freshKnownHosts();
    const { env } = environment(knownHosts, () => Promise.resolve(false));
    const error = await failure(openSshTunnel(settings(ssh.port), { sshPassword: PASSWORD }, env));
    expect(error.code).toBe('SSH_ERROR');
    expect(error.message).toMatch(/was not trusted/);
    expect(error.detail).toMatchObject({ reason: 'hostKeyRejected', keyType: 'ssh-ed25519' });
    await expect(readFile(knownHosts.file)).rejects.toMatchObject({ code: 'ENOENT' });
    await vi.waitFor(() => expect(ssh.clients.size).toBe(0));
  });

  it('a changed host key → refused without asking, with a clear error naming known_hosts', async () => {
    const ssh = await startSshServer();
    const knownHosts = freshKnownHosts();
    await writeFile(
      knownHosts.file,
      `${hostPattern('127.0.0.1', ssh.port)} ssh-ed25519 ${wire(otherHostKey.public).toString('base64')}\n`,
    );
    const { env, questions } = environment(knownHosts);
    const error = await failure(openSshTunnel(settings(ssh.port), { sshPassword: PASSWORD }, env));
    expect(questions).toEqual([]);
    expect(error.code).toBe('SSH_ERROR');
    expect(error.message).toMatch(/has changed/);
    expect(error.message).toContain(knownHosts.file);
    expect(error.message).toContain(describeHostKey(wire(hostKey.public)).fingerprint);
    expect(error.detail).toMatchObject({ reason: 'hostKeyChanged', port: ssh.port });
  });

  it('an unreadable known_hosts → SSH_ERROR "Cannot check the SSH host key"', async () => {
    const ssh = await startSshServer();
    const folder = join(dir, `known_hosts_dir_${String(++fileCount)}`);
    await mkdir(folder);
    const { env, questions } = environment(new KnownHosts(folder));
    const error = await failure(openSshTunnel(settings(ssh.port), { sshPassword: PASSWORD }, env));
    expect(error.code).toBe('SSH_ERROR');
    expect(error.message).toMatch(/^Cannot check the SSH host key of 127\.0\.0\.1:\d+: .*EISDIR/);
    expect(questions).toEqual([]);
  });

  it('the handshake timeout is paused while the user decides', async () => {
    const ssh = await startSshServer();
    const { env } = environment(
      freshKnownHosts(),
      () => new Promise((resolve) => setTimeout(() => resolve(true), 600)),
    );
    const tunnel = await open(settings(ssh.port), { sshPassword: PASSWORD }, env, {
      readyTimeoutMS: 300,
    });
    expect(tunnel.proxy.proxyPort).toBeGreaterThan(0);
  });

  it('the server closing while the user is asked → question aborted, clear error, a late "trust" saves nothing (CR-5)', async () => {
    const ssh = await startSshServer();
    // A TCP relay in front of the SSH server, so the test can drop the connection mid-handshake.
    const relayed = new Set<Socket>();
    const relay = createServer((socket) => {
      relayed.add(socket);
      socket.on('error', () => undefined);
      const upstream = connect(ssh.port, '127.0.0.1');
      upstream.on('error', () => undefined);
      socket.pipe(upstream).pipe(socket);
      socket.on('close', () => upstream.destroy());
    });
    const relayPort = await listen(relay);
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          for (const socket of relayed) socket.destroy();
          relay.close(() => resolve());
        }),
    );
    const knownHosts = freshKnownHosts();
    let questionSignal: AbortSignal | undefined;
    const { env } = environment(knownHosts, (_q, signal) => {
      questionSignal = signal;
      // The server goes away while the user decides; the user then answers "trust" anyway.
      for (const socket of relayed) socket.destroy();
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => setTimeout(() => resolve(true), 50));
      });
    });
    const error = await failure(openSshTunnel(settings(relayPort), { sshPassword: PASSWORD }, env));
    expect(error.code).toBe('SSH_ERROR');
    expect(error.message).toMatch(/closed the connection while waiting for the answer/);
    expect(questionSignal?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(readFile(knownHosts.file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('closing (abort) while the user is asked → CANCELLED and the question is aborted', async () => {
    const ssh = await startSshServer();
    const controller = new AbortController();
    let questionSignal: AbortSignal | undefined;
    const { env } = environment(freshKnownHosts(), (_q, signal) => {
      questionSignal = signal;
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve(false));
      });
    });
    const opening = openSshTunnel(settings(ssh.port), { sshPassword: PASSWORD }, env, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(questionSignal).toBeDefined());
    controller.abort();
    const error = await failure(opening);
    expect(error.code).toBe('CANCELLED');
    expect(questionSignal?.aborted).toBe(true);
    await vi.waitFor(() => expect(ssh.clients.size).toBe(0));
  });
});

describe('openSshTunnel: authentication', () => {
  it('a wrong password → SSH_ERROR authentication, password not in the message', async () => {
    const ssh = await startSshServer();
    const { env } = environment(freshKnownHosts());
    const error = await failure(
      openSshTunnel(settings(ssh.port), { sshPassword: 'wrong-fictitious-Pw' }, env),
    );
    expect(error.code).toBe('SSH_ERROR');
    expect(error.detail).toMatchObject({ reason: 'authentication' });
    expect(error.message).toBe(
      `SSH authentication failed for ${USER}@127.0.0.1:${String(ssh.port)} (method password)`,
    );
    expect(JSON.stringify(error)).not.toContain('wrong-fictitious-Pw');
  });

  it('password method without a saved SSH password fails before connecting', async () => {
    const ssh = await startSshServer();
    const { env, questions } = environment(freshKnownHosts());
    const error = await failure(openSshTunnel(settings(ssh.port), {}, env));
    expect(error).toMatchObject({ code: 'SSH_ERROR', detail: { reason: 'authentication' } });
    expect(error.message).toMatch(/^No SSH password for tunnel-tester@127\.0\.0\.1/);
    expect(questions).toEqual([]);
    expect(ssh.clients.size).toBe(0);
  });

  it('private key without passphrase', async () => {
    const ssh = await startSshServer();
    const { env } = environment(freshKnownHosts());
    const tunnel = await open(
      settings(ssh.port, { method: 'privateKey', privateKeyFile: keyFile }),
      {},
      env,
    );
    expect(tunnel.proxy.proxyPort).toBeGreaterThan(0);
  });

  it('private key with its passphrase (sshKeyPassphrase)', async () => {
    const ssh = await startSshServer();
    const { env } = environment(freshKnownHosts());
    const tunnel = await open(
      settings(ssh.port, { method: 'privateKey', privateKeyFile: encryptedKeyFile }),
      { sshKeyPassphrase: PASSPHRASE },
      env,
    );
    expect(tunnel.proxy.proxyPort).toBeGreaterThan(0);
  });

  it('an encrypted key without passphrase → asks to save the passphrase', async () => {
    const ssh = await startSshServer();
    const { env } = environment(freshKnownHosts());
    const error = await failure(
      openSshTunnel(
        settings(ssh.port, { method: 'privateKey', privateKeyFile: encryptedKeyFile }),
        {},
        env,
      ),
    );
    expect(error).toMatchObject({ code: 'SSH_ERROR', detail: { reason: 'authentication' } });
    expect(error.message).toBe(
      'The SSH private key is encrypted: save its passphrase in the profile',
    );
  });

  it('a wrong passphrase → SSH_ERROR authentication, passphrase not in the message', async () => {
    const ssh = await startSshServer();
    const { env } = environment(freshKnownHosts());
    const error = await failure(
      openSshTunnel(
        settings(ssh.port, { method: 'privateKey', privateKeyFile: encryptedKeyFile }),
        { sshKeyPassphrase: 'wrong-fictitious-passphrase' },
        env,
      ),
    );
    expect(error).toMatchObject({ code: 'SSH_ERROR', detail: { reason: 'authentication' } });
    expect(error.message).toMatch(/^Cannot use the SSH private key/);
    expect(error.message).not.toContain('wrong-fictitious-passphrase');
  });

  it('privateKey without a key file, or an unreadable one → SSH_ERROR authentication', async () => {
    const { env } = environment(freshKnownHosts());
    const none = await failure(openSshTunnel(settings(1, { method: 'privateKey' }), {}, env));
    expect(none).toMatchObject({ code: 'SSH_ERROR', detail: { reason: 'authentication' } });
    expect(none.message).toMatch(/^No SSH private key file chosen/);

    const missing = join(dir, 'no-such-key');
    const unreadable = await failure(
      openSshTunnel(settings(1, { method: 'privateKey', privateKeyFile: missing }), {}, env),
    );
    expect(unreadable.message).toBe(`Cannot read the SSH private key file ${missing} (ENOENT)`);
  });

  it('agent method without an agent → SSH_ERROR naming SSH_AUTH_SOCK', async () => {
    vi.stubEnv('SSH_AUTH_SOCK', '');
    cleanups.push(() => void vi.unstubAllEnvs());
    const { env } = environment(freshKnownHosts());
    const error = await failure(openSshTunnel(settings(1, { method: 'agent' }), {}, env));
    expect(error).toMatchObject({ code: 'SSH_ERROR', detail: { reason: 'authentication' } });
    expect(error.message).toMatch(/No SSH agent is running/);
  });

  it.skipIf(process.platform === 'win32')(
    'agent method uses SSH_AUTH_SOCK; an agent that is not reachable → SSH_ERROR authentication',
    async () => {
      const ssh = await startSshServer();
      vi.stubEnv('SSH_AUTH_SOCK', join(dir, 'no-agent.sock'));
      cleanups.push(() => void vi.unstubAllEnvs());
      const { env } = environment(freshKnownHosts());
      const error = await failure(openSshTunnel(settings(ssh.port, { method: 'agent' }), {}, env));
      expect(error).toMatchObject({ code: 'SSH_ERROR', detail: { reason: 'authentication' } });
    },
  );
});

describe('openSshTunnel: connecting', () => {
  it('nothing listening → SSH_ERROR network (ECONNREFUSED)', async () => {
    const ssh = await startSshServer();
    const port = ssh.port;
    await ssh.close();
    const { env } = environment(freshKnownHosts());
    const error = await failure(openSshTunnel(settings(port), { sshPassword: PASSWORD }, env));
    expect(error).toMatchObject({ code: 'SSH_ERROR', detail: { reason: 'network' } });
    expect(error.message).toBe(
      `Cannot reach the SSH server 127.0.0.1:${String(port)} (ECONNREFUSED)`,
    );
  });

  it('a hung server (accepts TCP, never reads or answers) → SSH_ERROR timeout after readyTimeoutMS', async () => {
    // Like an overloaded sshd whose kernel accepts the connection while the process never reads.
    const accepted = new Set<Socket>();
    const silent = createServer((socket) => {
      accepted.add(socket);
      socket.on('error', () => undefined);
    });
    const port = await listen(silent);
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          for (const socket of accepted) socket.destroy();
          silent.close(() => resolve());
        }),
    );
    const { env } = environment(freshKnownHosts());
    const outcome = await Promise.race([
      failure(
        openSshTunnel(settings(port), { sshPassword: PASSWORD }, env, { readyTimeoutMS: 200 }),
      ),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve('still connecting after 3 s'), 3_000),
      ),
    ]);
    expect(outcome).toMatchObject({ code: 'SSH_ERROR', detail: { reason: 'timeout' } });
    expect((outcome as RpcError).message).toMatch(/did not answer in time/);
  });

  it('a server that accepts and reads but never answers → SSH_ERROR timeout', async () => {
    const quiet = createServer((socket) => {
      socket.on('error', () => undefined);
      socket.resume();
    });
    const port = await listen(quiet);
    cleanups.push(() => new Promise<void>((resolve) => quiet.close(() => resolve())));
    const { env } = environment(freshKnownHosts());
    const error = await failure(
      openSshTunnel(settings(port), { sshPassword: PASSWORD }, env, { readyTimeoutMS: 200 }),
    );
    expect(error).toMatchObject({ code: 'SSH_ERROR', detail: { reason: 'timeout' } });
    expect(error.message).toBe(
      `The SSH server ${USER}@127.0.0.1:${String(port)} did not answer in time`,
    );
  });

  it('an already aborted signal → CANCELLED without connecting', async () => {
    const ssh = await startSshServer();
    const controller = new AbortController();
    controller.abort();
    const { env, questions } = environment(freshKnownHosts());
    const error = await failure(
      openSshTunnel(settings(ssh.port), { sshPassword: PASSWORD }, env, {
        signal: controller.signal,
      }),
    );
    expect(error.code).toBe('CANCELLED');
    expect(questions).toEqual([]);
    expect(ssh.clients.size).toBe(0);
  });

  it('an abort right after the call (before the SSH connect starts) → CANCELLED', async () => {
    const ssh = await startSshServer();
    const controller = new AbortController();
    const { env, questions } = environment(freshKnownHosts());
    const opening = openSshTunnel(settings(ssh.port), { sshPassword: PASSWORD }, env, {
      signal: controller.signal,
    });
    controller.abort();
    const result = await opening.then(
      (tunnel) => {
        cleanups.push(() => tunnel.close());
        return 'connected';
      },
      (error: unknown) => (error instanceof RpcError ? error.code : String(error)),
    );
    // A cancelled connect must not ask the user about the host key either.
    expect({ result, asked: questions.length }).toEqual({ result: 'CANCELLED', asked: 0 });
  });

  it('a server that drops the connection during the handshake → SSH_ERROR', async () => {
    const rude = createServer((socket) => {
      socket.on('error', () => undefined);
      socket.end('SSH-2.0-Fictitious\r\n');
      socket.destroy();
    });
    const port = await listen(rude);
    cleanups.push(() => new Promise<void>((resolve) => rude.close(() => resolve())));
    const { env } = environment(freshKnownHosts());
    const error = await failure(openSshTunnel(settings(port), { sshPassword: PASSWORD }, env));
    expect(error.code).toBe('SSH_ERROR');
  });
});

describe('openSshTunnel: forwarding and lifetime', () => {
  it('forwards SOCKS connections through the SSH server; close() ends channels, port and session', async () => {
    const ssh = await startSshServer();
    const target = await startEcho();
    const { env } = environment(freshKnownHosts());
    const tunnel = await open(settings(ssh.port), { sshPassword: PASSWORD }, env);

    const one = await through(tunnel, target.port);
    const two = await through(tunnel, target.port);
    expect(await echo(one, 'ping-1')).toBe('ping-1');
    expect(await echo(two, 'ping-2')).toBe('ping-2');
    expect(tunnel.openChannels()).toBe(2);
    expect(ssh.forwards).toEqual([
      { destIP: '127.0.0.1', destPort: target.port },
      { destIP: '127.0.0.1', destPort: target.port },
    ]);
    expect(target.sockets.size).toBe(2);

    const closing = tunnel.close();
    expect(tunnel.close()).toBe(closing);
    await closing;
    expect(tunnel.openChannels()).toBe(0);
    await expect(portIsClosed(tunnel.proxy.proxyPort)).resolves.toBe(true);
    await vi.waitFor(() => expect(ssh.clients.size).toBe(0));
    await vi.waitFor(() => expect(target.sockets.size).toBe(0));
  });

  it('a socket the driver closes frees its forwarded channel (server and openChannels)', async () => {
    const ssh = await startSshServer();
    const target = await startEcho();
    const { env } = environment(freshKnownHosts());
    const tunnel = await open(settings(ssh.port), { sshPassword: PASSWORD }, env);
    const one = await through(tunnel, target.port);
    const two = await through(tunnel, target.port);
    expect(await echo(one, 'a')).toBe('a');
    expect(await echo(two, 'b')).toBe('b');
    expect(tunnel.openChannels()).toBe(2);

    one.destroy();
    // The SSH server side lets go of the member connection ...
    await vi.waitFor(() => expect(target.sockets.size).toBe(1));
    // ... and the tunnel no longer counts (or holds on to) the closed channel.
    await vi.waitFor(() => expect(tunnel.openChannels()).toBe(1), { timeout: 2_000 });
  });

  it('a forward the SSH server refuses → the SOCKS client gets a failure, logged', async () => {
    const ssh = await startSshServer({ refuseForwarding: true });
    const { env, log } = environment(freshKnownHosts());
    const tunnel = await open(settings(ssh.port), { sshPassword: PASSWORD }, env);
    await expect(through(tunnel, 9)).rejects.toThrow();
    expect(tunnel.openChannels()).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/cannot forward to 127\.0\.0\.1:9/));
  });

  it('a connection reset after ready (SSH error) is logged and closes the tunnel', async () => {
    const ssh = await startSshServer();
    // A TCP relay in front of the SSH server, so the test can reset the client's connection.
    const relayed = new Set<Socket>();
    const relay = createServer((socket) => {
      relayed.add(socket);
      socket.on('error', () => undefined);
      const upstream = connect(ssh.port, '127.0.0.1');
      upstream.on('error', () => undefined);
      socket.pipe(upstream).pipe(socket);
      socket.on('close', () => upstream.destroy());
    });
    const relayPort = await listen(relay);
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          for (const socket of relayed) socket.destroy();
          relay.close(() => resolve());
        }),
    );
    const { env, log } = environment(freshKnownHosts());
    const tunnel = await open(settings(relayPort), { sshPassword: PASSWORD }, env);
    for (const socket of relayed) socket.resetAndDestroy();
    await vi.waitFor(
      () =>
        expect(log).toHaveBeenCalledWith(
          expect.stringMatching(
            new RegExp(`^ssh ${USER}@127\\.0\\.0\\.1:${String(relayPort)}: .+`),
          ),
        ),
      { timeout: 3_000 },
    );
    await vi.waitFor(async () => expect(await portIsClosed(tunnel.proxy.proxyPort)).toBe(true), {
      timeout: 3_000,
    });
  });

  it('the SSH server going away closes the local port', async () => {
    const ssh = await startSshServer({ dropAfterReady: true });
    const { env, log } = environment(freshKnownHosts());
    const tunnel = await open(settings(ssh.port), { sshPassword: PASSWORD }, env);
    await vi.waitFor(async () => expect(await portIsClosed(tunnel.proxy.proxyPort)).toBe(true), {
      timeout: 3_000,
    });
    // close() of a connection that is already gone does not wait for a `close` that never comes.
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringMatching(/: closed$/)), {
      timeout: 3_000,
    });
    expect(tunnel.openChannels()).toBe(0);
    await expect(through(tunnel, 9)).rejects.toThrow();
  });

  it("a lost SSH session calls onClosed once; the owner's own close() does not (CR-3)", async () => {
    const ssh = await startSshServer({ dropAfterReady: true, dropDelayMS: 100 });
    const { env } = environment(freshKnownHosts());
    const onClosed = vi.fn();
    const tunnel = await open(settings(ssh.port), { sshPassword: PASSWORD }, env, { onClosed });
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1), { timeout: 3_000 });
    // The local port is closed before the owner hears about it.
    expect(await portIsClosed(tunnel.proxy.proxyPort)).toBe(true);
    await tunnel.close();
    expect(onClosed).toHaveBeenCalledTimes(1);

    const steady = await startSshServer();
    const own = vi.fn();
    const second = await openSshTunnel(
      settings(steady.port),
      { sshPassword: PASSWORD },
      environment(freshKnownHosts()).env,
      { onClosed: own },
    );
    await second.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(own).not.toHaveBeenCalled();
  });

  it('the SSH server disconnecting right at ready → the local port is closed too', async () => {
    const ssh = await startSshServer({ dropAfterReady: true, dropDelayMS: 0 });
    const { env } = environment(freshKnownHosts());
    let tunnel: SshTunnel;
    try {
      tunnel = await openSshTunnel(settings(ssh.port), { sshPassword: PASSWORD }, env);
    } catch (error) {
      // The drop may come before ready: then the connect itself fails, which is fine too.
      expect(error).toMatchObject({ code: 'SSH_ERROR' });
      return;
    }
    cleanups.push(() => tunnel.close());
    await vi.waitFor(async () => expect(await portIsClosed(tunnel.proxy.proxyPort)).toBe(true), {
      timeout: 3_000,
    });
  });

  it('close() with a peer that stopped answering destroys the SSH socket after 1 s (CR-8)', async () => {
    const ssh = await startSshServer();
    // A relay in front of the SSH server that can go silent: it then neither forwards nor answers
    // the client's FIN (allowHalfOpen), like a peer behind a dead network path.
    const relayed: Socket[] = [];
    const upstreams: Socket[] = [];
    const relay = createServer({ allowHalfOpen: true }, (socket) => {
      relayed.push(socket);
      socket.on('error', () => undefined);
      const upstream = connect(ssh.port, '127.0.0.1');
      upstreams.push(upstream);
      upstream.on('error', () => undefined);
      socket.pipe(upstream).pipe(socket);
    });
    const relayPort = await listen(relay);
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          for (const socket of [...relayed, ...upstreams]) socket.destroy();
          relay.close(() => resolve());
        }),
    );
    // The client's TCP socket to the relay (ssh2 creates it internally with `new Socket()`).
    const clientSockets: Socket[] = [];
    const realConnect = Socket.prototype.connect;
    const spy = vi.spyOn(Socket.prototype, 'connect').mockImplementation(function (
      this: Socket,
      ...args: unknown[]
    ) {
      clientSockets.push(this);
      return (realConnect as (...a: unknown[]) => Socket).apply(this, args);
    });
    cleanups.push(() => spy.mockRestore());

    const { env, log } = environment(freshKnownHosts());
    const onClosed = vi.fn();
    const tunnel = await openSshTunnel(settings(relayPort), { sshPassword: PASSWORD }, env, {
      onClosed,
    });
    spy.mockRestore();
    const sshSocket = clientSockets.find((socket) => socket.remotePort === relayPort);
    expect(sshSocket).toBeDefined();

    // The peer goes silent: nothing is forwarded any more and the relay never ends its side.
    for (const socket of relayed) {
      socket.unpipe();
      socket.on('data', () => undefined);
    }
    for (const upstream of upstreams) {
      upstream.unpipe();
      upstream.destroy();
    }

    const started = Date.now();
    await tunnel.close();
    const took = Date.now() - started;

    // `close` never came from ssh2, so close() waited for its 1 s fallback ...
    expect(took).toBeGreaterThanOrEqual(900);
    expect(took).toBeLessThan(3_000);
    // ... and then destroyed the half-closed socket instead of leaving it open.
    expect(sshSocket?.destroyed).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/: closed$/));
    // The owner's own close() is not a lost session.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onClosed).not.toHaveBeenCalled();
  });
});

describe('toSshError', () => {
  const ssh: SshSettings = {
    host: 'bastion.example.test',
    port: 2222,
    username: 'ops',
    method: 'password',
  };
  const err = (message: string, extra: { level?: string; code?: string } = {}) =>
    Object.assign(new Error(message), extra);

  it('maps a missing passphrase for an encrypted key', () => {
    const error = toSshError(
      err('Encrypted private OpenSSH key detected, but no passphrase given'),
      ssh,
    );
    expect(error).toMatchObject({ code: 'SSH_ERROR', detail: { reason: 'authentication' } });
    expect(error.message).toBe(
      'The SSH private key is encrypted: save its passphrase in the profile',
    );
  });

  it.each([
    'Failed to decrypt: bad decrypt',
    'Cannot parse privateKey: Malformed OpenSSH private key',
    'Unsupported key format',
    'Wrong passphrase',
  ])('maps unusable keys (%s) to authentication', (message) => {
    const error = toSshError(err(message), ssh);
    expect(error).toMatchObject({ code: 'SSH_ERROR', detail: { reason: 'authentication' } });
    expect(error.message).toBe(
      `Cannot use the SSH private key (wrong passphrase or unsupported format): ${message}`,
    );
  });

  it('maps client-authentication to a message with user, host, port and method', () => {
    const error = toSshError(
      err('All configured authentication methods failed', { level: 'client-authentication' }),
      { ...ssh, method: 'agent' },
    );
    expect(error.message).toBe(
      'SSH authentication failed for ops@bastion.example.test:2222 (method agent)',
    );
    expect(error.detail).toEqual({ reason: 'authentication' });
  });

  it('maps client-timeout to timeout', () => {
    const error = toSshError(err('Timed out', { level: 'client-timeout' }), ssh);
    expect(error.message).toBe('The SSH server bastion.example.test:2222 did not answer in time');
    expect(error.detail).toEqual({ reason: 'timeout' });
  });

  it('maps agent failures to authentication', () => {
    const error = toSshError(err('agent refused', { level: 'agent' }), ssh);
    expect(error.message).toBe('The SSH agent failed: agent refused');
    expect(error.detail).toEqual({ reason: 'authentication' });
  });

  it.each(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH'])(
    'maps the socket error %s to network',
    (code) => {
      const error = toSshError(err(`connect ${code}`, { level: 'client-socket', code }), ssh);
      expect(error.message).toBe(`Cannot reach the SSH server bastion.example.test:2222 (${code})`);
      expect(error.detail).toEqual({ reason: 'network' });
    },
  );

  it('anything else is a generic SSH_ERROR with the original text and no detail', () => {
    const error = toSshError(err('Protocol error', { level: 'protocol', code: 'ERR_X' }), ssh);
    expect(error).toBeInstanceOf(RpcError);
    expect(error.code).toBe('SSH_ERROR');
    expect(error.message).toBe(
      'SSH connection to bastion.example.test:2222 failed: Protocol error',
    );
    expect(error.detail).toBeUndefined();
    expect(toSshError(err('x', { code: 'econnrefused' }), ssh).detail).toBeUndefined();
  });
});
