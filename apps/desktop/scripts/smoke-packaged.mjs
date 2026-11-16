// Smoke test for a packaged build: starts the executable (an AppImage, release/linux-unpacked/thicket,
// Thicket.app/Contents/MacOS/Thicket, Thicket.exe ...) with Playwright's Electron driver, waits for
// the window, checks that the renderer loaded from thicket://app and that main and the backend
// answer their pings, then writes a screenshot.
//
//   node scripts/smoke-packaged.mjs <executable> [screenshot.png]
//
// Linux without a display: runs with Chromium's headless Ozone backend (or use xvfb-run).
// AppImages get APPIMAGE_EXTRACT_AND_RUN=1 so they also start where FUSE is not available.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright-core';

const [executable, screenshot = 'release/smoke.png'] = process.argv.slice(2);
if (!executable) {
  console.error('usage: node scripts/smoke-packaged.mjs <executable> [screenshot.png]');
  process.exit(2);
}

const noDisplay = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const headless =
  process.platform === 'linux' && (noDisplay || process.env.THICKET_TEST_HEADLESS === '1');
const userData = mkdtempSync(join(tmpdir(), 'thicket-smoke-'));
const output = [];

const app = await _electron.launch({
  executablePath: resolve(executable),
  args: headless ? ['--ozone-platform=headless'] : [],
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1',
    APPIMAGE_EXTRACT_AND_RUN: '1',
    THICKET_USER_DATA: userData,
  },
  timeout: 60_000,
});
app.process().stdout?.on('data', (chunk) => output.push(chunk.toString()));
app.process().stderr?.on('data', (chunk) => output.push(chunk.toString()));

let failed = false;
try {
  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForLoadState('load');
  // Runs in the renderer, where the preload exposes `thicket` on the window.
  const call = (request) => page.evaluate((r) => globalThis.thicket.request(r), request);
  const mainPing = await call({ id: 'smoke-1', method: 'app.ping', params: {} });
  const backendPing = await call({ id: 'smoke-2', method: 'backend.ping', params: {} });
  const info = await app.evaluate(({ app: electronApp }) => ({
    name: electronApp.getName(),
    packaged: electronApp.isPackaged,
    version: electronApp.getVersion(),
  }));
  const windows = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), bounds: w.getBounds() })),
  );
  await page.screenshot({ path: screenshot });
  const result = {
    url: page.url(),
    title: await page.title(),
    app: info,
    windows,
    mainPing: mainPing.ok ? mainPing.result.process : mainPing,
    backendPing: backendPing.ok ? backendPing.result.process : backendPing,
    screenshot: resolve(screenshot),
  };
  console.log(`smoke: ${JSON.stringify(result)}`);
  if (
    !result.url.startsWith('thicket://app/') ||
    !info.packaged ||
    info.name !== 'Thicket' ||
    result.mainPing !== 'main' ||
    result.backendPing !== 'backend' ||
    !windows.some((w) => w.visible)
  ) {
    failed = true;
  }
} catch (error) {
  failed = true;
  console.error(`smoke: ${String(error)}`);
} finally {
  await app.close().catch((error) => console.error(`smoke: close failed: ${String(error)}`));
  rmSync(userData, { recursive: true, force: true });
}

if (failed) {
  console.error(output.join(''));
  console.error('smoke: FAILED');
  process.exit(1);
}
console.log('smoke: OK');
