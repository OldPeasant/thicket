import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import {
  BSON,
  Binary,
  Decimal128,
  Double,
  Int32,
  Long,
  MaxKey,
  MinKey,
  MongoClient,
  ObjectId,
  Timestamp,
  type Document,
} from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  ConnectionManager,
  RpcClient,
  RpcError,
  guardWrites,
  ioHandlers,
  serve,
  type FileDialogs,
} from '@thicket/backend';
import {
  methods,
  type ErrorInfo,
  type Event,
  type IoProgress,
  type MethodName,
  type ParamsOf,
  type Profile,
  type ResultOf,
} from '@thicket/contract';

import { portPair } from '../../packages/backend/src/server/testing';

// io.export / io.previewImport / io.import for JSON and JSON Lines (task io-basic-backend)
// against the 8.x standalone fixture, served like startBackend serves them (contract validation,
// streams, write guard). The native dialogs are replaced by a queue of temp file paths.

const mongo = inject('mongo').mongo8;
const run = randomBytes(3).toString('hex');
const DB = `io_${run}`;
const N = 10_000;
const BIG = 200_000;

const PROFILE: Profile = {
  id: 'io',
  name: 'IO',
  connectionString: mongo.uri,
  readOnly: false,
  production: false,
  serverSelectionTimeoutMS: 10_000,
};
const READ_ONLY: Profile = { ...PROFILE, id: 'io-ro', readOnly: true };

interface StreamOutcome {
  progress: IoProgress[];
  end?: { delivered: number };
  error?: ErrorInfo;
}

let dir: string;
const chosen: (string | null)[] = [];
const dialogs: FileDialogs = {
  saveFile: () => Promise.resolve(chosen.shift() ?? null),
  openFile: () => Promise.resolve(chosen.shift() ?? null),
};

function profileOf(id: string): Profile {
  if (id === PROFILE.id) return PROFILE;
  if (id === READ_ONLY.id) return READ_ONLY;
  throw new RpcError('NOT_FOUND', `No profile ${id}`);
}

function backendFor() {
  const manager = new ConnectionManager({
    loadProfile: (id) => Promise.resolve(profileOf(id)),
    loadSecrets: () => Promise.resolve(null),
  });
  const [serverPort, clientPort] = portPair();
  const stop = serve(serverPort, {
    table: methods,
    route: 'backend',
    handlers: guardWrites(ioHandlers(manager, dialogs), profileOf),
  });
  const client = new RpcClient(clientPort);
  const events = new Map<string, Event[]>();
  const listeners = new Map<string, (event: Event) => void>();
  clientPort.onMessage((message) => {
    const event = message as Partial<Event>;
    if (typeof event.stream !== 'string' || event.kind === undefined) return;
    const list = events.get(event.stream) ?? [];
    list.push(event as Event);
    events.set(event.stream, list);
    listeners.get(event.stream)?.(event as Event);
  });
  const call = <M extends MethodName>(method: M, params: ParamsOf<M>) =>
    client.call(method, params) as Promise<ResultOf<M>>;
  /** Waits for the stream's `end` or `error`; `onData` sees every progress payload as it comes. */
  const finished = (
    streamId: string,
    onData?: (progress: IoProgress) => void,
  ): Promise<StreamOutcome> =>
    new Promise((resolve) => {
      const outcome = () => {
        const list = events.get(streamId) ?? [];
        const last = list.at(-1);
        if (last === undefined || last.kind === 'data') return undefined;
        return {
          progress: list.filter((e) => e.kind === 'data').map((e) => e.payload as IoProgress),
          ...(last.kind === 'end' ? { end: last.payload as { delivered: number } } : {}),
          ...(last.kind === 'error' ? { error: last.payload as ErrorInfo } : {}),
        };
      };
      for (const e of events.get(streamId) ?? []) {
        if (e.kind === 'data') onData?.(e.payload as IoProgress);
      }
      const done = outcome();
      if (done) {
        resolve(done);
        return;
      }
      listeners.set(streamId, (event) => {
        if (event.kind === 'data') onData?.(event.payload as IoProgress);
        const result = outcome();
        if (result) resolve(result);
      });
    });
  const close = async () => {
    client.close();
    stop();
    await manager.closeAll();
  };
  return { manager, call, finished, close };
}

