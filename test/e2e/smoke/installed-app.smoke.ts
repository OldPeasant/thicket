import { expect, test } from '@playwright/test';
import { access, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { findInstaller, installApp, installerSuffix } from './installed-app';

// Checks of the smoke test's own helpers (no Vitest project covers test/e2e, so they run here, in
// `npm run test:smoke`, like test/e2e/harness-helpers.e2e.ts does for the e2e harness). They need no
// installer: the `installed` fixture of installer.smoke.ts is only set up for the tests using it.

/** Runs `body` with `process.platform` / `process.arch` reporting other values, then restores them. */
async function withProcess<T>(
  values: { platform?: NodeJS.Platform; arch?: NodeJS.Architecture },
  body: () => Promise<T>,
): Promise<T> {
  const saved = {
    platform: Object.getOwnPropertyDescriptor(process, 'platform'),
    arch: Object.getOwnPropertyDescriptor(process, 'arch'),
  };
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(process, key, { value, configurable: true });
  try {
    return await body();
  } finally {
    for (const [key, descriptor] of Object.entries(saved))
      if (descriptor) Object.defineProperty(process, key, descriptor);
  }
}

/** A fresh temp folder, removed after the test. */
async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `thicket-smoke-spec-${prefix}-`));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

let cleanups: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
  cleanups = [];
});

/** Writes an (empty) file with a fixed modification time (seconds since the epoch). */
async function fileAt(dir: string, name: string, mtime: number): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, '');
  await utimes(path, mtime, mtime);
  return path;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Writes an executable POSIX shell script. */
