import { defineConfig } from '@playwright/test';

// `npm run test:e2e`: builds the renderer and the Electron bundles, then runs test/e2e/**/*.e2e.ts
// against the built app with Playwright's `_electron` driver (fixtures in test/e2e/harness).
// On Linux run it under `xvfb-run -a`; without a display the harness uses Chromium's headless Ozone.
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.e2e.ts',
  // Per-test artifacts (failure screenshots, see harness/fixtures.ts); git-ignored.
  outputDir: 'test-results',
  // One Electron instance at a time: the app is heavy and some tests start containers.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
});
