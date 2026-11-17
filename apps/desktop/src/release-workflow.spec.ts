/**
 * Static and shell-level checks of the Windows signing in the release workflow
 * (.github/workflows/release.yml, docs/CODE_SIGNING.md). The workflow is parsed with the YAML
 * loader electron-builder already uses for electron-builder.yml (app-builder-lib, a dependency of
 * the declared electron-builder devDependency, as in packaging.spec.ts), so no new dependency is
 * needed. The `run:` scripts of the build steps are extracted and run with bash the way GitHub
 * runs them (`bash --noprofile --norc -eo pipefail`) against fake files and a fake `npm`/`npx`.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getConfig } from 'app-builder-lib/out/util/config/load.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(desktopDir, '..', '..');

interface Step {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string | number | boolean>;
  'working-directory'?: string;
}

interface Job {
  needs?: string | string[];
  permissions?: Record<string, string>;
  'timeout-minutes'?: number | string;
  strategy?: { matrix?: { include?: Record<string, string | number>[] } };
  steps: Step[];
}

interface Workflow {
  jobs: Record<string, Job>;
}

const SIGNED = "steps.signing.outputs.enabled == 'true'";
const SIGNPATH_ACTION = 'signpath/github-action-submit-signing-request@v1';

let workflow: Workflow;
let build: Job;
let release: Job;

beforeAll(async () => {
  const loaded = await getConfig<Workflow>(
    {
      packageKey: 'release',
      configFilename: 'release',
      projectDir: repoDir,
      packageMetadata: null,
    },
    '.github/workflows/release.yml',
  );
  if (!loaded) throw new Error('release.yml not found');
  workflow = loaded.result;
  const { build: buildJob, release: releaseJob } = workflow.jobs;
  if (!buildJob || !releaseJob) throw new Error('release.yml lacks the build or release job');
  build = buildJob;
  release = releaseJob;
});

function step(job: Job, name: string): Step {
  const found = job.steps.find((s) => s.name === name);
  if (!found) throw new Error(`no step "${name}"`);
  return found;
}

const indexOf = (job: Job, name: string) => job.steps.findIndex((s) => s.name === name);

/** A step belongs to the signing path when it talks to SignPath or handles the signed/unsigned folders. */
function isSigningStep(s: Step): boolean {
  const text = JSON.stringify({ uses: s.uses, run: s.run, with: s.with, id: s.id });
  return (
    s.uses === SIGNPATH_ACTION ||
    /win-signed|installer-signed|unsigned-app|unsigned-installer|--prepackaged/.test(text)
  );
}