async function script(path: string, body: string): Promise<string> {
  await writeFile(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return path;
}

test.describe('installerSuffix', () => {
  test('maps each OS to the installer `npm run dist` builds for it', () => {
    expect(installerSuffix('darwin')).toBe('.dmg');
    expect(installerSuffix('win32')).toBe('.exe');
    expect(installerSuffix('linux')).toBe('.AppImage');
  });

  test('falls back to the AppImage on other platforms', () => {
    expect(installerSuffix('freebsd')).toBe('.AppImage');
  });

  test('defaults to the current platform', async () => {
    expect(installerSuffix()).toBe(installerSuffix(process.platform));
    await withProcess({ platform: 'win32' }, async () => expect(installerSuffix()).toBe('.exe'));
  });
});

test.describe('findInstaller', () => {
  test('returns the newest Linux AppImage and ignores the other release files', async () => {
    const dir = await tempDir('find');
    await fileAt(dir, 'thicket-0.1.0-linux-x86_64.AppImage', 1_700_000_000);
    const newest = await fileAt(dir, 'thicket-0.0.0-linux-x86_64.AppImage', 1_700_000_500);
    await fileAt(dir, 'thicket-0.2.0-linux-x86_64.AppImage', 1_700_000_100);
    // Newer, but not an AppImage.
    await fileAt(dir, 'thicket-0.3.0-linux-x86_64.deb', 1_800_000_000);
    await fileAt(dir, 'thicket-0.3.0-linux-x86_64.rpm', 1_800_000_000);
    await fileAt(dir, 'thicket-0.3.0-linux-x86_64.AppImage.blockmap', 1_800_000_000);
    await fileAt(dir, 'builder-debug.yml', 1_800_000_000);
    await mkdir(join(dir, 'linux-unpacked'));

    await withProcess({ platform: 'linux' }, async () =>
      expect(await findInstaller(dir)).toBe(newest),
    );
  });

  test('a single installer is returned as is', async () => {
    const dir = await tempDir('single');
    const only = await fileAt(dir, 'thicket-1.0.0-linux-arm64.AppImage', 1_700_000_000);
    await withProcess({ platform: 'linux' }, async () =>
      expect(await findInstaller(dir)).toBe(only),
    );
  });

  test('on Windows picks the newest NSIS .exe, not the portable zip', async () => {
    const dir = await tempDir('win');
    await fileAt(dir, 'thicket-1.0.0-win-x64.exe', 1_700_000_000);
    const newest = await fileAt(dir, 'thicket-1.1.0-win-x64.exe', 1_700_000_100);
    await fileAt(dir, 'thicket-1.2.0-win-x64.zip', 1_800_000_000);
    await fileAt(dir, 'thicket-1.2.0-win-x64.exe.blockmap', 1_800_000_000);
    await withProcess({ platform: 'win32', arch: 'x64' }, async () =>
      expect(await findInstaller(dir)).toBe(newest),
    );
  });

  test('on macOS picks the dmg for this CPU, even when the other arch is newer', async () => {
    const dir = await tempDir('mac');
    const arm = await fileAt(dir, 'thicket-1.0.0-mac-arm64.dmg', 1_700_000_000);
    const x64 = await fileAt(dir, 'thicket-1.0.0-mac-x64.dmg', 1_700_000_100);
    await fileAt(dir, 'thicket-1.1.0-mac-arm64.dmg.blockmap', 1_800_000_000);

    await withProcess({ platform: 'darwin', arch: 'arm64' }, async () =>
      expect(await findInstaller(dir)).toBe(arm),
    );
    await withProcess({ platform: 'darwin', arch: 'x64' }, async () =>
      expect(await findInstaller(dir)).toBe(x64),
    );
  });

  test('on macOS without a dmg for this CPU it fails', async () => {
    const dir = await tempDir('mac-none');
    await fileAt(dir, 'thicket-1.0.0-mac-x64.dmg', 1_700_000_000);
    await withProcess({ platform: 'darwin', arch: 'arm64' }, async () =>
      expect(findInstaller(dir)).rejects.toThrow(/no \*\.dmg in /),
    );
  });

  test('fails with a hint when the folder has no installer for this OS', async () => {
    const dir = await tempDir('empty');
    await fileAt(dir, 'thicket-1.0.0-win-x64.exe', 1_700_000_000);
    await fileAt(dir, 'thicket-1.0.0-linux-x86_64.deb', 1_700_000_000);
    await withProcess({ platform: 'linux' }, async () => {
      const error = await findInstaller(dir).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        `no *.AppImage in ${dir}: run \`npm run dist\` or set THICKET_SMOKE_INSTALLER`,
      );
    });
  });

  test('fails with the same hint when the release folder does not exist', async () => {
    const dir = join(await tempDir('missing'), 'release');
    await withProcess({ platform: 'linux' }, async () =>
      expect(findInstaller(dir)).rejects.toThrow(
        `no *.AppImage in ${dir}: run \`npm run dist\` or set THICKET_SMOKE_INSTALLER`,
      ),
    );
  });
});