let backend: ReturnType<typeof backendFor>;
let direct: MongoClient;

const coll = (name: string) => direct.db(DB).collection<Document>(name);
const raw = { promoteValues: false, promoteLongs: false, promoteBuffers: false } as const;

/** Every document of a collection by `_id`, as canonical EJSON text (exact types). */
async function canonicalDocs(name: string): Promise<string[]> {
  const docs = await coll(name).find({}, raw).sort({ _id: 1 }).toArray();
  return docs.map((d) => BSON.EJSON.stringify(d, { relaxed: false }));
}

/** A document with most BSON types, varied per index. */
function richDocument(i: number): Document {
  return {
    _id: new ObjectId(),
    i: new Int32(i),
    long: Long.fromString(`${String(i)}000000000000`),
    double: new Double(i + 0.5),
    integralDouble: new Double(i),
    decimal: Decimal128.fromString(`${String(i)}.10`),
    date: new Date(Date.UTC(2020, 0, 1) + i * 1000),
    text: `doc ${String(i)} – ünïcode "quoted" \\ back\nslash`,
    bool: i % 2 === 0,
    nil: null,
    bin: new Binary(Buffer.from([i & 255, 1, 2, 3])),
    uuid: new Binary(Buffer.from(randomBytes(16)), Binary.SUBTYPE_UUID),
    regex: new BSON.BSONRegExp(`^a${String(i)}`, 'i'),
    ts: new Timestamp({ t: 1_700_000_000 + i, i: 1 }),
    min: new MinKey(),
    max: new MaxKey(),
    nested: { arr: [new Int32(1), 'two', { three: new Double(3) }], empty: {}, list: [] },
  };
}

async function exportTo(
  file: string,
  params: Partial<ParamsOf<'io.export'>> & Pick<ParamsOf<'io.export'>, 'coll' | 'format'>,
  onData?: (progress: IoProgress) => void,
) {
  chosen.push(file);
  const result = await backend.call('io.export', {
    profileId: PROFILE.id,
    db: DB,
    source: { kind: 'find', filter: '{}', sort: '{"_id":1}' },
    ...params,
  });
  expect(result.path).toBe(file);
  expect(result.streamId).not.toBeNull();
  return backend.finished(result.streamId ?? '', onData);
}

async function importFrom(
  file: string,
  format: 'json' | 'jsonl',
  target: string,
  options: { ordered?: boolean; stopOnError?: boolean; profileId?: string } = {},
) {
  chosen.push(file);
  const preview = await backend.call('io.previewImport', { format });
  if (!preview) throw new Error('preview cancelled');
  const { streamId } = await backend.call('io.import', {
    profileId: options.profileId ?? PROFILE.id,
    db: DB,
    coll: target,
    fileToken: preview.fileToken,
    ...(options.ordered !== undefined ? { ordered: options.ordered } : {}),
    ...(options.stopOnError !== undefined ? { stopOnError: options.stopOnError } : {}),
  });
  return { preview, outcome: await backend.finished(streamId) };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'thicket-io-'));
  direct = new MongoClient(mongo.uri, { serverSelectionTimeoutMS: 10_000 });
  await direct.connect();
  const docs = Array.from({ length: N }, (_, i) => richDocument(i));
  await coll('rich').insertMany(docs);
  backend = backendFor();
  await backend.manager.open(PROFILE.id, undefined);
  await backend.manager.open(READ_ONLY.id, undefined);
});

afterAll(async () => {
  await backend.close();
  await direct.db(DB).dropDatabase();
  await direct.close();
  await rm(dir, { recursive: true, force: true });
});

