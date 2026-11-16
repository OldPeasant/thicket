import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { appName, headlessArgs, repoDir } from './harness/app';
import { expect, realUserDataDir, screenshotWindows, snapshotDir, test } from './harness';

// Checks of the harness's own helpers (no Vitest project covers test/e2e, so they run here).

/** Runs `body` with the given environment variables set (`undefined` = unset), then restores them. */
async function withEnv<T>(vars: Record<string, string | undefined>, body: () => T | Promise<T>) {
  const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  const apply = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  };
  apply(vars);
  try {
    return await body();
  } finally {
    apply(saved);
  }
}

/** `value`, failing the test when it is missing. */
function defined<T>(value: T | undefined, what = 'value'): T {
  expect(value, `${what} is defined`).toBeDefined();
  if (value === undefined) throw new Error(`${what} is undefined`);
  return value;
}

test.describe('headlessArgs', () => {
  test.skip(process.platform !== 'linux', 'the headless switch is only used on Linux');

  test('adds the headless Ozone switch when there is no display', async () => {
    await withEnv(
      { DISPLAY: undefined, WAYLAND_DISPLAY: undefined, THICKET_TEST_HEADLESS: undefined },
      () => expect(headlessArgs()).toEqual(['--ozone-platform=headless']),
    );
  });

  test('uses the display when DISPLAY or WAYLAND_DISPLAY is set', async () => {
    await withEnv(
      { DISPLAY: ':99', WAYLAND_DISPLAY: undefined, THICKET_TEST_HEADLESS: undefined },
      () => expect(headlessArgs()).toEqual([]),
    );
    await withEnv(
      { DISPLAY: undefined, WAYLAND_DISPLAY: 'wayland-0', THICKET_TEST_HEADLESS: undefined },
      () => expect(headlessArgs()).toEqual([]),
    );
  });

  test('THICKET_TEST_HEADLESS=1 forces headless even with a display; other values do not', async () => {
    await withEnv({ DISPLAY: ':99', THICKET_TEST_HEADLESS: '1' }, () =>
      expect(headlessArgs()).toEqual(['--ozone-platform=headless']),
    );
    await withEnv({ DISPLAY: ':99', THICKET_TEST_HEADLESS: 'true' }, () =>
      expect(headlessArgs()).toEqual([]),
    );
  });
});

test.describe('realUserDataDir', () => {
  test.skip(process.platform !== 'linux', 'checks the Linux appData rule');

  test('is $XDG_CONFIG_HOME/<app name> when XDG_CONFIG_HOME is set', async () => {
    await withEnv({ XDG_CONFIG_HOME: '/tmp/fictitious-xdg-config' }, () =>
      expect(realUserDataDir()).toBe(join('/tmp/fictitious-xdg-config', appName())),
    );
  });

  test('falls back to ~/.config/<app name> when XDG_CONFIG_HOME is unset or empty', async () => {
    const expected = join(homedir(), '.config', appName());
    await withEnv({ XDG_CONFIG_HOME: undefined }, () => expect(realUserDataDir()).toBe(expected));
    await withEnv({ XDG_CONFIG_HOME: '' }, () => expect(realUserDataDir()).toBe(expected));
  });
});

test.describe('snapshotDir', () => {
  let root: string;
  test.beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'thicket-e2e-snapshot-'));
  });
  test.afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('returns null for a folder that does not exist', async () => {
    expect(await snapshotDir(join(root, 'missing'))).toBeNull();
  });

  test('returns an empty snapshot for an empty folder and equal snapshots when nothing changed', async () => {
    expect(await snapshotDir(root)).toEqual({});
    await mkdir(join(root, 'nested', 'deeper'), { recursive: true });
    await writeFile(join(root, 'nested', 'deeper', 'settings.json'), '{"pageSize":50}');
    const first = await snapshotDir(root);
    expect(Object.keys(first ?? {}).sort()).toEqual([
      join(root, 'nested'),
      join(root, 'nested', 'deeper'),
      join(root, 'nested', 'deeper', 'settings.json'),
    ]);
    expect(await snapshotDir(root)).toEqual(first);
  });

  test('detects a created folder in place of a missing one', async () => {
    const dir = join(root, 'appdata');
    const before = await snapshotDir(dir);
    await mkdir(dir);
    expect(await snapshotDir(dir)).not.toEqual(before);
  });

  test('detects a new, a deleted and a nested file', async () => {
    await writeFile(join(root, 'a.json'), '{}');
    const before = await snapshotDir(root);

    await writeFile(join(root, 'b.json'), '{}');
    expect(await snapshotDir(root)).not.toEqual(before);
    await rm(join(root, 'b.json'));
    expect(await snapshotDir(root)).toEqual(before);

    await mkdir(join(root, 'Cache'));
    await writeFile(join(root, 'Cache', 'entry'), 'x');
    const withNested = await snapshotDir(root);
    expect(withNested).toHaveProperty([join(root, 'Cache', 'entry')]);

    await rm(join(root, 'a.json'));
    expect(await snapshotDir(root)).not.toHaveProperty([join(root, 'a.json')]);
  });

  test('detects a rewrite with a different size or only a different modification time', async () => {
    const file = join(root, 'settings.json');
    await writeFile(file, '{"pageSize":50}');
    const fixed = new Date('2026-01-02T03:04:05Z');
    await utimes(file, fixed, fixed);
    const before = await snapshotDir(root);

    // Same size, newer mtime (e.g. a rewrite with equal-length content).
    await writeFile(file, '{"pageSize":99}');
    await utimes(file, fixed, new Date('2026-01-02T03:04:06Z'));
    expect((await stat(file)).size).toBe(15);
    expect(await snapshotDir(root)).not.toEqual(before);

    // Different size, original mtime.
    await writeFile(file, '{"pageSize":100}');
    await utimes(file, fixed, fixed);
    expect(await snapshotDir(root)).not.toEqual(before);
  });
});

