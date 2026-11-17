import { randomBytes } from 'node:crypto';

import { BSON, type Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  ConnectionManager,
  RESTARTED_TEXT,
  RpcClient,
  RpcError,
  ShellHost,
  serve,
  shellHandlers,
} from '@thicket/backend';
import {
  methods,
  type ErrorInfo,
  type Event,
  type MethodName,
  type ParamsOf,
  type Profile,
  type ResultOf,
  type ShellOutput,
} from '@thicket/contract';

import { portPair } from '../../packages/backend/src/server/testing';

// shell.open/eval/complete/close (task shell-backend) against the 8.x standalone fixture, served
// like startBackend serves them. The shell workers run worker.ts from source.

const mongo = inject('mongo').mongo8;
const WORKER = new URL('../../packages/backend/src/shell/worker.ts', import.meta.url);
const run = randomBytes(3).toString('hex');
const DB = `shell_${run}`;

const PROFILE: Profile = {
  id: 'p',
  name: 'Shell',
  readOnly: false,
  production: false,
  connectionString: mongo.uri,
  serverSelectionTimeoutMS: 10_000,
};

interface Outcome {
  outputs: ShellOutput[];
  end?: { delivered: number };
  error?: ErrorInfo;
}

function backendFor() {
  const manager = new ConnectionManager({
    loadProfile: (id) =>
      id === PROFILE.id ? Promise.resolve(PROFILE) : Promise.reject(new RpcError('NOT_FOUND', id)),
    loadSecrets: () => Promise.resolve(null),
  });
  const host = new ShellHost({ workerUrl: WORKER });
  const [serverPort, clientPort] = portPair();
  const stop = serve(serverPort, {
    table: methods,
    route: 'backend',
    handlers: shellHandlers(manager, host),
  });
  const client = new RpcClient(clientPort);
  const events = new Map<string, Event[]>();
  const waiters = new Map<string, () => void>();
  clientPort.onMessage((message) => {
    const event = message as Partial<Event>;
    if (typeof event.stream !== 'string' || event.kind === undefined) return;
    const list = events.get(event.stream) ?? [];
    list.push(event as Event);
    events.set(event.stream, list);
    waiters.get(event.stream)?.();
  });
  const call = <M extends MethodName>(method: M, params: ParamsOf<M>) =>
    client.call(method, params) as Promise<ResultOf<M>>;
  const outputsOf = (streamId: string) =>
    (events.get(streamId) ?? [])
      .filter((e) => e.kind === 'data')
      .map((e) => e.payload as ShellOutput);
  const finished = (streamId: string): Promise<Outcome> =>
    new Promise((resolve) => {
      const done = () => {
        const last = events.get(streamId)?.at(-1);
        if (last === undefined || last.kind === 'data') return;
        resolve({
          outputs: outputsOf(streamId),
          ...(last.kind === 'end' ? { end: last.payload as { delivered: number } } : {}),
          ...(last.kind === 'error' ? { error: last.payload as ErrorInfo } : {}),
        });
      };
      waiters.set(streamId, done);
      done();
    });
  /** Waits until the stream has sent at least one data event. */
  const firstOutput = (streamId: string): Promise<void> =>
    new Promise((resolve) => {
      const check = () => {
        if (outputsOf(streamId).length > 0) resolve();
      };
      waiters.set(streamId, check);
      check();
    });
  const evaluate = async (sessionId: string, code: string) => {
    const { streamId } = await call('shell.eval', { sessionId, code });
    return finished(streamId);
  };
  const close = async () => {
    await host.closeAll();
    client.close();
    stop();
    await manager.closeAll();
  };
  return { manager, host, call, evaluate, finished, firstOutput, clientPort, close };
}

let backend: ReturnType<typeof backendFor>;

async function failure(promise: Promise<unknown>): Promise<ErrorInfo> {
  try {
    await promise;
  } catch (error) {
    return error as ErrorInfo;
  }
  throw new Error('expected the call to fail');
}

