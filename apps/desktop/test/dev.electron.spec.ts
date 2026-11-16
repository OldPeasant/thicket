// The `npm run dev` path: the renderer from the `ng serve` dev server, Electron pointed at it with
// THICKET_DEV_SERVER (the same mechanism scripts/dev.mjs uses), the CSP added to the dev server's
// responses by `session.webRequest.onHeadersReceived`.
import type { Request, Response } from '@thicket/contract';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freePort, launchApp, repoDir, waitForUrl, type TestWindow } from './helpers';

const rendererDir = resolve(repoDir, 'packages', 'renderer');
const ngCli = createRequire(resolve(rendererDir, 'package.json')).resolve('@angular/cli/bin/ng.js');

let server: ChildProcess | undefined;
let app: ElectronApplication | undefined;
let page: Page;
let devServer: string;
let port: number;
const output: string[] = [];
const serverOutput: string[] = [];
const consoleMessages: string[] = [];

/** Stops `ng serve` and everything it started (its own process group on POSIX). */
function stopServer(): void {
  if (!server?.pid || server.exitCode !== null) return;
  try {
    if (process.platform === 'win32') server.kill();
    else process.kill(-server.pid, 'SIGTERM');
  } catch {
    // already gone
  }
}

function call(request: Request): Promise<Response> {
  return page.evaluate((r) => (window as unknown as TestWindow).thicket.request(r), request);
}

beforeAll(async () => {
  port = await freePort();
  devServer = `http://localhost:${port}`;
  server = spawn(process.execPath, [ngCli, 'serve', '--port', String(port)], {
    cwd: rendererDir,
    env: { ...process.env, NG_CLI_ANALYTICS: 'false', CI: 'true' },
    // Own process group, so afterAll can stop ng serve together with its workers.
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (chunk: Buffer) => serverOutput.push(chunk.toString()));
  server.stderr?.on('data', (chunk: Buffer) => serverOutput.push(chunk.toString()));
  try {
    await waitForUrl(devServer, 150_000);
  } catch (error) {
    throw new Error(`${String(error)}\nng serve output:\n${serverOutput.join('')}`, {
      cause: error,
    });
  }

  app = await launchApp(output, { THICKET_DEV_SERVER: devServer });
  page = await app.firstWindow();
  page.on('console', (message) => consoleMessages.push(message.text()));
  await page.waitForLoadState('domcontentloaded');
}, 180_000);

afterAll(async () => {
  try {
    await app?.close();
  } finally {
    stopServer();
  }
});

describe('Electron shell in dev mode (THICKET_DEV_SERVER)', () => {
  it('loads the renderer from the dev server', () => {
    expect(page.url()).toBe(`${devServer}/`);
  });

  it("serves the dev server's document with the CSP header, allowing its live-reload socket", async () => {
    const csp = await page.evaluate(async () => {
      const response = await fetch(location.href);
      return response.headers.get('content-security-policy');
    });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain(`ws://localhost:${port}`);
  });

  it('app.ping is answered by main, backend.ping by the backend process', async () => {
    const mainPing = await call({ id: 'd1', method: 'app.ping', params: {} });
    expect(mainPing).toMatchObject({ id: 'd1', ok: true, result: { process: 'main' } });

    const backendPing = await call({ id: 'd2', method: 'backend.ping', params: {} });
    expect(backendPing).toMatchObject({
      id: 'd2',
      ok: true,
      result: { process: 'backend', mainReachable: true },
    });
  });

  it('reports no Content Security Policy violations', async () => {
    // Give late scripts (the dev server's client) a moment to run.
    await new Promise((r) => setTimeout(r, 1000));
    const violations = consoleMessages.filter((m) => /Content Security Policy/i.test(m));
    expect(violations).toEqual([]);
  });
});
