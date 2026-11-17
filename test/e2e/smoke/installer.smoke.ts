import {
  _electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { appDir, headlessArgs } from '../harness/app';
import { screenshotWindows } from '../harness/fixtures';
import { containerRuntimeUnavailable, startMongo } from '../harness/mongo';
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
 * connects to a containerized MongoDB. `_electron.launch` needs the Electron fuse
 * `EnableNodeCliInspectArguments` left on in packaged builds.
 */

const installerPath = process.env['THICKET_SMOKE_INSTALLER'];

interface SmokeFixtures {
  userDataDir: string;
  appOutput: string[];
  electronApp: ElectronApplication;
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
      await rm(dir, { recursive: true, force: true });
    }
  },

  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their deps.
  appOutput: async ({}, use) => {
    await use([]);
  },

  electronApp: async ({ installed, userDataDir, appOutput }, use, testInfo) => {
    // The packaged app has its code in app.asar: no app path argument, unlike the dev harness.
    const app = await _electron.launch({
      executablePath: installed.executable,
      args: headlessArgs(),
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        THICKET_USER_DATA: userDataDir,
      } as Record<string, string>,
      timeout: 60_000,
    });
    app.process().stdout?.on('data', (chunk: Buffer) => appOutput.push(chunk.toString()));
    app.process().stderr?.on('data', (chunk: Buffer) => appOutput.push(chunk.toString()));
    try {
      await use(app);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        await screenshotWindows(app, testInfo);
        await testInfo.attach('app output', {
          body: appOutput.join(''),
          contentType: 'text/plain',
        });
      }
      await app.close().catch(() => app.process().kill('SIGKILL'));
    }
  },

  window: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

test('the packaged app starts and shows the welcome screen', async ({ electronApp, window }) => {
  expect(await electronApp.evaluate(({ app }) => app.isPackaged)).toBe(true);
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