const ejson = (text: string | undefined) =>
  BSON.EJSON.parse(text ?? 'null', { relaxed: false }) as unknown;

const results = (outcome: Outcome) =>
  outcome.outputs.filter((o): o is Extract<ShellOutput, { kind: 'result' }> => o.kind === 'result');

beforeAll(async () => {
  backend = backendFor();
  await backend.manager.open(PROFILE.id, undefined);
});

afterAll(async () => {
  if (!backend) return;
  const { sessionId } = await backend.call('shell.open', { profileId: PROFILE.id });
  await backend.evaluate(sessionId, `use ${DB}\ndb.dropDatabase()`);
  await backend.close();
});

describe('shell.open', () => {
  it('needs an open connection', async () => {
    const error = await failure(backend.call('shell.open', { profileId: 'other' }));
    expect(error.code).toBe('NOT_CONNECTED');
  });

  it('starts in the requested database', async () => {
    const opened = await backend.call('shell.open', { profileId: PROFILE.id, db: DB });
    expect(opened.db).toBe(DB);
    const outcome = await backend.evaluate(opened.sessionId, 'db.getName()');
    expect(results(outcome)[0]?.text).toBe(DB);
    await backend.call('shell.close', { sessionId: opened.sessionId });
  });
});

describe('shell.eval', () => {
  let sessionId: string;
  beforeAll(async () => {
    ({ sessionId } = await backend.call('shell.open', { profileId: PROFILE.id }));
  });

  it('use test; db.c.insertOne({a:1}); db.c.find() returns the document as EJSON', async () => {
    const outcome = await backend.evaluate(
      sessionId,
      `use ${DB}; db.c.insertOne({a:1}); db.c.find()`,
    );
    expect(outcome.error).toBeUndefined();
    expect(outcome.outputs).toContainEqual({ kind: 'db', db: DB });
    const last = results(outcome).at(-1);
    expect(last?.type).toBe('Cursor');
    const docs = ejson(last?.value) as Document[];
    expect(docs).toHaveLength(1);
    expect(docs[0]?.['a']).toEqual(new BSON.Int32(1));
    expect(docs[0]?.['_id']).toBeInstanceOf(BSON.ObjectId);
    // Canonical EJSON: the number keeps its type.
    expect(last?.value).toContain('{"$numberInt":"1"}');
    expect(last?.text).toContain('a: 1');
    expect(outcome.end?.delivered).toBe(outcome.outputs.length);
  });

  it('keeps variables and the database between inputs', async () => {
    await backend.evaluate(sessionId, 'const answer = 42; function twice(x) {\n  return 2 * x;\n}');
    const outcome = await backend.evaluate(sessionId, 'twice(answer)');
    expect(results(outcome)[0]).toMatchObject({ text: '84', value: '{"$numberInt":"84"}' });
    const db = await backend.evaluate(sessionId, 'db.getName()');
    expect(results(db)[0]?.text).toBe(DB);
  });

  it('streams print output and reports errors', async () => {
    const printed = await backend.evaluate(sessionId, 'print("hello", 1); printjson({a: 1}); 5');
    expect(printed.outputs.slice(0, 2)).toEqual([
      { kind: 'print', text: 'hello 1' },
      { kind: 'print', text: '{ a: 1 }' },
    ]);
    const thrown = await backend.evaluate(sessionId, 'throw new Error("boom")');
    expect(thrown.outputs).toEqual([{ kind: 'error', text: 'Error: boom' }]);
    const dup = await backend.evaluate(
      sessionId,
      'db.d.insertOne({_id: 1}); db.d.insertOne({_id: 1})',
    );
    expect(dup.outputs.at(-1)?.kind).toBe('error');
    expect((dup.outputs.at(-1) as { text: string }).text).toContain('E11000');
  });

  it('runs the lines after a shell command that has a trailing comment', async () => {
    const outcome = await backend.evaluate(sessionId, `use ${DB} // switch first\ndb.getName()`);
    expect(outcome.error).toBeUndefined();
    expect(results(outcome).at(-1)?.text).toBe(DB);
  });

  it('answers NOT_FOUND for an unknown session', async () => {
    const error = await failure(backend.call('shell.eval', { sessionId: 'nope', code: '1' }));
    expect(error.code).toBe('NOT_FOUND');
  });
});

