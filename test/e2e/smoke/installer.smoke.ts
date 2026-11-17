import {
  chromium,
  expect,
  test as base,
  type Browser,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { appDir, headlessArgs } from '../harness/app';
import { containerRuntimeUnavailable, startMongo } from '../harness/mongo';
import { endProcessTree, removeAppDir } from '../harness/processes';
import {
  findInstaller,
  installApp,
  mongoSmokeSkipReason,
  type InstalledApp,
} from './installed-app';

/**
 * Smoke test of a packaged Thicket (`npm run test:smoke`, release.yml after the build):
 * `THICKET_SMOKE_INSTALLER` names the installer (.AppImage, .dmg or NSIS .exe; default: the
 * newest one for this OS in apps/desktop/release). The app starts
 * from it, the welcome screen shows, and on Linux (or with `THICKET_SMOKE_MONGO=1`), where a
 * container runtime exists (`THICKET_SMOKE_MONGO=1` makes it required, as on the Linux CI jobs), it
 * connects to a containerized MongoDB. Playwright attaches over the Chromium DevTools protocol
 * (`--remote-debugging-port`), so this works with the EnableNodeCliInspectArguments fuse off.
 */

const installerPath = process.env['THICKET_SMOKE_INSTALLER'];

interface SmokeFixtures {
  userDataDir: string;
  appOutput: string[];
  /** Playwright attached over CDP to the running packaged app. */
  appBrowser: Browser;
  window: Page;
}

interface SmokeWorkerFixtures {
  installed: InstalledApp;
}

const test = base.extend<SmokeFixtures, SmokeWorkerFixtures>({
  installed: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their deps.
    async ({}, use) => {
      const installer = installerPath
        ? resolve(installerPath)
        : await findInstaller(join(appDir, 'release'));
      console.log(`smoke-testing ${installer}`);
      const installed = await installApp(installer);
      try {
        await use(installed);
      } finally {
        await installed.cleanup();
      }
    },
    { scope: 'worker', timeout: 180_000 },
  ],

  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their deps.
  userDataDir: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'thicket-smoke-userdata-'));
    try {
      await use(dir);
    } finally {
      // appBrowser's teardown (it depends on this fixture) has ended the app's processes already.
      await removeAppDir(dir);
    }
  },

  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their deps.
  appOutput: async ({}, use) => {
    await use([]);
  },

  appBrowser: async ({ installed, userDataDir, appOutput }, use, testInfo) => {
    // The packaged app has its code in app.asar: no app path argument, unlike the dev harness.
    // Not `_electron.launch`: it needs `--inspect` on the main process, which the packaged
    // build's EnableNodeCliInspectArguments fuse may turn off. `--remote-debugging-port` is a
    // Chromium switch that stays; Playwright attaches to the renderer over CDP.
    const child = spawn(installed.executable, [...headlessArgs(), '--remote-debugging-port=0'], {
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', THICKET_USER_DATA: userDataDir },
      // Own process group on POSIX, so the AppImage runtime, Electron and its helpers die together.
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk: Buffer) => appOutput.push(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => appOutput.push(chunk.toString()));
    let browser: Browser | undefined;
    try {
      const endpoint = await devToolsEndpoint(child, appOutput, 60_000);
      browser = await chromium.connectOverCDP(endpoint);
      await use(browser);
    } finally {
      if (browser && testInfo.status !== testInfo.expectedStatus) {
        await screenshotPages(appPages(browser), testInfo);
      }
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('app output', {
          body: appOutput.join(''),
          contentType: 'text/plain',
        });
      }
      await browser?.close().catch(() => undefined);
      // The whole tree: the AppImage runtime exits before Electron and its helpers do.
      await endProcessTree(child);
    }
  },

  window: async ({ appBrowser }, use) => {
    const page = await appWindow(appBrowser, 30_000);
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

/**
 * Saves a PNG of every page to the test's output folder (like the harness's `screenshotWindows`,
 * which needs an `ElectronApplication`).
 */
async function screenshotPages(pages: Page[], testInfo: TestInfo): Promise<void> {
  for (const [index, page] of pages.entries()) {
    const path = testInfo.outputPath(`failure-window-${index}.png`);
    try {
      await page.screenshot({ path, timeout: 5_000 });
      await testInfo.attach(`window ${index}`, { path, contentType: 'image/png' });
    } catch (error) {
      console.warn(`screenshot of window ${index} failed: ${String(error)}`);
    }
  }
}

/** The renderer pages (not DevTools or service workers) of every context. */
function appPages(browser: Browser): Page[] {
  return browser.contexts().flatMap((context) => context.pages());
}

/** The app window: the first page on `thicket://app`, waiting for it to open. */
async function appWindow(browser: Browser, timeoutMs: number): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const page = appPages(browser).find((p) => p.url().startsWith('thicket://app'));
    if (page) return page;
    if (Date.now() > deadline)
      throw new Error(
        `no thicket://app window within ${timeoutMs} ms (pages: ${appPages(browser)
          .map((p) => p.url())
          .join(', ')})`,
      );
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Waits for Chromium's `DevTools listening on ws://...` line on stderr. */
function devToolsEndpoint(
  child: ChildProcess,
  output: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let seen = '';
    const onData = (chunk: Buffer) => {
      seen += chunk.toString();
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(seen);
      if (match) {
        done();
        resolvePromise(match[1] as string);
      }
    };
    const onExit = (code: number | null) => {
      done();
      reject(
        new Error(`the app exited (${String(code)}) before DevTools listened:\n${output.join('')}`),
      );
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(`no DevTools endpoint within ${timeoutMs} ms:\n${output.join('')}`));
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      child.stderr?.off('data', onData);
      child.off('exit', onExit);
    };
    child.stderr?.on('data', onData);
    child.on('exit', onExit);
  });
}

