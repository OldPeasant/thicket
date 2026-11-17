import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addonLocation,
  isOptionalAddon,
  omitNativeAddons,
  omittedAddonSource,
} from './native-addons.ts';

let dir: string;

/** Writes `<dir>/<relative path parts>`, creating its directories. */
function put(parts: string[], contents: string): string {
  const file = join(dir, ...parts);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
  return file;
}

const SSH2_CRYPTO = ['node_modules', 'ssh2', 'lib', 'protocol'];
const SSHCRYPTO_MESSAGE =
  "Cannot find module 'ssh2/lib/protocol/crypto/build/Release/sshcrypto.node' (native addon not bundled into Thicket)";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thicket-native-addons-'));
  // Laid out like ssh2: an optional addon next to its JS, loaded in try/catch.
  // Not a real addon: the build must never read it.
  put([...SSH2_CRYPTO, 'crypto', 'build', 'Release', 'sshcrypto.node'], 'not an ELF/PE/Mach-O');
  put(
    [...SSH2_CRYPTO, 'crypto.js'],
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
  put(
    [...SSH2_CRYPTO, 'required.js'],
    "module.exports = require('./crypto/build/Release/sshcrypto.node');",
  );
  put(['optional.cjs'], "module.exports = require('ssh2/lib/protocol/crypto.js');");
  put(['required.cjs'], "module.exports = require('ssh2/lib/protocol/required.js');");
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

/** A module that tries each `require(specifier)` and records the error code and message. */
function tryLoadAll(specifiers: string[]): string {
  return [
    'const tryLoad = (load) => { try { load(); return null; } catch (e) { return [e.code, e.message]; } };',
    'module.exports = [',
    ...specifiers.map((s) => `  tryLoad(() => require(${JSON.stringify(s)})),`),
    '];',
  ].join('\n');
}

describe('omitNativeAddons', () => {
  it('without it, esbuild refuses a compiled addon (the v0.1.0-rc.1 release failure)', async () => {
    await expect(bundle('optional.cjs', false)).rejects.toThrow(
      /No loader is configured for ".node"/,
    );
  });

  it('bundles code that requires an allow-listed addon; requiring it throws MODULE_NOT_FOUND, so the JS fallback runs', async () => {
    const code = await bundle('optional.cjs');
    expect(code).not.toContain('not an ELF/PE/Mach-O');
    expect(run(code)).toEqual({
      fallback: true,
      code: 'MODULE_NOT_FOUND',
      message: SSHCRYPTO_MESSAGE,
    });
  });

  it('an unguarded require of an allow-listed addon throws when the module is loaded, not at build time', async () => {
    const code = await bundle('required.cjs');
    expect(() => run(code)).toThrow(/native addon not bundled into Thicket/);
  });

  it('leaves package imports whose names merely contain "node" alone', async () => {
    put(['pkg.cjs'], "module.exports = require('node:path').sep;");
    expect(run(await bundle('pkg.cjs'))).toBe(sep);
  });

  it('stubs an allow-listed addon that was never compiled (no toolchain: the file does not exist)', async () => {
    put(
      ['node_modules', 'os-dns-native', 'lib', 'index.js'],
      tryLoadAll(['../build/Release/os_dns_native.node', '../build/Debug/os_dns_native.node']),
    );
    put(['dns.cjs'], "module.exports = require('os-dns-native/lib/index.js');");
    expect(run(await bundle('dns.cjs'))).toEqual([
      [
        'MODULE_NOT_FOUND',
        "Cannot find module 'os-dns-native/build/Release/os_dns_native.node' (native addon not bundled into Thicket)",
      ],
      [
        'MODULE_NOT_FOUND',
        "Cannot find module 'os-dns-native/build/Debug/os_dns_native.node' (native addon not bundled into Thicket)",
      ],
    ]);
  });

  it('stubs every allow-listed addon in one bundle, each failing with its own package path', async () => {
    put(['node_modules', 'os-dns-native', 'build', 'Release', 'os_dns_native.node'], 'fake addon');
    put(
      ['node_modules', 'os-dns-native', 'index.js'],
      "module.exports = require('./build/Release/os_dns_native.node');",
    );
    put(['several.cjs'], tryLoadAll(['ssh2/lib/protocol/required.js', 'os-dns-native/index.js']));
    const code = await bundle('several.cjs');
    expect(code).not.toContain('fake addon');
    expect(run(code)).toEqual([
      ['MODULE_NOT_FOUND', SSHCRYPTO_MESSAGE],
      [
        'MODULE_NOT_FOUND',
        "Cannot find module 'os-dns-native/build/Release/os_dns_native.node' (native addon not bundled into Thicket)",
      ],
    ]);
  });

  it('gives identical relative addon paths in different packages distinct stubs', async () => {
    for (const pkg of [
      'win-export-certificate-and-key',
      '@mongodb-js/macos-export-certificate-and-key',
    ]) {
      put(
        ['node_modules', ...pkg.split('/'), 'index.js'],
        "module.exports = require('./build/Release/binding.node');",
      );
    }
    put(
      ['exporters.cjs'],
      tryLoadAll([
        'win-export-certificate-and-key/index.js',
        '@mongodb-js/macos-export-certificate-and-key/index.js',
      ]),
    );
    expect(run(await bundle('exporters.cjs'))).toEqual([
      [
        'MODULE_NOT_FOUND',
        "Cannot find module 'win-export-certificate-and-key/build/Release/binding.node' (native addon not bundled into Thicket)",
      ],
      [
        'MODULE_NOT_FOUND',
        "Cannot find module '@mongodb-js/macos-export-certificate-and-key/build/Release/binding.node' (native addon not bundled into Thicket)",
      ],
    ]);
  });

  it('also stubs an allow-listed addon imported from an ES module', async () => {
    put(
      [...SSH2_CRYPTO, 'esm.mjs'],
      "import binding from './crypto/build/Release/sshcrypto.node';\nexport default binding;",
    );
    put(['esm.mjs'], "export { default } from 'ssh2/lib/protocol/esm.mjs';");
    const code = await bundle('esm.mjs');
    expect(() => run(code)).toThrow(/native addon not bundled into Thicket/);
  });

  it('stubs an allow-listed addon named by a bare package specifier', async () => {
    put(['bare.cjs'], tryLoadAll(['ssh2/lib/protocol/crypto/build/Release/sshcrypto.node']));
    expect(run(await bundle('bare.cjs'))).toEqual([['MODULE_NOT_FOUND', SSHCRYPTO_MESSAGE]]);
  });

  it('fails the build for an addon of a package that is not allow-listed, naming the importer', async () => {
    const importer = put(
      ['node_modules', 'fast-thing', 'index.js'],
      "module.exports = require('./build/Release/fast.node');",
    );
    put(['unlisted.cjs'], "module.exports = require('fast-thing');");
    const error = await bundle('unlisted.cjs').then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toContain("Native addon './build/Release/fast.node'");
    expect(error?.message).toContain(importer);
    expect(error?.message).toContain('(package fast-thing)');
    expect(error?.message).toContain('mark the package external');
    expect(error?.message).toContain('OPTIONAL_ADDONS');
  });

  it('fails the build for an unlisted addon of an allow-listed package, whether or not it was compiled', async () => {
    put([...SSH2_CRYPTO, 'build', 'Release', 'other.node'], 'fake addon');
    put([...SSH2_CRYPTO, 'other.js'], "module.exports = require('./build/Release/other.node');");
    put([...SSH2_CRYPTO, 'missing.js'], "module.exports = require('./build/Release/gone.node');");
    for (const file of ['other', 'missing']) {
      put([`${file}.cjs`], `module.exports = require('ssh2/lib/protocol/${file}.js');`);
      await expect(bundle(`${file}.cjs`)).rejects.toThrow(
        /\(package ssh2\) is not in the allow-list/,
      );
    }
  });

  it('fails the build for an addon outside node_modules', async () => {
    put(['own.cjs'], "module.exports = require('./build/Release/own.node');");
    await expect(bundle('own.cjs')).rejects.toThrow(
      /Native addon '\.\/build\/Release\/own\.node' imported by .*own\.cjs is not in the allow-list/,
    );
  });

  it('stubs an allow-listed addon required by absolute path, with its package path in the message', async () => {
    const addon = join(dir, ...SSH2_CRYPTO, 'crypto', 'build', 'Release', 'sshcrypto.node');
    put(['absolute.cjs'], tryLoadAll([addon]));
    const code = await bundle('absolute.cjs');
    expect(code).not.toContain('not an ELF/PE/Mach-O');
    expect(run(code)).toEqual([['MODULE_NOT_FOUND', SSHCRYPTO_MESSAGE]]);
  });

  it('fails the build for an unlisted addon given as an entry point, naming the working directory', async () => {
    put(['entry', 'own.node'], 'fake addon');
    const error = await build({
      entryPoints: ['./own.node'],
      absWorkingDir: join(dir, 'entry'),
      bundle: true,
      platform: 'node',
      write: false,
      logLevel: 'silent',
      plugins: [omitNativeAddons],
    }).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toContain(
      `Native addon './own.node' imported by ${join(dir, 'entry')} is not in the allow-list`,
    );
  });

  it('bundles files whose names only start with or contain ".node" normally', async () => {
    put(['helper.node.cjs'], "module.exports = 'js helper';");
    put(['other.nodejs'], "module.exports = 'not an addon';");
    put(
      ['lookalikes.cjs'],
      "module.exports = [require('./helper.node.cjs'), require('./other.nodejs')];",
    );
    // `.nodejs` has no esbuild loader either: give it one so only the plugin's filter is tested.
    const result = await build({
      entryPoints: [join(dir, 'lookalikes.cjs')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
      logLevel: 'silent',
      loader: { '.nodejs': 'js' },
      plugins: [omitNativeAddons],
    });
    const [output] = result.outputFiles;
    if (!output) throw new Error('esbuild wrote no output');
    expect(run(output.text)).toEqual(['js helper', 'not an addon']);
  });
});

describe('addonLocation', () => {
  it('finds the package with POSIX and Windows separators', () => {
    const expected = {
      packageName: 'ssh2',
      file: 'lib/protocol/crypto/build/Release/sshcrypto.node',
    };
    expect(
      addonLocation('/app/node_modules/ssh2/lib/protocol/crypto/build/Release/sshcrypto.node'),
    ).toEqual(expected);
    expect(
      addonLocation(
        'C:\\app\\node_modules\\ssh2\\lib\\protocol\\crypto\\build\\Release\\sshcrypto.node',
      ),
    ).toEqual(expected);
  });

  it('uses the innermost node_modules and handles scoped packages', () => {
    expect(
      addonLocation(
        'C:\\a\\node_modules\\system-ca\\node_modules\\@mongodb-js\\macos-export-certificate-and-key\\build\\Release\\x.node',
      ),
    ).toEqual({
      packageName: '@mongodb-js/macos-export-certificate-and-key',
      file: 'build/Release/x.node',
    });
  });

  it('returns undefined outside node_modules or without a file inside the package', () => {
    expect(addonLocation('/app/build/Release/x.node')).toBeUndefined();
    expect(addonLocation('/app/node_modules/x.node')).toBeUndefined();
    expect(addonLocation('/app/node_modules/@scope/x.node')).toBeUndefined();
  });
});

describe('isOptionalAddon', () => {
  it('matches allow-listed packages by addon file name, in any build directory', () => {
    expect(
      isOptionalAddon({ packageName: 'os-dns-native', file: 'build/Debug/os_dns_native.node' }),
    ).toBe(true);
    expect(
      isOptionalAddon({ packageName: 'os-dns-native', file: 'build/Release/other.node' }),
    ).toBe(false);
    expect(isOptionalAddon({ packageName: 'ssh2', file: 'sshcrypto.node' })).toBe(true);
    expect(isOptionalAddon({ packageName: 'not-ssh2', file: 'sshcrypto.node' })).toBe(false);
    expect(
      isOptionalAddon({
        packageName: 'win-export-certificate-and-key',
        file: 'build/Release/any.node',
      }),
    ).toBe(true);
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

  it('keeps Windows separators, double quotes and newlines in the path literal', () => {
    const path = 'C:\\addons\\"x"\n\\b.node';
    const error = (() => {
      try {
        new Function(omittedAddonSource(path))();
      } catch (e) {
        return e as NodeJS.ErrnoException;
      }
      return undefined;
    })();
    expect(error?.code).toBe('MODULE_NOT_FOUND');
    expect(error?.message).toBe(
      `Cannot find module '${path}' (native addon not bundled into Thicket)`,
    );
  });
});
