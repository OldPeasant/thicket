import {
  cancel as cancelSchema,
  parseParamsIn,
  parseResultIn,
  request as requestSchema,
  response as responseSchema,
  type ErrorCode,
  type ErrorInfo,
  type Event,
  type MethodDef,
  type Response,
  type Route,
} from '@thicket/contract';

/**
 * One end of a message channel, independent of the runtime (Electron `MessagePortMain` in main and
 * in the utilityProcess, DOM `MessagePort` in the preload). Messages are structured-clone values.
 */
export interface Port {
  send(message: unknown): void;
  /** Registers a listener; returns a function that removes it. */
  onMessage(listener: (message: unknown) => void): () => void;
  close(): void;
}

/** An error a handler throws to answer with a specific contract error code. */
export class RpcError extends Error {
  readonly code: ErrorCode;
  readonly detail: unknown;

  constructor(code: ErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.detail = detail;
  }

  toInfo(): ErrorInfo {
    return this.detail === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, detail: this.detail };
  }
}

/** What a stream producer gets: its signal, and `send` for one `data` payload. */
export interface StreamSink {
  readonly streamId: string;
  /** Aborted when the caller cancels the stream (or the port closes). */
  readonly signal: AbortSignal;
  /** Sends one `data` event (validated against the method's `stream` schema). Ignored once over. */
  send(payload: unknown): void;
}

/**
 * Produces a stream's data. Resolves with the number of items delivered (the `end` event's
 * `delivered`); a rejection ends the stream with an `error` event. After a cancel the producer
 * should stop and clean up (e.g. kill the server operation) promptly: the `CANCELLED` error event
 * is sent when it settles (or after {@link STREAM_CANCEL_GRACE_MS} at the latest).
 */
export type StreamProducer = (sink: StreamSink) => Promise<number>;

export interface HandlerContext {
  /** Aborted when the caller cancels the request (or the port closes). */
  signal: AbortSignal;
  requestId: string;
  /**
   * Opens a stream for a streaming method and returns its id for the `{ streamId }` result. The
   * producer starts only after the response was sent, so the caller knows the id before any event;
   * if the request fails or is cancelled, it never starts. Always set by `serve`; optional so
   * unit tests of non-streaming handlers can pass a plain context.
   */
  openStream?: (producer: StreamProducer) => string;
}

/** Longest wait for a cancelled stream's producer to clean up before `CANCELLED` is sent anyway. */
export const STREAM_CANCEL_GRACE_MS = 5000;

/** Serves one method: gets validated params, returns the result (validated before it is sent). */
export type Handler = (params: never, context: HandlerContext) => unknown;

export interface ServeOptions {
  /** Method table the requests are validated against (`methods` or `privilegedMethods`). */
  table: Readonly<Record<string, MethodDef>>;
  /** The process this server runs in; methods routed elsewhere are refused. */
  route: Route;
  handlers: Readonly<Record<string, Handler>>;
  /** Unexpected failures (handler bugs, malformed messages), for logging. */
  onError?: (error: unknown) => void;
}

function errorResponse(id: string, error: ErrorInfo): Response {
  return { id, ok: false, error };
}

function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof RpcError) return error.toInfo();
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'INTERNAL', message: `Unexpected error: ${message}` };
}

interface PendingStream {
  id: string;
  producer: StreamProducer;
  controller: AbortController;
}

interface RunningStream {
  controller: AbortController;
  /** Sends the final event once; later calls do nothing. */
  finish(event: Event): void;
}

const cancelledInfo = (): ErrorInfo => ({
  code: 'CANCELLED',
  message: 'The operation was cancelled',
});

/**
 * Answers the requests that arrive on `port` with `options.handlers` and handles `{ cancel }`
 * messages: a cancelled request is answered `CANCELLED` at once and its handler's signal aborted;
 * whatever the handler returns later is dropped. Streams opened by a handler
 * (`context.openStream`) send `data` events, then `end` (`{ delivered }`) or `error`; a cancel of
 * the stream id aborts its producer and ends it with an `error` event of code `CANCELLED`.
 * Returns a function that stops serving and aborts every running request and stream.
 */
