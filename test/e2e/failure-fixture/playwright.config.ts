import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Config for the deliberately failing specs in this folder. They are not part of `npm run test:e2e`
// (the root config only matches *.e2e.ts); harness-helpers.e2e.ts runs them in a nested Playwright
// process to check that a failing test leaves a screenshot under its output folder.
export default defineConfig({
  testDir: dirname(fileURLToPath(import.meta.url)),
  testMatch: '*.fixture.ts',
  outputDir: process.env['THICKET_E2E_FAILURE_OUTPUT'] ?? 'test-results/failure-fixture',
  workers: 1,
  retries: 0,
  timeout: 60_000,
});