test('screenshotWindows saves a PNG of the window under test-results/ and attaches it', async ({
  electronApp,
  window,
}, testInfo) => {
  await expect(window).toHaveTitle('Thicket');
  await screenshotWindows(electronApp, testInfo);

  const png = testInfo.outputPath('failure-window-0.png');
  const relativePath = relative(repoDir, png);
  expect(relativePath.startsWith(`test-results${sep}`)).toBe(true);
  expect((await stat(png)).size).toBeGreaterThan(0);
  // Playwright copies attached files into the test's attachments/ folder.
  const attachment = testInfo.attachments.find((a) => a.name === 'window 0');
  expect(attachment?.contentType).toBe('image/png');
  expect(relative(testInfo.outputDir, defined(attachment?.path)).startsWith('..')).toBe(false);
});

interface JsonReportResult {
  status: string;
  attachments: { name: string; path?: string; contentType: string; body?: string }[];
}
interface JsonReport {
  suites: { specs: { title: string; tests: { results: JsonReportResult[] }[] }[] }[];
}

/** Runs Playwright on the deliberately failing fixture specs in failure-fixture/. */
function runFailureFixture(outputDir: string): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(repoDir, 'node_modules', '@playwright', 'test', 'cli.js'),
        'test',
        '--config',
        join(repoDir, 'test', 'e2e', 'failure-fixture', 'playwright.config.ts'),
        '--reporter=json',
      ],
      {
        cwd: repoDir,
        env: { ...process.env, THICKET_E2E_FAILURE_OUTPUT: outputDir },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code, stdout }));
  });
}

// eslint-disable-next-line no-empty-pattern -- Playwright tests must destructure their fixtures.
test('a failing test leaves a window screenshot and the app output under test-results/', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const outputDir = testInfo.outputPath('nested-run');
  expect(relative(repoDir, outputDir).startsWith(`test-results${sep}`)).toBe(true);

  const { code, stdout } = await runFailureFixture(outputDir);
  expect(code, 'the nested run has one deliberately failing test').toBe(1);
  const report = JSON.parse(stdout) as JsonReport;
  const specs = report.suites.flatMap((suite) => suite.specs);
  const resultOf = (title: string) => {
    const spec = specs.find((s) => s.title === title);
    return defined(spec?.tests[0]?.results[0], `result of "${title}" in the nested report`);
  };

  const failed = resultOf('fails on purpose after the window opened');
  expect(failed.status).toBe('failed');
  const screenshot = failed.attachments.find((a) => a.name === 'window 0');
  expect(screenshot?.contentType).toBe('image/png');
  const screenshotPath = defined(screenshot?.path, 'path of the window 0 attachment');
  expect(relative(outputDir, screenshotPath).startsWith('..')).toBe(false);
  expect((await stat(screenshotPath)).size).toBeGreaterThan(0);
  expect(failed.attachments.map((a) => a.name)).toContain('app output');

  // The screenshot file itself is kept in the failed test's folder; a passing test leaves none.
  const passed = resultOf('passes without a screenshot');
  expect(passed.status).toBe('passed');
  expect(passed.attachments.map((a) => a.name)).not.toContain('window 0');
  const screenshots = (await readdir(outputDir, { recursive: true })).filter((p) =>
    p.endsWith('failure-window-0.png'),
  );
  expect(screenshots).toHaveLength(1);
  const screenshotFile = defined(screenshots[0]);
  expect(screenshotFile).toMatch(/^failing\.fixture\.ts-fails-on-purpose/);
  await access(join(outputDir, screenshotFile));
});