export function serve(port: Port, options: ServeOptions): () => void {
  const running = new Map<string, AbortController>();
  const streams = new Map<string, RunningStream>();
  const report = options.onError ?? (() => undefined);

  const startStream = (method: string, pending: PendingStream) => {
    const { id, controller } = pending;
    const def = Object.hasOwn(options.table, method) ? options.table[method] : undefined;
    let over = false;
    let delivered = 0;
    const finish = (event: Event) => {
      if (over) return;
      over = true;
      streams.delete(id);
      port.send(event);
    };
    streams.set(id, { controller, finish });
    const sink: StreamSink = {
      streamId: id,
      signal: controller.signal,
      send(payload) {
        if (over || controller.signal.aborted) return;
        const parsed = def?.stream?.safeParse(payload);
        if (parsed && !parsed.success) {
          report(new Error(`Invalid stream data for ${method}: ${parsed.error.message}`));
          controller.abort();
          finish({
            stream: id,
            kind: 'error',
            payload: { code: 'INTERNAL', message: `Invalid stream data for ${method}` },
          });
          return;
        }
        delivered++;
        port.send({ stream: id, kind: 'data', payload: parsed ? parsed.data : payload });
      },
    };
    const settle = (event: () => Event) => {
      if (controller.signal.aborted) {
        finish({ stream: id, kind: 'error', payload: cancelledInfo() });
      } else finish(event());
    };
    let produced: Promise<number>;
    try {
      produced = pending.producer(sink);
    } catch (error) {
      produced = Promise.reject(error);
    }
    produced.then(
      (count) =>
        settle(() => ({
          stream: id,
          kind: 'end',
          payload: { delivered: Number.isInteger(count) && count >= 0 ? count : delivered },
        })),
      (error: unknown) =>
        settle(() => {
          if (!(error instanceof RpcError)) report(error);
          return { stream: id, kind: 'error', payload: toErrorInfo(error) };
        }),
    );
  };

  const cancelStream = (id: string): boolean => {
    const stream = streams.get(id);
    if (!stream) return false;
    stream.controller.abort();
    const timer = setTimeout(
      () => stream.finish({ stream: id, kind: 'error', payload: cancelledInfo() }),
      STREAM_CANCEL_GRACE_MS,
    );
    (timer as { unref?: () => void }).unref?.();
    return true;
  };

  const answer = (method: string, message: Response, opened: PendingStream[]) => {
    if (!running.delete(message.id)) {
      // Cancelled meanwhile: already answered, its streams never start.
      for (const s of opened) s.controller.abort();
      return;
    }
    port.send(message);
    for (const s of opened) {
      if (message.ok) startStream(method, s);
      else s.controller.abort();
    }
  };

  const handle = async (
    id: string,
    method: string,
    rawParams: unknown,
    signal: AbortSignal,
    opened: PendingStream[],
  ): Promise<Response> => {
    const def = Object.hasOwn(options.table, method) ? options.table[method] : undefined;
    if (def && def.route !== options.route) {
      return errorResponse(id, {
        code: 'INTERNAL',
        message: `${method} is served by ${def.route}, not by ${options.route}`,
      });
    }
    const params = parseParamsIn(options.table, method, rawParams);
    if (!params.ok) return errorResponse(id, params.error);
    const handler = Object.hasOwn(options.handlers, method) ? options.handlers[method] : undefined;
    if (!handler) {
      return errorResponse(id, {
        code: 'UNSUPPORTED',
        message: `${method} is not implemented yet`,
      });
    }
    try {
      const openStream = (producer: StreamProducer): string => {
        const stream: PendingStream = {
          id: `stream-${globalThis.crypto.randomUUID()}`,
          producer,
          controller: new AbortController(),
        };
        opened.push(stream);
        return stream.id;
      };
      const value: unknown = await handler(params.data as never, {
        signal,
        requestId: id,
        openStream,
      });
      const result = parseResultIn(options.table, method, value);
      if (!result.ok) report(new Error(result.error.message));
      return result.ok
        ? ({ id, ok: true, result: result.data } satisfies Response)
        : errorResponse(id, result.error);
    } catch (error) {
      if (!(error instanceof RpcError)) report(error);
      return errorResponse(id, toErrorInfo(error));
    }
  };

  const onMessage = (message: unknown) => {
    const cancelled = cancelSchema.safeParse(message);
    if (cancelled.success) {
      if (cancelStream(cancelled.data.cancel)) return;
      const controller = running.get(cancelled.data.cancel);
      if (!controller) return; // unknown or finished: ignored
      running.delete(cancelled.data.cancel);
      controller.abort();
      port.send(
        errorResponse(cancelled.data.cancel, {
          code: 'CANCELLED',
          message: 'The operation was cancelled',
        }),
      );
      return;
    }
    const parsed = requestSchema.safeParse(message);
    if (!parsed.success) {
      const id = (message as { id?: unknown } | null)?.id;
      report(new Error(`Malformed message: ${JSON.stringify(message)}`));
      if (typeof id === 'string' && id.length > 0 && !running.has(id)) {
        port.send(errorResponse(id, { code: 'INVALID_PARAMS', message: 'Malformed request' }));
      }
      return;
    }
    const { id, method, params } = parsed.data;
    if (running.has(id)) {
      // Can't answer with this id without confusing the caller about the running request.
      report(new Error(`Duplicate request id ${id}`));
      return;
    }
    const controller = new AbortController();
    running.set(id, controller);
    const opened: PendingStream[] = [];
    void handle(id, method, params, controller.signal, opened).then((response) =>
      answer(method, response, opened),
    );
  };

  const unsubscribe = port.onMessage(onMessage);
  return () => {
    unsubscribe();
    for (const controller of running.values()) controller.abort();
    running.clear();
    for (const stream of streams.values()) stream.controller.abort();
    streams.clear();
  };
}

