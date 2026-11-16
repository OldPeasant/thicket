import { InjectionToken } from '@angular/core';
import type { Event, Request, Response } from '@thicket/contract';

/**
 * What the preload script exposes as `window.thicket` (SPEC.md section 4): the only way the
 * sandboxed renderer talks to main and the backend. The renderer picks the request ids, so it can
 * cancel a request before its response arrives.
 */
export interface ThicketBridge {
  /** Sends a request; resolves with its response (`ok: false` for errors, never rejects for them). */
  request(request: Request): Promise<Response>;
  /** Cancels a running request (by request id) or stream (by `streamId`). Unknown ids are ignored. */
  cancel(id: string): void;
  /** Listens to every pushed `Event` (request streams and broadcast streams). Returns an unsubscribe function. */
  on(listener: (event: Event) => void): () => void;
}

declare global {
  interface Window {
    /** Set by the Electron preload script; missing in a plain browser (`ng serve`) and in tests. */
    thicket?: ThicketBridge;
  }
}

/** The bridge the `ApiService` uses. Defaults to `window.thicket`; tests provide `FakeThicketBridge`. */
export const THICKET_BRIDGE = new InjectionToken<ThicketBridge>('THICKET_BRIDGE', {
  providedIn: 'root',
  factory: () => windowBridge(),
});

function windowBridge(): ThicketBridge {
  const bridge = typeof window === 'undefined' ? undefined : window.thicket;
  return bridge ?? missingBridge;
}

const MISSING_MESSAGE =
  'window.thicket is not available: the renderer is not running inside the Thicket desktop app.';

/** Answers every request with `INTERNAL`, so the UI shows a readable error instead of crashing. */
const missingBridge: ThicketBridge = {
  request: (request) =>
    Promise.resolve({
      id: request.id,
      ok: false,
      error: { code: 'INTERNAL', message: MISSING_MESSAGE },
    }),
  cancel: () => undefined,
  on: () => () => undefined,
};
