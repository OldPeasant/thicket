/**
 * Entry point of the backend utilityProcess (bundled to `apps/desktop/dist/backend.cjs`).
 * Electron provides `process.parentPort` only in a utilityProcess.
 */
import { startBackend, type ParentPortLike } from './backend';

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (!parentPort) {
  console.error('The Thicket backend must run in an Electron utilityProcess');
  process.exit(1);
}
startBackend({
  parentPort,
  pid: process.pid,
  log: (message) => console.error(`[backend] ${message}`),
});
