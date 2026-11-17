import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';

import type { ShellOutput } from '@thicket/contract';

import { toConnectError } from '../connections/errors';
import { abortable } from '../connections/manager';
import type { ClientConfig } from '../connections/options';
import { RpcError } from '../server/rpc';
import type { FromWorker, ToWorker, WorkerError } from './protocol';

/** The part of `Worker` the host uses (tests pass fakes). */
export interface WorkerLike {
  postMessage(message: ToWorker): void;
  on(event: 'message', listener: (message: FromWorker) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): Promise<number>;
}

export interface ShellHostOptions {
  /**
   * The worker script: `shell-worker.cjs` next to the bundled backend, or `worker.ts` from source
   * (tests: Node strips the types). Without it `open` answers `UNSUPPORTED`.
   */
  workerUrl: string | URL | undefined;
  /** Defaults to `new Worker(url)`. */
  createWorker?(url: string | URL): WorkerLike;
  /**
   * How long an interrupted evaluation may take to stop by itself before its worker is
   * terminated and replaced (a synchronous loop never stops by itself). Default 1000 ms.
   */
  interruptGraceMs?: number;
  /** How long a closing worker may take to close its client before it is terminated. */
  closeGraceMs?: number;
  log?(message: string): void;
}

type Incoming = FromWorker | { type: 'exit' };

interface Session {
  id: string;
  profileId: string;
  config: ClientConfig;
  /** The current database (follows `db` outputs; a replacement worker starts there). */
  db: string;
  worker: WorkerLike;
  /** Listeners of the worker's messages, by request id (`exit`: the worker is gone). */
  pending: Map<number, (message: Incoming) => void>;
  /** Evaluations run one after another, like input in a REPL. */
  queue: Promise<unknown>;
  /**
   * Set once the worker died (crash or terminate): the next eval or completion starts a
   * replacement. `told`: the evaluation that saw the death already reported `reason` as its error.
   */
  dead?: { reason: string; told?: boolean };
  /** The replacement worker being started (shared by an eval and completions). */
  restarting?: Promise<void>;
  /** Restart notice for the next evaluation (a completion may have restarted the worker). */
  notice?: string;
  closed: boolean;
}

/** Messages of `ShellHost.eval` outputs about the session itself (not from mongosh). */
export const RESTARTED_TEXT =
  'The evaluation did not stop when interrupted: the shell was restarted, its variables are lost.';
/** Error of an evaluation whose worker crashed (the next input gets a fresh worker). */
export const CRASHED_TEXT = 'The shell stopped unexpectedly: it was restarted.';
const CLOSED_TEXT = 'The shell session was closed';

let nextRequestId = 1;

/**
 * mongosh sessions of the backend (docs/mongosh.md): one `worker_thread` with its own
 * `MongoClient` per session. Cancel interrupts an evaluation cooperatively; an evaluation that
 * doesn't stop within `interruptGraceMs` (`while (true) {}`) gets its worker terminated and a
 * fresh one, connected to the same database.
 */
export class ShellHost {
  private readonly sessions = new Map<string, Session>();
  private readonly workerUrl: string | URL | undefined;
  private readonly createWorker: (url: string | URL) => WorkerLike;
  private readonly interruptGraceMs: number;
  private readonly closeGraceMs: number;
  private readonly log: (message: string) => void;

  constructor(options: ShellHostOptions) {
    this.workerUrl = options.workerUrl;
    this.createWorker = options.createWorker ?? ((url) => new Worker(url) as WorkerLike);
    this.interruptGraceMs = options.interruptGraceMs ?? 1000;
    this.closeGraceMs = options.closeGraceMs ?? 2000;
    this.log = options.log ?? (() => undefined);
  }

  /** Starts a session for an open connection's driver configuration. */
  async open(
    profileId: string,
    config: ClientConfig,
    db: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ sessionId: string; db: string }> {
    if (this.workerUrl === undefined) {
      throw new RpcError('UNSUPPORTED', 'This backend was started without a shell worker');
    }
    const id = randomUUID();
    const { worker, db: current } = await this.startWorker(id, config, db, signal);
    const session: Session = {
      id,
      profileId,
      config,
      db: current,
      worker,
      pending: new Map(),
      queue: Promise.resolve(),
      closed: false,
    };
    this.sessions.set(id, session);
    this.attach(session, worker);
    this.log(`shell ${id} opened on ${profileId}`);
    return { sessionId: id, db: current };
  }

