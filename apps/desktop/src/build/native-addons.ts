// esbuild plugin for scripts/build.mjs (run by Node directly: erasable TypeScript only).
//
// Native addons (`*.node`) can't be bundled: esbuild has no loader for them ("No loader is
// configured for ".node" files"). They exist in node_modules only where npm could compile them
// (a C/C++ toolchain, e.g. GitHub runners), so a build without one never sees them. Every addon
// the bundles reach is optional and required in try/catch with a pure JS fallback:
// - ssh2: lib/protocol/crypto/build/Release/sshcrypto.node (faster ciphers; falls back to
//   Node's crypto)
// - os-dns-native (mongosh's devtools-connect: SRV lookups via the OS resolver; falls back to
//   Node's dns)
// - system-ca's win-export-certificate-and-key / @mongodb-js/macos-export-certificate-and-key
//   (OS certificate stores for mongosh proxies; failures are caught)
// So they are deliberately left out: each `require('….node')` becomes a module that throws
// MODULE_NOT_FOUND, exactly what happens where the addon was never compiled. The packaged app
// therefore behaves the same whether or not the build machine had a toolchain.
import type { Plugin } from 'esbuild';

const NAMESPACE = 'thicket-omitted-native-addon';

/** Source of the stand-in module for an omitted addon (exported for tests). */
export function omittedAddonSource(path: string): string {
  const message = `Cannot find module '${path}' (native addon not bundled into Thicket)`;
  return [
    `const error = new Error(${JSON.stringify(message)});`,
    `error.code = 'MODULE_NOT_FOUND';`,
    `throw error;`,
  ].join('\n');
}

/** Replaces every `*.node` import with a module that throws MODULE_NOT_FOUND when required. */
export const omitNativeAddons: Plugin = {
  name: 'omit-native-addons',
  setup(build) {
    build.onResolve({ filter: /\.node$/ }, (args) => ({ path: args.path, namespace: NAMESPACE }));
    build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => ({
      contents: omittedAddonSource(args.path),
      loader: 'js',
    }));
  },
};
