/**
 * The Windows signing gate of the release workflow (.github/workflows/release.yml):
 * scripts/signpath-enabled.mjs decides from the SignPath secret and variable whether to sign.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(desktopDir, 'scripts', 'signpath-enabled.mjs');

describe('signpath-enabled.mjs', () => {
  let dir: string;
  let output: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'thicket-signing-'));
    output = join(dir, 'github-output');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function run(vars: Record<string, string>) {
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...vars };
    const log = execFileSync(process.execPath, [script], { env, encoding: 'utf8' });
    return { log, output: readFileSync(output, 'utf8') };
  }

  it('signs when the token and the organization id are set', () => {
    const result = run({ SIGNPATH_API_TOKEN: 'token', SIGNPATH_ORGANIZATION_ID: 'org' });
    expect(result.output).toBe('enabled=true\n');
    expect(result.log).toContain('SignPath signing enabled');
    expect(result.log).not.toContain('token');
  });

  it.each([
    [{}, 'SIGNPATH_API_TOKEN (secret) and SIGNPATH_ORGANIZATION_ID (variable)'],
    [{ SIGNPATH_ORGANIZATION_ID: 'org' }, 'missing SIGNPATH_API_TOKEN (secret).'],
    [{ SIGNPATH_API_TOKEN: 'token' }, 'missing SIGNPATH_ORGANIZATION_ID (variable).'],
    // GitHub passes an unset secret or variable as an empty string.
    [{ SIGNPATH_API_TOKEN: '', SIGNPATH_ORGANIZATION_ID: ' ' }, 'SIGNPATH_API_TOKEN (secret) and'],
  ])('skips signing and says so when something is missing (%o)', (vars, missing) => {
    const result = run(vars);
    expect(result.output).toBe('enabled=false\n');
    expect(result.log).toMatch(/^::notice title=Windows signing skipped::SignPath signing skipped/);
    expect(result.log).toContain(missing);
  });
});
