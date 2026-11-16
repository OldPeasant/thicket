/**
 * Preload of every Thicket window (sandboxed; bundled to `dist/preload.cjs`). Exposes only
 * `window.thicket.request / cancel / on`; the ports to main and the backend arrive over IPC.
 */
import { contextBridge, ipcRenderer } from 'electron';

import { Bridge, type ThicketApi } from './bridge';
import { PORT_CHANNEL, fromDomPort, isPortMessage } from './ports';

const bridge = new Bridge((error) => console.error('[thicket]', error));

ipcRenderer.on(PORT_CHANNEL, (event, data: unknown) => {
  const [port] = event.ports;
  if (!port || !isPortMessage(data)) return;
  bridge.setPort(data.target, fromDomPort(port), data.restarted);
});

const api: ThicketApi = {
  request: (request) => bridge.request(request),
  cancel: (id) => bridge.cancel(id),
  on: (stream, listener) => bridge.on(stream, listener),
};

contextBridge.exposeInMainWorld('thicket', api);
