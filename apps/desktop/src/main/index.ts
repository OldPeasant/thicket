/**
 * Electron main process (bundled to `dist/main.cjs`): serves the renderer from `thicket://app`,
 * starts the backend utilityProcess and opens the window.
 *
 * Environment:
 * - `THICKET_DEV_SERVER`: load the renderer from this URL (the `ng serve` origin) instead.
 * - `THICKET_RENDERER_DIR`: folder of the built renderer (default `packages/renderer/dist`).
 *   A packaged app ignores both and serves `resources/renderer` (`rendererSource`).
 * - `THICKET_USER_DATA`: use this folder as Electron's `userData` (settings.json ...), for tests.
 * - `THICKET_UPDATE_CHECK=1`: check GitHub for updates also when not packaged (`updateChecker`).
 */
import { fromMainPort, serve } from '@thicket/backend';
import { BROADCAST_STREAMS, privilegedMethods, type SettingsChanged } from '@thicket/contract';
import {
  BrowserWindow,
  MessageChannelMain,
  app,
  dialog,
  protocol,
  safeStorage,
  session,
  shell,
  utilityProcess,
  type MessagePortMain,
} from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { NativeDialogs } from '../dialogs';
import { PipelinesStore } from '../pipelines';
import { ProfilesStore } from '../profiles';
import { SecretsStore } from '../secrets';
import { HistoryStore } from '../history';
import { SettingsStore } from '../settings/store';
import { UpdateChecker, openReleaseLink } from '../update';
import { BackendHost } from './backend-host';
import { Broadcaster } from './broadcast';
import { mainHandlers, privilegedHandlers } from './handlers';
import {
  APP_ORIGIN,
  APP_SCHEME,
  blockNavigation,
  blockWebview,
  contentSecurityPolicy,
  denyPermission,
  mimeType,
  resolveAppFile,
  withCspHeader,
} from './security';
import { rendererSource } from './renderer-source';
import { openWindow } from './window';

const log = (message: string) => console.log(`[main] ${message}`);

const distDir = __dirname;
const { devServer, rendererDir } = rendererSource({
  packaged: app.isPackaged,
  env: process.env,
  resourcesPath: process.resourcesPath,
  distDir,
});
const csp = contentSecurityPolicy(devServer);

const userDataOverride = process.env['THICKET_USER_DATA'];
if (userDataOverride) app.setPath('userData', path.resolve(userDataOverride));
const broadcaster = new Broadcaster(log);

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Every web contents, also ones we don't create on purpose: no popups, no navigation, no webviews.
app.on('web-contents-created', (_event, contents) => {
  // No popups; the update notice's link to a Thicket release page opens in the user's browser.
  contents.setWindowOpenHandler(({ url }) =>
    openReleaseLink(url, (link) => shell.openExternal(link), log),
  );
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

/** `connections.json` in `userData` (profiles without secrets). */
let profiles: ProfilesStore | undefined;

function profilesStore(): ProfilesStore {
  profiles ??= new ProfilesStore({
    file: path.join(app.getPath('userData'), 'connections.json'),
    secrets: secretsStore(),
    log: (message) => log(`profiles: ${message}`),
  });
  return profiles;
}

/** `pipelines.json` in `userData` (saved aggregation pipelines). */
let pipelines: PipelinesStore | undefined;

function pipelinesStore(): PipelinesStore {
  pipelines ??= new PipelinesStore({
    file: path.join(app.getPath('userData'), 'pipelines.json'),
    log: (message) => log(`pipelines: ${message}`),
  });
  return pipelines;
}

/** `history/` and `favorites.json` in `userData` (query history and favorite queries). */
let history: HistoryStore | undefined;

function historyStore(): HistoryStore {
  history ??= new HistoryStore({
    dir: app.getPath('userData'),
    log: (message) => log(`history: ${message}`),
  });
  return history;
}

/**
 * The update check (GitHub releases API), one per app. Only a packaged app checks by default: a
 * dev or test run (version 0.0.0) would always see an update and must not call GitHub;
 * `THICKET_UPDATE_CHECK=1` turns it on there. The `checkForUpdates` setting is read on every check.
 */
let updates: UpdateChecker | undefined;

function updateChecker(settings: SettingsStore): UpdateChecker {
  const allowed = app.isPackaged || process.env['THICKET_UPDATE_CHECK'] === '1';
  updates ??= new UpdateChecker({
    current: app.getVersion(),
    enabled: () => allowed && settings.get().checkForUpdates,
    log: (message) => log(`update: ${message}`),
  });
  return updates;
}

/** File dialogs for the backend (io.*), attached to the focused window (or any window). */
const nativeDialogs: NativeDialogs = {
  showSaveDialog: (options) => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options);
  },
  showOpenDialog: (options) => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
  },
};

const host = new BackendHost<MessagePortMain>({
  fork: () =>
    utilityProcess.fork(path.join(distDir, 'backend.cjs'), [], {
      serviceName: 'Thicket backend',
      stdio: 'inherit',
      // The backend keeps the SSH `known_hosts` in userData.
      env: { ...process.env, THICKET_USER_DATA: app.getPath('userData') },
    }),
  createChannel: () => new MessageChannelMain(),
  servePrivileged: (port) =>
    serve(fromMainPort(port), {
      table: privilegedMethods,
      route: 'main',
      handlers: privilegedHandlers({
        secrets: secretsStore(),
        profiles: profilesStore(),
        dialogs: nativeDialogs,
        oidc: {
          openExternal: (url) => shell.openExternal(url),
          hasProfile: (profileId) => profilesStore().has(profileId),
          log: (message) => log(`oidc: ${message}`),
        },
      }),
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

function createWindow(settings: SettingsStore): void {
  openWindow({
    preload: path.join(distDir, 'preload.cjs'),
    url: devServer ?? `${APP_ORIGIN}/index.html`,
    host,
    mainHandlers: mainHandlers({
      version: app.getVersion(),
      secrets: secretsStore(),
      settings,
      profiles: profilesStore(),
      dialogs: nativeDialogs,
      pipelines: pipelinesStore(),
      history: historyStore(),
      updates: updateChecker(settings),
      log: (message) => log(`profiles: ${message}`),
    }),
    broadcaster,
    log,
  });
}

void app.whenReady().then(async () => {
  const settings = await SettingsStore.open(path.join(app.getPath('userData'), 'settings.json'), {
    log,
  });
  settings.onChange((value) =>
    broadcaster.emit(BROADCAST_STREAMS.settingsChanged, {
      settings: value,
    } satisfies SettingsChanged),
  );

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
  createWindow(settings);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(settings);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => host.stop());
