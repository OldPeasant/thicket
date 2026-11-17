import { connect, type Socket } from 'node:net';
import { PassThrough, type Duplex } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startLocalSocks, type LocalSocks, type SocksConnect } from './socks';

/** A client socket that collects what it receives, with helpers to wait for bytes or close. */
interface TestClient {
  socket: Socket;
  received(): Buffer;
  /** Waits until at least `n` bytes arrived and returns them all. */
  waitFor(n: number): Promise<Buffer>;
  closed: Promise<void>;
}

async function client(socks: LocalSocks): Promise<TestClient> {
  const socket = connect(socks.port, socks.host);
  socket.on('error', () => undefined);
  let data = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    data = Buffer.concat([data, chunk]);
  });
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return {
    socket,
    received: () => data,
    waitFor: async (n) => {
      await vi.waitFor(() => expect(data.length).toBeGreaterThanOrEqual(n));
      return data;
    },
    closed,
  };
}

function greeting(...methods: number[]): Buffer {
  return Buffer.from([0x05, methods.length, ...methods]);
}

function auth(username: string, password: string): Buffer {
  const user = Buffer.from(username, 'utf8');
  const pass = Buffer.from(password, 'utf8');
  return Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]);
}

function port(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
}

function connectDomain(host: string, p: number, command = 0x01): Buffer {
  const name = Buffer.from(host, 'utf8');
  return Buffer.concat([Buffer.from([0x05, command, 0x00, 0x03, name.length]), name, port(p)]);
}

function connectIPv4(bytes: number[], p: number): Buffer {
  return Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x01, ...bytes]), port(p)]);
}

function connectIPv6(bytes: number[], p: number): Buffer {
  return Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x04, ...bytes]), port(p)]);
}

const OK_REPLY = [0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];

/** A `connect` that records targets and hands out PassThrough pairs as the remote side. */
function recordingConnect() {
  const targets: { host: string; port: number }[] = [];
  const remotes: { toRemote: PassThrough; remote: Duplex }[] = [];
  const connectFn: SocksConnect = (host, p) => {
    targets.push({ host, port: p });
    // What the client writes ends up in `toRemote`; `remote.push` sends to the client.
    const toRemote = new PassThrough();
    const remote = new PassThrough();
    remote.write = ((chunk: Buffer, ...rest: unknown[]) =>
      toRemote.write(chunk, ...(rest as []))) as typeof remote.write;
    remotes.push({ toRemote, remote });
    return Promise.resolve(remote);
  };
  return { targets, remotes, connect: connectFn };
}