export interface CallOptions {
  /** Answer `TIMEOUT` (and send a cancel) when no response came in time. */
  timeoutMs?: number;
}

/**
 * Sends requests on a port and resolves them with the matching responses; failed responses
 * reject with an `RpcError`. Used by the backend for its privileged calls to `main`.
 */
export class RpcClient {
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: RpcError) => void }
  >();
  private next = 0;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly port: Port,
    private readonly idPrefix = 'c',
  ) {
    this.unsubscribe = port.onMessage((message) => this.receive(message));
  }

  call(method: string, params: unknown, options: CallOptions = {}): Promise<unknown> {
    const id = `${this.idPrefix}${++this.next}`;
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = <T>(fn: (value: T) => void) => {
        return (value: T) => {
          if (timer) clearTimeout(timer);
          this.pending.delete(id);
          fn(value);
        };
      };
      this.pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
      if (options.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          this.pending.get(id)?.reject(new RpcError('TIMEOUT', `${method} did not answer in time`));
          this.port.send({ cancel: id });
        }, options.timeoutMs);
      }
      this.port.send({ id, method, params });
    });
  }

  /** Rejects every pending call (the port is gone) and stops listening. */
  close(reason = 'The connection closed'): void {
    this.unsubscribe();
    for (const entry of [...this.pending.values()]) {
      entry.reject(new RpcError('INTERNAL', reason));
    }
  }

  private receive(message: unknown): void {
    const parsed = responseSchema.safeParse(message);
    if (!parsed.success) return;
    const entry = this.pending.get(parsed.data.id);
    if (!entry) return;
    if (parsed.data.ok) entry.resolve(parsed.data.result);
    else {
      const { code, message: text, detail } = parsed.data.error;
      entry.reject(new RpcError(code, text, detail));
    }
  }
}
