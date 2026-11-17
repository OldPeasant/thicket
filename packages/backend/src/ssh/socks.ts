import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

/**
 * A minimal SOCKS5 server (RFC 1928, CONNECT only, username/password auth of RFC 1929) on
 * 127.0.0.1 with a random port and random credentials. The driver connects to it with its
 * `proxyHost` options; every accepted CONNECT is handed to `connect` (an SSH `forwardOut`), so each
 * replica set member the driver talks to gets its own forwarded channel, addressed by the name the
 * driver uses (resolved on the SSH server's side).
 */
export interface LocalSocks {
  host: string;
  port: number;
  username: string;
  password: string;
  /** Client sockets currently open (accepted and not yet closed). */
  openSockets(): number;
  /** Stops listening and destroys every open socket. */
  close(): Promise<void>;
}

/** Opens the outgoing side of one CONNECT. Rejecting answers the client "connection refused". */
export type SocksConnect = (host: string, port: number) => Promise<Duplex>;

const VERSION = 0x05;
const AUTH_VERSION = 0x01;
const METHOD_USER_PASSWORD = 0x02;
const NO_ACCEPTABLE_METHOD = 0xff;
const CMD_CONNECT = 0x01;
const ATYP_IPV4 = 0x01;
const ATYP_DOMAIN = 0x03;
const ATYP_IPV6 = 0x04;
const REPLY_OK = 0x00;
const REPLY_REFUSED = 0x05;
const REPLY_COMMAND_NOT_SUPPORTED = 0x07;
const REPLY_ADDRESS_NOT_SUPPORTED = 0x08;
/** Longest wait for a client's handshake before its socket is dropped. */
const HANDSHAKE_TIMEOUT_MS = 30_000;

export async function startLocalSocks(
  connect: SocksConnect,
  log: (message: string) => void = () => undefined,
): Promise<LocalSocks> {
  const username = randomBytes(9).toString('base64url');
  const password = randomBytes(18).toString('base64url');
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    handle(socket, { username, password }, connect).catch((error: unknown) => {
      log(`socks: ${error instanceof Error ? error.message : String(error)}`);
      socket.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('The local SOCKS server has no TCP address');
  }
  let closing: Promise<void> | undefined;
  return {
    host: '127.0.0.1',
    port: address.port,
    username,
    password,
    openSockets: () => sockets.size,
    close() {
      // Resolve only once the server and every accepted socket have emitted `close`. The server's
      // own close callback can run before the sockets' `close` events (it does on Windows and
      // macOS), which left them counted in `openSockets()` after `close()` had resolved. A socket
      // still in the set has not emitted `close` yet (`socket.closed` turns true earlier, when
      // destroy() runs), so always wait for the event.
      closing ??= Promise.all([
        new Promise<void>((resolve) => server.close(() => resolve())),
        ...[...sockets].map(
          (socket) =>
            new Promise<void>((resolve) => {
              socket.once('close', () => resolve());
              socket.destroy();
            }),
        ),
      ]).then(() => undefined);
      return closing;
    },
  };
}

/** Reads exactly `n` bytes at a time from a socket that is still in the handshake. */
class Reader {
  private buffered = Buffer.alloc(0);
  private waiting: { n: number; resolve: (b: Buffer) => void; reject: (e: Error) => void } | null =
    null;
  private failure: Error | null = null;
  private readonly onData = (chunk: Buffer) => {
    this.buffered = Buffer.concat([this.buffered, chunk]);
    this.flush();
  };
  private readonly onEnd = () => this.fail(new Error('the client closed during the handshake'));

  constructor(private readonly socket: Socket) {
    socket.on('data', this.onData);
    socket.once('end', this.onEnd);
    socket.once('close', this.onEnd);
  }

  read(n: number): Promise<Buffer> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiting = { n, resolve, reject };
      this.flush();
    });
  }

  /** Stops reading; returns bytes that came after the handshake (already sent payload). */
  detach(): Buffer {
    this.socket.off('data', this.onData);
    this.socket.off('end', this.onEnd);
    this.socket.off('close', this.onEnd);
    const rest = this.buffered;
    this.buffered = Buffer.alloc(0);
    return rest;
  }

  private flush(): void {
    const waiting = this.waiting;
    if (!waiting || this.buffered.length < waiting.n) return;
    this.waiting = null;
    const head = this.buffered.subarray(0, waiting.n);
    this.buffered = this.buffered.subarray(waiting.n);
    waiting.resolve(head);
  }

  private fail(error: Error): void {
    this.failure ??= error;
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.reject(error);
  }
}

