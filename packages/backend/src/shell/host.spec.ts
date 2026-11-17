import type { ShellOutput } from '@thicket/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { awsAuthOptions } from '../auth/aws/aws';
import type { ClientConfig } from '../connections/options';
import { RpcError } from '../server/rpc';
import {
  CRASHED_TEXT,
  RESTARTED_TEXT,
  ShellHost,
  type ShellHostOptions,
  type WorkerLike,
} from './host';
import { withAwsCredentials, type FromWorker, type ToWorker } from './protocol';

/** Fictitious secrets; none of them is a real credential. */
const PASSWORD = 'fictitious-shell-Pw1';

const CONFIG: ClientConfig = {
  uri: 'mongodb://db.example.test:27017',
  options: { appName: 'Thicket', auth: { username: 'alice', password: PASSWORD } },
};

/** Fictitious AWS keys (not real credentials). */
const AWS_KEY_ID = 'AKIAFICTITIOUSKEY01';
const AWS_SECRET = 'fictitious-aws-Secret-Key-1';
const AWS_TOKEN = 'fictitious-aws-Session-Token-1';

/** MONGODB-AWS with explicit keys, as `auth/aws` builds it (a function provider in the options). */
const AWS_CONFIG: ClientConfig = {
  uri: 'mongodb://db.example.test:27017',
  options: {
    appName: 'Thicket',
    ...awsAuthOptions(
      { mechanism: 'MONGODB-AWS', username: AWS_KEY_ID, secretMode: 'saved' },
      { password: AWS_SECRET, awsSessionToken: AWS_TOKEN },
      undefined,
    ),
  },
};

type Listener = (value: never) => void;

/**
 * A fake shell worker: records what the host posts. By default it answers `open` with `opened`
 * (on the requested db, `test` otherwise) and `close` with `closed`; everything else is answered
 * by the test through `reply`. `terminate` ends it with an `exit` event, like a real `Worker`.
 */
class FakeWorker implements WorkerLike {
  readonly posted: ToWorker[] = [];
  terminated = 0;
  exited = false;
  private readonly listeners: Record<'message' | 'error' | 'exit', Listener[]> = {
    message: [],
    error: [],
    exit: [],
  };

  constructor(readonly answerOpen: boolean | 'fail' = true) {}

  postMessage(message: ToWorker): void {
    this.posted.push(message);
    if (message.type === 'open' && this.answerOpen === true) {
      queueMicrotask(() => this.reply({ type: 'opened', db: message.db ?? 'test' }));
    }
    if (message.type === 'close') queueMicrotask(() => this.reply({ type: 'closed' }));
  }

  on(event: 'message' | 'error' | 'exit', listener: Listener): this {
    this.listeners[event].push(listener);
    return this;
  }

  terminate(): Promise<number> {
    this.terminated++;
    queueMicrotask(() => this.exit(1));
    return Promise.resolve(1);
  }

  reply(message: FromWorker): void {
    if (this.exited) return;
    for (const l of [...this.listeners.message]) (l as (m: FromWorker) => void)(message);
  }

  fail(error: Error): void {
    for (const l of [...this.listeners.error]) (l as (e: Error) => void)(error);
  }

  exit(code: number): void {
    if (this.exited) return;
    this.exited = true;
    for (const l of [...this.listeners.exit]) (l as (c: number) => void)(code);
  }

  /** The posted messages of a type. */
  of<T extends ToWorker['type']>(type: T): Extract<ToWorker, { type: T }>[] {
    return this.posted.filter((m): m is Extract<ToWorker, { type: T }> => m.type === type);
  }
}

function setup(options: Partial<ShellHostOptions> & { workers?: FakeWorker[] } = {}) {
  const queue = [...(options.workers ?? [])];
  const workers: FakeWorker[] = [];
  const urls: (string | URL)[] = [];
  const logs: string[] = [];
  const host = new ShellHost({
    workerUrl: 'file:///fictitious/shell-worker.cjs',
    createWorker: (url) => {
      urls.push(url);
      const worker = queue.shift() ?? new FakeWorker();
      workers.push(worker);
      return worker;
    },
    log: (message) => logs.push(message),
    ...options,
  });
  return { host, workers, urls, logs };
}

/** Collects the outputs of an evaluation. */
function collector() {
  const outputs: ShellOutput[] = [];
  return { outputs, emit: (output: ShellOutput) => void outputs.push(output) };
}

async function rejection(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RpcError);
    return error as RpcError;
  }
  throw new Error('expected a rejection');
}

