// Smoke test for a packaged build: starts the executable (an AppImage, release/linux-unpacked/thicket,
// Thicket.app/Contents/MacOS/Thicket, Thicket.exe ...), attaches to its renderer over the Chromium
// DevTools protocol, checks that the renderer loaded from thicket://app and that main and the
// backend answer their pings, then writes a screenshot. It also reads the Electron fuses of the
// binary (electron-builder.yml `electronFuses`) unless it is an AppImage, and checks the hardening
// at runtime: ELECTRON_RUN_AS_NODE=1 `-e` runs no script, `--inspect` is ignored, and
// THICKET_DEV_SERVER / THICKET_RENDERER_DIR do not change what is loaded.
//
//   node scripts/smoke-packaged.mjs <executable> [screenshot.png]
//
// Packaged builds have the EnableNodeCliInspectArguments fuse off, so Playwright's Electron driver
// (which needs `--inspect` on the main process) cannot attach; `--remote-debugging-port` is a
// Chromium switch, unaffected by the fuses, and only reaches the renderer.
//
// Linux without a display: runs with Chromium's headless Ozone backend (or use xvfb-run).
// AppImages get APPIMAGE_EXTRACT_AND_RUN=1 so they also start where FUSE is not available.
import fuses from '@electron/fuses';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const [executable, screenshot = 'release/smoke.png'] = process.argv.slice(2);
if (!executable) {
  console.error('usage: node scripts/smoke-packaged.mjs <executable> [screenshot.png]');
  process.exit(2);
}

/** Fuses the packaged binary must have (FuseV1Options name -> expected state). */
const EXPECTED_FUSES = {
  RunAsNode: 'DISABLE',
  EnableNodeOptionsEnvironmentVariable: 'DISABLE',
  EnableNodeCliInspectArguments: 'DISABLE',
  OnlyLoadAppFromAsar: 'ENABLE',
  EnableEmbeddedAsarIntegrityValidation: 'ENABLE',
};
/** Fuse wire bytes (@electron/fuses FuseState, which its index does not export). */
const FUSE_STATES = { 48: 'DISABLE', 49: 'ENABLE', 114: 'REMOVED', 144: 'INHERIT' };
const TIMEOUT = 60_000;
const NODE_MARKER = 'THICKET_SMOKE_NODE_RAN';

const noDisplay = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const headless =
  process.platform === 'linux' && (noDisplay || process.env.THICKET_TEST_HEADLESS === '1');
// Headless Ozone's default screen is 1x1, which clamps the window to 1x1 (blank or hanging
// screenshots): give it a real screen size.
const HEADLESS_ARGS = ['--ozone-platform=headless', '--ozone-override-screen-size=1920,1080'];
const userData = mkdtempSync(join(tmpdir(), 'thicket-smoke-'));
const output = [];

/** Reads the fuse wire; undefined for AppImages (the binary is inside the squashfs). */
async function readFuses(path) {
  if (/\.AppImage$/i.test(path)) return undefined;
  const wire = await fuses.getCurrentFuseWire(path);
  const states = {};
  for (const name of Object.keys(EXPECTED_FUSES)) {
    const state = wire[fuses.FuseV1Options[name]];
    states[name] = FUSE_STATES[state] ?? String(state);
  }
  return states;
}