describe('release.yml: Windows signing steps', () => {
  it('decides about signing only on Windows, from the SignPath secret and variable', () => {
    const check = step(build, 'Check Windows signing setup');
    expect(check.id).toBe('signing');
    expect(check.if).toBe("runner.os == 'Windows'");
    expect(check.env).toEqual({
      SIGNPATH_API_TOKEN: '${{ secrets.SIGNPATH_API_TOKEN }}',
      SIGNPATH_ORGANIZATION_ID: '${{ vars.SIGNPATH_ORGANIZATION_ID }}',
    });
    expect(check.run?.trim()).toBe('node apps/desktop/scripts/signpath-enabled.mjs');
    expect(existsSync(join(repoDir, 'apps/desktop/scripts/signpath-enabled.mjs'))).toBe(true);
    // Runs after npm ci (node_modules not needed, but checkout is) and before the build reads it.
    expect(indexOf(build, 'Check Windows signing setup')).toBeGreaterThan(
      indexOf(build, 'Install'),
    );
    expect(indexOf(build, 'Check Windows signing setup')).toBeLessThan(
      indexOf(build, 'Build installers'),
    );
  });

  it('gates every signing step on the signing check, and nothing else', () => {
    const signing = build.steps.filter(isSigningStep);
    expect(signing.map((s) => s.name)).toEqual([
      'Upload unsigned app for signing',
      'Sign app (SignPath)',
      'Build installer and zip from the signed app',
      'Upload unsigned installer for signing',
      'Sign installer (SignPath)',
      'Use signed installer',
    ]);
    for (const s of signing) expect(s.if, s.name).toBe(SIGNED);
    // The gated steps are exactly the signing steps: the unsigned path skips all of them.
    expect(build.steps.filter((s) => s.if === SIGNED)).toEqual(signing);
  });

  it('keeps the unsigned path: the same ungated steps, in the same order, as before signing', () => {
    const ungated = build.steps.filter((s) => s.if !== SIGNED).map((s) => s.name ?? s.uses);
    expect(ungated).toEqual([
      'Keep LF line endings',
      'actions/checkout@v5',
      'actions/setup-node@v5',
      'Install rpm tooling',
      'Install',
      'Check Windows signing setup',
      'Build installers',
      'Collect installers',
      'actions/upload-artifact@v4',
      'Allow user namespaces for the Chromium sandbox',
      'Smoke test installer',
      'Upload smoke test results',
    ]);
  });

  it('signs in order: app, installer and zip from the signed app, installer, then collects', () => {
    const order = [
      'Check Windows signing setup',
      'Build installers',
      'Upload unsigned app for signing',
      'Sign app (SignPath)',
      'Build installer and zip from the signed app',
      'Upload unsigned installer for signing',
      'Sign installer (SignPath)',
      'Use signed installer',
      'Collect installers',
      'Smoke test installer',
    ].map((name) => indexOf(build, name));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('sends the uploaded artifacts to SignPath with the documented slugs', () => {
    const app = step(build, 'Sign app (SignPath)');
    const installer = step(build, 'Sign installer (SignPath)');
    const appUpload = step(build, 'Upload unsigned app for signing');
    const installerUpload = step(build, 'Upload unsigned installer for signing');

    expect(appUpload.uses).toBe('actions/upload-artifact@v4');
    expect(appUpload.with?.path).toBe('apps/desktop/release/win-unpacked');
    expect(appUpload.with?.['if-no-files-found']).toBe('error');
    expect(installerUpload.with?.path).toBe('apps/desktop/release/*.exe');
    expect(installerUpload.with?.['if-no-files-found']).toBe('error');
    // Distinct artifact names per matrix entry (upload-artifact@v4 refuses duplicates).
    expect(appUpload.with?.name).not.toBe(installerUpload.with?.name);
    expect(appUpload.with?.name).toContain('${{ matrix.name }}');

    for (const [sign, upload, config] of [
      [app, appUpload, 'win-app'],
      [installer, installerUpload, 'win-installer'],
    ] as const) {
      expect(sign.uses).toBe(SIGNPATH_ACTION);
      expect(sign.with).toMatchObject({
        'api-token': '${{ secrets.SIGNPATH_API_TOKEN }}',
        'organization-id': '${{ vars.SIGNPATH_ORGANIZATION_ID }}',
        'project-slug': 'thicket',
        'signing-policy-slug': 'release-signing',
        'artifact-configuration-slug': config,
        'github-artifact-id': `\${{ steps.${upload.id}.outputs.artifact-id }}`,
        'wait-for-completion': true,
      });
    }
  });

  it('builds the installer from the folder SignPath writes the signed app to', () => {
    const signedDir = step(build, 'Sign app (SignPath)').with?.['output-artifact-directory'];
    const packaging = step(build, 'Build installer and zip from the signed app');
    const prepackaged = /--prepackaged (\S+)/.exec(packaging.run ?? '')?.[1];
    // electron-builder runs in the step's working directory, apps/desktop.
    expect(packaging['working-directory']).toBe('apps/desktop');
    expect(posix.join('apps/desktop', prepackaged ?? '')).toBe(signedDir);
    // The signed installer is copied over the unsigned one from that same release/ folder.
    const signedInstallerDir = step(build, 'Sign installer (SignPath)').with?.[
      'output-artifact-directory'
    ];
    expect(step(build, 'Use signed installer').run).toContain(`${signedInstallerDir}/*.exe`);
  });

  it('gives the Windows job enough time for both SignPath approvals', () => {
    const win = build.strategy?.matrix?.include?.find((entry) => entry.name === 'win-x64');
    const waitSeconds = ['Sign app (SignPath)', 'Sign installer (SignPath)'].map((name) =>
      Number(step(build, name).with?.['wait-for-completion-timeout-in-seconds']),
    );
    const waitMinutes = waitSeconds.reduce((a, b) => a + b, 0) / 60;
    expect(build['timeout-minutes']).toBe('${{ matrix.timeout || 45 }}');
    expect(Number(win?.timeout)).toBeGreaterThan(waitMinutes);
    // The other builds keep the 45 minute limit.
    for (const entry of build.strategy?.matrix?.include ?? []) {
      if (entry.name !== 'win-x64') expect(entry.timeout, String(entry.name)).toBeUndefined();
    }
  });

  it('lets the build job token read the uploaded artifacts for SignPath, nothing more', () => {
    // Job-level permissions replace the workflow-level ones, so contents: read is listed again.
    expect(build.permissions).toEqual({ contents: 'read', actions: 'read' });
  });

  it('passes the SignPath token only to the signing check and the SignPath action', () => {
    const users = build.steps
      .filter((s) => JSON.stringify(s).includes('SIGNPATH_API_TOKEN'))
      .map((s) => s.name);
    expect(users).toEqual([
      'Check Windows signing setup',
      'Sign app (SignPath)',
      'Sign installer (SignPath)',
    ]);
    expect(JSON.stringify(release)).not.toContain('SIGNPATH');
  });
});

describe('release.yml: artefacts and checksums', () => {
  it('collects the same installer types as before (exe and zip on Windows)', () => {
    expect(step(build, 'Collect installers').run).toContain(
      'apps/desktop/release/*.{AppImage,deb,rpm,dmg,exe,zip}',
    );
    const upload = build.steps.find((s) => s.with?.name === 'installers-${{ matrix.name }}');
    expect(upload?.with?.path).toBe('out/*');
    expect(indexOf(build, 'Use signed installer')).toBeLessThan(
      upload ? build.steps.indexOf(upload) : -1,
    );
  });

  it('computes SHA256SUMS.txt in the release job, after downloading the (signed) build artifacts', () => {
    expect(release.needs).toBe('build');
    const download = release.steps.findIndex((s) => s.uses === 'actions/download-artifact@v5');
    const checksums = indexOf(release, 'Checksums');
    const publish = indexOf(release, 'Upload to draft release');
    expect(download).toBeGreaterThanOrEqual(0);
    expect(release.steps[download]?.with).toMatchObject({
      pattern: 'installers-*',
      path: 'out',
      'merge-multiple': true,
    });
    expect(download).toBeLessThan(checksums);
    expect(checksums).toBeLessThan(publish);
    expect(step(release, 'Checksums')['working-directory']).toBe('out');
    expect(step(release, 'Checksums').run).toContain('sha256sum -- * > SHA256SUMS.txt');
  });
});

describe('docs match the workflow', () => {
  const codeSigning = () => readFileSync(join(repoDir, 'docs/CODE_SIGNING.md'), 'utf8');

  it('documents every SignPath slug, the secret and the variable the workflow uses', () => {
    const doc = codeSigning();
    const slugs = new Set<string>();
    for (const s of build.steps.filter((s) => s.uses === SIGNPATH_ACTION)) {
      for (const key of ['project-slug', 'signing-policy-slug', 'artifact-configuration-slug']) {
        slugs.add(String(s.with?.[key]));
      }
    }
    expect([...slugs].sort()).toEqual(['release-signing', 'thicket', 'win-app', 'win-installer']);
    for (const slug of slugs) expect(doc, slug).toContain(`**\`${slug}\`**`);
    expect(doc).toContain('secret **`SIGNPATH_API_TOKEN`**');
    expect(doc).toContain('variable **`SIGNPATH_ORGANIZATION_ID`**');
  });

  it('has the code signing policy sections and the attribution in README and policy', () => {
    const doc = codeSigning();
    for (const heading of [
      '## Code signing policy',
      '### Team roles',
      '### Privacy policy',
      '## One-time setup (maintainer)',
    ]) {
      expect(doc).toContain(heading);
    }
    expect(doc).toContain('Thicket sends no telemetry');
    const attribution =
      'Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by\n[SignPath Foundation](https://signpath.org)';
    expect(doc).toContain(attribution);
    const readme = readFileSync(join(repoDir, 'README.md'), 'utf8');
    expect(readme).toContain(attribution);
    expect(readme).toContain('[code signing policy](docs/CODE_SIGNING.md)');
  });
});

// The run scripts execute on the runners in bash (Git Bash on Windows). Locally they need a
// POSIX bash and sha256sum; on Windows `bash` may resolve to WSL, so these run on Linux/macOS.
describe.skipIf(process.platform === 'win32')('release.yml run scripts (bash)', () => {
  let work: string;
  let scripts: string;
  let bin: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'thicket-release-work-'));
    scripts = mkdtempSync(join(tmpdir(), 'thicket-release-scripts-'));
    bin = join(scripts, 'bin');
    mkdirSync(bin);
    // Fake npm and npx: write each argument as [arg] on its own line (empty arguments show up),
    // the command name first.
    for (const command of ['npm', 'npx']) {
      const fake = join(bin, command);
      writeFileSync(
        fake,
        `#!/bin/sh\n{ printf '%s\\n' ${command}; for a in "$@"; do printf '[%s]\\n' "$a"; done; } > "$NPM_ARGS"\n`,
      );
      chmodSync(fake, 0o755);
    }
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
    rmSync(scripts, { recursive: true, force: true });
  });

  /** Runs a step's `run:` script like GitHub's `shell: bash`, in `cwd`, with the step's env. */
  function runStep(job: Job, name: string, env: Record<string, string>, cwd = work) {
    const file = join(scripts, `${name.replace(/\W+/g, '-')}.sh`);
    writeFileSync(file, step(job, name).run ?? '');
    return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', file], {
      cwd,
      encoding: 'utf8',
      env: { PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, ...env },
    });
  }

  /** The command line (command name, then [arg] per argument) a build step runs, in its working directory. */
  function npmArgs(name: string, env: Record<string, string>) {
    const argsFile = join(scripts, 'npm-args');
    const cwd = join(work, step(build, name)['working-directory'] ?? '.');
    mkdirSync(cwd, { recursive: true });
    const result = runStep(build, name, { ...env, NPM_ARGS: argsFile }, cwd);
    expect(result.status, result.stderr).toBe(0);
    return readFileSync(argsFile, 'utf8').trim().split('\n');
  }

  const before = (args: string[]) => [
    'npm',
    ...['run', 'dist', '-w', 'apps/desktop', '--', ...args, '-c.extraMetadata.version=1.2.3'].map(
      (a) => `[${a}]`,
    ),
  ];

  describe('Build installers', () => {
    it.each([
      ['Linux/macOS (no signing check output)', '--linux --x64', undefined],
      ['Windows without the SignPath setup', '--win --x64', 'false'],
      ['an empty output', '--mac', ''],
    ])('builds the installers as before signing on %s', (_label, args, sign) => {
      const env: Record<string, string> = { TAG: 'v1.2.3', ARGS: args };
      if (sign !== undefined) env.SIGN = sign;
      expect(npmArgs('Build installers', env)).toEqual(before(args.split(' ')));
    });

    it('builds only the unpacked app when signing', () => {
      const args = npmArgs('Build installers', {
        TAG: 'v1.2.3',
        ARGS: '--win --x64',
        SIGN: 'true',
      });
      expect(args).toEqual(before(['--win', '--x64', '--dir']));
    });
  });

  it('builds the installer and zip from the signed folder with the tag version, without rebuilding', () => {
    const args = npmArgs('Build installer and zip from the signed app', {
      TAG: 'v1.2.3',
      ARGS: '--win --x64',
    });
    // electron-builder only (no renderer or bundle rebuild).
    expect(args).toEqual([
      'npx',
      ...[
        'electron-builder',
        '--config',
        'electron-builder.yml',
        '--publish',
        'never',
        '--win',
        '--x64',
        '--prepackaged',
        'release/win-signed',
        '-c.extraMetadata.version=1.2.3',
      ].map((a) => `[${a}]`),
    ]);
    // The same electron-builder options as the dist script (config, never publish).
    const pkg = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.dist).toContain(
      'electron-builder --config electron-builder.yml --publish never',
    );
  });

  describe('Use signed installer', () => {
    const releaseDir = () => join(work, 'apps/desktop/release');
    const signedDir = () => join(releaseDir(), 'installer-signed');
    const exe = 'thicket-1.2.3-win-x64.exe';
    const zip = 'thicket-1.2.3-win-x64.zip';

    beforeEach(() => {
      mkdirSync(signedDir(), { recursive: true });
      mkdirSync(join(releaseDir(), 'win-unpacked'));
      mkdirSync(join(releaseDir(), 'win-signed'));
      writeFileSync(join(releaseDir(), 'win-signed', 'Thicket.exe'), 'fictitious signed app');
      writeFileSync(join(releaseDir(), exe), 'fictitious unsigned installer');
      writeFileSync(join(releaseDir(), zip), 'fictitious zip of the signed app');
    });

    it('replaces the unsigned installer; collect and checksums then use the signed bytes', () => {
      writeFileSync(join(signedDir(), exe), 'fictitious signed installer');

      const use = runStep(build, 'Use signed installer', {});
      expect(use.status, use.stderr).toBe(0);
      expect(readFileSync(join(releaseDir(), exe), 'utf8')).toBe('fictitious signed installer');

      const collect = runStep(build, 'Collect installers', {});
      expect(collect.status, collect.stderr).toBe(0);
      // Same file names as an unsigned build: the installer and the zip, nothing else.
      expect(readdirSync(join(work, 'out')).sort()).toEqual([exe, zip]);
      expect(readFileSync(join(work, 'out', exe), 'utf8')).toBe('fictitious signed installer');

      const sums = runStep(release, 'Checksums', {}, join(work, 'out'));
      expect(sums.status, sums.stderr).toBe(0);
      const sha = (text: string) => createHash('sha256').update(text).digest('hex');
      expect(readFileSync(join(work, 'out', 'SHA256SUMS.txt'), 'utf8')).toBe(
        `${sha('fictitious signed installer')}  ${exe}\n` +
          `${sha('fictitious zip of the signed app')}  ${zip}\n`,
      );
    });

    it('fails when SignPath returned no installer', () => {
      const result = runStep(build, 'Use signed installer', {});
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('expected one signed installer, found:');
      expect(readFileSync(join(releaseDir(), exe), 'utf8')).toBe('fictitious unsigned installer');
    });

    it('fails when SignPath returned more than one installer', () => {
      writeFileSync(join(signedDir(), exe), 'fictitious signed installer');
      writeFileSync(join(signedDir(), 'other.exe'), 'fictitious other');
      const result = runStep(build, 'Use signed installer', {});
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('expected one signed installer');
      expect(readFileSync(join(releaseDir(), exe), 'utf8')).toBe('fictitious unsigned installer');
    });

    it('fails when the signed installer has another name than the unsigned one', () => {
      writeFileSync(join(signedDir(), 'renamed.exe'), 'fictitious signed installer');
      const result = runStep(build, 'Use signed installer', {});
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'signed installer renamed.exe does not replace an unsigned one',
      );
      expect(existsSync(join(releaseDir(), 'renamed.exe'))).toBe(false);
    });
  });

  it('collects the same file names on an unsigned Windows build', () => {
    const releaseDir = join(work, 'apps/desktop/release');
    mkdirSync(join(releaseDir, 'win-unpacked'), { recursive: true });
    writeFileSync(join(releaseDir, 'thicket-1.2.3-win-x64.exe'), 'fictitious installer');
    writeFileSync(join(releaseDir, 'thicket-1.2.3-win-x64.zip'), 'fictitious zip');
    writeFileSync(join(releaseDir, 'thicket-1.2.3-win-x64.exe.blockmap'), 'fictitious blockmap');
    const collect = runStep(build, 'Collect installers', {});
    expect(collect.status, collect.stderr).toBe(0);
    expect(readdirSync(join(work, 'out')).sort()).toEqual([
      'thicket-1.2.3-win-x64.exe',
      'thicket-1.2.3-win-x64.zip',
    ]);
  });
});
