import type { Port } from '@thicket/backend';
import {
  BROADCAST_STREAMS,
  event as eventSchema,
  request as requestSchema,
  response as responseSchema,
  route,
  type BackendRestarted,
  type ErrorInfo,
  type Event,
  type Request,
  type Response,
  type Route,
} from '@thicket/contract';

/** What the preload exposes as `window.thicket` (SPEC.md section 4). */
export interface ThicketApi {
  /** Sends a request; resolves with its response (never rejects for contract errors). */
  request(request: Request): Promise<Response>;
  /** Cancels a running request or stream by its request id or stream id. */
  cancel(id: string): void;
  /**
   * Listens to the events of one stream (a `streamId` or a broadcast stream name), or to every
   * event when called with just a listener. Returns an unsubscribe function.
   */
  on(stream: string, listener: (event: Event) => void): () => void;
  on(listener: (event: Event) => void): () => void;
}

type Listener = (event: Event) => void;

/** Events kept for a known stream until the renderer subscribes to it. */
export const MAX_BUFFERED_EVENTS = 1000;

interface Pending {
  target: Route;
  resolve: (response: Response) => void;
}

/**
 * The renderer side of the transport: routes each request by `route(method)` to main or the
 * backend, matches responses, delivers events and routes cancels to the owner of their target.
 * It knows nothing about Electron: the preload hands it the two ports.
 */
export class Bridge implements ThicketApi {
  private readonly ports = new Map<Route, { port: Port; unsubscribe: () => void }>();
  private readonly queued = new Map<Route, Request[]>([
    ['main', []],
    ['backend', []],
  ]);
  private readonly pending = new Map<string, Pending>();
  /** streamId → process that serves it, from responses that returned a `streamId`. */
  private readonly streamOwners = new Map<string, Route>();
  private readonly buffered = new Map<string, Event[]>();
  private readonly listeners = new Map<string, Set<Listener>>();
  /** Listeners of every event (`on(listener)`). */
  private readonly everything = new Set<Listener>();

  constructor(private readonly report: (error: unknown) => void = () => undefined) {}

  /**
   * Connects (or reconnects) a process. A new backend port after a restart fails the requests
   * and streams of the old process and emits `backend.restarted`.
   */
  setPort(target: Route, port: Port, restarted?: BackendRestarted): void {
    const old = this.ports.get(target);
    if (old) {
      old.unsubscribe();
      old.port.close();
      this.failProcess(target, {
        code: 'INTERNAL',
        message: `The ${target} process restarted; the operation was lost`,
      });
    }
    const unsubscribe = port.onMessage((message) => this.receive(target, message));
    this.ports.set(target, { port, unsubscribe });
    const queue = this.queued.get(target) ?? [];
    this.queued.set(target, []);
    for (const request of queue) port.send(request);
    if (restarted) {
      this.emit({ stream: BROADCAST_STREAMS.backendRestarted, kind: 'data', payload: restarted });
    }
  }

  request(request: Request): Promise<Response> {
    const parsed = requestSchema.safeParse(request);
    if (!parsed.success) {
      return Promise.reject(new TypeError('thicket.request needs { id, method, params }'));
    }
    const { id, method, params } = parsed.data;
    if (this.pending.has(id)) {
      return Promise.reject(new TypeError(`Request id ${id} is already in use`));
    }
    const target = route(method);
    if (!target) {
      return Promise.resolve({
        id,
        ok: false,
        error: { code: 'UNKNOWN_METHOD', message: `Unknown method "${method}"` },
      });
    }
    return new Promise((resolve) => {
      this.pending.set(id, { target, resolve });
      const message: Request = { id, method, params };
      const connected = this.ports.get(target);
      if (connected) connected.port.send(message);
      else this.queued.get(target)?.push(message);
    });
  }

  cancel(id: string): void {
    if (typeof id !== 'string' || id.length === 0) return;
    const pending = this.pending.get(id);
    const target = pending?.target ?? this.streamOwners.get(id);
    if (!target) return; // unknown or finished: ignored, as the contract says
    const queue = this.queued.get(target) ?? [];
    const index = queue.findIndex((request) => request.id === id);
    if (index >= 0 && pending) {
      // Never sent: answer locally.
      queue.splice(index, 1);
      this.settle(id, {
        id,
        ok: false,
        error: { code: 'CANCELLED', message: 'The operation was cancelled' },
      });
      return;
    }
    this.ports.get(target)?.port.send({ cancel: id });
  }

  on(stream: string, listener: Listener): () => void;
  on(listener: Listener): () => void;
  on(streamOrListener: string | Listener, maybeListener?: Listener): () => void {
    if (typeof streamOrListener === 'function' && maybeListener === undefined) {
      const listener = streamOrListener;
      this.everything.add(listener);
      return () => void this.everything.delete(listener);
    }
    const stream = streamOrListener;
    const listener = maybeListener;
    if (typeof stream !== 'string' || typeof listener !== 'function') {
      throw new TypeError('thicket.on needs a listener, or a stream name and a listener');
    }
    let set = this.listeners.get(stream);
    if (!set) {
      set = new Set();
      this.listeners.set(stream, set);
    }
    set.add(listener);
    const early = this.buffered.get(stream);
    if (early) {
      this.buffered.delete(stream);
      for (const event of early) this.call(listener, event);
    }
    return () => {
      const current = this.listeners.get(stream);
      current?.delete(listener);
      if (current?.size === 0) this.listeners.delete(stream);
    };
  }

  private receive(target: Route, message: unknown): void {
    const asResponse = responseSchema.safeParse(message);
    if (asResponse.success) {
      const pending = this.pending.get(asResponse.data.id);
      if (!pending || pending.target !== target) return;
      if (asResponse.data.ok) {
        const streamId = (asResponse.data.result as { streamId?: unknown } | null)?.streamId;
        if (typeof streamId === 'string' && streamId.length > 0) {
          this.streamOwners.set(streamId, target);
          // Events can arrive before the renderer subscribes to the new stream: keep them.
          if (!this.listeners.has(streamId) && this.everything.size === 0) {
            this.buffered.set(streamId, []);
          }
        }
      }
      this.settle(asResponse.data.id, asResponse.data);
      return;
    }
    const asEvent = eventSchema.safeParse(message);
    if (asEvent.success) {
      this.emit(asEvent.data);
      return;
    }
    this.report(new Error(`Malformed message from ${target}`));
  }

  private emit(event: Event): void {
    const last = event.kind !== 'data';
    const set = this.listeners.get(event.stream);
    for (const listener of [...this.everything]) this.call(listener, event);
    if (set && set.size > 0) {
      for (const listener of [...set]) this.call(listener, event);
    } else {
      const buffer = this.buffered.get(event.stream);
      if (buffer && this.everything.size > 0) this.buffered.delete(event.stream);
      else if (buffer && buffer.length < MAX_BUFFERED_EVENTS) buffer.push(event);
      else if (buffer) this.report(new Error(`Dropped an event of stream ${event.stream}`));
    }
    if (last) this.streamOwners.delete(event.stream);
  }

  private call(listener: Listener, event: Event): void {
    try {
      listener(event);
    } catch (error) {
      this.report(error);
    }
  }

  private settle(id: string, response: Response): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.resolve(response);
  }

  /** Fails what was running in a process that went away. */
  private failProcess(target: Route, error: ErrorInfo): void {
    for (const [id, pending] of [...this.pending]) {
      if (pending.target === target) this.settle(id, { id, ok: false, error });
    }
    for (const [stream, owner] of [...this.streamOwners]) {
      if (owner === target) this.emit({ stream, kind: 'error', payload: error });
    }
  }
}