test('the packaged app starts and shows the welcome screen', async ({ window }) => {
  expect(window.url()).toMatch(/^thicket:\/\/app\//);
  await expect(window).toHaveTitle('Thicket');
  await expect(window.getByRole('heading', { name: 'Thicket', level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  await expect(window.getByTestId('welcome-new')).toBeVisible();
  await expect(window.getByTestId('welcome-import')).toBeVisible();
});

test.describe('MongoDB', () => {
  // Declared at describe level, the skip applies before the app is launched.
  const notHere = mongoSmokeSkipReason();
  test.skip(notHere !== undefined, notHere);

  test('the packaged app connects to a containerized MongoDB', async ({ window }) => {
    test.setTimeout(240_000);
    const unavailable = await containerRuntimeUnavailable();
    if (unavailable) {
      if (process.env['THICKET_SMOKE_MONGO'] === '1') throw new Error(unavailable);
      test.skip(true, unavailable);
    }
    const mongo = await startMongo('mongo8');
    try {
      await window.getByTestId('welcome-new').click();
      await expect(window.getByTestId('connection-editor')).toBeVisible();
      await window.getByTestId('field-name').fill('Smoke');
      await window.getByTestId('tab-uri').click();
      await window.getByTestId('field-uri').fill(mongo.uri);
      await expect(window.getByTestId('uri-error')).toHaveCount(0);

      // Test connection runs in the packaged backend (bundled driver), against the real server.
      await window.getByTestId('test-connection').click();
      await expect(window.getByTestId('test-ok')).toContainText('Connected in', {
        timeout: 60_000,
      });
      await expect(window.getByTestId('test-ok')).toContainText('MongoDB 8.');

      // Saved and opened from the sidebar: the connection reaches the connected state.
      await window.getByTestId('save').click();
      await expect(window.getByTestId('saved-notice')).toBeVisible();
      const conn = window.locator('[data-testid="tree-conn"][data-name="Smoke"]');
      await conn.click();
      await expect(conn).toHaveAttribute('data-state', 'connected', { timeout: 60_000 });
    } finally {
      await mongo.stop();
    }
  });
});