/** The last `eval` message the worker got (waits until it got at least `count`). */
async function lastEval(worker: FakeWorker, count = 1) {
  await vi.waitFor(() => expect(worker.of('eval').length).toBeGreaterThanOrEqual(count));
  return worker.of('eval').at(-1) as Extract<ToWorker, { type: 'eval' }>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ShellHost.open', () => {
  it('answers UNSUPPORTED without a worker script and starts no worker', async () => {
    const createWorker = vi.fn(() => new FakeWorker());
    const host = new ShellHost({ workerUrl: undefined, createWorker });
    const error = await rejection(host.open('p1', CONFIG, undefined));
    expect(error.code).toBe('UNSUPPORTED');
    expect(createWorker).not.toHaveBeenCalled();
    expect(host.sessionIds()).toEqual([]);
  });

  it('starts a worker with the driver configuration and the requested database', async () => {
    const { host, workers, urls } = setup();
    const opened = await host.open('p1', CONFIG, 'shop');
    expect(opened).toEqual({ sessionId: expect.any(String) as unknown, db: 'shop' });
    expect(urls).toEqual(['file:///fictitious/shell-worker.cjs']);
    expect(workers[0]?.posted).toEqual([
      { type: 'open', uri: CONFIG.uri, options: CONFIG.options, db: 'shop' },
    ]);
    expect(host.has(opened.sessionId)).toBe(true);
    expect(host.sessionIds()).toEqual([opened.sessionId]);
  });

  it("answers with the worker's database when none was requested", async () => {
    const { host, workers } = setup();
    const opened = await host.open('p1', CONFIG, undefined);
    expect(opened.db).toBe('test');
    expect(workers[0]?.of('open')[0]?.db).toBeUndefined();
  });

  it('every session gets its own worker and id', async () => {
    const { host, workers } = setup();
    const a = await host.open('p1', CONFIG, undefined);
    const b = await host.open('p1', CONFIG, undefined);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(workers).toHaveLength(2);
  });

  it('maps an open failure like a connect error (secrets masked) and terminates the worker', async () => {
    const worker = new FakeWorker(false);
    const { host, logs } = setup({ workers: [worker] });
    const opening = host.open('p1', CONFIG, undefined);
    await vi.waitFor(() => expect(worker.of('open')).toHaveLength(1));
    worker.reply({
      type: 'openFailed',
      error: {
        name: 'MongoServerError',
        message: `Authentication failed for alice:${PASSWORD}`,
        code: 18,
      },
    });
    const error = await rejection(opening);
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).not.toContain(PASSWORD);
    expect(error.message).toContain('****');
    expect(worker.terminated).toBe(1);
    expect(host.sessionIds()).toEqual([]);
    expect(logs.join('\n')).not.toContain(PASSWORD);
  });

  it('maps a network failure code from the worker (NETWORK_ERROR)', async () => {
    const worker = new FakeWorker(false);
    const { host } = setup({ workers: [worker] });
    const opening = host.open('p1', CONFIG, undefined);
    await vi.waitFor(() => expect(worker.of('open')).toHaveLength(1));
    worker.reply({
      type: 'openFailed',
      error: { name: 'MongoNetworkError', message: 'connect ECONNREFUSED', code: 'ECONNREFUSED' },
    });
    expect((await rejection(opening)).code).toBe('NETWORK_ERROR');
    expect(worker.terminated).toBe(1);
  });

  it('a worker that errors or exits while starting answers INTERNAL and is terminated', async () => {
    const crashing = new FakeWorker(false);
    const exiting = new FakeWorker(false);
    const { host } = setup({ workers: [crashing, exiting] });
    const first = host.open('p1', CONFIG, undefined);
    await vi.waitFor(() => expect(crashing.of('open')).toHaveLength(1));
    crashing.fail(new Error('Cannot find module mongodb'));
    const error = await rejection(first);
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toBe('The shell could not start: Cannot find module mongodb');
    expect(crashing.terminated).toBe(1);

    const second = host.open('p1', CONFIG, undefined);
    await vi.waitFor(() => expect(exiting.of('open')).toHaveLength(1));
    exiting.exit(7);
    const exited = await rejection(second);
    expect(exited).toMatchObject({
      code: 'INTERNAL',
      message: 'The shell stopped while starting (exit code 7)',
    });
    expect(host.sessionIds()).toEqual([]);
  });

  it('a cancelled open answers CANCELLED and terminates the worker', async () => {
    const worker = new FakeWorker(false);
    const { host } = setup({ workers: [worker] });
    const controller = new AbortController();
    const opening = host.open('p1', CONFIG, undefined, controller.signal);
    await vi.waitFor(() => expect(worker.of('open')).toHaveLength(1));
    controller.abort();
    expect((await rejection(opening)).code).toBe('CANCELLED');
    expect(worker.terminated).toBe(1);
    expect(host.sessionIds()).toEqual([]);
  });
});

