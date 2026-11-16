import { defineConfig } from 'vitest/config';

// `npm run test:electron -w apps/desktop`: starts the built app (dist/, after scripts/build.mjs)
// with Playwright's Electron driver. Needs the renderer build (npm run build -w packages/renderer)
// and a display: on Linux either xvfb-run or THICKET_TEST_HEADLESS=1 (Chromium's headless Ozone).
export default defineConfig({
  test: {
    name: 'desktop-electron',
    environment: 'node',
    include: ['test/**/*.electron.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
