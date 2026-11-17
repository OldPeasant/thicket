import { inject, Injectable } from '@angular/core';
import {
  BROADCAST_STREAMS,
  type ConnStatus,
  type Event,
  type MethodName,
  type ParamsOf,
  type ResultOf,
  type SettingsChanged,
  type SshHostKeyPrompt,
  type StreamDataOf,
  type StreamMethodName,
  type ThemeInfo,
} from '@thicket/contract';
import { filter, map, Observable } from 'rxjs';

import { ApiError } from './api-error';
import { THICKET_BRIDGE } from './thicket-bridge';

/** Options of `ApiService.request`. */
export interface RequestOptions {
  /** Aborting cancels the request (`thicket.cancel(id)`) and rejects it with `CANCELLED`. */
  signal?: AbortSignal;
}

/** Options of `ApiService.stream`. */
export interface StreamOptions<M extends StreamMethodName> {
  /** Called once with the request's result (e.g. `path` of `io.export`), before any data. */
  onStart?: (result: ResultOf<M>) => void;
}

/**
 * Most events a stream subscription buffers while its request is pending (its `streamId` is not
 * known yet). One more fails the stream with `INTERNAL` and cancels it.
 */
export const MAX_EARLY_EVENTS = 10_000;

const BROADCAST_STREAM_NAMES: ReadonlySet<string> = new Set(Object.values(BROADCAST_STREAMS));

/** Payload types of the broadcast streams (events not tied to a request). */
export interface BroadcastPayloads {
  [BROADCAST_STREAMS.connStatus]: ConnStatus;
  [BROADCAST_STREAMS.theme]: ThemeInfo;
  [BROADCAST_STREAMS.settingsChanged]: SettingsChanged;
  [BROADCAST_STREAMS.sshHostKey]: SshHostKeyPrompt;
}

export type BroadcastStream = keyof BroadcastPayloads;

