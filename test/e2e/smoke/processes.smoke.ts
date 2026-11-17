import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  endProcessTree,
  processGroupAlive,
  removeAppDir,
  waitForProcessGroupExit,
} from '../harness/processes';

// Checks of the app teardown helpers in test/e2e/harness/processes.ts (used by installer.smoke.ts and
// harness/fixtures.ts). They need no app: a Node "app" (child) starts a "helper" (grandchild) in the
// same process group, like the AppImage runtime starts Electron and its Chromium helpers. They run
// here, in `npm run test:smoke`, because the release workflow runs this suite on every OS.

const POSIX_ONLY = 'Windows has no process groups: endProcessTree waits for the child only there';

/**
 * The helper (grandchild). argv: <marker dir> <mode>
 * - `ignore-term`: ignores SIGTERM, runs until killed;
 * - `linger-on-term:<ms>`: on SIGTERM keeps running <ms>, writes `done`, then exits (like a
 *   Chromium helper that still flushes its cache after the runtime exited);
 * - `exit-after:<ms>`: exits by itself after <ms>, writing `done` first.
 * Any SIGTERM it receives is recorded as the file `sigterm`. Writes `grandchild.pid` once ready.
 */
const GRANDCHILD = `
const fs = require('node:fs');
const path = require('node:path');
const [dir, mode] = process.argv.slice(2);
const [kind, ms] = mode.split(':');
const done = () => { fs.writeFileSync(path.join(dir, 'done'), ''); process.exit(0); };
process.on('SIGTERM', () => {
  fs.writeFileSync(path.join(dir, 'sigterm'), '');
  if (kind === 'linger-on-term') setTimeout(done, Number(ms));
});
if (kind === 'exit-after') setTimeout(done, Number(ms));
setInterval(() => undefined, 1000);
fs.writeFileSync(path.join(dir, 'grandchild.pid.tmp'), String(process.pid));
fs.renameSync(path.join(dir, 'grandchild.pid.tmp'), path.join(dir, 'grandchild.pid'));
`;

/**
 * The app (child). argv: <grandchild script> <marker dir> <child mode> <grandchild mode>
 * Child modes: `default` (SIGTERM ends it), `ignore-term`, `exit-when-ready` (exits by itself once
 * the grandchild is ready, leaving it running, like the AppImage runtime does).
 */
const CHILD = `
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const [script, dir, mode, grandchildMode] = process.argv.slice(1);
if (mode === 'ignore-term') process.on('SIGTERM', () => undefined);
spawn(process.execPath, [script, dir, grandchildMode], { stdio: 'ignore' });
setInterval(() => {
  if (mode === 'exit-when-ready' && fs.existsSync(path.join(dir, 'grandchild.pid'))) process.exit(0);
}, 20);
`;

let cleanups: (() => Promise<unknown> | unknown)[] = [];
test.afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await Promise.resolve(cleanup()).catch(() => undefined);
  cleanups = [];
});

/** A fresh temp folder, removed after the test. */
async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `thicket-smoke-spec-${prefix}-`));
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Whether the process `pid` still exists (a zombie counts: its parent has not reaped it yet). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function killQuietly(pid: number, signal: NodeJS.Signals = 'SIGKILL'): void {
  try {
    process.kill(pid, signal);
  } catch {
    // already gone
  }
}

/** Spawns a Node process running `source`, killed after the test if it is still running. */
function spawnNode(
  source: string,
  args: string[],
  { detached }: { detached: boolean },
): ChildProcess {
  const child = spawn(process.execPath, ['-e', source, '--', ...args], {
    detached,
    stdio: 'ignore',
    windowsHide: true,
  });
  cleanups.push(() => {
    if (child.pid === undefined) return;
    if (detached && process.platform !== 'win32') killQuietly(-child.pid);
    killQuietly(child.pid);
  });
  return child;
}

interface Tree {
  child: ChildProcess;
  grandchildPid: number;
  dir: string;
}

/** Starts a detached child (own process group) with a grandchild in that group; waits until both run. */
async function startTree(childMode: string, grandchildMode: string): Promise<Tree> {
  const dir = await tempDir('tree');
  const script = join(dir, 'grandchild.js');
  await writeFile(script, GRANDCHILD);
  const child = spawnNode(CHILD, [script, dir, childMode, grandchildMode], { detached: true });
  const pidFile = join(dir, 'grandchild.pid');
  await expect.poll(() => exists(pidFile), { timeout: 15_000 }).toBe(true);
  const grandchildPid = Number(await readFile(pidFile, 'utf8'));
  cleanups.push(() => killQuietly(grandchildPid));
  expect(pidAlive(grandchildPid), 'the grandchild runs').toBe(true);
  return { child, grandchildPid, dir };
}

