import { z } from 'zod';

import { count } from './common';
import { errorInfo } from './errors';

/**
 * Messages on the renderer ↔ backend `MessagePort` (SPEC.md section 4). `params`, `result` and
 * `payload` are validated per method with the schemas in `methods`.
 */

/** A call. `id` is chosen by the caller and unique per port. */
export const request = z.object({
  id: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown(),
});

export type Request = z.infer<typeof request>;

const okResponse = z.object({ id: z.string().min(1), ok: z.literal(true), result: z.unknown() });
const errorResponse = z.object({ id: z.string().min(1), ok: z.literal(false), error: errorInfo });

/** Answer to a `Request` with the same `id`. */
export const response = z.discriminatedUnion('ok', [okResponse, errorResponse]);

export type Response = z.infer<typeof response>;

export const EVENT_KINDS = ['data', 'end', 'error'] as const;

/**
 * Pushed output of a stream. `data` payloads follow the method's `stream` schema; `end` carries
 * `StreamEnd`; `error` carries `ErrorInfo`. After `end` or `error` no more events come for that stream.
 */
export const event = z.object({
  stream: z.string().min(1),
  kind: z.enum(EVENT_KINDS),
  payload: z.unknown(),
});

export type Event = z.infer<typeof event>;

/** Payload of an `end` event. */
export const streamEnd = z.object({
  /** Items delivered on the stream (documents, events, lines ...). */
  delivered: count,
});

export type StreamEnd = z.infer<typeof streamEnd>;

/** Payload of an `error` event. */
export const streamError = errorInfo;

/**
 * Cancels a running request or stream: `cancel` is a request `id` or a `streamId`. The backend
 * kills the server-side operation (`killCursors`/`killOp`); the request answers `CANCELLED`, a
 * stream ends with an `error` event of code `CANCELLED`. Unknown or finished targets are ignored.
 *
 * Routing: a request and the stream it returns belong to the process that served the request,
 * `route(method)`. The preload/main delivers a cancel to the process that owns the target: for a
 * request id it uses the route of that request's method; for a stream id `main` keeps a map
 * streamId → owner, filled from the responses that returned a `streamId`. Streams of main-routed
 * `io.*` methods are run by the backend on `main`'s behalf, so `main` forwards their cancel to the
 * backend over its privileged port.
 */
export const cancel = z.object({
  cancel: z.string().min(1),
});

export type Cancel = z.infer<typeof cancel>;

/** Well-known stream names for events that are not tied to a request. */
export const BROADCAST_STREAMS = {
  /** Connection state changes; payload `ConnStatus`. */
  connStatus: 'conn.status',
  /** Effective theme changed (setting or OS); payload `ThemeInfo`. */
  theme: 'app.theme',
} as const;
