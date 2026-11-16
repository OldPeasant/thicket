import type { Port } from './rpc';

/**
 * The part of Electron's `MessagePortMain` (main process and utilityProcess) that `Port` needs.
 * Declared here so the backend doesn't depend on Electron's typings.
 */
export interface MainPortLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  off(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  start(): void;
  close(): void;
}

/**
 * Wraps an Electron `MessagePortMain` and starts it. `onClose` runs when the other end goes away
 * (window closed, process died).
 */
export function fromMainPort(port: MainPortLike, onClose?: () => void): Port {
  if (onClose) port.on('close', onClose);
  port.start();
  return {
    send: (message) => port.postMessage(message),
    onMessage(listener) {
      const wrapped = (event: { data: unknown }) => listener(event.data);
      port.on('message', wrapped);
      return () => void port.off('message', wrapped);
    },
    close: () => port.close(),
  };
}
