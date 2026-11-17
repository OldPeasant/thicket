/**
 * Entry point of the backend utilityProcess (bundled to `apps/desktop/dist/backend.cjs`).
 * Electron provides `process.parentPort` only in a utilityProcess.
 */
import { join } from 'node:path';

import { startBackend, type ParentPortLike } from './backend';

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (!parentPort) {
  console.error('The Thicket backend must run in an Electron utilityProcess');
  process.exit(1);
}
startBackend({
  parentPort,
  pid: process.pid,
  // Bundled next to backend.cjs by apps/desktop/scripts/build.mjs.
  shellWorker: join(__dirname, 'shell-worker.cjs'),
  log: (message) => console.error(`[backend] ${message}`),
});