describe('io.export → io.import round trip', () => {
  it.each(['jsonl', 'json'] as const)(
    'exports 10 000 documents as %s (canonical) and imports them unchanged',
    async (format) => {
      const file = path.join(dir, `rich.${format}`);
      const exported = await exportTo(file, { coll: 'rich', format, ejsonMode: 'canonical' });
      expect(exported.error).toBeUndefined();
      expect(exported.end?.delivered).toBe(N);
      expect(exported.progress.at(-1)).toEqual({ processed: N, failed: 0, errors: [] });
      const text = await readFile(file, 'utf8');
      if (format === 'json') expect(Array.isArray(JSON.parse(text))).toBe(true);
      else expect(text.trimEnd().split('\n')).toHaveLength(N);

      const target = `rich_copy_${format}`;
      const { preview, outcome } = await importFrom(file, format, target);
      expect(preview.fileName).toBe(`rich.${format}`);
      expect(preview.sizeBytes).toBe((await stat(file)).size);
      expect(preview.sample).toHaveLength(20);
      expect(outcome.error).toBeUndefined();
      expect(outcome.end?.delivered).toBe(N);
      expect(outcome.progress.at(-1)).toEqual({ processed: N, failed: 0, errors: [] });

      const [original, copy] = await Promise.all([canonicalDocs('rich'), canonicalDocs(target)]);
      expect(copy).toHaveLength(N);
      expect(copy).toEqual(original);
    },
  );

  it('relaxed export writes plain JSON numbers and dates', async () => {
    const file = path.join(dir, 'relaxed.jsonl');
    const exported = await exportTo(file, {
      coll: 'rich',
      format: 'jsonl',
      ejsonMode: 'relaxed',
      source: { kind: 'find', filter: '{"i":{"$numberInt":"7"}}', projection: '{"i":1,"date":1}' },
    });
    expect(exported.end?.delivered).toBe(1);
    const line = JSON.parse((await readFile(file, 'utf8')).trim()) as Record<string, unknown>;
    expect(line['i']).toBe(7);
    expect(line['date']).toEqual({ $date: '2020-01-01T00:00:07Z' });
    expect(Object.keys(line).sort()).toEqual(['_id', 'date', 'i']);
  });

  it('exports an aggregation', async () => {
    const file = path.join(dir, 'agg.json');
    const exported = await exportTo(file, {
      coll: 'rich',
      format: 'json',
      source: {
        kind: 'aggregate',
        pipeline: '[{"$match":{"bool":true}},{"$count":"n"}]',
      },
    });
    expect(exported.end?.delivered).toBe(1);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([{ n: N / 2 }]);
  });

  it('a cancelled save dialog answers streamId null', async () => {
    chosen.push(null);
    const result = await backend.call('io.export', {
      profileId: PROFILE.id,
      db: DB,
      coll: 'rich',
      format: 'jsonl',
      source: { kind: 'find', filter: '{}' },
    });
    expect(result).toEqual({ streamId: null, path: null });
  });
});