describe('ShellHost.open: driver options cross postMessage (MONGODB-AWS)', () => {
  it('posts clone-safe options: the AWS provider is resolved to plain credentials', async () => {
    expect(() => structuredClone(AWS_CONFIG.options)).toThrow();
    const { host, workers } = setup();
    await host.open('aws', AWS_CONFIG, undefined);
    const [open] = (workers[0] as FakeWorker).of('open');
    expect(() => structuredClone(open)).not.toThrow();
    expect(open).toMatchObject({
      type: 'open',
      uri: AWS_CONFIG.uri,
      options: { appName: 'Thicket', authMechanism: 'MONGODB-AWS', authSource: '$external' },
      awsCredentials: {
        accessKeyId: AWS_KEY_ID,
        secretAccessKey: AWS_SECRET,
        sessionToken: AWS_TOKEN,
      },
    });
    expect(open?.options.authMechanismProperties).toBeUndefined();
    // The configuration the session keeps (for restarts) is unchanged.
    expect(AWS_CONFIG.options.authMechanismProperties?.AWS_CREDENTIAL_PROVIDER).toBeTypeOf(
      'function',
    );
  });

  it('the worker side rebuilds a static provider from the posted credentials', async () => {
    const { host, workers } = setup();
    await host.open('aws', AWS_CONFIG, undefined);
    const [open] = (workers[0] as FakeWorker).of('open');
    const cloned = structuredClone(open) as Extract<ToWorker, { type: 'open' }>;
    const options = withAwsCredentials(cloned.options, cloned.awsCredentials);
    expect(options).toMatchObject({ authMechanism: 'MONGODB-AWS', authSource: '$external' });
    const provider = options.authMechanismProperties?.AWS_CREDENTIAL_PROVIDER;
    expect(provider).toBeTypeOf('function');
    await expect(provider?.()).resolves.toEqual({
      accessKeyId: AWS_KEY_ID,
      secretAccessKey: AWS_SECRET,
      sessionToken: AWS_TOKEN,
    });
    // Options without AWS credentials are used as they are.
    expect(withAwsCredentials(CONFIG.options, undefined)).toBe(CONFIG.options);
  });

  it('keeps other auth mechanism properties and calls a non-static provider on each start', async () => {
    let calls = 0;
    const config: ClientConfig = {
      uri: AWS_CONFIG.uri,
      options: {
        authMechanism: 'MONGODB-AWS',
        authMechanismProperties: {
          SERVICE_NAME: 'mongodb',
          AWS_CREDENTIAL_PROVIDER: () => {
            calls++;
            return Promise.resolve({
              accessKeyId: `${AWS_KEY_ID}${calls}`,
              secretAccessKey: AWS_SECRET,
            });
          },
        },
      },
    };
    const { host, workers } = setup();
    await host.open('aws', config, undefined);
    await host.open('aws', config, undefined);
    const opens = workers.map((w) => w.of('open')[0]);
    expect(opens.map((o) => o?.options.authMechanismProperties)).toEqual([
      { SERVICE_NAME: 'mongodb' },
      { SERVICE_NAME: 'mongodb' },
    ]);
    expect(opens.map((o) => o?.awsCredentials?.accessKeyId)).toEqual([
      `${AWS_KEY_ID}1`,
      `${AWS_KEY_ID}2`,
    ]);
    for (const open of opens) expect(() => structuredClone(open)).not.toThrow();
  });

  it('a postMessage that throws on open terminates the worker and rejects', async () => {
    class Unclonable extends FakeWorker {
      override postMessage(message: ToWorker): void {
        if (message.type === 'open') {
          throw new DOMException('function could not be cloned', 'DataCloneError');
        }
        super.postMessage(message);
      }
    }
    const worker = new Unclonable();
    const { host } = setup({ workers: [worker] });
    const error = await rejection(host.open('p1', CONFIG, undefined));
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toContain('could not be cloned');
    expect(worker.terminated).toBe(1);
    expect(host.sessionIds()).toEqual([]);
  });

  it('a failing credential provider terminates the worker and rejects without posting', async () => {
    const config: ClientConfig = {
      uri: AWS_CONFIG.uri,
      options: {
        authMechanism: 'MONGODB-AWS',
        authMechanismProperties: {
          AWS_CREDENTIAL_PROVIDER: () => Promise.reject(new Error('no AWS credentials found')),
        },
      },
    };
    const worker = new FakeWorker();
    const { host } = setup({ workers: [worker] });
    const error = await rejection(host.open('aws', config, undefined));
    expect(error.message).toContain('no AWS credentials found');
    expect(worker.posted).toEqual([]);
    expect(worker.terminated).toBe(1);
    expect(host.sessionIds()).toEqual([]);
  });

  it('masks the AWS secret access key and session token in open errors and logs', async () => {
    const worker = new FakeWorker(false);
    const { host, logs } = setup({ workers: [worker] });
    const opening = host.open('aws', AWS_CONFIG, undefined);
    await vi.waitFor(() => expect(worker.of('open')).toHaveLength(1));
    worker.reply({
      type: 'openFailed',
      error: {
        name: 'MongoServerError',
        message: `Authentication failed: secret ${AWS_SECRET} token ${AWS_TOKEN}`,
        code: 18,
      },
    });
    const error = await rejection(opening);
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.message).not.toContain(AWS_SECRET);
    expect(error.message).not.toContain(AWS_TOKEN);
    expect(error.message).toContain('secret **** token ****');
    expect(logs.join('\n')).not.toContain(AWS_SECRET);
    expect(logs.join('\n')).not.toContain(AWS_TOKEN);
    expect(worker.terminated).toBe(1);
  });

  // Round 6 (test-writer): restart, cancellation and credential-shape cases of CR-2.
  it('a replacement worker (after a crash) gets freshly resolved AWS credentials, clone-safe', async () => {
    let calls = 0;
    const config: ClientConfig = {
      uri: AWS_CONFIG.uri,
      options: {
        authMechanism: 'MONGODB-AWS',
        authMechanismProperties: {
          AWS_CREDENTIAL_PROVIDER: () => {
            calls++;
            return Promise.resolve({
              accessKeyId: `${AWS_KEY_ID}${calls}`,
              secretAccessKey: AWS_SECRET,
              sessionToken: AWS_TOKEN,
            });
          },
        },
      },
    };
    const { host, workers } = setup();
    const { sessionId } = await host.open('aws', config, 'shop');
    (workers[0] as FakeWorker).exit(1);
    const c = collector();
    const next = host.eval(sessionId, '1', c.emit);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    const replacement = workers[1] as FakeWorker;
    const { id } = await lastEval(replacement);
    replacement.reply({ type: 'evalDone', id });
    await expect(next).resolves.toBe(0);
    const [open] = replacement.of('open');
    expect(() => structuredClone(open)).not.toThrow();
    expect(open).toMatchObject({ db: 'shop', awsCredentials: { accessKeyId: `${AWS_KEY_ID}2` } });
    expect(open?.options.authMechanismProperties).toBeUndefined();
    expect(c.outputs).toEqual([{ kind: 'print', text: CRASHED_TEXT }]);
    // The session's own configuration still holds the provider (the next restart calls it again).
    expect(config.options.authMechanismProperties?.AWS_CREDENTIAL_PROVIDER).toBeTypeOf('function');
  });

  it('a restart whose credential provider fails fails the evaluation (secrets masked); the next one retries', async () => {
    let fail = false;
    const config: ClientConfig = {
      uri: AWS_CONFIG.uri,
      options: {
        authMechanism: 'MONGODB-AWS',
        auth: { password: PASSWORD },
        authMechanismProperties: {
          AWS_CREDENTIAL_PROVIDER: () =>
            fail
              ? Promise.reject(new Error(`credentials expired for ${PASSWORD}`))
              : Promise.resolve({ accessKeyId: AWS_KEY_ID, secretAccessKey: AWS_SECRET }),
        },
      },
    };
    const { host, workers, logs } = setup();
    const { sessionId } = await host.open('aws', config, undefined);
    (workers[0] as FakeWorker).exit(1);
    fail = true;
    const error = await rejection(host.eval(sessionId, '1', () => undefined));
    expect(error.message).toContain('credentials expired for ****');
    expect(error.message).not.toContain(PASSWORD);
    expect(logs.join('\n')).not.toContain(PASSWORD);
    // The worker created for the failed restart got nothing and was terminated.
    expect(workers).toHaveLength(2);
    expect((workers[1] as FakeWorker).posted).toEqual([]);
    expect((workers[1] as FakeWorker).terminated).toBe(1);
    expect(host.has(sessionId)).toBe(true);
    fail = false;
    const c = collector();
    const next = host.eval(sessionId, '2', c.emit);
    await vi.waitFor(() => expect(workers).toHaveLength(3));
    const fresh = workers[2] as FakeWorker;
    const { id } = await lastEval(fresh);
    fresh.reply({ type: 'evalDone', id });
    await expect(next).resolves.toBe(0);
    expect(fresh.of('open')[0]?.awsCredentials?.accessKeyId).toBe(AWS_KEY_ID);
  });

  it('an open cancelled while the credential provider is pending answers CANCELLED and posts nothing', async () => {
    let resolveProvider: (value: { accessKeyId: string; secretAccessKey: string }) => void = () =>
      undefined;
    const config: ClientConfig = {
      uri: AWS_CONFIG.uri,
      options: {
        authMechanism: 'MONGODB-AWS',
        authMechanismProperties: {
          AWS_CREDENTIAL_PROVIDER: () =>
            new Promise((resolve) => {
              resolveProvider = resolve;
            }),
        },
      },
    };
    const worker = new FakeWorker();
    const { host } = setup({ workers: [worker] });
    const controller = new AbortController();
    const opening = host.open('aws', config, undefined, controller.signal);
    controller.abort();
    expect((await rejection(opening)).code).toBe('CANCELLED');
    expect(worker.terminated).toBe(1);
    // The provider answering late changes nothing.
    resolveProvider({ accessKeyId: AWS_KEY_ID, secretAccessKey: AWS_SECRET });
    await Promise.resolve();
    expect(worker.posted).toEqual([]);
    expect(host.sessionIds()).toEqual([]);
  });

  it('a worker that exits while the credential provider is pending answers INTERNAL', async () => {
    let resolveProvider: (value: { accessKeyId: string; secretAccessKey: string }) => void = () =>
      undefined;
    const config: ClientConfig = {
      uri: AWS_CONFIG.uri,
      options: {
        authMechanism: 'MONGODB-AWS',
        authMechanismProperties: {
          AWS_CREDENTIAL_PROVIDER: () =>
            new Promise((resolve) => {
              resolveProvider = resolve;
            }),
        },
      },
    };
    const worker = new FakeWorker(false);
    const { host } = setup({ workers: [worker] });
    const opening = host.open('aws', config, undefined);
    worker.exit(3);
    // No unhandled rejection while the provider is still pending.
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveProvider({ accessKeyId: AWS_KEY_ID, secretAccessKey: AWS_SECRET });
    const error = await rejection(opening);
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toContain('exit code 3');
    expect(worker.terminated).toBe(1);
    expect(host.sessionIds()).toEqual([]);
  });

  it('posts only accessKeyId, secretAccessKey, sessionToken and expiration (absent fields left out)', async () => {
    const expiration = new Date('2030-01-01T00:00:00Z');
    const config: ClientConfig = {
      uri: AWS_CONFIG.uri,
      options: {
        authMechanism: 'MONGODB-AWS',
        authMechanismProperties: {
          AWS_CREDENTIAL_PROVIDER: () =>
            Promise.resolve({
              accessKeyId: AWS_KEY_ID,
              secretAccessKey: AWS_SECRET,
              expiration,
              // A provider (e.g. the AWS SDK) may add fields; a function would not clone.
              extra: () => 'not cloneable',
            } as unknown as { accessKeyId: string; secretAccessKey: string }),
        },
      },
    };
    const { host, workers } = setup();
    await host.open('aws', config, undefined);
    const [open] = (workers[0] as FakeWorker).of('open');
    expect(open?.awsCredentials).toEqual({
      accessKeyId: AWS_KEY_ID,
      secretAccessKey: AWS_SECRET,
      expiration,
    });
    expect(open?.awsCredentials).not.toHaveProperty('sessionToken');
    const cloned = structuredClone(open);
    expect(cloned?.awsCredentials?.expiration).toEqual(expiration);
  });
});

