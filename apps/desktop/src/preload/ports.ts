import type { Port } from '@thicket/backend';
import { backendRestarted, type BackendRestarted, type Route } from '@thicket/contract';

/** IPC channel on which main hands a window its ports (`webContents.postMessage`). */
export const PORT_CHANNEL = 'thicket:port';

/** Data sent with each port on `PORT_CHANNEL`. */
export interface PortMessage {
  target: Route;
  /** Set when the port replaces one of a backend that died. */
  restarted?: BackendRestarted;
}

export function isPortMessage(value: unknown): value is PortMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  if (message['target'] !== 'main' && message['target'] !== 'backend') return false;
  return (
    message['restarted'] === undefined || backendRestarted.safeParse(message['restarted']).success
  );
}

/** The part of the DOM `MessagePort` the preload uses. */
export interface DomPortLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  start(): void;
  close(): void;
}

export function fromDomPort(port: DomPortLike): Port {
  port.start();
  return {
    send: (message) => port.postMessage(message),
    onMessage(listener) {
      const wrapped = (event: { data: unknown }) => listener(event.data);
      port.addEventListener('message', wrapped);
      return () => port.removeEventListener('message', wrapped);
    },
    close: () => port.close(),
  };
}