/**
 * Typed access to `window.thicket`. Requests are typed by the contract (`ParamsOf`/`ResultOf`),
 * failures reject with `ApiError`; streaming methods are cold Observables: each subscription sends
 * its own request and cancels its own server-side stream when it unsubscribes before the stream
 * ended. Use `share()` to let several subscribers share one stream.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly bridge = inject(THICKET_BRIDGE);

  /** Calls `method`; resolves with its result or rejects with an `ApiError`. */
  request<M extends MethodName>(
    method: M,
    params: ParamsOf<M>,
    options: RequestOptions = {},
  ): Promise<ResultOf<M>> {
    const { signal } = options;
    if (signal?.aborted) return Promise.reject(cancelledError());

    const id = newRequestId();
    const sent = this.send(id, method, params) as Promise<ResultOf<M>>;
    if (!signal) return sent;
    return new Promise<ResultOf<M>>((resolve, reject) => {
      const onAbort = (): void => {
        this.bridge.cancel(id);
        reject(cancelledError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      // Remove the listener before settling, so an abort right after the caller resumes is a no-op.
      // After an abort, the settled promise ignores the late resolve/reject.
      sent.then(
        (result) => {
          signal.removeEventListener('abort', onAbort);
          resolve(result);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }

  /**
   * Starts a streaming method and emits the payloads of its `data` events. Completes on `end`,
   * errors with an `ApiError` on an `error` event or a failed request. Unsubscribing before that
   * cancels the request (still pending) or the stream (`streamId` known). The request is sent
   * once per subscription.
   *
   * `options.onStart` receives the request's result (e.g. the chosen `path` of `io.export`) once,
   * before any data is emitted. A result with `streamId: null` (e.g. a cancelled save dialog) then
   * completes the Observable without emitting.
   */
  stream<M extends StreamMethodName>(
    method: M,
    params: ParamsOf<M>,
    options: StreamOptions<M> = {},
  ): Observable<StreamDataOf<M>> {
    return new Observable<StreamDataOf<M>>((subscriber) => {
      const id = newRequestId();
      let streamId: string | undefined;
      /** The response was accepted: events go straight to `handle` instead of the buffer. */
      let started = false;
      let responded = false;
      let finished = false;
      /** Unsubscribed or given up (buffer overflow): a late `streamId` is cancelled at once. */
      let abandoned = false;
      /** Events that arrive before the response tells us the `streamId`. */
      let early: Event[] = [];

      const finish = (): void => {
        finished = true;
        early = [];
        off();
      };

      const handle = (event: Event): void => {
        if (finished || event.stream !== streamId) return;
        switch (event.kind) {
          case 'data':
            subscriber.next(event.payload as StreamDataOf<M>);
            break;
          case 'end':
            finish();
            subscriber.complete();
            break;
          case 'error':
            finish();
            subscriber.error(ApiError.from(event.payload));
            break;
        }
      };

      const off = this.bridge.on((event) => {
        if (finished) return;
        if (started) {
          handle(event);
          return;
        }
        // Broadcasts never belong to a request's stream: don't hold them while the request is pending.
        if (BROADCAST_STREAM_NAMES.has(event.stream)) return;
        if (early.length >= MAX_EARLY_EVENTS) {
          abandoned = true;
          finish();
          this.bridge.cancel(id);
          subscriber.error(
            new ApiError({
              code: 'INTERNAL',
              message: `More than ${MAX_EARLY_EVENTS} events arrived before the response of ${method}`,
            }),
          );
          return;
        }
        early.push(event);
      });

      this.send(id, method, params).then(
        (result) => {
          responded = true;
          const sid = streamIdOf(result);
          if (abandoned) {
            // Cancelled while pending, but the response was already on its way: stop the stream too.
            if (typeof sid === 'string') this.bridge.cancel(sid);
            return;
          }
          if (sid === undefined) {
            finish();
            subscriber.error(
              new ApiError({
                code: 'INTERNAL',
                message: `${method} did not return a streamId`,
                detail: result,
              }),
            );
            return;
          }
          if (sid !== null) streamId = sid;
          try {
            options.onStart?.(result as ResultOf<M>);
          } catch (error) {
            if (finished) return;
            finish();
            if (streamId !== undefined) this.bridge.cancel(streamId);
            subscriber.error(error);
            return;
          }
          if (finished) return; // onStart unsubscribed
          if (sid === null) {
            // Nothing to stream, e.g. the user cancelled the save dialog of io.export.
            finish();
            subscriber.complete();
            return;
          }
          started = true;
          const buffered = early;
          early = [];
          for (const event of buffered) handle(event);
        },
        (error: unknown) => {
          responded = true;
          if (abandoned) return;
          finish();
          subscriber.error(ApiError.from(error));
        },
      );

      return () => {
        abandoned = true;
        if (finished) return;
        finish();
        if (streamId !== undefined) this.bridge.cancel(streamId);
        else if (!responded) this.bridge.cancel(id);
      };
    });
  }

  /** Payloads of a broadcast stream (`BROADCAST_STREAMS`), e.g. connection status changes. */
  broadcasts<S extends BroadcastStream>(stream: S): Observable<BroadcastPayloads[S]> {
    return this.events(stream).pipe(
      filter((event) => event.kind === 'data'),
      map((event) => event.payload as BroadcastPayloads[S]),
    );
  }

  /** Every event of the stream with name `stream` (all kinds), e.g. `backend.restarted`. */
  events(stream: string): Observable<Event> {
    return new Observable<Event>((subscriber) =>
      this.bridge.on((event) => {
        if (event.stream === stream) subscriber.next(event);
      }),
    );
  }

  /** Sends the request; resolves with the result, rejects with an `ApiError`. */
  private async send(id: string, method: string, params: unknown): Promise<unknown> {
    let response: unknown;
    try {
      response = await this.bridge.request({ id, method, params });
    } catch (error) {
      throw ApiError.from(error);
    }
    if (typeof response !== 'object' || response === null || !('ok' in response)) {
      throw new ApiError({
        code: 'INTERNAL',
        message: `Malformed response from the bridge for ${method}`,
        detail: response,
      });
    }
    const { ok, result, error } = response as { ok: unknown; result?: unknown; error?: unknown };
    if (ok === true) return result;
    throw ApiError.from(error);
  }
}

function cancelledError(): ApiError {
  return new ApiError({ code: 'CANCELLED', message: 'Cancelled' });
}

/** The `streamId` of a stream method's result: `null` means "nothing to stream", `undefined` malformed. */
function streamIdOf(result: unknown): string | null | undefined {
  if (typeof result !== 'object' || result === null) return undefined;
  const { streamId } = result as Record<string, unknown>;
  if (streamId === null) return null;
  return typeof streamId === 'string' && streamId.length > 0 ? streamId : undefined;
}

let fallbackCounter = 0;

/** Unique per port; random so ids from several windows sharing a backend never collide in logs. */
function newRequestId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `r-${Date.now().toString(36)}-${(fallbackCounter++).toString(36)}`;
}