/** The child's pid, failing the test when it has none. */
function pidOf(child: ChildProcess): number {
  if (child.pid === undefined) throw new Error('the child has no pid');
  return child.pid;
}

function exitedOf(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Resolves once `child` has started (has a pid) or failed to start. */
function spawned(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once('spawn', () => resolve());
    child.once('error', () => resolve());
  });
}

test.describe('endProcessTree with a process group (POSIX)', () => {
  test.skip(process.platform === 'win32', POSIX_ONLY);

  test('returns only after a grandchild that outlives the child has exited', async () => {
    // The AppImage case: SIGTERM ends the runtime at once, its helper keeps writing for a while.
    const { child, grandchildPid, dir } = await startTree('default', 'linger-on-term:500');

    await endProcessTree(child);

    expect(child.signalCode, 'the child was ended with SIGTERM').toBe('SIGTERM');
    expect(await exists(join(dir, 'sigterm')), 'the grandchild got SIGTERM').toBe(true);
    // `done` is written right before the grandchild exits on its own: it was waited for, not killed.
    expect(await exists(join(dir, 'done')), 'the grandchild finished its shutdown').toBe(true);
    expect(pidAlive(grandchildPid), 'the grandchild is gone').toBe(false);
    expect(processGroupAlive(pidOf(child)), 'the process group is empty').toBe(false);
  });

  test('sends SIGKILL to the group when it is still running after graceMs', async () => {
    const { child, grandchildPid, dir } = await startTree('ignore-term', 'ignore-term');

    await endProcessTree(child, { graceMs: 300 });

    expect(await exists(join(dir, 'sigterm')), 'SIGTERM was sent first').toBe(true);
    expect(child.signalCode, 'the child was killed').toBe('SIGKILL');
    expect(pidAlive(grandchildPid), 'the grandchild is gone').toBe(false);
    expect(await exists(join(dir, 'done')), 'the grandchild did not exit by itself').toBe(false);
    expect(processGroupAlive(pidOf(child)), 'the process group is empty').toBe(false);
  });

  test('kills the leftover grandchild when the child has exited already', async () => {
    const { child, grandchildPid, dir } = await startTree('exit-when-ready', 'ignore-term');
    await new Promise((r) => (exitedOf(child) ? r(undefined) : child.once('exit', r)));
    expect(pidAlive(grandchildPid), 'the grandchild outlives the child').toBe(true);

    await endProcessTree(child, { graceMs: 300 });

    expect(await exists(join(dir, 'sigterm')), 'the group was signalled').toBe(true);
    expect(pidAlive(grandchildPid), 'the grandchild is gone').toBe(false);
  });

  test('terminate: false sends no SIGTERM and waits for the group to exit by itself', async () => {
    // Playwright's app.close() has ended the app already; only the helpers are left.
    const { child, grandchildPid, dir } = await startTree('exit-when-ready', 'exit-after:500');

    await endProcessTree(child, { terminate: false });

    expect(child.exitCode, 'the child exited by itself').toBe(0);
    expect(await exists(join(dir, 'sigterm')), 'no SIGTERM was sent').toBe(false);
    expect(await exists(join(dir, 'done')), 'the grandchild finished by itself').toBe(true);
    expect(pidAlive(grandchildPid), 'the grandchild is gone').toBe(false);
  });

  test('terminate: false still kills members left after graceMs, without SIGTERM', async () => {
    const { child, grandchildPid, dir } = await startTree('exit-when-ready', 'ignore-term');

    await endProcessTree(child, { terminate: false, graceMs: 300 });

    expect(pidAlive(grandchildPid), 'the grandchild is gone').toBe(false);
    expect(await exists(join(dir, 'sigterm')), 'only SIGKILL was sent').toBe(false);
    expect(processGroupAlive(pidOf(child)), 'the process group is empty').toBe(false);
  });
});

