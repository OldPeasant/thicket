import type { Event, Request, Response } from '@thicket/contract';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** What the preload exposes; redeclared so the page functions below type-check. */
interface Thicket {
  request(request: Request): Promise<Response>;
  cancel(id: string): void;
  on(stream: string, listener: (event: Event) => void): () => void;
}
type TestWindow = typeof globalThis & { thicket: Thicket; restartEvents: Event[] };

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The `electron` package's main export is the path of the Electron binary.
const electronPath = createRequire(import.meta.url)('electron') as string;

/** Without a display (CI without xvfb-run), use Chromium's headless Ozone backend. */
function headlessArgs(): string[] {
  const noDisplay = !process.env['DISPLAY'] && !process.env['WAYLAND_DISPLAY'];
  const wanted = process.env['THICKET_TEST_HEADLESS'] === '1';
  return process.platform === 'linux' && (noDisplay || wanted) ? ['--ozone-platform=headless'] : [];
}

let app: ElectronApplication;
let page: Page;
const output: string[] = [];

function call(request: Request): Promise<Response> {
  return page.evaluate((r) => (window as unknown as TestWindow).thicket.request(r), request);
}

beforeAll(async () => {
  app = await _electron.launch({
    executablePath: electronPath,
    args: [...headlessArgs(), appDir],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } as Record<string, string>,
  });
  app.process().stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  app.process().stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

afterAll(async () => {
  await app?.close();
});

describe('Electron shell', () => {
  it('loads the renderer from thicket://app with the CSP header', async () => {
    expect(page.url()).toBe('thicket://app/index.html');
    const csp = await page.evaluate(async () => {
      const response = await fetch('thicket://app/index.html');
      return response.headers.get('content-security-policy');
    });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
  });

  it('exposes only thicket.request/cancel/on and no Node APIs', async () => {
    const exposed = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown> & TestWindow;
      return {
        keys: Object.keys(w.thicket).sort(),
        require: typeof w['require'],
        process: typeof w['process'],
        module: typeof w['module'],
      };
    });
    expect(exposed).toEqual({
      keys: ['cancel', 'on', 'request'],
      require: 'undefined',
      process: 'undefined',
      module: 'undefined',
    });
  });

  it('app.ping is answered by main, backend.ping by the backend process', async () => {
    const mainPing = await call({ id: 'p1', method: 'app.ping', params: {} });
    expect(mainPing).toMatchObject({ id: 'p1', ok: true, result: { process: 'main' } });

    const backendPing = await call({ id: 'p2', method: 'backend.ping', params: {} });
    expect(backendPing).toMatchObject({
      id: 'p2',
      ok: true,
      result: { process: 'backend', mainReachable: true },
    });
    const pid = (backendPing as { result: { pid: number } }).result.pid;
    const mainPid = await app.evaluate(() => process.pid);
    expect(pid).not.toBe(mainPid);
    expect(pid).not.toBe(app.process().pid);
  });

  it('the privileged main ↔ backend methods are not reachable from the renderer', async () => {
    for (const method of ['secrets.get', 'main.ping']) {
      const answer = await call({ id: `x-${method}`, method, params: { profileId: 'p1' } });
      expect(answer).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } });
    }
  });

  it('cancels a long backend request with CANCELLED', async () => {
    const started = Date.now();
    const answer = await page.evaluate(async () => {
      const { thicket } = window as unknown as TestWindow;
      const pending = thicket.request({
        id: 'sleep-1',
        method: 'backend.sleep',
        params: { ms: 30000 },
      });
      await new Promise((r) => setTimeout(r, 200));
      thicket.cancel('sleep-1');
      return pending;
    });
    expect(answer).toMatchObject({ id: 'sleep-1', ok: false, error: { code: 'CANCELLED' } });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('blocks window.open and navigation', async () => {
    const opened = await page.evaluate(() => window.open('https://example.com/') === null);
    expect(opened).toBe(true);
    await page.evaluate(() => {
      window.location.href = 'https://example.com/';
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(page.url()).toBe('thicket://app/index.html');
    expect(app.windows()).toHaveLength(1);
  });

  it('restarts a killed backend and tells the renderer', async () => {
    await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      w.restartEvents = [];
      w.thicket.on('backend.restarted', (event) => w.restartEvents.push(event));
    });
    const before = await call({ id: 'k1', method: 'backend.ping', params: {} });
    const oldPid = (before as { result: { pid: number } }).result.pid;

    process.kill(oldPid, 'SIGKILL');

    await expect
      .poll(() => page.evaluate(() => (window as unknown as TestWindow).restartEvents.length), {
        timeout: 15_000,
      })
      .toBe(1);
    const [restart] = await page.evaluate(() => (window as unknown as TestWindow).restartEvents);
    expect(restart).toMatchObject({
      stream: 'backend.restarted',
      kind: 'data',
      payload: { restarts: 1 },
    });

    const after = await call({ id: 'k2', method: 'backend.ping', params: {} });
    expect(after).toMatchObject({ ok: true, result: { process: 'backend', mainReachable: true } });
    expect((after as { result: { pid: number } }).result.pid).not.toBe(oldPid);
  });
});