describe('withAwsCredentials (worker side)', () => {
  it('adds the provider next to other mechanism properties without changing the input', async () => {
    const options = {
      authMechanism: 'MONGODB-AWS' as const,
      authMechanismProperties: { SERVICE_NAME: 'mongodb' },
    };
    const credentials = { accessKeyId: AWS_KEY_ID, secretAccessKey: AWS_SECRET };
    const out = withAwsCredentials(options, credentials);
    expect(out.authMechanismProperties?.SERVICE_NAME).toBe('mongodb');
    await expect(out.authMechanismProperties?.AWS_CREDENTIAL_PROVIDER?.()).resolves.toBe(
      credentials,
    );
    expect(options.authMechanismProperties).toEqual({ SERVICE_NAME: 'mongodb' });
  });

  it('builds authMechanismProperties when the options have none', async () => {
    const out = withAwsCredentials(
      { authMechanism: 'MONGODB-AWS' },
      { accessKeyId: AWS_KEY_ID, secretAccessKey: AWS_SECRET, sessionToken: AWS_TOKEN },
    );
    await expect(out.authMechanismProperties?.AWS_CREDENTIAL_PROVIDER?.()).resolves.toEqual({
      accessKeyId: AWS_KEY_ID,
      secretAccessKey: AWS_SECRET,
      sessionToken: AWS_TOKEN,
    });
  });
});

