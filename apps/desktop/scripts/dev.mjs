// `npm run dev`: bundles main/preload/backend, starts the renderer dev server (`ng serve`, live
// reload) and Electron pointed at it. Changes to main, preload or backend need a restart.
// Ctrl+C or closing the window stops everything.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(appDir, '..', '..');
const devServer = process.env.THICKET_DEV_SERVER || 'http://localhost:4200';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electron = createRequire(import.meta.url)('electron');

const children = [];
function run(command, args, options) {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  children.push(child);
  return child;
}
function stopAll(code) {
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exit(code);
}
process.on('SIGINT', () => stopAll(130));
process.on('SIGTERM', () => stopAll(143));

async function waitFor(url, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up within ${timeoutMs / 1000} s`);
}

const build = run(process.execPath, [resolve(appDir, 'scripts/build.mjs')], { cwd: appDir });
const built = await new Promise((r) => build.on('exit', r));
if (built !== 0) stopAll(built ?? 1);

const port = new URL(devServer).port || '4200';
const server = run(npm, ['run', 'dev', '-w', 'packages/renderer', '--', '--port', port], {
  cwd: repo,
  shell: process.platform === 'win32',
});
server.on('exit', (code) => stopAll(code ?? 1));

await waitFor(devServer, 120_000);
const app = run(electron, [appDir], {
  cwd: appDir,
  env: { ...process.env, THICKET_DEV_SERVER: devServer },
});
app.on('exit', (code) => stopAll(code ?? 0));
