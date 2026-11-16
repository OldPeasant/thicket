import {
  cancel as cancelSchema,
  parseParamsIn,
  parseResultIn,
  request as requestSchema,
  response as responseSchema,
  type ErrorCode,
  type ErrorInfo,
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

export interface HandlerContext {
  /** Aborted when the caller cancels the request (or the port closes). */
  signal: AbortSignal;
  requestId: string;
}

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

/**
 * Answers the requests that arrive on `port` with `options.handlers` and handles `{ cancel }`
 * messages: a cancelled request is answered `CANCELLED` at once and its handler's signal aborted;
 * whatever the handler returns later is dropped. Returns a function that stops serving and aborts
 * every running request.
 */
export function serve(port: Port, options: ServeOptions): () => void {
  const running = new Map<string, AbortController>();
  const report = options.onError ?? (() => undefined);

  const answer = (message: Response) => {
    if (!running.delete(message.id)) return; // cancelled meanwhile: already answered
    port.send(message);
  };

  const handle = async (id: string, method: string, rawParams: unknown, signal: AbortSignal) => {
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
      const value: unknown = await handler(params.data as never, { signal, requestId: id });
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
    void handle(id, method, params, controller.signal).then(answer);
  };

  const unsubscribe = port.onMessage(onMessage);
  return () => {
    unsubscribe();
    for (const controller of running.values()) controller.abort();
    running.clear();
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
