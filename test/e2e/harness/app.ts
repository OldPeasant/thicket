import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication } from '@playwright/test';

export const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** The Electron app folder (`package.json` `main` → `dist/main.cjs`, built by `npm run test:e2e`). */
export const appDir = join(repoDir, 'apps', 'desktop');

// Electron binary lookup, headlessArgs() and the launch env duplicate
// apps/desktop/test/helpers.ts: keep in sync with it.
// The `electron` package's main export is the path of the Electron binary.
const electronPath = createRequire(join(appDir, 'package.json'))('electron') as string;

/**
 * Without a display (CI without xvfb-run), use Chromium's headless Ozone backend. Its screen is
 * 1×1 px by default, which shrinks the window to 1×1: nothing visible gets painted and
 * screenshots hang or come out blank. So give the headless screen a real size.
 */
export function headlessArgs(): string[] {
  const noDisplay = !process.env['DISPLAY'] && !process.env['WAYLAND_DISPLAY'];
  const wanted = process.env['THICKET_TEST_HEADLESS'] === '1';
  return process.platform === 'linux' && (noDisplay || wanted)
    ? ['--ozone-platform=headless', `--ozone-override-screen-size=${HEADLESS_SCREEN}`]
    : [];
}

/** Screen size (`width,height`) of the headless Ozone backend; the app window is 1280×800. */
export const HEADLESS_SCREEN = '1920,1080';

export interface LaunchOptions {
  /** Folder used as Electron's `userData` (`THICKET_USER_DATA`). */
  userDataDir: string;
  /** Extra environment variables for the app. */
  env?: Record<string, string>;
  /** Chromium/Electron switches, placed before the app path. */
  switches?: string[];
  /** Receives the app's stdout and stderr. */
  output?: string[];
  /**
   * A packaged build to start instead of the development build in `apps/desktop` (an AppImage,
   * `release/linux-unpacked/thicket`, ...). AppImages get `APPIMAGE_EXTRACT_AND_RUN=1`, so they
   * start without FUSE (as in `apps/desktop/scripts/smoke-packaged.mjs`).
   */
  executable?: string;
}

/** Starts the built app with Playwright's Electron driver and an explicit `userData` folder. */
export async function launchApp(options: LaunchOptions): Promise<ElectronApplication> {
  const packaged = options.executable;
  const app = await _electron.launch({
    executablePath: packaged ?? electronPath,
    args: [...headlessArgs(), ...(options.switches ?? []), ...(packaged ? [] : [appDir])],
    // An AppImage extracts itself before Electron starts.
    ...(packaged ? { timeout: 120_000 } : {}),
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
      ...(packaged ? { APPIMAGE_EXTRACT_AND_RUN: '1' } : {}),
      ...options.env,
      THICKET_USER_DATA: options.userDataDir,
    } as Record<string, string>,
  });
  const output = options.output;
  if (output) {
    app.process().stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    app.process().stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  }
  return app;
}

/** Electron's app name: `productName`, else `name` of the app's package.json. */
export function appName(): string {
  const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')) as {
    name: string;
    productName?: string;
  };
  return pkg.productName ?? pkg.name;
}

/**
 * The `userData` folder the app would use without `THICKET_USER_DATA` (Electron's default:
 * `appData` + app name), i.e. the real user's data that tests must never touch.
 */
export function realUserDataDir(): string {
  const home = homedir();
  let appData: string;
  if (process.platform === 'win32')
    appData = process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming');
  else if (process.platform === 'darwin') appData = join(home, 'Library', 'Application Support');
  else appData = process.env['XDG_CONFIG_HOME'] || join(home, '.config');
  return join(appData, appName());
}

/**
 * Every entry below `dir` with size and modification time, or `null` when `dir` doesn't exist.
 * Two equal snapshots mean nothing was created, deleted or written there in between.
 */
export async function snapshotDir(dir: string): Promise<Record<string, string> | null> {
  try {
    await stat(dir);
  } catch {
    return null;
  }
  const result: Record<string, string> = {};
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    const path = join(entry.parentPath, entry.name);
    try {
      const info = await stat(path);
      result[path] = `${info.isDirectory() ? 'd' : 'f'}:${info.size}:${info.mtimeMs}`;
    } catch {
      result[path] = 'vanished';
    }
  }
  return result;
}