  /**
   * Evaluates `code` in a session, after the evaluations before it; outputs go to `emit`.
   * Resolves with the number of outputs once the evaluation is over. An abort of `signal`
   * interrupts it (and drops it while it is still queued); the promise then rejects `CANCELLED`
   * once the session is ready for the next input.
   */
  eval(
    sessionId: string,
    code: string,
    emit: (output: ShellOutput) => void,
    signal?: AbortSignal,
  ): Promise<number> {
    let session: Session;
    try {
      session = this.session(sessionId);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    const run = session.queue.then(() => this.runEval(session, code, emit, signal));
    session.queue = run.catch(() => undefined);
    return run;
  }

  private async runEval(
    session: Session,
    code: string,
    emit: (output: ShellOutput) => void,
    signal: AbortSignal | undefined,
  ): Promise<number> {
    // Closed while queued: no worker is started for it.
    if (session.closed) throw notFound(session.id);
    if (signal?.aborted) throw cancelled();
    await this.ensureWorker(session, signal);
    if (signal?.aborted) throw cancelled();
    if (session.notice !== undefined) {
      emit({ kind: 'print', text: session.notice });
      delete session.notice;
    }
    const id = nextRequestId++;
    let count = 0;
    let interrupted = false;
    const done = new Promise<void>((resolve) => {
      session.pending.set(id, (message) => {
        if (message.type === 'output') {
          if (message.output.kind === 'db') session.db = message.output.db;
          if (!interrupted) {
            count++;
            emit(message.output);
          }
        } else if (message.type === 'evalDone') {
          resolve();
        } else if (message.type === 'exit') {
          // The worker died under the evaluation: it ends with the reason as its error (an
          // interrupted one is answered CANCELLED, the notice then comes with the next input).
          if (!interrupted && session.dead) {
            count++;
            emit({ kind: 'error', text: session.dead.reason });
            session.dead.told = true;
          }
          resolve();
        }
      });
    });
    const worker = session.worker;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      interrupted = true;
      worker.postMessage({ type: 'interrupt' });
      timer = setTimeout(() => {
        if (session.pending.has(id) && session.worker === worker) {
          this.log(`shell ${session.id}: evaluation did not stop, restarting its worker`);
          this.kill(session, RESTARTED_TEXT);
        }
      }, this.interruptGraceMs);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      worker.postMessage({ type: 'eval', id, code });
      await done;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (timer !== undefined) clearTimeout(timer);
      session.pending.delete(id);
    }
    if (interrupted) throw cancelled();
    return count;
  }

