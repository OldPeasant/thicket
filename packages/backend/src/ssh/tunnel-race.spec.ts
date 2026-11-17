import { mkdtemp, rm } from 'node:fs/promises';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Server, utils } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KnownHosts } from './known-hosts';
import type { LocalSocks } from './socks';
import { openSshTunnel } from './tunnel';

// CR-6: the SSH session ends while the local SOCKS port is still starting. `startLocalSocks` is
// wrapped (module mock, this file only) so the test can hold it until the session is gone.

const hooks = vi.hoisted(() => ({
  started: [] as LocalSocks[],
  hold: undefined as (() => Promise<void>) | undefined,
}));

vi.mock('./socks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./socks')>();
  return {
    ...actual,
    startLocalSocks: async (...args: Parameters<typeof actual.startLocalSocks>) => {
      const socks = await actual.startLocalSocks(...args);
      hooks.started.push(socks);
      await hooks.hold?.();
      return socks;
    },
  };
});

const USER = 'race-tester';
const PASSWORD = 'fictitious-race-Pw1';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  hooks.started.length = 0;
  hooks.hold = undefined;
});

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

describe('openSshTunnel: session lost while the local port starts', () => {
  it('closes the SOCKS port that started too late and fails with SSH_ERROR', async () => {
    let sessionGone!: () => void;
    const gone = new Promise<void>((resolve) => (sessionGone = resolve));
    const server = new Server(
      { hostKeys: [utils.generateKeyPairSync('ed25519').private] },
      (conn) => {
        conn.on('error', () => undefined);
        conn.on('close', () => sessionGone());
        conn.on('authentication', (ctx) =>
          ctx.method === 'password' && ctx.username === USER && ctx.password === PASSWORD
            ? ctx.accept()
            : ctx.reject(['password']),
        );
        conn.on('ready', () => setTimeout(() => conn.end(), 10));
      },
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const port = (server.address() as AddressInfo).port;
    const dir = await mkdtemp(join(tmpdir(), 'thicket-race-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));

    // The local port finishes starting only after the SSH session has ended.
    hooks.hold = async () => {
      await gone;
      await new Promise((resolve) => setTimeout(resolve, 50));
    };
    const onClosed = vi.fn();
    const opening = openSshTunnel(
      { host: '127.0.0.1', port, username: USER, method: 'password' },
      { sshPassword: PASSWORD },
      {
        knownHosts: new KnownHosts(join(dir, 'known_hosts')),
        confirmHostKey: () => Promise.resolve(true),
      },
      { onClosed },
    );
    await expect(opening).rejects.toMatchObject({
      code: 'SSH_ERROR',
      message: expect.stringMatching(/closed the connection/) as unknown,
    });
    expect(hooks.started).toHaveLength(1);
    const socks = hooks.started[0];
    expect(socks?.openSockets()).toBe(0);
    expect(await portIsClosed(socks?.port ?? 0)).toBe(true);
    // The caller never got a tunnel, so it is not told about a lost one either.
    expect(onClosed).not.toHaveBeenCalled();
  });
});
