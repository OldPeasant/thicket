// Bundles the Electron main process, the preload script and the backend utilityProcess into
// apps/desktop/dist/ (CommonJS: the sandboxed preload can't load ES modules).
// `--watch` keeps rebuilding on change (manual use only: `npm run dev` bundles once, so changes to
// main, preload or backend need a restart of `npm run dev`).
import { build, context } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { omitNativeAddons } from '../src/build/native-addons.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: 'linked',
  // Native modules stay out of the bundles (optional driver dependencies, docs/mongosh.md
  // "Packaging impact"): without them GSSAPI and client-side encryption are unavailable.
  // cpu-features: ssh2's optional native helper (main gets the backend package too). ssh2 requires
  // it in try/catch and falls back to pure JS, so it stays out of the bundles and isn't shipped.
  external: ['electron', 'kerberos', 'mongodb-client-encryption', 'cpu-features'],
  // Other native addons (ssh2's sshcrypto, os-dns-native, system-ca's certificate exporters) are
  // compiled only where a C/C++ toolchain exists; they are left out the same way, see
  // src/build/native-addons.ts; any addon not on its allow-list fails the build. CI (check.yml
  // "bundle") builds with them compiled.
  plugins: [omitNativeAddons],
  logLevel: 'info',
};

const entries = [
  { entryPoints: [resolve(root, 'src/main/index.ts')], outfile: resolve(root, 'dist/main.cjs') },
  {
    entryPoints: [resolve(root, 'src/preload/index.ts')],
    outfile: resolve(root, 'dist/preload.cjs'),
    // Sandboxed preloads run in a renderer: only `electron` and a few polyfilled modules exist.
    platform: 'browser',
    target: 'chrome140',
  },
  {
    entryPoints: [resolve(root, '../../packages/backend/src/server/entry.ts')],
    outfile: resolve(root, 'dist/backend.cjs'),
  },
  {
    // One worker_thread per mongosh console, started by the backend (docs/mongosh.md).
    entryPoints: [resolve(root, '../../packages/backend/src/shell/worker.ts')],
    outfile: resolve(root, 'dist/shell-worker.cjs'),
    external: [
      ...common.external,
      // Lazy optional requires esbuild can't resolve (docs/mongosh.md "Packaging impact"):
      // TypeScript input in the async rewriter, PAC proxy support.
      '@babel/preset-typescript/package.json',
      'pac-proxy-agent',
    ],
  },
];

if (watch) {
  for (const entry of entries) {
    const ctx = await context({ ...common, ...entry });
    await ctx.watch();
  }
} else {
  await Promise.all(entries.map((entry) => build({ ...common, ...entry })));
}