test.describe('processGroupAlive and waitForProcessGroupExit (POSIX)', () => {
  test.skip(process.platform === 'win32', POSIX_ONLY);

  test('report a running group, time out while it runs and resolve once it is empty', async () => {
    const { child, grandchildPid } = await startTree('ignore-term', 'ignore-term');
    const pgid = pidOf(child);
    expect(processGroupAlive(pgid)).toBe(true);

    expect(await waitForProcessGroupExit(pgid, 100), 'times out while the group runs').toBe(false);

    process.kill(-pgid, 'SIGKILL');
    expect(await waitForProcessGroupExit(pgid, 15_000), 'resolves once the group is empty').toBe(
      true,
    );
    expect(processGroupAlive(pgid)).toBe(false);
    expect(pidAlive(grandchildPid)).toBe(false);
  });

  test('a pid that leads no process group is not alive as a group', async () => {
    // A non-detached child is in the test runner's group, so no group has its pid as id.
    const child = spawnNode('setInterval(() => undefined, 1000)', [], { detached: false });
    await spawned(child);
    expect(processGroupAlive(pidOf(child))).toBe(false);
    expect(await waitForProcessGroupExit(pidOf(child), 1_000)).toBe(true);
  });
});

test.describe('endProcessTree on any OS', () => {
  test('ends a running detached child', async () => {
    const child = spawnNode('setInterval(() => undefined, 1000)', [], {
      detached: process.platform !== 'win32',
    });
    await spawned(child);

    await endProcessTree(child, { graceMs: 5_000 });

    expect(exitedOf(child), 'the child has exited').toBe(true);
  });

  test('ends a running child that was not detached', async () => {
    // processes.ts signals the child alone when it leads no process group.
    const child = spawnNode('setInterval(() => undefined, 1000)', [], { detached: false });
    await spawned(child);

    await endProcessTree(child, { graceMs: 5_000 });

    expect(exitedOf(child), 'the child has exited').toBe(true);
  });

  test('terminate: false kills a child still running after graceMs', async () => {
    const child = spawnNode('setInterval(() => undefined, 1000)', [], {
      detached: process.platform !== 'win32',
    });
    await spawned(child);

    await endProcessTree(child, { terminate: false, graceMs: 300 });

    expect(exitedOf(child), 'the child has exited').toBe(true);
    expect(child.signalCode).toBe('SIGKILL');
  });

  test('returns at once for a child that has exited already', async () => {
    const child = spawnNode('process.exit(3)', [], { detached: process.platform !== 'win32' });
    await new Promise((r) => child.once('exit', r));

    await endProcessTree(child);

    expect(child.exitCode).toBe(3);
  });

  test('returns for a child that never started (no pid)', async () => {
    const child = spawn(join(tmpdir(), 'thicket-smoke-spec-no-such-program'), [], {
      stdio: 'ignore',
    });
    await spawned(child);
    expect(child.pid).toBeUndefined();

    await endProcessTree(child);
  });
});

test.describe('removeAppDir', () => {
  test('removes a folder with nested content', async () => {
    const dir = await tempDir('userdata');
    await mkdir(join(dir, 'Cache', 'Cache_Data'), { recursive: true });
    await writeFile(join(dir, 'Cache', 'Cache_Data', 'index'), 'fictitious cache entry');
    await writeFile(join(dir, 'Preferences'), '{}');

    await removeAppDir(dir);

    expect(await exists(dir)).toBe(false);
  });

  test('accepts a folder that does not exist', async () => {
    const dir = join(await tempDir('parent'), 'never-created');
    await removeAppDir(dir);
    expect(await exists(dir)).toBe(false);
  });

  test('removes a folder a process is still writing into', async () => {
    // The writer adds files to Cache until it fails (the folder is gone) or 2 s have passed: rm
    // meets ENOTEMPTY (or EPERM/EBUSY on Windows) and has to retry.
    const dir = await tempDir('userdata');
    const cache = join(dir, 'Cache');
    await mkdir(cache);
    await writeFile(join(cache, 'first'), '');
    const writer = spawnNode(
      `
      const fs = require('node:fs');
      const path = require('node:path');
      const cache = process.argv[1];
      const end = Date.now() + 2000;
      for (let i = 0; Date.now() < end; i++) {
        try { fs.writeFileSync(path.join(cache, 'entry-' + i), 'x'); } catch { process.exit(0); }
      }
      `,
      [cache],
      { detached: false },
    );
    const writerExited = new Promise((r) => writer.once('exit', r));
    await spawned(writer);
    await expect.poll(() => exists(join(cache, 'entry-0')), { timeout: 15_000 }).toBe(true);

    await removeAppDir(dir);
    await writerExited;

    expect(await exists(dir), 'the folder is gone').toBe(false);
  });
});