  /** Completions for the input before the cursor. */
  async complete(sessionId: string, code: string, signal?: AbortSignal): Promise<string[]> {
    const session = this.session(sessionId);
    // A dead worker is replaced (its restart notice waits for the next evaluation). The restart
    // is not tied to this request: cancelling the completion only stops waiting for it.
    if (session.dead || session.restarting) {
      await abortable(this.ensureWorker(session, undefined), signal);
    }
    const id = nextRequestId++;
    const answer = new Promise<string[]>((resolve, reject) => {
      session.pending.set(id, (message) => {
        if (message.type === 'completions') resolve(message.completions);
        else if (message.type === 'completeFailed') {
          reject(new RpcError('INTERNAL', `Completion failed: ${message.error.message}`));
        } else if (message.type === 'exit') {
          reject(new RpcError('CANCELLED', 'The shell was restarted'));
        }
      });
    });
    const onAbort = () => session.pending.delete(id);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      session.worker.postMessage({ type: 'complete', id, code });
      return await abortable(answer, signal);
    } finally {
      signal?.removeEventListener('abort', onAbort);
      session.pending.delete(id);
    }
  }

  /** Closes a session (its client and worker); `NOT_FOUND` for unknown ids. */
  async close(sessionId: string): Promise<void> {
    await this.closeSession(this.session(sessionId));
  }

  /** Closes the sessions of a profile (its connection was closed). */
  async closeProfile(profileId: string): Promise<void> {
    await Promise.all(
      [...this.sessions.values()]
        .filter((s) => s.profileId === profileId)
        .map((s) => this.closeSession(s)),
    );
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => this.closeSession(s)));
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Ids of the open sessions (diagnostics, tests). */
  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  private session(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) throw new RpcError('NOT_FOUND', `No shell session ${sessionId}`);
    return session;
  }

  private async closeSession(session: Session): Promise<void> {
    if (session.closed) return;
    session.closed = true;
    this.sessions.delete(session.id);
    const worker = session.worker;
    if (!session.dead) {
      const closed = new Promise<void>((resolve) => {
        worker.on('message', (message) => {
          if (message.type === 'closed') resolve();
        });
        worker.on('exit', () => resolve());
        setTimeout(resolve, this.closeGraceMs).unref();
      });
      worker.postMessage({ type: 'close' });
      await closed;
    }
    this.kill(session, CLOSED_TEXT);
    await worker.terminate().catch(() => undefined);
    this.log(`shell ${session.id} closed`);
  }

  /** Terminates the session's worker; pending requests end, the next use starts a new one. */
  private kill(session: Session, reason: string): void {
    if (session.dead) return;
    session.dead = { reason };
    void session.worker.terminate().catch(() => undefined);
    this.flush(session);
  }

  private flush(session: Session): void {
    for (const listener of [...session.pending.values()]) listener({ type: 'exit' });
  }

  private attach(session: Session, worker: WorkerLike): void {
    worker.on('message', (message) => {
      if (session.worker !== worker) return;
      if ('id' in message) session.pending.get(message.id)?.(message);
    });
    worker.on('error', (error) => {
      this.log(`shell ${session.id}: worker error ${error.message}`);
    });
    worker.on('exit', () => {
      if (session.worker !== worker || session.dead) return;
      session.dead = { reason: session.closed ? CLOSED_TEXT : CRASHED_TEXT };
      this.flush(session);
    });
  }

  /**
   * Replaces a dead worker; the restart notice is kept in `session.notice` for the next
   * evaluation (unless the evaluation that saw the death already reported it). One restart at a
   * time: a second caller waits for the running one. An abort of `signal` (the evaluation that
   * started the restart) stops it and terminates the new worker; the session stays dead.
   */
  private ensureWorker(session: Session, signal: AbortSignal | undefined): Promise<void> {
    if (session.restarting) return abortable(session.restarting, signal);
    if (!session.dead) return Promise.resolve();
    const restarting = this.restart(session, session.dead, signal);
    session.restarting = restarting;
    const clear = () => {
      if (session.restarting === restarting) delete session.restarting;
    };
    restarting.then(clear, clear);
    return restarting;
  }

  private async restart(
    session: Session,
    dead: { reason: string; told?: boolean },
    signal: AbortSignal | undefined,
  ): Promise<void> {
    if (session.closed) throw notFound(session.id);
    const { worker, db } = await this.startWorker(session.id, session.config, session.db, signal);
    if (session.closed) {
      await worker.terminate().catch(() => undefined);
      throw notFound(session.id);
    }
    session.worker = worker;
    session.db = db;
    delete session.dead;
    if (!dead.told) session.notice = dead.reason;
    this.attach(session, worker);
  }

  private async startWorker(
    id: string,
    config: ClientConfig,
    db: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ worker: WorkerLike; db: string }> {
    if (this.workerUrl === undefined)
      throw new RpcError('UNSUPPORTED', 'This backend was started without a shell worker');
    const worker = this.createWorker(this.workerUrl);
    const opened = new Promise<string>((resolve, reject) => {
      worker.on('message', (message) => {
        if (message.type === 'opened') resolve(message.db);
        else if (message.type === 'openFailed') {
          reject(toConnectError(fromWorkerError(message.error), secretsOf(config), true));
        }
      });
      worker.on('error', (error) => {
        reject(new RpcError('INTERNAL', `The shell could not start: ${error.message}`));
      });
      worker.on('exit', (code) => {
        reject(new RpcError('INTERNAL', `The shell stopped while starting (exit code ${code})`));
      });
    });
    worker.postMessage({ type: 'open', uri: config.uri, options: config.options, db });
    try {
      return { worker, db: await abortable(opened, signal) };
    } catch (error) {
      await worker.terminate().catch(() => undefined);
      this.log(`shell ${id}: open failed: ${(error as Error).message}`);
      throw error;
    }
  }
}

function notFound(sessionId: string): RpcError {
  return new RpcError('NOT_FOUND', `No shell session ${sessionId}`);
}

function cancelled(): RpcError {
  return new RpcError('CANCELLED', 'The operation was cancelled');
}

function fromWorkerError(error: WorkerError): Error {
  const out = new Error(error.message) as Error & { code?: number | string };
  out.name = error.name;
  if (error.code !== undefined) out.code = error.code;
  return out;
}

/** Secrets in a driver configuration, masked in error messages. */
function secretsOf(config: ClientConfig): string[] {
  const o = config.options;
  return [o.auth?.password, o.proxyPassword, o.passphrase, o.tlsCertificateKeyFilePassword].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
}