const servers: LocalSocks[] = [];
async function start(connectFn: SocksConnect, log?: (m: string) => void): Promise<LocalSocks> {
  const socks = await startLocalSocks(connectFn, log);
  servers.push(socks);
  return socks;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

/** Runs greeting + auth with the right credentials; resolves after the auth reply. */
async function authenticate(socks: LocalSocks): Promise<TestClient> {
  const c = await client(socks);
  c.socket.write(greeting(0x00, 0x02));
  expect([...(await c.waitFor(2))]).toEqual([0x05, 0x02]);
  c.socket.write(auth(socks.username, socks.password));
  expect([...(await c.waitFor(4)).subarray(2, 4)]).toEqual([0x01, 0x00]);
  return c;
}

describe('startLocalSocks', () => {
  it('listens on 127.0.0.1 with a random port and random credentials per server', async () => {
    const a = await start(recordingConnect().connect);
    const b = await start(recordingConnect().connect);
    expect(a.host).toBe('127.0.0.1');
    expect(a.port).toBeGreaterThan(0);
    expect(a.port).not.toBe(b.port);
    expect(a.username).not.toBe(b.username);
    expect(a.password).not.toBe(b.password);
    expect(a.password.length).toBeGreaterThanOrEqual(20);
    expect(a.openSockets()).toBe(0);
  });

  it('handshake with user/password, CONNECT by domain name, then forwards both ways', async () => {
    const r = recordingConnect();
    const socks = await start(r.connect);
    const c = await authenticate(socks);
    c.socket.write(connectDomain('mongo-a.internal.example.test', 27017));
    const reply = (await c.waitFor(14)).subarray(4, 14);
    expect([...reply]).toEqual(OK_REPLY);
    expect(r.targets).toEqual([{ host: 'mongo-a.internal.example.test', port: 27017 }]);

    const remote = r.remotes[0];
    const fromClient: Buffer[] = [];
    remote?.toRemote.on('data', (chunk: Buffer) => fromClient.push(chunk));
    c.socket.write('hello from the driver');
    await vi.waitFor(() =>
      expect(Buffer.concat(fromClient).toString()).toBe('hello from the driver'),
    );
    remote?.remote.push(Buffer.from('hello from mongod'));
    await vi.waitFor(() => expect(c.received().subarray(14).toString()).toBe('hello from mongod'));
    expect(socks.openSockets()).toBe(1);
  });

  it('reads IPv4 targets as dotted quads', async () => {
    const r = recordingConnect();
    const socks = await start(r.connect);
    const c = await authenticate(socks);
    c.socket.write(connectIPv4([192, 0, 2, 10], 27018));
    await c.waitFor(14);
    expect(r.targets).toEqual([{ host: '192.0.2.10', port: 27018 }]);
  });

  it('reads IPv6 targets as eight hex groups', async () => {
    const r = recordingConnect();
    const socks = await start(r.connect);
    const c = await authenticate(socks);
    // 2001:db8::1 (documentation prefix)
    c.socket.write(connectIPv6([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 443));
    await c.waitFor(14);
    expect(r.targets).toEqual([{ host: '2001:db8:0:0:0:0:0:1', port: 443 }]);
  });

  it('accepts the handshake split into single bytes', async () => {
    const r = recordingConnect();
    const socks = await start(r.connect);
    const c = await client(socks);
    const bytes = Buffer.concat([
      greeting(0x02),
      auth(socks.username, socks.password),
      connectDomain('db.example.test', 27017),
    ]);
    for (const byte of bytes) {
      c.socket.write(Buffer.from([byte]));
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect([...(await c.waitFor(14)).subarray(4, 14)]).toEqual(OK_REPLY);
    expect(r.targets).toEqual([{ host: 'db.example.test', port: 27017 }]);
  });

  it('forwards payload sent in the same packet as the CONNECT request', async () => {
    const r = recordingConnect();
    const socks = await start(r.connect);
    const c = await authenticate(socks);
    const fromClient: Buffer[] = [];
    c.socket.write(Buffer.concat([connectDomain('db.example.test', 27017), Buffer.from('early')]));
    await vi.waitFor(() => expect(r.remotes).toHaveLength(1));
    r.remotes[0]?.toRemote.on('data', (chunk: Buffer) => fromClient.push(chunk));
    await vi.waitFor(() => expect(Buffer.concat(fromClient).toString()).toBe('early'));
    expect([...(await c.waitFor(14)).subarray(4, 14)]).toEqual(OK_REPLY);
  });

  it('wrong credentials → auth failure reply, socket closed, connect never called', async () => {
    const r = recordingConnect();
    const socks = await start(r.connect);
    for (const [user, pass] of [
      [socks.username, 'wrong-fictitious-pass'],
      ['wrong-user', socks.password],
      [socks.username, `${socks.password}x`],
      ['', ''],
    ] as const) {
      const c = await client(socks);
      c.socket.write(greeting(0x02));
      await c.waitFor(2);
      c.socket.write(auth(user, pass));
      await c.closed;
      expect([...c.received()]).toEqual([0x05, 0x02, 0x01, 0x01]);
    }
    expect(r.targets).toEqual([]);
  });

  it('a client without the user/password method gets "no acceptable method"', async () => {
    const r = recordingConnect();
    const socks = await start(r.connect);
    const c = await client(socks);
    c.socket.write(greeting(0x00));
    await c.closed;
    expect([...c.received()]).toEqual([0x05, 0xff]);

    const none = await client(socks);
    none.socket.write(greeting());
    await none.closed;
    expect([...none.received()]).toEqual([0x05, 0xff]);
    expect(r.targets).toEqual([]);
  });

  it('another SOCKS version is dropped (and logged)', async () => {
    const log = vi.fn();
    const socks = await start(recordingConnect().connect, log);
    const c = await client(socks);
    c.socket.write(Buffer.from([0x04, 0x01, 0x00, 0x50, 0, 0, 0, 1, 0]));
    await c.closed;
    expect(c.received().length).toBe(0);
    expect(log).toHaveBeenCalledWith('socks: unsupported SOCKS version 4');
  });

  it('a wrong auth sub-negotiation version is dropped', async () => {
    const log = vi.fn();
    const socks = await start(recordingConnect().connect, log);
    const c = await client(socks);
    c.socket.write(greeting(0x02));
    await c.waitFor(2);
    c.socket.write(Buffer.from([0x05, 0x00]));
    await c.closed;
    expect(log).toHaveBeenCalledWith('socks: unsupported SOCKS auth version');
  });

  it('a command other than CONNECT gets "command not supported"', async () => {
    const r = recordingConnect();
    const socks = await start(r.connect);
    const c = await authenticate(socks);
    c.socket.write(connectDomain('db.example.test', 27017, 0x02 /* BIND */));
    await c.closed;
    expect(c.received()[5]).toBe(0x07);
    expect(r.targets).toEqual([]);
  });

  it('an unknown address type gets "address type not supported"', async () => {
    const r = recordingConnect();
    const socks = await start(r.connect);
    const c = await authenticate(socks);
    c.socket.write(Buffer.from([0x05, 0x01, 0x00, 0x09]));
    await c.closed;
    expect(c.received()[5]).toBe(0x08);
    expect(r.targets).toEqual([]);
  });

  it('a failed connect answers "connection refused" (05) and closes the socket', async () => {
    const socks = await start(() => Promise.reject(new Error('administratively prohibited')));
    const c = await authenticate(socks);
    c.socket.write(connectDomain('db.example.test', 27017));
    await c.closed;
    expect([...c.received().subarray(4)]).toEqual([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
    await vi.waitFor(() => expect(socks.openSockets()).toBe(0));
  });

  it('a client that closes during the handshake is cleaned up', async () => {
    const log = vi.fn();
    const socks = await start(recordingConnect().connect, log);
    const c = await client(socks);
    c.socket.write(Buffer.from([0x05]));
    await vi.waitFor(() => expect(socks.openSockets()).toBe(1));
    c.socket.end();
    await vi.waitFor(() => expect(socks.openSockets()).toBe(0));
    expect(log).toHaveBeenCalledWith('socks: the client closed during the handshake');
  });

  it('a client that goes away while connect is pending: the remote is destroyed', async () => {
    let resolveRemote: ((d: Duplex) => void) | undefined;
    const socks = await start(
      () =>
        new Promise<Duplex>((resolve) => {
          resolveRemote = resolve;
        }),
    );
    const c = await authenticate(socks);
    c.socket.write(connectDomain('db.example.test', 27017));
    await vi.waitFor(() => expect(resolveRemote).toBeDefined());
    c.socket.destroy();
    await vi.waitFor(() => expect(socks.openSockets()).toBe(0));
    const remote = new PassThrough();
    resolveRemote?.(remote);
    await vi.waitFor(() => expect(remote.destroyed).toBe(true));
  });

  it('closing the remote side closes the client socket, and vice versa', async () => {
    const r = recordingConnect();
    const socks = await start(r.connect);
    const one = await authenticate(socks);
    one.socket.write(connectDomain('a.example.test', 1));
    await one.waitFor(14);
    r.remotes[0]?.remote.destroy();
    await one.closed;

    const two = await authenticate(socks);
    two.socket.write(connectDomain('b.example.test', 2));
    await two.waitFor(14);
    two.socket.destroy();
    await vi.waitFor(() => expect(r.remotes[1]?.remote.destroyed).toBe(true));
    await vi.waitFor(() => expect(socks.openSockets()).toBe(0));
  });

  it('a remote error closes both sides', async () => {
    const r = recordingConnect();
    const socks = await start(r.connect);
    const c = await authenticate(socks);
    c.socket.write(connectDomain('a.example.test', 1));
    await c.waitFor(14);
    r.remotes[0]?.remote.destroy(new Error('channel failed'));
    await c.closed;
    await vi.waitFor(() => expect(socks.openSockets()).toBe(0));
  });

  it('close() stops listening and destroys open sockets; it is idempotent', async () => {
    const r = recordingConnect();
    const socks = await start(r.connect);
    const forwarded = await authenticate(socks);
    forwarded.socket.write(connectDomain('a.example.test', 1));
    await forwarded.waitFor(14);
    const handshaking = await client(socks);
    await vi.waitFor(() => expect(socks.openSockets()).toBe(2));

    const first = socks.close();
    expect(socks.close()).toBe(first);
    await first;
    // Once close() resolved no socket is counted any more (the regression on Windows and macOS),
    // without waiting for the clients to see their sockets close.
    expect(socks.openSockets()).toBe(0);
    await forwarded.closed;
    await handshaking.closed;
    expect(socks.openSockets()).toBe(0);
    await vi.waitFor(() => expect(r.remotes[0]?.remote.destroyed).toBe(true));
    const refused = connect(socks.port, socks.host);
    await expect(
      new Promise((resolve, reject) => {
        refused.once('connect', resolve);
        refused.once('error', reject);
      }),
    ).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('close() right after a socket was destroyed still waits until that socket is gone', async () => {
    // A destroyed socket reports `closed` at once, but emits `close` (and leaves openSockets())
    // only after its handle closed. close() must wait for that, else the socket is still counted.
    const r = recordingConnect();
    const socks = await start(r.connect);
    const c = await authenticate(socks);
    c.socket.write(connectDomain('a.example.test', 1));
    await c.waitFor(14);
    const remote = r.remotes[0]?.remote;
    let closing: Promise<void> | undefined;
    // The server's own error handler (registered first) has just destroyed the client socket.
    remote?.once('error', () => {
      closing = socks.close();
    });
    remote?.destroy(new Error('channel failed'));
    await vi.waitFor(() => expect(closing).toBeDefined());
    await closing;
    expect(socks.openSockets()).toBe(0);
  });
});