describe('io.import errors', () => {
  const lines = [
    '{"_id": 1, "a": 1}',
    '{"_id": 2, "a": }',
    '',
    '{"_id": 3, "a": {"$numberLong": "3"}}',
    '[1, 2]',
    '{"_id": 1, "a": "duplicate"}',
    '{"_id": 4}',
  ];

  it('continue mode reports the bad lines and imports the rest (JSON Lines)', async () => {
    const file = path.join(dir, 'bad.jsonl');
    await writeFile(file, lines.join('\n'));
    const { outcome } = await importFrom(file, 'jsonl', 'bad_continue', { stopOnError: false });
    expect(outcome.error).toBeUndefined();
    expect(outcome.end?.delivered).toBe(3);
    const last = outcome.progress.at(-1);
    expect(last?.processed).toBe(6);
    expect(last?.failed).toBe(3);
    expect(last?.errors.map((e) => e.index)).toEqual([2, 5, 6]);
    expect(last?.errors.map((e) => e.error.code)).toEqual([
      'INVALID_PARAMS',
      'INVALID_PARAMS',
      'SERVER_ERROR',
    ]);
    expect(last?.errors[0]?.error.message).toMatch(/^Line 2: /);
    expect(last?.errors[2]?.error.message).toMatch(/duplicate key/);
    const ids = (await coll('bad_continue').find({}, raw).sort({ _id: 1 }).toArray()).map((d) =>
      BSON.EJSON.stringify(d, { relaxed: false }),
    );
    expect(ids).toEqual([
      '{"_id":{"$numberInt":"1"},"a":{"$numberInt":"1"}}',
      '{"_id":{"$numberInt":"3"},"a":{"$numberLong":"3"}}',
      '{"_id":{"$numberInt":"4"}}',
    ]);
  });

  it('continue mode in a JSON array reports the line of the bad element', async () => {
    const file = path.join(dir, 'bad.json');
    await writeFile(file, `[\n${lines.filter((l) => l !== '').join(',\n')}\n]\n`);
    const { outcome } = await importFrom(file, 'json', 'bad_json', {
      stopOnError: false,
      ordered: false,
    });
    expect(outcome.error).toBeUndefined();
    expect(outcome.end?.delivered).toBe(3);
    expect(outcome.progress.at(-1)?.errors.map((e) => e.index)).toEqual([3, 5, 6]);
    expect(await coll('bad_json').countDocuments()).toBe(3);
  });

  it('stop mode ends with the first bad line and keeps the lines before it', async () => {
    const file = path.join(dir, 'bad-stop.jsonl');
    await writeFile(file, lines.join('\n'));
    const { outcome } = await importFrom(file, 'jsonl', 'bad_stop');
    expect(outcome.error?.code).toBe('INVALID_PARAMS');
    expect(outcome.error?.message).toMatch(/Line 2/);
    expect(outcome.progress.at(-1)).toMatchObject({ failed: 1, errors: [{ index: 2 }] });
    expect(await coll('bad_stop').countDocuments()).toBe(1);
  });

  it('a read-only profile cannot import', async () => {
    const file = path.join(dir, 'ro.jsonl');
    await writeFile(file, '{"a":1}\n');
    await expect(importFrom(file, 'jsonl', 'ro', { profileId: READ_ONLY.id })).rejects.toThrow(
      /read-only/,
    );
  });
});

describe('export memory', () => {
  it(
    'streams 200 000 documents to the file without buffering them',
    { timeout: 180_000 },
    async () => {
      // `gc()` without --expose-gc on the command line: retained heap is then measurable.
      setFlagsFromString('--expose-gc');
      const gc = runInNewContext('gc') as () => void;
      const big = coll('big');
      for (let start = 0; start < BIG; start += 20_000) {
        await big.insertMany(
          Array.from({ length: 20_000 }, (_, k) => ({ n: start + k, s: `small ${String(k)}` })),
        );
      }
      const file = path.join(dir, 'big.jsonl');
      gc();
      const baseline = process.memoryUsage().heapUsed;
      let maxRetained = 0;
      const sizesAt: { processed: number; bytes: number }[] = [];
      const pending: Promise<void>[] = [];
      const exported = await exportTo(file, { coll: 'big', format: 'jsonl' }, (progress) => {
        gc();
        maxRetained = Math.max(maxRetained, process.memoryUsage().heapUsed - baseline);
        pending.push(
          stat(file).then(
            (s) => void sizesAt.push({ processed: progress.processed, bytes: s.size }),
          ),
        );
      });
      await Promise.all(pending);
      expect(exported.error).toBeUndefined();
      expect(exported.end?.delivered).toBe(BIG);
      const finalSize = (await stat(file)).size;
      // The file grows while the cursor is read: half way through, about half of it is on disk.
      const half = sizesAt.find((s) => s.processed >= BIG / 2 && s.processed < BIG);
      expect(half).toBeDefined();
      expect(half?.bytes ?? 0).toBeGreaterThan(finalSize * 0.3);
      // 200 000 documents held at once would retain far more than this (tens of MB).
      expect(maxRetained).toBeLessThan(16 * 1024 * 1024);
      expect((await readFile(file, 'utf8')).trimEnd().split('\n')).toHaveLength(BIG);
    },
  );
});
