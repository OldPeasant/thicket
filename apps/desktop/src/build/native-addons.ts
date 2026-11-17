// esbuild plugin for scripts/build.mjs (run by Node directly: erasable TypeScript only).
//
// Native addons (`*.node`) can't be bundled: esbuild has no loader for them ("No loader is
// configured for ".node" files"). They exist in node_modules only where npm could compile them
// (a C/C++ toolchain, e.g. GitHub runners), so a build without one never sees them. The addons
// listed in OPTIONAL_ADDONS are optional and required in try/catch with a pure JS fallback:
// - ssh2: lib/protocol/crypto/build/Release/sshcrypto.node (faster ciphers; falls back to
//   Node's crypto)
// - os-dns-native (mongosh's devtools-connect: SRV lookups via the OS resolver; falls back to
//   Node's dns)
// - system-ca's win-export-certificate-and-key / @mongodb-js/macos-export-certificate-and-key
//   (OS certificate stores for mongosh proxies; failures are caught). They load their addon via
//   `bindings` (a computed path esbuild never sees); any `.node` import from them is allowed too.
// So they are deliberately left out: each `require('….node')` becomes a module that throws
// MODULE_NOT_FOUND, exactly what happens where the addon was never compiled. The packaged app
// therefore behaves the same whether or not the build machine had a toolchain.
//
// Any other addon fails the build: it may have no fallback, and a stub would only fail at
// runtime on the code path that loads it. The decision doesn't depend on whether the `.node` file
// exists, so builds with and without a toolchain behave the same.
import type { Plugin } from 'esbuild';
import { isAbsolute, resolve } from 'node:path';

const NAMESPACE = 'thicket-omitted-native-addon';

/**
 * Vetted optional addons: package name -> addon file names (any directory inside the package,
 * e.g. build/Release or build/Debug), or `'any'` for every `.node` file of the package.
 * Add an entry only after confirming the package requires the addon in try/catch with a JS
 * fallback (and that its callers handle the failure).
 */
export const OPTIONAL_ADDONS: Readonly<Record<string, readonly string[] | 'any'>> = {
  ssh2: ['sshcrypto.node'],
  'os-dns-native': ['os_dns_native.node'],
  'win-export-certificate-and-key': 'any',
  '@mongodb-js/macos-export-certificate-and-key': 'any',
};

/** An addon located inside an installed package. */
export interface AddonLocation {
  /** Package name, e.g. `ssh2` or `@scope/name`. */
  packageName: string;
  /** Path of the addon inside the package, with `/` separators. */
  file: string;
}

/**
 * Finds the package an addon belongs to from its path (`/` or `\` separators): the segment(s)
 * after the last `node_modules`. Returns undefined outside node_modules.
 */
export function addonLocation(addonPath: string): AddonLocation | undefined {
  const parts = addonPath.split(/[\\/]+/);
  const index = parts.lastIndexOf('node_modules');
  if (index < 0) return undefined;
  const scoped = parts[index + 1]?.startsWith('@') ? 1 : 0;
  const nameParts = parts.slice(index + 1, index + 2 + scoped);
  const file = parts.slice(index + 2 + scoped);
  if (nameParts.length !== 1 + scoped || file.length === 0) return undefined;
  return { packageName: nameParts.join('/'), file: file.join('/') };
}

/** Whether the addon is in OPTIONAL_ADDONS. */
export function isOptionalAddon(location: AddonLocation): boolean {
  const allowed = OPTIONAL_ADDONS[location.packageName];
  if (allowed === undefined) return false;
  if (allowed === 'any') return true;
  const fileName = location.file.slice(location.file.lastIndexOf('/') + 1);
  return allowed.includes(fileName);
}

/** Source of the stand-in module for an omitted addon (exported for tests). */
export function omittedAddonSource(path: string): string {
  const message = `Cannot find module '${path}' (native addon not bundled into Thicket)`;
  return [
    `const error = new Error(${JSON.stringify(message)});`,
    `error.code = 'MODULE_NOT_FOUND';`,
    `throw error;`,
  ].join('\n');
}

function unlistedAddonError(specifier: string, importer: string, packageName?: string): string {
  return [
    `Native addon '${specifier}' imported by ${importer}`,
    packageName ? ` (package ${packageName})` : '',
    ' is not in the allow-list of optional addons (apps/desktop/src/build/native-addons.ts).',
    ' Either mark the package external in scripts/build.mjs and ship it (electron-builder.yml),',
    ' or, after confirming it is required in try/catch with a JS fallback, add it to',
    ' OPTIONAL_ADDONS.',
  ].join('');
}

/**
 * Replaces each allow-listed `*.node` import with a module that throws MODULE_NOT_FOUND when
 * required; any other `*.node` import fails the build.
 */
export const omitNativeAddons: Plugin = {
  name: 'omit-native-addons',
  setup(build) {
    build.onResolve({ filter: /\.node$/ }, (args) => {
      const importer = args.importer || args.resolveDir;
      const relative = args.path.startsWith('./') || args.path.startsWith('../');
      // A bare specifier (`pkg/build/x.node`) names its package directly.
      const location =
        relative || isAbsolute(args.path)
          ? addonLocation(resolve(args.resolveDir, args.path))
          : addonLocation(`node_modules/${args.path}`);
      if (!location || !isOptionalAddon(location)) {
        return {
          errors: [{ text: unlistedAddonError(args.path, importer, location?.packageName) }],
        };
      }
      return { path: `${location.packageName}/${location.file}`, namespace: NAMESPACE };
    });
    build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => ({
      contents: omittedAddonSource(args.path),
      loader: 'js',
    }));
  },
};