describe('ShellHost.eval', () => {
  it('posts the code, emits the outputs and resolves with their number', async () => {
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    const c = collector();
    const running = host.eval(sessionId, 'print("hi"); 1', c.emit);
    const { id, code } = await lastEval(workers[0] as FakeWorker);
    expect(code).toBe('print("hi"); 1');
    const worker = workers[0] as FakeWorker;
    worker.reply({ type: 'output', id, output: { kind: 'print', text: 'hi' } });
    worker.reply({ type: 'output', id, output: { kind: 'result', text: '1', value: '1' } });
    // Outputs of other requests are not this evaluation's.
    worker.reply({ type: 'output', id: id + 1000, output: { kind: 'print', text: 'other' } });
    worker.reply({ type: 'evalDone', id });
    await expect(running).resolves.toBe(2);
    expect(c.outputs).toEqual([
      { kind: 'print', text: 'hi' },
      { kind: 'result', text: '1', value: '1' },
    ]);
  });

  it('answers NOT_FOUND for an unknown session', async () => {
    const { host } = setup();
    const error = await rejection(
      new Promise((resolve) => resolve(host.eval('nope', '1', () => undefined))),
    );
    expect(error.code).toBe('NOT_FOUND');
  });

  it('answers an unknown session with a rejected promise, not a synchronous throw', async () => {
    const { host } = setup();
    let result: Promise<number> | undefined;
    expect(() => (result = host.eval('nope', '1', () => undefined))).not.toThrow();
    expect((await rejection(result as Promise<number>)).code).toBe('NOT_FOUND');
  });

  it('queues evaluations of a session: the next starts after the previous ended', async () => {
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    const worker = workers[0] as FakeWorker;
    const first = host.eval(sessionId, 'first', () => undefined);
    const second = host.eval(sessionId, 'second', () => undefined);
    const { id } = await lastEval(worker);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.of('eval').map((m) => m.code)).toEqual(['first']);
    worker.reply({ type: 'evalDone', id });
    await expect(first).resolves.toBe(0);
    await vi.waitFor(() =>
      expect(worker.of('eval').map((m) => m.code)).toEqual(['first', 'second']),
    );
    worker.reply({ type: 'evalDone', id: (worker.of('eval')[1] as { id: number }).id });
    await expect(second).resolves.toBe(0);
  });

  it('sessions do not wait for each other', async () => {
    const { host, workers } = setup();
    const a = await host.open('p1', CONFIG, undefined);
    const b = await host.open('p1', CONFIG, undefined);
    void host.eval(a.sessionId, 'while (true) {}', () => undefined);
    void host.eval(b.sessionId, '1', () => undefined);
    await lastEval(workers[0] as FakeWorker);
    expect((await lastEval(workers[1] as FakeWorker)).code).toBe('1');
  });

  it('an evaluation cancelled while queued is dropped (never posted) and the queue goes on', async () => {
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    const worker = workers[0] as FakeWorker;
    const first = host.eval(sessionId, 'first', () => undefined);
    const controller = new AbortController();
    const dropped = host.eval(sessionId, 'dropped', () => undefined, controller.signal);
    const third = host.eval(sessionId, 'third', () => undefined);
    const { id } = await lastEval(worker);
    controller.abort();
    worker.reply({ type: 'evalDone', id });
    await first;
    expect((await rejection(dropped)).code).toBe('CANCELLED');
    await vi.waitFor(() =>
      expect(worker.of('eval').map((m) => m.code)).toEqual(['first', 'third']),
    );
    worker.reply({ type: 'evalDone', id: (worker.of('eval')[1] as { id: number }).id });
    await expect(third).resolves.toBe(0);
    expect(worker.of('interrupt')).toEqual([]);
  });

  it('an already aborted signal answers CANCELLED without posting', async () => {
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    const controller = new AbortController();
    controller.abort();
    expect(
      (await rejection(host.eval(sessionId, '1', () => undefined, controller.signal))).code,
    ).toBe('CANCELLED');
    expect(workers[0]?.of('eval')).toEqual([]);
  });

  it('cancel interrupts cooperatively: interrupt message, later outputs dropped, CANCELLED, no restart', async () => {
    vi.useFakeTimers();
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    const worker = workers[0] as FakeWorker;
    const c = collector();
    const controller = new AbortController();
    const running = host.eval(sessionId, 'db.slow.find()', c.emit, controller.signal);
    const { id } = await lastEval(worker);
    worker.reply({ type: 'output', id, output: { kind: 'print', text: 'before' } });
    controller.abort();
    expect(worker.of('interrupt')).toEqual([{ type: 'interrupt' }]);
    worker.reply({
      type: 'output',
      id,
      output: { kind: 'error', text: 'MongoshInterruptedError' },
    });
    worker.reply({ type: 'evalDone', id });
    expect((await rejection(running)).code).toBe('CANCELLED');
    expect(c.outputs).toEqual([{ kind: 'print', text: 'before' }]);
    // The grace period passes: the worker stopped by itself, so it is kept.
    await vi.advanceTimersByTimeAsync(5000);
    expect(worker.terminated).toBe(0);
    const next = collector();
    const after = host.eval(sessionId, 'kept', next.emit);
    const nextEval = await lastEval(worker, 2);
    worker.reply({ type: 'evalDone', id: nextEval.id });
    await expect(after).resolves.toBe(0);
    expect(next.outputs).toEqual([]);
    expect(workers).toHaveLength(1);
  });

  it('an evaluation that does not stop is terminated after interruptGraceMs and restarted on the same db', async () => {
    vi.useFakeTimers();
    const { host, workers, logs } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    const worker = workers[0] as FakeWorker;
    // The evaluation switches the database before it loops.
    const controller = new AbortController();
    const running = host.eval(
      sessionId,
      'use shop\nwhile (true) {}',
      () => undefined,
      controller.signal,
    );
    const failed = rejection(running);
    const { id } = await lastEval(worker);
    worker.reply({ type: 'output', id, output: { kind: 'db', db: 'shop' } });
    controller.abort();
    expect(worker.of('interrupt')).toHaveLength(1);
    // Default grace: 1000 ms. Just before it the worker is kept.
    await vi.advanceTimersByTimeAsync(999);
    expect(worker.terminated).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(worker.terminated).toBe(1);
    expect((await failed).code).toBe('CANCELLED');
    expect(logs).toContain(`shell ${sessionId}: evaluation did not stop, restarting its worker`);

    // The next evaluation starts a fresh worker on the same database and tells the user first.
    const c = collector();
    const next = host.eval(sessionId, 'db.getName()', c.emit);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    const replacement = workers[1] as FakeWorker;
    expect(replacement.of('open')).toEqual([
      { type: 'open', uri: CONFIG.uri, options: CONFIG.options, db: 'shop' },
    ]);
    const { id: nextId } = await lastEval(replacement);
    replacement.reply({ type: 'output', id: nextId, output: { kind: 'result', text: 'shop' } });
    replacement.reply({ type: 'evalDone', id: nextId });
    // The restart notice is emitted but not counted as an output of the evaluation.
    await expect(next).resolves.toBe(1);
    expect(c.outputs).toEqual([
      { kind: 'print', text: RESTARTED_TEXT },
      { kind: 'result', text: 'shop' },
    ]);
    // Only once: the evaluation after that has no notice.
    const quiet = collector();
    const third = host.eval(sessionId, '1', quiet.emit);
    const { id: thirdId } = await lastEval(replacement, 2);
    expect(thirdId).not.toBe(nextId);
    replacement.reply({ type: 'evalDone', id: thirdId });
    await third;
    expect(quiet.outputs).toEqual([]);
    expect(workers).toHaveLength(2);
  });

  it('honours a custom interruptGraceMs', async () => {
    vi.useFakeTimers();
    const { host, workers } = setup({ interruptGraceMs: 50 });
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    const controller = new AbortController();
    const running = rejection(
      host.eval(sessionId, 'while (true) {}', () => undefined, controller.signal),
    );
    await lastEval(workers[0] as FakeWorker);
    controller.abort();
    await vi.advanceTimersByTimeAsync(49);
    expect(workers[0]?.terminated).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(workers[0]?.terminated).toBe(1);
    expect((await running).code).toBe('CANCELLED');
  });

  it('messages of a replaced worker are ignored', async () => {
    vi.useFakeTimers();
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    const old = workers[0] as FakeWorker;
    const controller = new AbortController();
    const running = rejection(
      host.eval(sessionId, 'while (true) {}', () => undefined, controller.signal),
    );
    await lastEval(old);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1000);
    await running;
    const c = collector();
    const next = host.eval(sessionId, '2', c.emit);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    const replacement = workers[1] as FakeWorker;
    const { id } = await lastEval(replacement);
    // A late message of the old worker with the same request id changes nothing.
    old.exited = false;
    old.reply({ type: 'output', id, output: { kind: 'print', text: 'stale' } });
    old.reply({ type: 'evalDone', id });
    replacement.reply({ type: 'evalDone', id });
    await next;
    expect(c.outputs).toEqual([{ kind: 'print', text: RESTARTED_TEXT }]);
  });

  it('a worker that dies during an evaluation ends it with an error; the next one restarts without a second notice', async () => {
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, 'shop');
    const worker = workers[0] as FakeWorker;
    const dying = collector();
    const running = host.eval(sessionId, 'crash()', dying.emit);
    const { id: crashId } = await lastEval(worker);
    worker.reply({ type: 'output', id: crashId, output: { kind: 'print', text: 'before' } });
    worker.exit(1);
    // The evaluation ends (does not wait forever) with the reason as its error output.
    await expect(running).resolves.toBe(2);
    expect(dying.outputs).toEqual([
      { kind: 'print', text: 'before' },
      { kind: 'error', text: CRASHED_TEXT },
    ]);
    const c = collector();
    const next = host.eval(sessionId, '1', c.emit);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    const replacement = workers[1] as FakeWorker;
    expect(replacement.of('open')[0]?.db).toBe('shop');
    const { id } = await lastEval(replacement);
    replacement.reply({ type: 'evalDone', id });
    await next;
    // The user was told by the error already.
    expect(c.outputs).toEqual([]);
  });

  it('a worker that dies while idle: the next evaluation restarts it and shows the notice', async () => {
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    (workers[0] as FakeWorker).exit(1);
    const c = collector();
    const next = host.eval(sessionId, '1', c.emit);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    const replacement = workers[1] as FakeWorker;
    const { id } = await lastEval(replacement);
    replacement.reply({ type: 'evalDone', id });
    await expect(next).resolves.toBe(0);
    expect(c.outputs).toEqual([{ kind: 'print', text: CRASHED_TEXT }]);
  });

  it('an evaluation cancelled while its worker restarts is not run and stops the restart (CANCELLED)', async () => {
    const replacement = new FakeWorker(false);
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    (workers[0] as FakeWorker).exit(1);
    setupQueue(host, replacement);
    const controller = new AbortController();
    const running = host.eval(sessionId, 'db.c.drop()', () => undefined, controller.signal);
    await vi.waitFor(() => expect(replacement.of('open')).toHaveLength(1));
    controller.abort();
    // The abort does not wait for the slow start: the new worker is terminated.
    expect((await rejection(running)).code).toBe('CANCELLED');
    expect(replacement.terminated).toBe(1);
    expect(replacement.of('eval')).toEqual([]);
    // The next input starts another worker and still gets the notice.
    const c = collector();
    const next = host.eval(sessionId, '1', c.emit);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    const fresh = workers[1] as FakeWorker;
    const { id } = await lastEval(fresh);
    fresh.reply({ type: 'evalDone', id });
    await expect(next).resolves.toBe(0);
    expect(c.outputs).toEqual([{ kind: 'print', text: CRASHED_TEXT }]);
  });

  it('a worker that crashes after an interrupt (before the grace ends): CANCELLED, no error output, notice next', async () => {
    vi.useFakeTimers();
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    const worker = workers[0] as FakeWorker;
    const controller = new AbortController();
    const c = collector();
    const running = host.eval(sessionId, 'while (true) {}', c.emit, controller.signal);
    await vi.waitFor(() => expect(worker.of('eval')).toHaveLength(1));
    controller.abort();
    worker.exit(1);
    expect((await rejection(running)).code).toBe('CANCELLED');
    expect(c.outputs).toEqual([]);
    // The grace timer was cleared: nothing more happens to the session.
    await vi.advanceTimersByTimeAsync(5000);
    vi.useRealTimers();
    const next = collector();
    const second = host.eval(sessionId, '1', next.emit);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    const { id } = await lastEval(workers[1] as FakeWorker);
    (workers[1] as FakeWorker).reply({ type: 'evalDone', id });
    await expect(second).resolves.toBe(0);
    expect(next.outputs).toEqual([{ kind: 'print', text: CRASHED_TEXT }]);
  });

  it('the restart notice is shown once: the evaluation after it gets none', async () => {
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    (workers[0] as FakeWorker).exit(1);
    const evalOn = async (expected: ShellOutput[]) => {
      // Counted before the eval is sent: the replacement may get it before `waitFor` returns.
      const before = workers[1]?.of('eval').length ?? 0;
      const c = collector();
      const run = host.eval(sessionId, '1', c.emit);
      await vi.waitFor(() => expect(workers).toHaveLength(2));
      const replacement = workers[1] as FakeWorker;
      const { id } = await lastEval(replacement, before + 1);
      replacement.reply({ type: 'evalDone', id });
      await run;
      expect(c.outputs).toEqual(expected);
    };
    await evalOn([{ kind: 'print', text: CRASHED_TEXT }]);
    await evalOn([]);
  });

  it('a failed restart fails the evaluation; the next evaluation tries again', async () => {
    const failing = new FakeWorker(false);
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    (workers[0] as FakeWorker).exit(1);
    // The replacement cannot connect.
    const restart = setupQueue(host, failing);
    const first = host.eval(sessionId, '1', () => undefined);
    await vi.waitFor(() => expect(failing.of('open')).toHaveLength(1));
    failing.reply({
      type: 'openFailed',
      error: { name: 'MongoNetworkError', message: 'connect ECONNREFUSED', code: 'ECONNREFUSED' },
    });
    expect((await rejection(first)).code).toBe('NETWORK_ERROR');
    expect(failing.terminated).toBe(1);
    restart.done();
    expect(host.has(sessionId)).toBe(true);
    const c = collector();
    const second = host.eval(sessionId, '2', c.emit);
    await vi.waitFor(() => expect(workers.length).toBeGreaterThanOrEqual(2));
    const replacement = workers.at(-1) as FakeWorker;
    const { id } = await lastEval(replacement);
    replacement.reply({ type: 'evalDone', id });
    await second;
    expect(c.outputs[0]).toEqual({
      kind: 'print',
      text: 'The shell stopped unexpectedly: it was restarted.',
    });
  });
});

