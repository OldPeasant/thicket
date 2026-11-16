import type { Event, Request, Response } from '@thicket/contract';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication } from 'playwright-core';

/** What the preload exposes; redeclared so the page functions in the specs type-check. */
export interface Thicket {
  request(request: Request): Promise<Response>;
  cancel(id: string): void;
  on(stream: string, listener: (event: Event) => void): () => void;
}
export type TestWindow = typeof globalThis & { thicket: Thicket; restartEvents: Event[] };

export const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const repoDir = resolve(appDir, '..', '..');
// Electron binary lookup, headlessArgs() and the launch env are duplicated in
// test/e2e/harness/app.ts: keep in sync with it.
// The `electron` package's main export is the path of the Electron binary.
const electronPath = createRequire(import.meta.url)('electron') as string;

/** Without a display (CI without xvfb-run), use Chromium's headless Ozone backend. */
export function headlessArgs(): string[] {
  const noDisplay = !process.env['DISPLAY'] && !process.env['WAYLAND_DISPLAY'];
  const wanted = process.env['THICKET_TEST_HEADLESS'] === '1';
  return process.platform === 'linux' && (noDisplay || wanted) ? ['--ozone-platform=headless'] : [];
}

/**
 * Starts the built app (`dist/`) with Playwright's Electron driver; output goes to `output`.
 * `switches` are Chromium/Electron command-line switches (placed before the app path).
 */
export async function launchApp(
  output: string[],
  env: Record<string, string> = {},
  switches: string[] = [],
): Promise<ElectronApplication> {
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [...headlessArgs(), ...switches, appDir],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', ...env } as Record<string, string>,
  });
  app.process().stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  app.process().stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  return app;
}

/**
 * Starts the built app directly (without Playwright) and resolves with its stdout + stderr once
 * `pattern` matches, then stops it. For lines main prints right at startup: `launchApp` attaches
 * its listeners only after Playwright's launch returns, so such early lines never reach `output`.
 * `env` should set `THICKET_USER_DATA` to a temp folder.
 */
export function startupOutput(
  pattern: RegExp,
  env: Record<string, string>,
  timeoutMs = 20_000,
): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(electronPath, [...headlessArgs(), appDir], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let text = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolveOutput(text);
    };
    const timer = setTimeout(
      () => finish(new Error(`no output matching ${pattern} within ${timeoutMs} ms:\n${text}`)),
      timeoutMs,
    );
    const onData = (chunk: Buffer) => {
      text += chunk.toString();
      if (pattern.test(text)) finish();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (error) => finish(error));
    child.once('exit', (code) =>
      finish(new Error(`app exited (${code}) before printing ${pattern}:\n${text}`)),
    );
  });
}

/** A TCP port that was free a moment ago on localhost. */
export function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

/** Polls `url` until it answers 2xx, or throws after `timeoutMs`. */
export async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up within ${timeoutMs / 1000} s`);
}
