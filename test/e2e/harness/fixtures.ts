import {
  test as base,
  expect,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { launchApp, realUserDataDir, snapshotDir } from './app';
import { containerRuntimeUnavailable, startMongo, type E2EMongo, type FixtureName } from './mongo';
import { screenshot } from './screenshot';

export interface E2EFixtures {
  /** Fresh temporary folder used as the app's `userData`; deleted after the test. */
  userDataDir: string;
  /** Extra environment for the app (override with `test.use({ appEnv: {...} })`). */
  appEnv: Record<string, string>;
  /**
   * A packaged build to start instead of the development build (`LaunchOptions.executable`), e.g.
   * `test.use({ appExecutable: '…/thicket-0.0.0-linux-x86_64.AppImage' })`.
   */
  appExecutable: string | undefined;
  /** The app's stdout/stderr lines; attached to the report when the test fails. */
  appOutput: string[];
  /** The built app, started with `userDataDir`. Screenshots its windows when the test fails. */
  electronApp: ElectronApplication;
  /** The app's first window, after `domcontentloaded`. */
  window: Page;
  /** A running MongoDB fixture (`mongoFixture` option); the test is skipped without Docker/Podman. */
  mongo: E2EMongo;
}

export interface E2EWorkerFixtures {
  /** Which integration fixture `mongo` starts (default `mongo8`). */
  mongoFixture: FixtureName;
  /** Started once per worker on first use, or the reason it can't run. */
  mongoServer: E2EMongo | { unavailable: string };
}

/** Saves a PNG of every open window to the test's output folder (under test-results/). */
export async function screenshotWindows(app: ElectronApplication, testInfo: TestInfo) {
  const windows = app.windows();
  for (const [index, page] of windows.entries()) {
    const path = testInfo.outputPath(`failure-window-${index}.png`);
    try {
      await screenshot(app, page, path);
      await testInfo.attach(`window ${index}`, { path, contentType: 'image/png' });
    } catch (error) {
      console.warn(`screenshot of window ${index} failed: ${String(error)}`);
    }
  }
}

export const test = base.extend<E2EFixtures, E2EWorkerFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their deps.
  userDataDir: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'thicket-e2e-userdata-'));
    try {
      await use(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },

  appEnv: [{}, { option: true }],

  appExecutable: [undefined, { option: true }],

  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their deps.
  appOutput: async ({}, use) => {
    await use([]);
  },

  electronApp: async ({ userDataDir, appEnv, appExecutable, appOutput }, use, testInfo) => {
    const realDir = realUserDataDir();
    const before = await snapshotDir(realDir);
    const app = await launchApp({
      userDataDir,
      env: appEnv,
      output: appOutput,
      ...(appExecutable ? { executable: appExecutable } : {}),
    });
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
    // The real user's data must be exactly as before: the app only uses the temporary folder.
    expect(await snapshotDir(realDir), `the app wrote to the real userData ${realDir}`).toEqual(
      before,
    );
  },

  window: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },

  mongoFixture: ['mongo8', { option: true, scope: 'worker' }],

  mongoServer: [
    async ({ mongoFixture }, use) => {
      const unavailable = await containerRuntimeUnavailable();
      if (unavailable) {
        await use({ unavailable });
        return;
      }
      const server = await startMongo(mongoFixture);
      try {
        await use(server);
      } finally {
        await server.stop();
      }
    },
    { scope: 'worker', timeout: 180_000 },
  ],

  mongo: async ({ mongoServer }, use, testInfo) => {
    if ('unavailable' in mongoServer) testInfo.skip(true, mongoServer.unavailable);
    else await use(mongoServer);
  },
});

export { expect };
