/**
 * Control messages from `main` to the backend utilityProcess (`process.parentPort`). Each one
 * transfers exactly one `MessagePortMain`:
 * - `privileged`: the backend's port to `main` (secrets, settings). Only `main` holds the other end.
 * - `renderer`: a renderer window's port; the backend serves the contract on it.
 */
export type BackendControlMessage =
  | { type: 'privileged' }
  | {
      type: 'renderer';
      /**
       * The host's renderer connection counter (a new one per window load, also on reload; not
       * Electron's `webContents.id`), for logs.
       */
      window: number;
    };

export function isBackendControlMessage(value: unknown): value is BackendControlMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  if (message['type'] === 'privileged') return true;
  return message['type'] === 'renderer' && typeof message['window'] === 'number';
}
