// Throwaway: measure what bundling the mongosh runtime with esbuild costs (see docs/mongosh.md).
// Usage: node bundle.mjs && node out/bundle.cjs
import { build } from 'esbuild';
import { statSync } from 'node:fs';

const result = await build({
  entryPoints: ['ping.cjs'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outfile: 'out/bundle.cjs',
  // Native modules (and their loaders) stay outside the bundle, shipped unpacked.
  // Lazy optional requires that esbuild can't resolve statically (babel config loader, PAC proxies).
  external: [
    'kerberos',
    'mongodb-client-encryption',
    'ssh2',
    'cpu-features',
    '@babel/preset-typescript/package.json',
    'pac-proxy-agent',
  ],
  metafile: true,
  logLevel: 'warning',
});
const bytes = statSync('out/bundle.cjs').size;
console.log(`out/bundle.cjs: ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
const inputs = Object.entries(result.metafile.outputs['out/bundle.cjs'].inputs)
  .map(([file, v]) => [
    file
      .replace(/^.*node_modules\//, '')
      .split('/')
      .slice(0, 2)
      .join('/'),
    v.bytesInOutput,
  ])
  .reduce((acc, [pkg, b]) => acc.set(pkg, (acc.get(pkg) ?? 0) + b), new Map());
for (const [pkg, b] of [...inputs].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`${(b / 1024).toFixed(0).padStart(7)} KiB  ${pkg}`);
}
