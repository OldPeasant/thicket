import type { BackendRestarted } from '@thicket/contract';
import type { BackendControlMessage } from '@thicket/backend';

/** The part of Electron's `UtilityProcess` the host uses. */
export interface BackendProcess<P> {
  readonly pid: number | undefined;
  postMessage(message: BackendControlMessage, transfer: P[]): void;
  on(event: 'exit', listener: (code: number) => void): unknown;
  kill(): boolean;
}

/** A `MessageChannelMain`: two entangled ports. */
export interface Channel<P> {
  port1: P;
  port2: P;
}

/** A renderer that wants a port to the backend; called again with a fresh port after a restart. */
export type RendererSink<P> = (port: P, restarted?: BackendRestarted) => void;

export interface BackendHostOptions<P> {
  /** Starts the backend utilityProcess. */
  fork: () => BackendProcess<P>;
  createChannel: () => Channel<P>;
  /** Serves main's end of a new privileged port; returns a function that stops serving it. */
  servePrivileged: (port: P) => () => void;
  /** Closes a port that is no longer used. */
  closePort: (port: P) => void;
  log?: (message: string) => void;
  /** A backend that lived shorter than this counts as a crash loop: the next start waits. */
  stableAfterMs?: number;
  /** First and longest wait before restarting a crash-looping backend. */
  minDelayMs?: number;
  maxDelayMs?: number;
  /** Injected timers (tests). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  now?: () => number;
}

interface Sink<P> {
  id: number;
  deliver: RendererSink<P>;
}

/**
 * Owns the backend utilityProcess: starts it, hands it the privileged port and one port per
 * renderer, and restarts it when it dies. After a restart every registered renderer gets a fresh
 * port together with the restart info (the preload turns it into a `backend.restarted` event).
 */
export class BackendHost<P> {
  private process: BackendProcess<P> | undefined;
  private stopPrivileged: (() => void) | undefined;
  private readonly sinks = new Map<number, Sink<P>>();
  private nextSink = 0;
  private restarts = 0;
  private quickCrashes = 0;
  private startedAt = 0;
  private stopping = false;
  private pendingRestart = false;
  private readonly log: (message: string) => void;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly now: () => number;

  constructor(private readonly options: BackendHostOptions<P>) {
    this.log = options.log ?? (() => undefined);
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.now = options.now ?? (() => Date.now());
  }

  /** Process id of the running backend (diagnostics, tests). */
  get pid(): number | undefined {
    return this.process?.pid;
  }

  get restartCount(): number {
    return this.restarts;
  }

  start(): void {
    if (this.process || this.stopping) return;
    this.spawn(undefined);
  }

  /**
   * Registers a renderer: it gets a port to the backend now (if running) and after each restart.
   * Returns a function to call when the window closes.
   */
  connectRenderer(deliver: RendererSink<P>): () => void {
    const sink: Sink<P> = { id: ++this.nextSink, deliver };
    this.sinks.set(sink.id, sink);
    if (this.process) this.broker(this.process, sink, undefined);
    return () => void this.sinks.delete(sink.id);
  }

  /** Stops the backend for good (app quit). */
  stop(): void {
    this.stopping = true;
    this.stopPrivileged?.();
    this.stopPrivileged = undefined;
    const running = this.process;
    this.process = undefined;
    running?.kill();
  }

  private spawn(restarted: BackendRestarted | undefined): void {
    const child = this.options.fork();
    this.process = child;
    this.startedAt = this.now();
    child.on('exit', (code) => this.onExit(child, code));

    const privileged = this.options.createChannel();
    child.postMessage({ type: 'privileged' }, [privileged.port2]);
    this.stopPrivileged?.();
    const stopServing = this.options.servePrivileged(privileged.port1);
    this.stopPrivileged = () => {
      stopServing();
      this.options.closePort(privileged.port1);
    };

    for (const sink of this.sinks.values()) this.broker(child, sink, restarted);
    this.log(`backend started (pid ${String(child.pid)})`);
  }

  private broker(child: BackendProcess<P>, sink: Sink<P>, restarted: BackendRestarted | undefined) {
    const channel = this.options.createChannel();
    child.postMessage({ type: 'renderer', window: sink.id }, [channel.port2]);
    sink.deliver(channel.port1, restarted);
  }

  private onExit(child: BackendProcess<P>, code: number): void {
    if (child !== this.process) return; // an old process, already replaced
    this.process = undefined;
    this.stopPrivileged?.();
    this.stopPrivileged = undefined;
    if (this.stopping || this.pendingRestart) return;

    const lived = this.now() - this.startedAt;
    const stableAfter = this.options.stableAfterMs ?? 10_000;
    this.quickCrashes = lived < stableAfter ? this.quickCrashes + 1 : 0;
    const min = this.options.minDelayMs ?? 250;
    const max = this.options.maxDelayMs ?? 10_000;
    const delay = this.quickCrashes <= 1 ? 0 : Math.min(max, min * 2 ** (this.quickCrashes - 2));
    const reason = `backend process exited with code ${String(code)}`;
    this.log(`${reason}; restarting in ${String(delay)} ms`);

    const restart = () => {
      this.pendingRestart = false;
      if (this.stopping || this.process) return;
      this.restarts += 1;
      this.spawn({ restarts: this.restarts, reason });
    };
    if (delay === 0) restart();
    else {
      this.pendingRestart = true;
      this.setTimer(restart, delay);
    }
  }
}