describe('interrupt', () => {
  it('stops while(true){} within 2 s and the session goes on', async () => {
    const { sessionId } = await backend.call('shell.open', { profileId: PROFILE.id, db: DB });
    const { streamId } = await backend.call('shell.eval', {
      sessionId,
      code: 'print("looping"); while (true) {}',
    });
    await backend.firstOutput(streamId);
    const started = Date.now();
    backend.clientPort.send({ cancel: streamId });
    const outcome = await backend.finished(streamId);
    const next = await backend.evaluate(sessionId, 'db.getName()');
    const elapsed = Date.now() - started;
    expect(outcome.error?.code).toBe('CANCELLED');
    expect(elapsed).toBeLessThan(2000);
    // A fresh runtime on the same database, and the user is told.
    expect(next.outputs[0]).toEqual({ kind: 'print', text: RESTARTED_TEXT });
    expect(results(next)[0]?.text).toBe(DB);
    await backend.call('shell.close', { sessionId });
  });

  it('interrupts a running server operation cooperatively and keeps the variables', async () => {
    const { sessionId } = await backend.call('shell.open', { profileId: PROFILE.id, db: DB });
    await backend.evaluate(sessionId, 'var kept = "yes"; db.slow.insertOne({x: 1})');
    const { streamId } = await backend.call('shell.eval', {
      sessionId,
      code: 'print("go"); db.slow.find({ $where: "sleep(10000) || true" }).toArray()',
    });
    await backend.firstOutput(streamId);
    const started = Date.now();
    backend.clientPort.send({ cancel: streamId });
    const outcome = await backend.finished(streamId);
    const next = await backend.evaluate(sessionId, 'kept');
    expect(outcome.error?.code).toBe('CANCELLED');
    expect(Date.now() - started).toBeLessThan(2000);
    expect(next.outputs).toEqual([{ kind: 'result', text: 'yes', value: '"yes"' }]);
    await backend.call('shell.close', { sessionId });
  });
});

describe('shell.complete', () => {
  it("complete('db.c.fi') suggests find and findOne", async () => {
    const { sessionId } = await backend.call('shell.open', { profileId: PROFILE.id, db: DB });
    const code = 'db.c.fi';
    const { completions } = await backend.call('shell.complete', {
      sessionId,
      code,
      cursor: code.length,
    });
    expect(completions).toContain('db.c.find');
    expect(completions).toContain('db.c.findOne');
    await backend.call('shell.close', { sessionId });
  });
});

describe('shell.close', () => {
  it('ends the session', async () => {
    const { sessionId } = await backend.call('shell.open', { profileId: PROFILE.id });
    await backend.call('shell.close', { sessionId });
    expect(backend.host.has(sessionId)).toBe(false);
    const error = await failure(backend.call('shell.close', { sessionId }));
    expect(error.code).toBe('NOT_FOUND');
  });

  it('closeProfile (conn.close) ends every session of the profile', async () => {
    const one = await backend.call('shell.open', { profileId: PROFILE.id });
    const two = await backend.call('shell.open', { profileId: PROFILE.id, db: DB });
    await backend.host.closeProfile(PROFILE.id);
    expect(backend.host.has(one.sessionId)).toBe(false);
    expect(backend.host.has(two.sessionId)).toBe(false);
    const error = await failure(
      backend.call('shell.eval', { sessionId: two.sessionId, code: '1' }),
    );
    expect(error.code).toBe('NOT_FOUND');
  });
});