/**
 * Makes the next worker the host creates `worker` (the host's `createWorker` in `setup` takes
 * from a queue; this test needs a worker that fails after the session was opened).
 */
function setupQueue(host: ShellHost, worker: FakeWorker) {
  const internal = host as unknown as { createWorker: (url: string | URL) => WorkerLike };
  const original = internal.createWorker;
  let used = false;
  internal.createWorker = (url) => {
    if (used) return original(url);
    used = true;
    return worker;
  };
  return { done: () => (internal.createWorker = original) };
}

describe('ShellHost.complete', () => {
  it('asks the worker and answers its completions', async () => {
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    const worker = workers[0] as FakeWorker;
    const answer = host.complete(sessionId, 'db.c.fi');
    await vi.waitFor(() => expect(worker.of('complete')).toHaveLength(1));
    const { id, code } = worker.of('complete')[0] as { id: number; code: string };
    expect(code).toBe('db.c.fi');
    worker.reply({ type: 'completions', id, completions: ['db.c.find', 'db.c.findOne'] });
    await expect(answer).resolves.toEqual(['db.c.find', 'db.c.findOne']);
  });

  it('answers INTERNAL when the completer failed', async () => {
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    const worker = workers[0] as FakeWorker;
    const answer = host.complete(sessionId, 'db.');
    await vi.waitFor(() => expect(worker.of('complete')).toHaveLength(1));
    const { id } = worker.of('complete')[0] as { id: number };
    worker.reply({ type: 'completeFailed', id, error: { name: 'Error', message: 'no topology' } });
    expect(await rejection(answer)).toMatchObject({
      code: 'INTERNAL',
      message: 'Completion failed: no topology',
    });
  });

  it('answers CANCELLED when the worker exits meanwhile; the next completion restarts it', async () => {
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, 'shop');
    const worker = workers[0] as FakeWorker;
    const answer = host.complete(sessionId, 'db.');
    await vi.waitFor(() => expect(worker.of('complete')).toHaveLength(1));
    worker.exit(1);
    expect(await rejection(answer)).toMatchObject({
      code: 'CANCELLED',
      message: 'The shell was restarted',
    });
    // The next completion does not wait for an evaluation: it starts the replacement.
    const again = host.complete(sessionId, 'db.c.fi');
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    const replacement = workers[1] as FakeWorker;
    expect(replacement.of('open')[0]?.db).toBe('shop');
    await vi.waitFor(() => expect(replacement.of('complete')).toHaveLength(1));
    const { id } = replacement.of('complete')[0] as { id: number };
    replacement.reply({ type: 'completions', id, completions: ['db.c.find'] });
    await expect(again).resolves.toEqual(['db.c.find']);
    // The restart notice is not lost: the next evaluation shows it, once.
    const c = collector();
    const next = host.eval(sessionId, '1', c.emit);
    const evalMessage = await lastEval(replacement);
    replacement.reply({ type: 'evalDone', id: evalMessage.id });
    await next;
    expect(c.outputs).toEqual([{ kind: 'print', text: CRASHED_TEXT }]);
    expect(workers).toHaveLength(2);
  });

  it('a completion and an evaluation during a restart share one replacement worker', async () => {
    const replacement = new FakeWorker(false);
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    (workers[0] as FakeWorker).exit(1);
    setupQueue(host, replacement);
    const answer = host.complete(sessionId, 'db.');
    const c = collector();
    const running = host.eval(sessionId, '1', c.emit);
    await vi.waitFor(() => expect(replacement.of('open')).toHaveLength(1));
    replacement.reply({ type: 'opened', db: 'test' });
    await vi.waitFor(() => expect(replacement.of('complete')).toHaveLength(1));
    const { id } = replacement.of('complete')[0] as { id: number };
    replacement.reply({ type: 'completions', id, completions: ['db.c'] });
    await expect(answer).resolves.toEqual(['db.c']);
    const evalMessage = await lastEval(replacement);
    replacement.reply({ type: 'evalDone', id: evalMessage.id });
    await running;
    expect(c.outputs).toEqual([{ kind: 'print', text: CRASHED_TEXT }]);
    // Only the first worker came from the default factory: no second replacement.
    expect(workers).toHaveLength(1);
  });

  it('cancelling a completion that started a restart only stops waiting: the restart finishes and the next eval uses it', async () => {
    const replacement = new FakeWorker(false);
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, 'shop');
    (workers[0] as FakeWorker).exit(1);
    setupQueue(host, replacement);
    const controller = new AbortController();
    const answer = host.complete(sessionId, 'db.', controller.signal);
    await vi.waitFor(() => expect(replacement.of('open')).toHaveLength(1));
    controller.abort();
    expect((await rejection(answer)).code).toBe('CANCELLED');
    // The restart is not tied to the completion's signal.
    expect(replacement.terminated).toBe(0);
    expect(replacement.of('complete')).toEqual([]);
    replacement.reply({ type: 'opened', db: 'shop' });
    const c = collector();
    const next = host.eval(sessionId, 'db.getName()', c.emit);
    const { id } = await lastEval(replacement);
    replacement.reply({ type: 'evalDone', id });
    // The notice is emitted but not counted as an output of the evaluation.
    await expect(next).resolves.toBe(0);
    expect(c.outputs).toEqual([{ kind: 'print', text: CRASHED_TEXT }]);
    // No further worker was started.
    expect(workers).toHaveLength(1);
  });

  it('an evaluation cancelled while waiting for a restart started by a completion is CANCELLED; the restart goes on', async () => {
    const replacement = new FakeWorker(false);
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    (workers[0] as FakeWorker).exit(1);
    setupQueue(host, replacement);
    const answer = host.complete(sessionId, 'db.');
    await vi.waitFor(() => expect(replacement.of('open')).toHaveLength(1));
    const controller = new AbortController();
    const running = host.eval(sessionId, 'db.c.drop()', () => undefined, controller.signal);
    controller.abort();
    expect((await rejection(running)).code).toBe('CANCELLED');
    expect(replacement.terminated).toBe(0);
    replacement.reply({ type: 'opened', db: 'test' });
    await vi.waitFor(() => expect(replacement.of('complete')).toHaveLength(1));
    const { id } = replacement.of('complete')[0] as { id: number };
    replacement.reply({ type: 'completions', id, completions: ['db.c'] });
    await expect(answer).resolves.toEqual(['db.c']);
    // The cancelled code never ran.
    expect(replacement.of('eval')).toEqual([]);
    expect(workers).toHaveLength(1);
  });

  it("a completion waiting for an evaluation's restart that gets cancelled fails; the next completion starts a fresh worker", async () => {
    const replacement = new FakeWorker(false);
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    (workers[0] as FakeWorker).exit(1);
    setupQueue(host, replacement);
    const controller = new AbortController();
    const running = host.eval(sessionId, '1', () => undefined, controller.signal);
    await vi.waitFor(() => expect(replacement.of('open')).toHaveLength(1));
    const answer = host.complete(sessionId, 'db.');
    controller.abort();
    expect((await rejection(running)).code).toBe('CANCELLED');
    expect((await rejection(answer)).code).toBe('CANCELLED');
    expect(replacement.terminated).toBe(1);
    // The session is not stuck: the next completion restarts it.
    const again = host.complete(sessionId, 'db.c.fi');
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    const fresh = workers[1] as FakeWorker;
    await vi.waitFor(() => expect(fresh.of('complete')).toHaveLength(1));
    const { id } = fresh.of('complete')[0] as { id: number };
    fresh.reply({ type: 'completions', id, completions: ['db.c.find'] });
    await expect(again).resolves.toEqual(['db.c.find']);
  });

  it('a completion whose restart fails answers the open error; the next evaluation tries again with the notice', async () => {
    const failing = new FakeWorker(false);
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    (workers[0] as FakeWorker).exit(1);
    const restart = setupQueue(host, failing);
    const answer = host.complete(sessionId, 'db.');
    await vi.waitFor(() => expect(failing.of('open')).toHaveLength(1));
    failing.reply({
      type: 'openFailed',
      error: { name: 'MongoNetworkError', message: 'connect ECONNREFUSED', code: 'ECONNREFUSED' },
    });
    expect((await rejection(answer)).code).toBe('NETWORK_ERROR');
    expect(failing.terminated).toBe(1);
    restart.done();
    const c = collector();
    const next = host.eval(sessionId, '1', c.emit);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    const { id } = await lastEval(workers[1] as FakeWorker);
    (workers[1] as FakeWorker).reply({ type: 'evalDone', id });
    await expect(next).resolves.toBe(0);
    expect(c.outputs).toEqual([{ kind: 'print', text: CRASHED_TEXT }]);
  });

  it('a completion restarting a session that gets closed answers NOT_FOUND and terminates the replacement', async () => {
    const replacement = new FakeWorker(false);
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    (workers[0] as FakeWorker).exit(1);
    setupQueue(host, replacement);
    const answer = host.complete(sessionId, 'db.');
    await vi.waitFor(() => expect(replacement.of('open')).toHaveLength(1));
    await host.close(sessionId);
    replacement.reply({ type: 'opened', db: 'test' });
    expect((await rejection(answer)).code).toBe('NOT_FOUND');
    expect(replacement.terminated).toBe(1);
    expect(replacement.of('complete')).toEqual([]);
    expect(host.has(sessionId)).toBe(false);
  });

  it('answers CANCELLED when the request is cancelled', async () => {
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    const controller = new AbortController();
    const answer = host.complete(sessionId, 'db.', controller.signal);
    await vi.waitFor(() => expect(workers[0]?.of('complete')).toHaveLength(1));
    controller.abort();
    expect((await rejection(answer)).code).toBe('CANCELLED');
  });

  it('answers NOT_FOUND for an unknown session', async () => {
    const { host } = setup();
    expect((await rejection(host.complete('nope', 'db.'))).code).toBe('NOT_FOUND');
  });
});

