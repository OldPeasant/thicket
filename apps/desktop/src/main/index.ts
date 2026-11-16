/**
 * Electron main process (bundled to `dist/main.cjs`): serves the renderer from `thicket://app`,
 * starts the backend utilityProcess and opens the window.
 *
 * Environment:
 * - `THICKET_DEV_SERVER`: load the renderer from this URL (the `ng serve` origin) instead.
 * - `THICKET_RENDERER_DIR`: folder of the built renderer (default `packages/renderer/dist`).
 */
import { fromMainPort, serve } from '@thicket/backend';
import { privilegedMethods } from '@thicket/contract';
import {
  BrowserWindow,
  MessageChannelMain,
  app,
  protocol,
  safeStorage,
  session,
  utilityProcess,
  type MessagePortMain,
} from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { SecretsStore } from '../secrets';
import { BackendHost } from './backend-host';
import { mainHandlers, privilegedHandlers } from './handlers';
import {
  APP_ORIGIN,
  APP_SCHEME,
  blockNavigation,
  blockWebview,
  contentSecurityPolicy,
  denyPermission,
  denyWindowOpen,
  mimeType,
  resolveAppFile,
  withCspHeader,
} from './security';
import { openWindow } from './window';

const log = (message: string) => console.log(`[main] ${message}`);

const distDir = __dirname;
const devServer = process.env['THICKET_DEV_SERVER'] || undefined;
const rendererDir =
  process.env['THICKET_RENDERER_DIR'] ||
  path.resolve(distDir, '..', '..', '..', 'packages', 'renderer', 'dist');
const csp = contentSecurityPolicy(devServer);

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Every web contents, also ones we don't create on purpose: no popups, no navigation, no webviews.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(denyWindowOpen);
  contents.on('will-navigate', (event) => {
    if (blockNavigation(event, event.url, contents.getURL()))
      log(`blocked navigation to ${event.url}`);
  });
  contents.on('will-redirect', (event) => {
    blockNavigation(event, event.url, contents.getURL());
  });
  // Subframes (also refused by the CSP's `frame-src 'none'`); the main frame is `will-navigate`'s.
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && blockNavigation(event))
      log(`blocked frame navigation to ${event.url}`);
  });
  contents.on('will-attach-webview', blockWebview);
});

/** `secrets.bin` in `userData`; created once the app is ready (safeStorage needs that on Linux). */
let secrets: SecretsStore | undefined;

function secretsStore(): SecretsStore {
  secrets ??= new SecretsStore({
    file: path.join(app.getPath('userData'), 'secrets.bin'),
    safeStorage,
    platform: process.platform,
    log: (message) => log(`secrets: ${message}`),
  });
  return secrets;
}

const host = new BackendHost<MessagePortMain>({
  fork: () =>
    utilityProcess.fork(path.join(distDir, 'backend.cjs'), [], {
      serviceName: 'Thicket backend',
      stdio: 'inherit',
    }),
  createChannel: () => new MessageChannelMain(),
  servePrivileged: (port) =>
    serve(fromMainPort(port), {
      table: privilegedMethods,
      route: 'main',
      handlers: privilegedHandlers({ secrets: secretsStore() }),
      onError: (error) => log(`privileged handler: ${String(error)}`),
    }),
  closePort: (port) => port.close(),
  log,
});

async function serveAppFile(request: Request): Promise<Response> {
  const file = resolveAppFile(request.url, rendererDir, path.join);
  if (!file) return new Response('Not found', { status: 404 });
  try {
    const body = await readFile(file);
    return new Response(body, {
      headers: { 'content-type': mimeType(file), 'content-security-policy': csp },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function createWindow(): void {
  openWindow({
    preload: path.join(distDir, 'preload.cjs'),
    url: devServer ?? `${APP_ORIGIN}/index.html`,
    host,
    mainHandlers: mainHandlers({ version: app.getVersion(), secrets: secretsStore() }),
    log,
  });
}

void app.whenReady().then(() => {
  protocol.handle(APP_SCHEME, serveAppFile);
  // The dev server's responses (and anything else loaded over http) get the same CSP.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: withCspHeader(details.responseHeaders, csp) });
  });
  session.defaultSession.setPermissionRequestHandler(denyPermission);
  session.defaultSession.setPermissionCheckHandler(() => false);

  // Detect the keychain backend now (on Linux this also enables the plain-text key for `basic_text`).
  void secretsStore()
    .status()
    .then((status) => log(`secret storage: ${status.level} (${status.backend})`));
  host.start();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => host.stop());
