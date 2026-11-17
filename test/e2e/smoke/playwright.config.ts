import { defineConfig } from '@playwright/test';

// `npm run test:smoke`: starts a packaged Thicket from the installer in THICKET_SMOKE_INSTALLER
// (installer.smoke.ts). Not part of `npm run test:e2e`, which runs the unpackaged build.
// On Linux run it under `xvfb-run -a`; without a display the app uses Chromium's headless Ozone.
export default defineConfig({
  testDir: '.',
  testMatch: '*.smoke.ts',
  outputDir: '../../../test-results/smoke',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
});
