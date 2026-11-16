import type { EnvironmentProviders, Provider } from '@angular/core';
import type {
  ErrorInfo,
  Event,
  MethodName,
  ParsedParamsOf,
  Request,
  Response,
  ResultOf,
  StreamDataOf,
  StreamEnd,
  StreamMethodName,
} from '@thicket/contract';

import { ApiError } from '../api-error';
import { THICKET_BRIDGE, type ThicketBridge } from '../thicket-bridge';

/** What a handler may return: the result, or an error (thrown `ApiError` works too). */
export type FakeOutcome<M extends MethodName> = ResultOf<M> | { error: ErrorInfo };

/** Answers one method in the fake. `request.id` is the id the client chose (for `cancel`). */
export type FakeHandler<M extends MethodName> = (
  params: ParsedParamsOf<M>,
  request: Request,
) => FakeOutcome<M> | Promise<FakeOutcome<M>>;

/**
 * In-memory `window.thicket` for renderer tests. Register answers with `handle()`, push stream
 * events with `emit()`/`data()`/`end()`/`failStream()`, and inspect `requests` and `cancels`.
 * Unhandled methods answer `UNKNOWN_METHOD`. Params are not validated against the contract.
 *
 * ```ts
 * const fake = new FakeThicketBridge();
 * TestBed.configureTestingModule({ providers: [provideFakeThicket(fake)] });
 * fake.handle('docs.find', () => ({ streamId: 's1' }));
 * ```
 */
export class FakeThicketBridge implements ThicketBridge {
  /** Every request sent, in order. */
  readonly requests: Request[] = [];
  /** Every id passed to `cancel`, in order. */
  readonly cancels: string[] = [];

  private readonly handlers = new Map<string, FakeHandler<MethodName>>();
  private readonly listeners = new Set<(event: Event) => void>();

  /** Answers `method` with `handler` (replaces an earlier handler). */
  handle<M extends MethodName>(method: M, handler: FakeHandler<M>): this {
    this.handlers.set(method, handler as unknown as FakeHandler<MethodName>);
    return this;
  }

  /** Answers `method` with a fixed result. */
  respond<M extends MethodName>(method: M, result: ResultOf<M>): this {
    return this.handle(method, () => result);
  }

  /** Answers `method` with an error. */
  fail<M extends MethodName>(method: M, error: ErrorInfo): this {
    return this.handle(method, () => ({ error }));
  }

  /** Pushes an event to every listener. */
  emit(event: Event): this {
    for (const listener of [...this.listeners]) listener(event);
    return this;
  }

  /** Pushes a `data` event typed by the stream method. */
  data<M extends StreamMethodName>(_method: M, streamId: string, payload: StreamDataOf<M>): this {
    return this.emit({ stream: streamId, kind: 'data', payload });
  }

  /** Pushes the `end` event of a stream. */
  end(streamId: string, payload: StreamEnd = { delivered: 0 }): this {
    return this.emit({ stream: streamId, kind: 'end', payload });
  }

  /** Ends a stream with an `error` event. */
  failStream(streamId: string, error: ErrorInfo): this {
    return this.emit({ stream: streamId, kind: 'error', payload: error });
  }

  /** Requests sent for `method`. */
  requestsFor(method: MethodName): Request[] {
    return this.requests.filter((request) => request.method === method);
  }

  /** Number of active `on()` listeners (to assert that clients clean up). */
  get listenerCount(): number {
    return this.listeners.size;
  }

  async request(request: Request): Promise<Response> {
    this.requests.push(request);
    const handler = this.handlers.get(request.method);
    if (!handler) {
      return error(request.id, {
        code: 'UNKNOWN_METHOD',
        message: `FakeThicketBridge has no handler for "${request.method}"`,
      });
    }
    try {
      const outcome = await handler(request.params as never, request);
      if (isErrorOutcome(outcome)) return error(request.id, outcome.error);
      return { id: request.id, ok: true, result: outcome };
    } catch (thrown) {
      const apiError = ApiError.from(thrown);
      return error(request.id, {
        code: apiError.code,
        message: apiError.message,
        detail: apiError.detail,
      });
    }
  }

  cancel(id: string): void {
    this.cancels.push(id);
  }

  on(listener: (event: Event) => void): () => void {
    // Wrap so that the same function registered twice gets two independent subscriptions.
    const wrapped = (event: Event): void => listener(event);
    this.listeners.add(wrapped);
    return () => this.listeners.delete(wrapped);
  }
}

/** Providers that replace `window.thicket` with `fake` (a new `FakeThicketBridge` by default). */
export function provideFakeThicket(
  fake: FakeThicketBridge = new FakeThicketBridge(),
): (Provider | EnvironmentProviders)[] {
  return [{ provide: THICKET_BRIDGE, useValue: fake }];
}

function error(id: string, info: ErrorInfo): Response {
  return { id, ok: false, error: info };
}

function isErrorOutcome(outcome: unknown): outcome is { error: ErrorInfo } {
  return (
    typeof outcome === 'object' &&
    outcome !== null &&
    Object.keys(outcome).length === 1 &&
    'error' in outcome
  );
}
