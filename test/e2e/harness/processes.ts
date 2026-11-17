import { spawn, type ChildProcess } from 'node:child_process';
import { rm } from 'node:fs/promises';

/**
 * Teardown helpers for app processes and their folders. An AppImage's runtime is the process the
 * tests start, but Electron and its Chromium helpers are its children: on SIGTERM the runtime exits
 * at once while they still shut down and write into the app's userData folder (release run
 * 44136477833: `ENOTEMPTY` removing it). So teardown waits for the whole process group, not only
 * for the child it started.
 */

/** Whether any process of the POSIX process group `pgid` still exists. */
export function processGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    // EPERM: a member exists but belongs to another user (still alive).
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Polls until the process group `pgid` is empty; `false` if it still has members after `timeoutMs`. */
export async function waitForProcessGroupExit(pgid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processGroupAlive(pgid)) {
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}

function exited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (exited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(exited(child));
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

/**
 * Waits until `child` and, on POSIX, every process of its process group have exited. The child must
 * have been spawned with `detached: true` there (its own group; Playwright's `_electron.launch`
 * does this too). Members still running after `graceMs` (or with `terminate`, signalled with
 * SIGTERM first) get SIGKILL. Windows has no process groups: `terminate` ends the tree with
 * `taskkill /T /F`.
 */
export async function endProcessTree(
  child: ChildProcess,
  { terminate = true, graceMs = 10_000 }: { terminate?: boolean; graceMs?: number } = {},
): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    if (exited(child)) return;
    if (terminate) {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }).on(
        'error',
        () => undefined,
      );
    }
    if (!(await waitForExit(child, graceMs))) child.kill('SIGKILL');
    await waitForExit(child, 5_000);
    return;
  }
  if (terminate && processGroupAlive(pid)) signalGroup(pid, child, 'SIGTERM');
  if (!(await waitForProcessGroupExit(pid, graceMs))) {
    signalGroup(pid, child, 'SIGKILL');
    await waitForProcessGroupExit(pid, 5_000);
  }
  await waitForExit(child, 5_000);
}

function signalGroup(pgid: number, child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // Not a group leader (not detached) or already gone: signal the child alone.
    if (!exited(child)) child.kill(signal);
  }
}

/**
 * Deletes a folder an app used. A process that was not part of the waited-for tree may still write
 * into it for a moment: `rm` retries ENOTEMPTY/EBUSY/EPERM instead of failing the test's teardown.
 */
export async function removeAppDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