describe('ShellHost.close / closeProfile / closeAll', () => {
  it('closes the client in the worker, then terminates it; the id is gone', async () => {
    const { host, workers, logs } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    await host.close(sessionId);
    const worker = workers[0] as FakeWorker;
    expect(worker.of('close')).toEqual([{ type: 'close' }]);
    expect(worker.terminated).toBeGreaterThanOrEqual(1);
    expect(host.has(sessionId)).toBe(false);
    expect(logs).toContain(`shell ${sessionId} closed`);
    expect((await rejection(host.close(sessionId))).code).toBe('NOT_FOUND');
    expect(
      (await rejection(new Promise((r) => r(host.eval(sessionId, '1', () => undefined))))).code,
    ).toBe('NOT_FOUND');
  });

  it('closing the same session twice at once closes it once', async () => {
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    await Promise.all([host.close(sessionId), host.closeAll(), host.closeProfile('p1')]);
    expect(workers[0]?.of('close')).toHaveLength(1);
    expect(host.sessionIds()).toEqual([]);
  });

  it('logs worker errors of an open session (and keeps it)', async () => {
    const { host, workers, logs } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    (workers[0] as FakeWorker).fail(new Error('fictitious worker failure'));
    expect(logs).toContain(`shell ${sessionId}: worker error fictitious worker failure`);
    expect(host.has(sessionId)).toBe(true);
  });

  it('terminates a worker that does not answer close within closeGraceMs', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    worker.postMessage = function (message: ToWorker) {
      this.posted.push(message);
      if (message.type === 'open') queueMicrotask(() => this.reply({ type: 'opened', db: 'test' }));
      // `close` is never answered (the worker is busy in a loop).
    };
    const { host } = setup({ workers: [worker], closeGraceMs: 300 });
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    let closed = false;
    const closing = host.close(sessionId).then(() => (closed = true));
    await vi.advanceTimersByTimeAsync(299);
    expect(closed).toBe(false);
    expect(worker.terminated).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(worker.terminated).toBeGreaterThanOrEqual(1);
  });

  it('a running evaluation ends when its session is closed', async () => {
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    const running = host.eval(sessionId, 'db.slow.find()', () => undefined);
    await lastEval(workers[0] as FakeWorker);
    await host.close(sessionId);
    // It settles (does not hang) once the worker is gone.
    await running.catch(() => undefined);
  });

  it('a queued evaluation of a closed session fails and leaves no worker running', async () => {
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    const first = host.eval(sessionId, 'first', () => undefined);
    const queued = host.eval(sessionId, 'queued', () => undefined);
    await lastEval(workers[0] as FakeWorker);
    await host.close(sessionId);
    await first.catch(() => undefined);
    expect((await rejection(queued)).code).toBe('NOT_FOUND');
    for (const worker of workers) expect(worker.terminated).toBeGreaterThanOrEqual(1);
    expect(workers.flatMap((w) => w.of('eval')).map((m) => m.code)).toEqual(['first']);
    // No replacement worker was started (and connected) for the queued evaluation.
    expect(workers).toHaveLength(1);
  });

  it('a running evaluation of a closed session ends with an error output', async () => {
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    const c = collector();
    const running = host.eval(sessionId, 'db.slow.find()', c.emit);
    await lastEval(workers[0] as FakeWorker);
    await host.close(sessionId);
    await expect(running).resolves.toBe(1);
    expect(c.outputs).toEqual([{ kind: 'error', text: 'The shell session was closed' }]);
  });

  it('a worker that exits while closing (instead of answering close) ends the running evaluation with the close reason', async () => {
    const worker = new FakeWorker();
    worker.postMessage = function (message: ToWorker) {
      this.posted.push(message);
      if (message.type === 'open') queueMicrotask(() => this.reply({ type: 'opened', db: 'test' }));
      // The worker goes away on `close` without a `closed` answer.
      if (message.type === 'close') queueMicrotask(() => this.exit(0));
    };
    const { host } = setup({ workers: [worker] });
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    const c = collector();
    const running = host.eval(sessionId, 'db.slow.find()', c.emit);
    await lastEval(worker);
    await host.close(sessionId);
    await expect(running).resolves.toBe(1);
    // Not the crash text: the session was being closed when its worker exited.
    expect(c.outputs).toEqual([{ kind: 'error', text: 'The shell session was closed' }]);
    expect(host.has(sessionId)).toBe(false);
  });

  it('closing a session while its worker restarts terminates the replacement (NOT_FOUND)', async () => {
    const replacement = new FakeWorker(false);
    const { host, workers } = setup();
    const { sessionId } = await host.open('p1', CONFIG, undefined);
    (workers[0] as FakeWorker).exit(1);
    setupQueue(host, replacement);
    const next = host.eval(sessionId, '1', () => undefined);
    await vi.waitFor(() => expect(replacement.of('open')).toHaveLength(1));
    // A dead session is closed without a close message to its (gone) worker.
    await host.close(sessionId);
    expect(workers[0]?.of('close')).toEqual([]);
    replacement.reply({ type: 'opened', db: 'test' });
    expect((await rejection(next)).code).toBe('NOT_FOUND');
    expect(replacement.terminated).toBe(1);
    expect(replacement.of('eval')).toEqual([]);
  });

  it('closeProfile closes only the sessions of that profile', async () => {
    const { host, workers } = setup();
    const a = await host.open('p1', CONFIG, undefined);
    const b = await host.open('p1', CONFIG, 'shop');
    const other = await host.open('p2', CONFIG, undefined);
    await host.closeProfile('p1');
    expect(host.sessionIds()).toEqual([other.sessionId]);
    expect(host.has(a.sessionId)).toBe(false);
    expect(host.has(b.sessionId)).toBe(false);
    expect(workers[0]?.of('close')).toHaveLength(1);
    expect(workers[1]?.of('close')).toHaveLength(1);
    expect(workers[2]?.of('close')).toEqual([]);
    expect(workers[2]?.terminated).toBe(0);
    // A profile without sessions: nothing happens.
    await expect(host.closeProfile('p3')).resolves.toBeUndefined();
  });

  it('closeAll closes every session', async () => {
    const { host, workers } = setup();
    await host.open('p1', CONFIG, undefined);
    await host.open('p2', CONFIG, undefined);
    await host.closeAll();
    expect(host.sessionIds()).toEqual([]);
    for (const worker of workers) expect(worker.of('close')).toHaveLength(1);
  });
});
