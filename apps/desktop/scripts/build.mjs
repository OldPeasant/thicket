// Bundles the Electron main process, the preload script and the backend utilityProcess into
// apps/desktop/dist/ (CommonJS: the sandboxed preload can't load ES modules).
// `--watch` keeps rebuilding on change (manual use only: `npm run dev` bundles once, so changes to
// main, preload or backend need a restart of `npm run dev`).
import { build, context } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: 'linked',
  // cpu-features: ssh2's optional native helper (main gets the backend package too). ssh2 requires
  // it in try/catch and falls back to pure JS, so it stays out of the bundles and isn't shipped.
  external: ['electron', 'cpu-features'],
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
];

if (watch) {
  for (const entry of entries) {
    const ctx = await context({ ...common, ...entry });
    await ctx.watch();
  }
} else {
  await Promise.all(entries.map((entry) => build({ ...common, ...entry })));
}
