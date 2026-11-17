import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** A packaged Thicket made runnable from an installer file; `cleanup()` undoes the install. */
export interface InstalledApp {
  /** The Thicket executable inside the installed or mounted app. */
  executable: string;
  cleanup(): Promise<void>;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Why the MongoDB smoke test is skipped on this host, or `undefined` when it runs: it runs on Linux
 * or when `THICKET_SMOKE_MONGO=1` asks for it (a missing container runtime then fails the test).
 */
export function mongoSmokeSkipReason(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (platform === 'linux' || env['THICKET_SMOKE_MONGO'] === '1') return undefined;
  return 'MongoDB containers are Linux-only in the smoke test (Windows runners have Windows containers only, macOS runners no Docker)';
}

/** Installer suffix `npm run dist` produces for this OS that `installApp` can start. */
export function installerSuffix(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return '.dmg';
  if (platform === 'win32') return '.exe';
  return '.AppImage';
}

/**
 * The installer for this OS (and, on macOS, this CPU) in `releaseDir` (electron-builder's
 * `release/`); the newest one when there are several versions.
 */
export async function findInstaller(releaseDir: string): Promise<string> {
  const suffix = installerSuffix();
  const names = (await readdir(releaseDir).catch(() => [] as string[])).filter(
    (name) =>
      name.endsWith(suffix) &&
      (process.platform !== 'darwin' || name.includes(process.arch === 'arm64' ? 'arm64' : 'x64')),
  );
  let newest: { path: string; mtime: number } | undefined;
  for (const name of names) {
    const path = join(releaseDir, name);
    const { mtimeMs } = await stat(path);
    if (!newest || mtimeMs > newest.mtime) newest = { path, mtime: mtimeMs };
  }
  if (!newest)
    throw new Error(
      `no *${suffix} in ${releaseDir}: run \`npm run dist\` or set THICKET_SMOKE_INSTALLER`,
    );
  return newest.path;
}

/**
 * Turns an installer built by `npm run dist` (release.yml "Collect installers") into a runnable
 * executable the way a user would get one:
 * - `.AppImage`: made executable and started as is (the AppImage runtime mounts or extracts it;
 *   set `APPIMAGE_EXTRACT_AND_RUN=1` where FUSE is missing).
 * - `.dmg` (macOS): mounted read-only with `hdiutil`, `Thicket.app` started from the image.
 * - `.exe` (Windows NSIS): silent per-user install (`/S /D=<temp dir>`), uninstalled afterwards;
 *   on Windows only in CI or with `THICKET_SMOKE_ALLOW_INSTALL=1` (it replaces a real install).
 */
export async function installApp(installer: string): Promise<InstalledApp> {
  const lower = installer.toLowerCase();
  if (lower.endsWith('.appimage')) {
    await chmod(installer, 0o755);
    return { executable: installer, cleanup: async () => undefined };
  }

  if (lower.endsWith('.dmg')) {
    const mountPoint = await mkdtemp(join(tmpdir(), 'thicket-smoke-dmg-'));
    await run('hdiutil', [
      'attach',
      '-nobrowse',
      '-readonly',
      '-mountpoint',
      mountPoint,
      installer,
    ]);
    const detach = async () => {
      await run('hdiutil', ['detach', mountPoint, '-force']).catch(() => undefined);
      await rm(mountPoint, { recursive: true, force: true });
    };
    const apps = (await readdir(mountPoint)).filter((name) => name.endsWith('.app'));
    if (apps.length !== 1) {
      await detach();
      throw new Error(`expected one .app in ${installer}, found: ${apps.join(', ') || 'none'}`);
    }
    const appName = (apps[0] as string).replace(/\.app$/, '');
    return {
      executable: join(mountPoint, `${appName}.app`, 'Contents', 'MacOS', appName),
      cleanup: detach,
    };
  }

  if (lower.endsWith('.exe')) {
    // The installer shares its uninstall entry (appId) with a real per-user Thicket and silently
    // uninstalls that first: only on throwaway CI runners, or when explicitly allowed.
    if (
      process.platform === 'win32' &&
      !process.env['CI'] &&
      process.env['THICKET_SMOKE_ALLOW_INSTALL'] !== '1'
    )
      throw new Error(
        'refusing to run the NSIS installer outside CI: it would replace (and the cleanup then ' +
          'uninstall) an existing per-user Thicket installation. Set THICKET_SMOKE_ALLOW_INSTALL=1 ' +
          'to run it anyway.',
      );
    const dir = await mkdtemp(join(tmpdir(), 'thicket-smoke-install-'));
    const removeDir = () => rm(dir, { recursive: true, force: true }).catch(() => undefined);
    const executable = join(dir, 'Thicket.exe');
    try {
      // NSIS: `/D=` must be the last argument and is taken verbatim (no quotes).
      await run(installer, ['/S', `/D=${dir}`], { windowsVerbatimArguments: true });
      if (!(await exists(executable))) {
        const found = await readdir(dir).catch(() => []);
        throw new Error(
          `the installer put no Thicket.exe into ${dir} (found: ${found.join(', ')})`,
        );
      }
    } catch (error) {
      await removeDir();
      throw error;
    }
    return {
      executable,
      cleanup: async () => {
        const uninstaller = join(dir, 'Uninstall Thicket.exe');
        // `_?=<dir>` (last, verbatim): the NSIS uninstaller runs in place and we wait for it,
        // instead of it relaunching from %TEMP% and racing the `rm` below.
        if (await exists(uninstaller))
          await run(uninstaller, ['/S', `_?=${dir}`], { windowsVerbatimArguments: true }).catch(
            () => undefined,
          );
        await removeDir();
      },
    };
  }

  throw new Error(`unsupported installer ${installer}: expected .AppImage, .dmg or .exe`);
}