test.describe('installApp', () => {
  test('refuses installers it cannot start', async () => {
    for (const name of [
      'thicket.deb',
      'thicket.rpm',
      'thicket.zip',
      'thicket',
      'thicket.AppImage.blockmap',
    ]) {
      await expect(installApp(join(tmpdir(), name))).rejects.toThrow(
        `unsupported installer ${join(tmpdir(), name)}: expected .AppImage, .dmg or .exe`,
      );
    }
  });

  test('makes an AppImage executable and starts it as is', async () => {
    test.skip(process.platform === 'win32', 'POSIX file modes');
    const dir = await tempDir('appimage');
    const appImage = join(dir, 'thicket-1.0.0-linux-x86_64.AppImage');
    await writeFile(appImage, 'fictitious AppImage', { mode: 0o644 });

    const installed = await installApp(appImage);
    expect(installed.executable).toBe(appImage);
    expect((await stat(appImage)).mode & 0o777).toBe(0o755);

    await installed.cleanup();
    // Nothing was installed, so cleanup leaves the user's file alone.
    expect(await readFile(appImage, 'utf8')).toBe('fictitious AppImage');
  });

  test('the suffix check ignores case', async () => {
    test.skip(process.platform === 'win32', 'POSIX file modes');
    const dir = await tempDir('appimage-case');
    const appImage = join(dir, 'Thicket.APPIMAGE');
    await writeFile(appImage, '', { mode: 0o600 });
    const installed = await installApp(appImage);
    expect(installed.executable).toBe(appImage);
    expect((await stat(appImage)).mode & 0o777).toBe(0o755);
  });

  test.describe('NSIS .exe (with a fictitious installer script)', () => {
    test.skip(process.platform !== 'linux', 'the stand-in installer is a POSIX shell script');

    test('installs silently into a temp folder and uninstalls on cleanup', async () => {
      const dir = await tempDir('nsis');
      const log = join(dir, 'calls.log');
      // Writes Thicket.exe and an uninstaller into the /D= folder, as NSIS does.
      const installer = await script(
        join(dir, 'thicket-1.0.0-win-x64.exe'),
        [
          `echo "install $*" >> '${log}'`,
          'target="${2#/D=}"',
          'printf app > "$target/Thicket.exe"',
          `printf '#!/bin/sh\\necho "uninstall $*" >> ${log}\\n' > "$target/Uninstall Thicket.exe"`,
          'chmod +x "$target/Uninstall Thicket.exe"',
        ].join('\n'),
      );

      const installed = await installApp(installer);
      const installDir = installed.executable.slice(0, -'/Thicket.exe'.length);
      cleanups.push(() => rm(installDir, { recursive: true, force: true }));
      expect(installed.executable.endsWith('/Thicket.exe')).toBe(true);
      expect(installDir.startsWith(join(tmpdir(), 'thicket-smoke-install-'))).toBe(true);
      expect(await readFile(installed.executable, 'utf8')).toBe('app');
      expect(await readFile(log, 'utf8')).toBe(`install /S /D=${installDir}\n`);

      await installed.cleanup();
      expect(await readFile(log, 'utf8')).toBe(`install /S /D=${installDir}\nuninstall /S\n`);
      expect(await exists(installDir)).toBe(false);
    });

    test('cleanup removes the folder even without an uninstaller', async () => {
      const dir = await tempDir('nsis-no-uninstaller');
      const installer = await script(join(dir, 'setup.exe'), 'printf app > "${2#/D=}/Thicket.exe"');
      const installed = await installApp(installer);
      const installDir = installed.executable.slice(0, -'/Thicket.exe'.length);
      cleanups.push(() => rm(installDir, { recursive: true, force: true }));
      await installed.cleanup();
      expect(await exists(installDir)).toBe(false);
    });

    test('fails when the installer puts no Thicket.exe into the folder', async () => {
      const dir = await tempDir('nsis-empty');
      const installer = await script(join(dir, 'setup.exe'), 'printf x > "${2#/D=}/Other.exe"');
      const error = await installApp(installer).then(
        () => undefined,
        (e: unknown) => e as Error,
      );
      expect(error?.message).toMatch(
        /^the installer put no Thicket\.exe into .+ \(found: Other\.exe\)$/,
      );
      const installDir = /into (.+) \(found/.exec(error?.message ?? '')?.[1];
      if (installDir) cleanups.push(() => rm(installDir, { recursive: true, force: true }));
    });

    test('fails when the installer exits with an error', async () => {
      const dir = await tempDir('nsis-fail');
      // The failing installer leaves its install folder name only in its log.
      const log = join(dir, 'calls.log');
      const installer = await script(join(dir, 'setup.exe'), `echo "\${2#/D=}" > '${log}'\nexit 2`);
      await expect(installApp(installer)).rejects.toThrow(/Command failed/);
      const installDir = (await readFile(log, 'utf8')).trim();
      cleanups.push(() => rm(installDir, { recursive: true, force: true }));
    });
  });

  test.describe('dmg (with a fictitious hdiutil on PATH)', () => {
    test.skip(process.platform !== 'linux', 'stands in for macOS hdiutil with a shell script');

    /** Puts an `hdiutil` first on PATH that logs its calls and "mounts" `apps` into the mount point. */
    async function fakeHdiutil(apps: string[]): Promise<{ log: string }> {
      const dir = await tempDir('hdiutil');
      const log = join(dir, 'calls.log');
      await script(
        join(dir, 'hdiutil'),
        [
          `echo "$*" >> '${log}'`,
          'if [ "$1" = attach ]; then',
          '  mount="$5"',
          ...apps.map((app) => `  mkdir -p "$mount/${app}/Contents/MacOS"`),
          '  ln -s /Applications "$mount/Applications"',
          'fi',
        ].join('\n'),
      );
      const savedPath = process.env['PATH'];
      process.env['PATH'] = `${dir}${delimiter}${savedPath ?? ''}`;
      cleanups.push(async () => {
        process.env['PATH'] = savedPath;
      });
      return { log };
    }

    test('mounts the image read-only and starts the app from it; cleanup detaches', async () => {
      const { log } = await fakeHdiutil(['Thicket.app']);
      const installed = await installApp('/fictitious/thicket-1.0.0-mac-arm64.dmg');
      const mountPoint = installed.executable.slice(
        0,
        -'/Thicket.app/Contents/MacOS/Thicket'.length,
      );
      cleanups.push(() => rm(mountPoint, { recursive: true, force: true }));

      expect(installed.executable).toBe(
        join(mountPoint, 'Thicket.app', 'Contents', 'MacOS', 'Thicket'),
      );
      expect(mountPoint.startsWith(join(tmpdir(), 'thicket-smoke-dmg-'))).toBe(true);
      expect(await readFile(log, 'utf8')).toBe(
        `attach -nobrowse -readonly -mountpoint ${mountPoint} /fictitious/thicket-1.0.0-mac-arm64.dmg\n`,
      );

      await installed.cleanup();
      expect((await readFile(log, 'utf8')).split('\n')[1]).toBe(`detach ${mountPoint} -force`);
      expect(await exists(mountPoint)).toBe(false);
    });

    test('fails and detaches when the image holds no app', async () => {
      const { log } = await fakeHdiutil([]);
      await expect(installApp('/fictitious/empty.dmg')).rejects.toThrow(
        'expected one .app in /fictitious/empty.dmg, found: none',
      );
      const calls = (await readFile(log, 'utf8')).trim().split('\n');
      expect(calls).toHaveLength(2);
      const mountPoint = calls[1]?.replace(/^detach (.+) -force$/, '$1') ?? '';
      expect(await exists(mountPoint)).toBe(false);
    });

    test('fails and detaches when the image holds several apps', async () => {
      const { log } = await fakeHdiutil(['Thicket.app', 'Other.app']);
      await expect(installApp('/fictitious/two.dmg')).rejects.toThrow(
        /^expected one \.app in \/fictitious\/two\.dmg, found: (Thicket\.app, Other\.app|Other\.app, Thicket\.app)$/,
      );
      expect((await readFile(log, 'utf8')).trim().split('\n')[1]).toMatch(/^detach .+ -force$/);
    });

    test('the mount point is removed even when detaching fails', async () => {
      const dir = await tempDir('hdiutil-fail');
      await script(
        join(dir, 'hdiutil'),
        ['if [ "$1" = attach ]; then mkdir -p "$5/Thicket.app"; exit 0; fi', 'exit 1'].join('\n'),
      );
      const savedPath = process.env['PATH'];
      process.env['PATH'] = `${dir}${delimiter}${savedPath ?? ''}`;
      cleanups.push(async () => {
        process.env['PATH'] = savedPath;
      });
      const installed = await installApp('/fictitious/thicket.dmg');
      const mountPoint = installed.executable.slice(
        0,
        -'/Thicket.app/Contents/MacOS/Thicket'.length,
      );
      await installed.cleanup();
      expect(await exists(mountPoint)).toBe(false);
    });
  });
});
