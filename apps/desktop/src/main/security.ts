/**
 * Security settings of the renderer window (SPEC.md section 6, docs/ARCHITECTURE.md). Pure
 * values and functions so they are unit-tested without Electron.
 */

/** Scheme the packaged renderer is served from (`thicket://app/index.html`). */
export const APP_SCHEME = 'thicket';
export const APP_HOST = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/**
 * Content-Security-Policy of the renderer: only the app's own scripts, no remote content, no
 * `eval`. Inline styles are allowed because Angular's component styles need them.
 * `devServer` (the `ng serve` origin in `npm run dev`) additionally allows its live-reload socket.
 */
export function contentSecurityPolicy(devServer?: string): string {
  const connect = ["'self'"];
  if (devServer) {
    const url = new URL(devServer);
    connect.push(`ws://${url.host}`, `wss://${url.host}`);
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self'",
  ].join('; ');
}

/** `webPreferences` of every Thicket window: no Node, isolated and sandboxed. */
export function secureWebPreferences(preload: string) {
  return {
    preload,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    experimentalFeatures: false,
    spellcheck: false,
  } as const;
}

/**
 * Response headers with the CSP set (replacing any the server sent, in any letter case), for
 * `session.webRequest.onHeadersReceived`.
 */
export function withCspHeader(
  headers: Record<string, string | string[]> | undefined,
  csp: string,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() === 'content-security-policy') continue;
    out[name] = Array.isArray(value) ? value : [value];
  }
  out['Content-Security-Policy'] = [csp];
  return out;
}

/** `webContents.setWindowOpenHandler`: no new windows, ever. */
export function denyWindowOpen(): { action: 'deny' } {
  return { action: 'deny' };
}

/** The part of Electron's navigation events the guards use. */
export interface PreventableEvent {
  preventDefault(): void;
}

/**
 * `will-navigate` / `will-redirect` / `will-frame-navigate`: every navigation away from the loaded
 * page is blocked (the renderer is a single-page app; in-page history changes don't fire these).
 * Returns whether it was blocked.
 */
export function blockNavigation(event: PreventableEvent, url?: string, current?: string): boolean {
  if (url !== undefined && current !== undefined && sameDocument(url, current)) return false;
  event.preventDefault();
  return true;
}

/** Same document, ignoring the fragment (a hash change is not a navigation away). */
function sameDocument(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    left.hash = '';
    right.hash = '';
    return left.href === right.href;
  } catch {
    return false;
  }
}

/** `will-attach-webview`: `<webview>` is disabled; block it even if a preference slips. */
export function blockWebview(event: PreventableEvent): void {
  event.preventDefault();
}

/** Permission requests (camera, notifications, ...): Thicket needs none, so all are refused. */
export function denyPermission(
  _webContents: unknown,
  _permission: string,
  callback: (granted: boolean) => void,
): void {
  callback(false);
}

/**
 * Resolves a `thicket://app/<path>` URL to a file below `root`, or `undefined` if it points
 * elsewhere (other host, `..` escapes). An empty path or a path without an extension (an Angular
 * route) serves `index.html`.
 */
export function resolveAppFile(url: string, root: string, join: (...parts: string[]) => string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== APP_HOST) return undefined;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return undefined;
  }
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.some((s) => s === '..' || s === '.' || s.includes('\\') || s.includes('\0'))) {
    return undefined;
  }
  const last = segments.at(-1);
  if (!last?.includes('.')) return join(root, 'index.html');
  return join(root, ...segments);
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  txt: 'text/plain; charset=utf-8',
  map: 'application/json',
};

export function mimeType(file: string): string {
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}