/** Resolves with the DevTools WebSocket URL Chromium prints to stderr. */
function devToolsUrl(child) {
  return new Promise((resolveUrl, reject) => {
    let buffered = '';
    const timer = setTimeout(() => reject(new Error('no DevTools URL within 60 s')), TIMEOUT);
    child.stderr.on('data', (chunk) => {
      buffered += chunk.toString();
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffered);
      if (match) {
        clearTimeout(timer);
        resolveUrl(match[1]);
      }
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`app exited before DevTools was ready (code ${code}, signal ${signal})`));
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * With ELECTRON_RUN_AS_NODE=1, `<executable> -e <script>` must not run the script (RunAsNode fuse
 * off): the app starts normally instead. Node would print the marker at once; the probe stops the
 * app after 10 s (or when it exits) and reports whether the marker appeared.
 */
async function runAsNodeRan(path) {
  const probeData = mkdtempSync(join(tmpdir(), 'thicket-smoke-node-'));
  const probe = spawn(
    path,
    ['-e', `console.log('${NODE_MARKER}')`, ...(headless ? HEADLESS_ARGS : [])],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        APPIMAGE_EXTRACT_AND_RUN: '1',
        THICKET_USER_DATA: probeData,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let text = '';
  try {
    await new Promise((done) => {
      const timer = setTimeout(done, 10_000);
      const onData = (chunk) => {
        text += chunk.toString();
        if (text.includes(NODE_MARKER)) done();
      };
      probe.stdout.on('data', onData);
      probe.stderr.on('data', onData);
      probe.once('exit', () => (clearTimeout(timer), done()));
      probe.once('error', () => (clearTimeout(timer), done()));
    });
  } finally {
    await stop(probe);
    rmSync(probeData, { recursive: true, force: true });
  }
  return text.includes(NODE_MARKER);
}

/** Stops the app: SIGTERM (Electron quits cleanly), SIGKILL after 10 s. */
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((done) => child.once('exit', done));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  await exited;
  clearTimeout(timer);
}

let child;
let browser;
let failed = false;
try {
  const fuseStates = await readFuses(resolve(executable));
  const nodeRan = await runAsNodeRan(resolve(executable));
  // What the packaged app must shrug off: `--inspect` (fuse) and the dev-only renderer overrides
  // (ignored when packaged, so the page still comes from thicket://app). NODE_OPTIONS is checked
  // by the fuse read only: Electron drops most NODE_OPTIONS (`--require` too) in packaged apps
  // even with the fuse on, so a runtime probe would show nothing either way.
  child = spawn(
    resolve(executable),
    ['--remote-debugging-port=0', '--inspect=0', ...(headless ? HEADLESS_ARGS : [])],
    {
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        APPIMAGE_EXTRACT_AND_RUN: '1',
        THICKET_USER_DATA: userData,
        THICKET_DEV_SERVER: 'http://127.0.0.1:9',
        THICKET_RENDERER_DIR: join(userData, 'no-renderer'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  browser = await chromium.connectOverCDP(await devToolsUrl(child), { timeout: TIMEOUT });
  const context = browser.contexts()[0] ?? (await browser.waitForEvent('context'));
  // The app has one window. Its target can still be on the initial blank document (main creates
  // the BrowserWindow before loadURL), so wait for the navigation away from about: before the load
  // state and the pings; a wrong origin is then reported by the URL check below, not a timeout.
  const page = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: TIMEOUT }));
  await page.waitForURL((url) => url.protocol !== 'about:', { timeout: TIMEOUT });
  await page.waitForLoadState('load');
  // Runs in the renderer, where the preload exposes `thicket` on the window.
  const call = (request) => page.evaluate((r) => globalThis.thicket.request(r), request);
  const mainPing = await call({ id: 'smoke-1', method: 'app.ping', params: {} });
  const backendPing = await call({ id: 'smoke-2', method: 'backend.ping', params: {} });
  const visibility = await page.evaluate(() => globalThis.document.visibilityState);
  await page.screenshot({ path: screenshot });
  const log = output.join('');
  const result = {
    url: page.url(),
    title: await page.title(),
    visibility,
    fuses: fuseStates ?? 'not read (AppImage)',
    runAsNode: nodeRan ? 'RAN' : 'ignored',
    inspect: /Debugger listening/.test(log) ? 'LISTENING' : 'ignored',
    mainPing: mainPing.ok ? mainPing.result : mainPing,
    backendPing: backendPing.ok ? backendPing.result.process : backendPing,
    screenshot: resolve(screenshot),
  };
  console.log(`smoke: ${JSON.stringify(result)}`);
  const wrongFuses = fuseStates
    ? Object.entries(EXPECTED_FUSES).filter(([name, state]) => fuseStates[name] !== state)
    : [];
  if (wrongFuses.length > 0) console.error(`smoke: wrong fuses ${JSON.stringify(wrongFuses)}`);
  if (
    !result.url.startsWith('thicket://app/') ||
    result.mainPing?.process !== 'main' ||
    result.backendPing !== 'backend' ||
    visibility !== 'visible' ||
    wrongFuses.length > 0 ||
    result.runAsNode !== 'ignored' ||
    result.inspect !== 'ignored'
  ) {
    failed = true;
  }
} catch (error) {
  failed = true;
  console.error(`smoke: ${String(error)}`);
} finally {
  await browser?.close().catch((error) => console.error(`smoke: close failed: ${String(error)}`));
  if (child) await stop(child);
  rmSync(userData, { recursive: true, force: true });
}

if (failed) {
  console.error(output.join(''));
  console.error('smoke: FAILED');
  process.exit(1);
}
console.log('smoke: OK');
