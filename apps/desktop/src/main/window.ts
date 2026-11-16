import { fromMainPort, serve, type Handler } from '@thicket/backend';
import { methods } from '@thicket/contract';
import { BrowserWindow, MessageChannelMain, type MessagePortMain } from 'electron';

import { PORT_CHANNEL, type PortMessage } from '../preload/ports';
import type { BackendHost } from './backend-host';
import type { Broadcaster } from './broadcast';
import { secureWebPreferences } from './security';

export interface WindowOptions {
  preload: string;
  /** URL of the renderer (`thicket://app/index.html` or the dev server). */
  url: string;
  host: BackendHost<MessagePortMain>;
  mainHandlers: Record<string, Handler>;
  /** Broadcast events from main (e.g. `app.settings.changed`) go to the window's main port. */
  broadcaster?: Broadcaster;
  log: (message: string) => void;
}

/**
 * Opens a Thicket window and wires its ports: one to main (served here) and one to the backend
 * (brokered by the host, replaced after a backend restart). A reload of the page gets fresh ports.
 */
export function openWindow(options: WindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'Thicket',
    webPreferences: secureWebPreferences(options.preload),
  });
  const contents = window.webContents;
  window.once('ready-to-show', () => window.show());

  let detach: (() => void) | undefined;
  const post = (data: PortMessage, port: MessagePortMain) => {
    if (!contents.isDestroyed()) contents.postMessage(PORT_CHANNEL, data, [port]);
  };
  const connect = () => {
    detach?.();
    const channel = new MessageChannelMain();
    const stopMain = serve(fromMainPort(channel.port1), {
      table: methods,
      route: 'main',
      handlers: options.mainHandlers,
      onError: (error) => options.log(`main handler: ${String(error)}`),
    });
    post({ target: 'main' }, channel.port2);
    const removeSink = options.broadcaster?.add((event) => channel.port1.postMessage(event));
    const disconnect = options.host.connectRenderer((port, restarted) =>
      post(restarted ? { target: 'backend', restarted } : { target: 'backend' }, port),
    );
    detach = () => {
      removeSink?.();
      stopMain();
      channel.port1.close();
      disconnect();
    };
  };
  contents.on('did-finish-load', connect);
  window.on('closed', () => {
    detach?.();
    detach = undefined;
  });
  void window.loadURL(options.url);
  return window;
}