function sameSecret(given: Buffer, expected: string): boolean {
  const wanted = Buffer.from(expected, 'utf8');
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

async function handle(
  socket: Socket,
  credentials: { username: string; password: string },
  connect: SocksConnect,
): Promise<void> {
  socket.setTimeout(HANDSHAKE_TIMEOUT_MS, () => socket.destroy());
  const reader = new Reader(socket);

  // Greeting: VER NMETHODS METHODS...
  const [version, methodCount] = await reader.read(2);
  if (version !== VERSION) throw new Error(`unsupported SOCKS version ${String(version)}`);
  const offered = await reader.read(methodCount ?? 0);
  if (!offered.includes(METHOD_USER_PASSWORD)) {
    socket.end(Buffer.from([VERSION, NO_ACCEPTABLE_METHOD]));
    return;
  }
  socket.write(Buffer.from([VERSION, METHOD_USER_PASSWORD]));

  // RFC 1929: VER ULEN UNAME PLEN PASSWD
  const [authVersion, userLength] = await reader.read(2);
  if (authVersion !== AUTH_VERSION) throw new Error('unsupported SOCKS auth version');
  const user = await reader.read(userLength ?? 0);
  const [passwordLength] = await reader.read(1);
  const pass = await reader.read(passwordLength ?? 0);
  // Evaluate both, so the time doesn't tell which one was wrong.
  const userOk = sameSecret(user, credentials.username);
  const passOk = sameSecret(pass, credentials.password);
  if (!userOk || !passOk) {
    socket.end(Buffer.from([AUTH_VERSION, 0x01]));
    return;
  }
  socket.write(Buffer.from([AUTH_VERSION, 0x00]));

  // Request: VER CMD RSV ATYP DST.ADDR DST.PORT
  const [, command, , addressType] = await reader.read(4);
  let host: string;
  if (addressType === ATYP_IPV4) {
    host = [...(await reader.read(4))].join('.');
  } else if (addressType === ATYP_DOMAIN) {
    const [length] = await reader.read(1);
    host = (await reader.read(length ?? 0)).toString('utf8');
  } else if (addressType === ATYP_IPV6) {
    const bytes = await reader.read(16);
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) groups.push(bytes.readUInt16BE(i).toString(16));
    host = groups.join(':');
  } else {
    socket.end(reply(REPLY_ADDRESS_NOT_SUPPORTED));
    return;
  }
  const port = (await reader.read(2)).readUInt16BE(0);
  if (command !== CMD_CONNECT) {
    socket.end(reply(REPLY_COMMAND_NOT_SUPPORTED));
    return;
  }

  let remote: Duplex;
  try {
    remote = await connect(host, port);
  } catch {
    socket.end(reply(REPLY_REFUSED));
    return;
  }
  if (socket.destroyed) {
    remote.destroy();
    return;
  }
  socket.setTimeout(0);
  const early = reader.detach();
  socket.write(reply(REPLY_OK));
  if (early.length > 0) remote.write(early);
  socket.pipe(remote);
  remote.pipe(socket);
  const done = () => {
    socket.destroy();
    remote.destroy();
    // The pipe to the closed socket is gone: drain what is left, so the remote side reaches its
    // end and closes (an ssh2 channel emits `close` only after `end`, else it stays counted).
    remote.resume();
  };
  socket.once('close', done);
  remote.once('close', done);
  remote.on('error', done);
  socket.on('error', done);
}

/** A reply with a zero bind address (clients ignore it for CONNECT). */
function reply(code: number): Buffer {
  return Buffer.from([VERSION, code, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0]);
}
