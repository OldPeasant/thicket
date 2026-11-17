import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { omitNativeAddons, omittedAddonSource } from './native-addons.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thicket-native-addons-'));
  // A package laid out like ssh2: an optional addon next to its JS, loaded in try/catch.
  mkdirSync(join(dir, 'crypto', 'build', 'Release'), { recursive: true });
  // Not a real addon: the build must never read it.
  writeFileSync(join(dir, 'crypto', 'build', 'Release', 'sshcrypto.node'), 'not an ELF/PE/Mach-O');
  writeFileSync(
    join(dir, 'optional.cjs'),
    [
      'let binding;',
      'try {',
      "  binding = require('./crypto/build/Release/sshcrypto.node');",
      '} catch (error) {',
      '  module.exports = { fallback: true, code: error.code, message: error.message };',
      '}',
      'if (binding) module.exports = { fallback: false };',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'required.cjs'),
    "module.exports = require('./crypto/build/Release/sshcrypto.node');",
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function bundle(entry: string, withPlugin = true): Promise<string> {
  const result = await build({
    entryPoints: [join(dir, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    write: false,
    logLevel: 'silent',
    plugins: withPlugin ? [omitNativeAddons] : [],
  });
  const [output] = result.outputFiles;
  if (!output) throw new Error('esbuild wrote no output');
  return output.text;
}

/** Runs a CommonJS bundle and returns its exports. */
function run(code: string): unknown {
  const module = { exports: {} as unknown };
  const fn = new Function('module', 'exports', 'require', code) as (
    m: typeof module,
    e: unknown,
    r: NodeJS.Require,
  ) => void;
  fn(module, module.exports, createRequire(join(dir, 'bundle.cjs')));
  return module.exports;
}

describe('omitNativeAddons', () => {
  it('without it, esbuild refuses a compiled addon (the v0.1.0-rc.1 release failure)', async () => {
    await expect(bundle('optional.cjs', false)).rejects.toThrow(
      /No loader is configured for ".node"/,
    );
  });

  it('bundles code that requires an addon; requiring it throws MODULE_NOT_FOUND, so the JS fallback runs', async () => {
    const code = await bundle('optional.cjs');
    expect(code).not.toContain('not an ELF/PE/Mach-O');
    expect(run(code)).toEqual({
      fallback: true,
      code: 'MODULE_NOT_FOUND',
      message:
        "Cannot find module './crypto/build/Release/sshcrypto.node' (native addon not bundled into Thicket)",
    });
  });

  it('an unguarded require of an addon throws when the module is loaded, not at build time', async () => {
    const code = await bundle('required.cjs');
    expect(() => run(code)).toThrow(/native addon not bundled into Thicket/);
  });

  it('leaves package imports whose names merely contain "node" alone', async () => {
    writeFileSync(join(dir, 'pkg.cjs'), "module.exports = require('node:path').sep;");
    expect(run(await bundle('pkg.cjs'))).toBe(sep);
  });
});

describe('omittedAddonSource', () => {
  it('quotes the path safely', () => {
    const source = omittedAddonSource("./it's/a.node");
    const module = { exports: {} };
    expect(() => new Function('module', source)(module)).toThrow(
      "Cannot find module './it's/a.node'",
    );
  });
});
