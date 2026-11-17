import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { IoProgress } from '@thicket/contract';
import { BSON, Int32, Long, ObjectId, type Document } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientLike } from '../connections/manager';

/**
 * Set `gate` in a test: export streams open their file only once it resolves; `opened` then
 * resolves when that open has finished (the file exists).
 */
const slowOpen = vi.hoisted(() => ({
  gate: undefined as Promise<void> | undefined,
  opened: undefined as Promise<void> | undefined,
}));

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  type Open = (...args: unknown[]) => void;
  const createWriteStream = (file: string, options: Record<string, unknown>) => {
    const gate = slowOpen.gate;
    if (!gate) return fs.createWriteStream(file, options);
    let opened: (() => void) | undefined;
    slowOpen.opened = new Promise<void>((resolve) => (opened = resolve));
    const open: Open = (...args) => {
      const callback = args.pop() as (...result: unknown[]) => void;
      void gate.then(() =>
        (fs.open as unknown as Open)(...args, (...result: unknown[]) => {
          opened?.();
          callback(...result);
        }),
      );
    };
    return fs.createWriteStream(file, {
      ...options,
      fs: { open, write: fs.write, writev: fs.writev, close: fs.close },
    });
  };
  return { ...fs, default: { ...fs, createWriteStream }, createWriteStream };
});
import { RpcError } from '../server/rpc';
import {
  EXPORT_BATCH_SIZE,
  EXPORT_PROGRESS_EVERY,
  exportCommand,
  exportToFile,
  type ExportParams,
} from './export';

const base = { profileId: 'p1', db: 'shop', coll: 'orders' };

const params = (p: Partial<ExportParams> = {}): ExportParams => ({
  ...base,
  source: { kind: 'find', filter: '{}' },
  format: 'jsonl',
  ...p,
});

describe('exportCommand', () => {
  it('builds a find with every query field, the user projection unchanged and no paging', () => {
    const cmd = exportCommand(
      params({
        source: {
          kind: 'find',
          filter: '{"n":{"$gt":{"$numberInt":"1"}}}',
          sort: '{"n":-1}',
          projection: '{"n":1}',
          collation: '{"locale":"de"}',
          hint: '"n_1"',
          skip: 5,
          limit: 10,
          maxTimeMS: 2000,
        },
      }),
    );
    expect(cmd).toEqual({
      find: 'orders',
      filter: { n: { $gt: new Int32(1) } },
      sort: { n: -1 },
      projection: { n: 1 },
      collation: { locale: 'de' },
      hint: 'n_1',
      skip: 5,
      limit: 10,
      maxTimeMS: 2000,
      batchSize: EXPORT_BATCH_SIZE,
    });
    expect(cmd['filter']['n']['$gt']).toBeInstanceOf(Int32);
  });

  it('leaves out absent options, an empty projection and limit 0 (no limit)', () => {
    expect(exportCommand(params())).toEqual({ find: 'orders', filter: {}, batchSize: 1000 });
    const cmd = exportCommand(
      params({ source: { kind: 'find', filter: '{}', projection: '{}', limit: 0, skip: 0 } }),
    );
    expect(cmd).toEqual({ find: 'orders', filter: {}, skip: 0, batchSize: 1000 });
  });

  it('builds an aggregate with a cursor batch size', () => {
    const cmd = exportCommand(
      params({ source: { kind: 'aggregate', pipeline: '[{"$match":{"a":1}},{"$limit":3}]' } }),
    );
    expect(cmd).toEqual({
      aggregate: 'orders',
      pipeline: [{ $match: { a: new Int32(1) } }, { $limit: new Int32(3) }],
      cursor: { batchSize: EXPORT_BATCH_SIZE },
    });
  });

  it.each([
    ['a pipeline that is not an array', { kind: 'aggregate', pipeline: '{"$match":{}}' }],
    ['a pipeline that is not EJSON', { kind: 'aggregate', pipeline: '[{' }],
    ['a filter that is not EJSON', { kind: 'find', filter: '{"a":' }],
    ['a filter that is not a document', { kind: 'find', filter: '[1]' }],
    ['a sort that is not a document', { kind: 'find', filter: '{}', sort: '1' }],
  ] as const)('refuses %s with INVALID_PARAMS', (_what, source) => {
    expect(() => exportCommand(params({ source: source as ExportParams['source'] }))).toThrow(
      expect.objectContaining({ code: 'INVALID_PARAMS' }),
    );
  });
});

/** The commands a fake server got and the batches it serves (by cursor). */
interface FakeServer {
  client: ClientLike;
  sent: Document[];
}

const cursorReply = (id: number, batch: Document[], first: boolean): Document => ({
  cursor: { id: new Long(id), ns: 'shop.orders', [first ? 'firstBatch' : 'nextBatch']: batch },
  ok: 1,
});

/**
 * A server that answers a find/aggregate with `batches[0]` and each getMore with the next batch.
 * `hook` may replace the answer of any command (return undefined to keep the default).
 */
function fakeServer(
  batches: Document[][],
  hook?: (cmd: Document) => Promise<Document> | undefined,
): FakeServer {
  const sent: Document[] = [];
  let next = 0;
  const answer = (cmd: Document): Promise<Document> => {
    const custom = hook?.(cmd);
    if (custom) return custom;
    if ('find' in cmd || 'aggregate' in cmd || 'getMore' in cmd) {
      const first = !('getMore' in cmd);
      const batch = batches[next++] ?? [];
      return Promise.resolve(cursorReply(next < batches.length ? 42 : 0, batch, first));
    }
    if ('currentOp' in cmd) return Promise.resolve({ inprog: [], ok: 1 });
    return Promise.resolve({ ok: 1 });
  };
  const client: ClientLike = {
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: () => ({
      command: (cmd) => {
        sent.push(cmd);
        return answer(cmd);
      },
    }),
  };
  return { client, sent };
}

const docs = (from: number, count: number): Document[] =>
  Array.from({ length: count }, (_, k) => ({ _id: new Int32(from + k), n: Long.fromNumber(7) }));

describe('exportToFile', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'thicket-export-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes JSON Lines in relaxed EJSON by default, reading every batch', async () => {
    const server = fakeServer([docs(0, 2), docs(2, 1)]);
    const file = path.join(dir, 'out.jsonl');
    const progress: IoProgress[] = [];
    const written = await exportToFile(server.client, params(), file, {
      progress: (p) => progress.push(p),
    });
    expect(written).toBe(3);
    expect(await readFile(file, 'utf8')).toBe(
      '{"_id":0,"n":7}\n{"_id":1,"n":7}\n{"_id":2,"n":7}\n',
    );
    const getMore = server.sent.find((c) => 'getMore' in c);
    expect(getMore).toMatchObject({ collection: 'orders', batchSize: EXPORT_BATCH_SIZE });
    // Only the final report: fewer documents than EXPORT_PROGRESS_EVERY.
    expect(progress).toEqual([{ processed: 3, failed: 0, errors: [] }]);
  });

  it('writes one JSON array in canonical EJSON that parses back to the same documents', async () => {
    const id = new ObjectId('64b7f0c2a1b2c3d4e5f60718');
    const batch = [
      { _id: id, d: new Date(Date.UTC(2024, 1, 3)), n: new Int32(1) },
      { _id: new Int32(2) },
    ];
    const server = fakeServer([batch, [{ _id: Long.fromNumber(3) }]]);
    const file = path.join(dir, 'out.json');
    const written = await exportToFile(
      server.client,
      params({ format: 'json', ejsonMode: 'canonical' }),
      file,
    );
    expect(written).toBe(3);
    const text = await readFile(file, 'utf8');
    expect(text).toBe(
      '[\n' +
        '{"_id":{"$oid":"64b7f0c2a1b2c3d4e5f60718"},"d":{"$date":{"$numberLong":"1706918400000"}},"n":{"$numberInt":"1"}},\n' +
        '{"_id":{"$numberInt":"2"}},\n' +
        '{"_id":{"$numberLong":"3"}}\n' +
        ']\n',
    );
    const parsed = BSON.EJSON.parse(text, { relaxed: false }) as Document[];
    expect(BSON.EJSON.stringify(parsed, { relaxed: false })).toBe(
      BSON.EJSON.stringify([...batch, { _id: Long.fromNumber(3) }], { relaxed: false }),
    );
  });

  it('writes an empty array for an empty JSON export and an empty file for JSON Lines', async () => {
    const json = path.join(dir, 'empty.json');
    const jsonl = path.join(dir, 'empty.jsonl');
    expect(await exportToFile(fakeServer([[]]).client, params({ format: 'json' }), json)).toBe(0);
    expect(await exportToFile(fakeServer([[]]).client, params(), jsonl)).toBe(0);
    expect(await readFile(json, 'utf8')).toBe('[]\n');
    expect(JSON.parse(await readFile(json, 'utf8'))).toEqual([]);
    expect(await readFile(jsonl, 'utf8')).toBe('');
  });

  it('runs the aggregation of an aggregate source', async () => {
    const server = fakeServer([[{ _id: 'a', n: new Int32(2) }]]);
    const file = path.join(dir, 'agg.jsonl');
    await exportToFile(
      server.client,
      params({ source: { kind: 'aggregate', pipeline: '[{"$group":{"_id":"$k"}}]' } }),
      file,
    );
    expect(server.sent[0]).toMatchObject({ aggregate: 'orders', cursor: { batchSize: 1000 } });
    expect(await readFile(file, 'utf8')).toBe('{"_id":"a","n":2}\n');
  });

  it('reports progress at least every EXPORT_PROGRESS_EVERY documents and once at the end', async () => {
    const size = EXPORT_PROGRESS_EVERY / 2;
    const server = fakeServer([docs(0, size), docs(size, size), docs(2 * size, size), []]);
    const progress: number[] = [];
    await exportToFile(server.client, params(), path.join(dir, 'p.jsonl'), {
      progress: (p) => progress.push(p.processed),
    });
    expect(progress).toEqual([2 * size, 3 * size]);
  });

  it('waits for the file stream to drain when a batch exceeds its buffer (back pressure)', async () => {
    const pad = 'p'.repeat(200);
    const batch = (from: number) =>
      Array.from({ length: EXPORT_BATCH_SIZE }, (_, k) => ({ _id: new Int32(from + k), pad }));
    const server = fakeServer([batch(0), batch(EXPORT_BATCH_SIZE)]);
    const file = path.join(dir, 'big.jsonl');
    expect(await exportToFile(server.client, params(), file)).toBe(2 * EXPORT_BATCH_SIZE);
    const lines = (await readFile(file, 'utf8')).trimEnd().split('\n');
    expect(lines).toHaveLength(2 * EXPORT_BATCH_SIZE);
    expect(lines.at(-1)).toBe(`{"_id":${String(2 * EXPORT_BATCH_SIZE - 1)},"pad":"${pad}"}`);
  });

  it('removes the partial file and rejects with the server error when a getMore fails', async () => {
    let getMores = 0;
    const server = fakeServer([docs(0, 2), docs(2, 2)], (cmd) =>
      'getMore' in cmd && ++getMores === 1
        ? Promise.reject(Object.assign(new Error('cursor killed'), { code: 237 }))
        : undefined,
    );
    const file = path.join(dir, 'fail.jsonl');
    const error = await exportToFile(server.client, params(), file).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).message).toMatch(/cursor killed/);
    expect(await readdir(dir)).toEqual([]);
  });

  it('a cancel stops the export, kills the server operation and removes the file', async () => {
    const controller = new AbortController();
    let failGetMore: ((error: Error) => void) | undefined;
    const server = fakeServer([docs(0, 2), docs(2, 2)], (cmd) => {
      if ('getMore' in cmd) {
        controller.abort();
        return new Promise((_resolve, reject) => (failGetMore = reject));
      }
      if ('currentOp' in cmd) return Promise.resolve({ inprog: [{ opid: 9 }], ok: 1 });
      if ('killOp' in cmd) {
        failGetMore?.(new Error('operation was interrupted'));
        return Promise.resolve({ ok: 1 });
      }
      return undefined;
    });
    const file = path.join(dir, 'cancel.json');
    await expect(
      exportToFile(server.client, params({ format: 'json' }), file, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(server.sent.some((c) => 'killOp' in c)).toBe(true);
    expect(await readdir(dir)).toEqual([]);
  });

  it('a failure before the file is open removes the file once the open completed', async () => {
    // The open is held until 20 ms after the server failed: removing the file at once would run
    // before the open creates it, and the empty file would stay behind.
    let release: (() => void) | undefined;
    slowOpen.gate = new Promise<void>((resolve) => (release = resolve));
    try {
      const server = fakeServer([], () => {
        setTimeout(() => release?.(), 20);
        return Promise.reject(new Error('connection reset'));
      });
      const file = path.join(dir, 'early.jsonl');
      const error = await exportToFile(server.client, params(), file).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RpcError);
      expect((error as Error).message).toMatch(/connection reset/);
      // Whenever the open finished, the file must not exist afterwards.
      await slowOpen.opened;
      expect(existsSync(file)).toBe(false);
      expect(await readdir(dir)).toEqual([]);
    } finally {
      release?.();
      slowOpen.gate = undefined;
      slowOpen.opened = undefined;
    }
  });

  it('a failed JSON export settles only after the late open, and leaves no file', async () => {
    // JSON writes "[" before the server is asked: it is buffered in the stream while the open
    // waits. The export must not settle (and remove the file) before the open has finished.
    let release: (() => void) | undefined;
    slowOpen.gate = new Promise<void>((resolve) => (release = resolve));
    try {
      let openDone = false;
      const server = fakeServer([], () => {
        void slowOpen.opened?.then(() => (openDone = true));
        setTimeout(() => release?.(), 20);
        return Promise.reject(new Error('connection reset'));
      });
      const file = path.join(dir, 'early.json');
      const error = await exportToFile(server.client, params({ format: 'json' }), file).catch(
        (e: unknown) => e,
      );
      expect(openDone).toBe(true);
      expect(error).toMatchObject({ message: expect.stringMatching(/connection reset/) });
      expect(existsSync(file)).toBe(false);
      expect(await readdir(dir)).toEqual([]);
    } finally {
      release?.();
      slowOpen.gate = undefined;
      slowOpen.opened = undefined;
    }
  });

  it('rejects INTERNAL naming the file when it cannot be created (server answers at once)', async () => {
    const file = path.join(dir, 'missing-folder', 'x.jsonl');
    const error = await exportToFile(fakeServer([docs(0, 1)]).client, params(), file).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: 'INTERNAL' });
    expect((error as Error).message).toContain(file);
  });

  it.each(['jsonl', 'json'] as const)(
    'rejects INTERNAL for an empty %s export when the file cannot be created',
    { timeout: 3000 },
    async (format) => {
      // No document is written: only ending the stream can notice the failed open.
      const file = path.join(dir, 'missing-folder', `empty.${format}`);
      const outcome = await Promise.race([
        exportToFile(fakeServer([[]]).client, params({ format }), file).then(
          () => 'resolved',
          (e: unknown) => e,
        ),
        new Promise((resolve) => setTimeout(() => resolve('still running after 2 s'), 2000)),
      ]);
      expect(outcome).toMatchObject({ code: 'INTERNAL' });
      expect((outcome as Error).message).toContain(file);
    },
  );

  it(
    'rejects INTERNAL when the file cannot be created and the server answers after the open failed',
    { timeout: 3000 },
    async () => {
      // A real server takes longer to answer the find than the file system takes to refuse the
      // file: the stream is already destroyed when the first batch is written.
      const slow = (cmd: Document) =>
        'find' in cmd
          ? new Promise<Document>((resolve) =>
              setTimeout(() => resolve(cursorReply(0, docs(0, 1), true)), 100),
            )
          : undefined;
      const file = path.join(dir, 'missing-folder', 'x.jsonl');
      const outcome = await Promise.race([
        exportToFile(fakeServer([], slow).client, params(), file).then(
          () => 'resolved',
          (e: unknown) => e,
        ),
        new Promise((resolve) => setTimeout(() => resolve('still running after 2 s'), 2000)),
      ]);
      expect(outcome).toMatchObject({ code: 'INTERNAL' });
    },
  );

  it.skipIf(!existsSync('/dev/full'))(
    'rejects INTERNAL and kills the cursor when a write fails between batches (disk full)',
    { timeout: 3000 },
    async () => {
      // /dev/full opens fine but refuses every write with ENOSPC; the getMore answers after the
      // failed write, so the next batch meets an already destroyed stream.
      const server = fakeServer([docs(0, 1), docs(1, 1), docs(2, 1)], (cmd) =>
        'getMore' in cmd
          ? new Promise<Document>((resolve) =>
              setTimeout(() => resolve(cursorReply(42, docs(1, 1), false)), 50),
            )
          : undefined,
      );
      const file = path.join(dir, 'full.jsonl');
      await symlink('/dev/full', file);
      const outcome = await Promise.race([
        exportToFile(server.client, params(), file).then(
          () => 'resolved',
          (e: unknown) => e,
        ),
        new Promise((resolve) => setTimeout(() => resolve('still running after 2 s'), 2000)),
      ]);
      expect(outcome).toMatchObject({ code: 'INTERNAL' });
      expect((outcome as Error).message).toContain(file);
      expect(server.sent.some((c) => 'killCursors' in c)).toBe(true);
      expect(await readdir(dir)).toEqual([]);
    },
  );

  it.skipIf(!existsSync('/dev/full'))(
    'rejects INTERNAL when a write fails while waiting for the buffer to drain (disk full)',
    { timeout: 3000 },
    async () => {
      // One batch larger than the stream's buffer: write() returns false and the export waits for
      // `drain`, which never comes; the write error must end the wait.
      const pad = 'p'.repeat(200);
      const batch = Array.from({ length: EXPORT_BATCH_SIZE }, (_, k) => ({
        _id: new Int32(k),
        pad,
      }));
      const server = fakeServer([batch]);
      const file = path.join(dir, 'full-big.jsonl');
      await symlink('/dev/full', file);
      const progress: IoProgress[] = [];
      const outcome = await Promise.race([
        exportToFile(server.client, params(), file, { progress: (p) => progress.push(p) }).then(
          () => 'resolved',
          (e: unknown) => e,
        ),
        new Promise((resolve) => setTimeout(() => resolve('still running after 2 s'), 2000)),
      ]);
      expect(outcome).toMatchObject({ code: 'INTERNAL' });
      expect((outcome as Error).message).toContain(file);
      expect((outcome as Error).message).toMatch(/ENOSPC/);
      // No final progress event for a failed export.
      expect(progress).toEqual([]);
      expect(await readdir(dir)).toEqual([]);
    },
  );

  it.skipIf(!existsSync('/dev/full'))(
    'rejects INTERNAL for an empty JSON export when the bracket cannot be written (disk full)',
    { timeout: 3000 },
    async () => {
      const file = path.join(dir, 'full-empty.json');
      await symlink('/dev/full', file);
      const outcome = await Promise.race([
        exportToFile(fakeServer([[]]).client, params({ format: 'json' }), file).then(
          () => 'resolved',
          (e: unknown) => e,
        ),
        new Promise((resolve) => setTimeout(() => resolve('still running after 2 s'), 2000)),
      ]);
      expect(outcome).toMatchObject({ code: 'INTERNAL' });
      expect((outcome as Error).message).toContain(file);
      expect(await readdir(dir)).toEqual([]);
    },
  );
});

describe('exportToFile as CSV', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'thicket-export-csv-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const csv = (p: Partial<ExportParams> = {}) => params({ format: 'csv', ...p });

  it('without fields writes the flattened paths of the documents as the header', async () => {
    const server = fakeServer([
      [
        {
          _id: new ObjectId('64b7f0c2a1b2c3d4e5f60718'),
          name: 'Widget, large',
          address: { city: 'Springfield', zip: '01234' },
          qty: new Int32(3),
        },
        { _id: new Int32(2), name: 'Gadget "mini"', extra: true, tags: ['a', new Int32(1)] },
      ],
    ]);
    const file = path.join(dir, 'out.csv');
    expect(await exportToFile(server.client, csv(), file)).toBe(2);
    expect(await readFile(file, 'utf8')).toBe(
      '_id,name,address.city,address.zip,qty,extra,tags\n' +
        '64b7f0c2a1b2c3d4e5f60718,"Widget, large",Springfield,01234,3,,\n' +
        '2,"Gadget ""mini""",,,,true,"[""a"",1]"\n',
    );
  });

  it('takes the columns from the first batch only (later new fields are not written)', async () => {
    const server = fakeServer([[{ a: new Int32(1) }], [{ a: new Int32(2), late: 'x' }]]);
    const file = path.join(dir, 'first.csv');
    expect(await exportToFile(server.client, csv(), file)).toBe(2);
    expect(await readFile(file, 'utf8')).toBe('a\n1\n2\n');
  });

  it('with csvFields writes exactly those columns, in order, also missing and nested ones', async () => {
    const server = fakeServer([
      [
        { _id: new Int32(1), address: { city: 'X' }, tags: ['t0', 't1'] },
        { _id: new Int32(2), address: 'not a document' },
      ],
    ]);
    const file = path.join(dir, 'fields.csv');
    await exportToFile(
      server.client,
      csv({ csvFields: ['address.city', 'tags.1', 'missing', '_id'] }),
      file,
    );
    expect(await readFile(file, 'utf8')).toBe('address.city,tags.1,missing,_id\nX,t1,,1\n,,,2\n');
  });

  it('writes nested values in canonical Extended JSON when asked', async () => {
    const server = fakeServer([[{ tags: [new Int32(1)], n: Long.fromNumber(5) }]]);
    const file = path.join(dir, 'canonical.csv');
    await exportToFile(server.client, csv({ ejsonMode: 'canonical' }), file);
    // Numbers stay plain decimal cells; only the array is Extended JSON.
    expect(await readFile(file, 'utf8')).toBe('tags,n\n"[{""$numberInt"":""1""}]",5\n');
  });

  it('an empty result without fields writes an empty file, with fields only the header', async () => {
    const plain = path.join(dir, 'empty.csv');
    const withFields = path.join(dir, 'header.csv');
    expect(await exportToFile(fakeServer([[]]).client, csv(), plain)).toBe(0);
    expect(
      await exportToFile(fakeServer([[]]).client, csv({ csvFields: ['a', 'b'] }), withFields),
    ).toBe(0);
    expect(await readFile(plain, 'utf8')).toBe('');
    expect(await readFile(withFields, 'utf8')).toBe('a,b\n');
  });

  it('writes no metadata file for CSV', async () => {
    const file = path.join(dir, 'orders.csv');
    await exportToFile(fakeServer([[{ a: new Int32(1) }]]).client, csv(), file);
    expect(await readdir(dir)).toEqual(['orders.csv']);
  });
});

describe('exportToFile as BSON', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'thicket-export-bson-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const bson = (p: Partial<ExportParams> = {}) => params({ format: 'bson', ...p });
  const UUID_HEX = 'fedcba9876543210fedcba9876543210';
  const cursor = (batch: Document[]) =>
    Promise.resolve({ cursor: { id: new Long(0), ns: 'shop.$cmd', firstBatch: batch }, ok: 1 });
  /** Answers listCollections and listIndexes like a server holding shop.orders. */
  const metadataHook = (cmd: Document): Promise<Document> | undefined => {
    if ('listCollections' in cmd) {
      return cursor([
        {
          name: 'orders',
          type: 'collection',
          options: { capped: true, size: new Int32(4096) },
          info: { uuid: new BSON.Binary(Buffer.from(UUID_HEX, 'hex'), 4) },
        },
      ]);
    }
    if ('listIndexes' in cmd) {
      return cursor([
        { v: new Int32(2), key: { _id: new Int32(1) }, name: '_id_' },
        { v: new Int32(2), key: { sku: new Int32(1) }, name: 'sku_1', ns: 'shop.orders' },
      ]);
    }
    return undefined;
  };

  /** The documents of a .bson file, in canonical EJSON. */
  async function dumped(file: string): Promise<string[]> {
    const bytes = await readFile(file);
    const out: string[] = [];
    let at = 0;
    while (at < bytes.length) {
      const size = bytes.readInt32LE(at);
      out.push(
        BSON.EJSON.stringify(
          BSON.deserialize(bytes.subarray(at, at + size), { promoteValues: false }),
          { relaxed: false },
        ),
      );
      at += size;
    }
    return out;
  }

  it('writes every batch as BSON documents and the metadata next to the file', async () => {
    const first = [{ _id: new Int32(1), at: new Date(Date.UTC(2024, 0, 1)) }];
    const second = [{ _id: Long.fromNumber(2), n: BSON.Decimal128.fromString('1.10') }];
    const server = fakeServer([first, second], metadataHook);
    const progress: IoProgress[] = [];
    const file = path.join(dir, 'orders.bson');
    expect(
      await exportToFile(server.client, bson(), file, { progress: (p) => progress.push(p) }),
    ).toBe(2);
    expect(await dumped(file)).toEqual(
      [...first, ...second].map((d) => BSON.EJSON.stringify(d, { relaxed: false })),
    );
    expect((await readdir(dir)).sort()).toEqual(['orders.bson', 'orders.metadata.json']);
    const metadata = await readFile(path.join(dir, 'orders.metadata.json'), 'utf8');
    expect(metadata.endsWith('}\n')).toBe(true);
    expect(JSON.parse(metadata)).toEqual({
      options: { capped: true, size: { $numberInt: '4096' } },
      indexes: [
        { v: { $numberInt: '2' }, key: { _id: { $numberInt: '1' } }, name: '_id_' },
        { v: { $numberInt: '2' }, key: { sku: { $numberInt: '1' } }, name: 'sku_1' },
      ],
      uuid: UUID_HEX,
      collectionName: 'orders',
      type: 'collection',
    });
    // The metadata is asked for after the documents.
    const order = server.sent.map((c) => Object.keys(c)[0]);
    expect(order.indexOf('listCollections')).toBeGreaterThan(order.indexOf('getMore'));
    expect(progress.at(-1)).toEqual({ processed: 2, failed: 0, errors: [] });
  });

  it('an empty collection gives an empty .bson file and its metadata', async () => {
    const server = fakeServer([[]], metadataHook);
    const file = path.join(dir, 'orders.bson');
    expect(await exportToFile(server.client, bson(), file)).toBe(0);
    expect((await readFile(file)).length).toBe(0);
    expect(existsSync(path.join(dir, 'orders.metadata.json'))).toBe(true);
  });

  it('an aggregation export writes metadata without options and indexes', async () => {
    const server = fakeServer([[{ _id: 'k', total: new Int32(3) }]], metadataHook);
    const file = path.join(dir, 'totals.bson');
    await exportToFile(
      server.client,
      bson({ source: { kind: 'aggregate', pipeline: '[{"$group":{"_id":"$k"}}]' } }),
      file,
    );
    expect(JSON.parse(await readFile(path.join(dir, 'totals.metadata.json'), 'utf8'))).toEqual({
      options: {},
      indexes: [],
      collectionName: 'orders',
      type: 'collection',
    });
    expect(server.sent.some((c) => 'listCollections' in c || 'listIndexes' in c)).toBe(false);
  });

  it('names the metadata after a file chosen without the .bson extension', async () => {
    const server = fakeServer([[{ _id: new Int32(1) }]], metadataHook);
    await exportToFile(server.client, bson(), path.join(dir, 'dump'));
    expect((await readdir(dir)).sort()).toEqual(['dump', 'dump.metadata.json']);
  });

  it('removes the .bson file and writes no metadata when reading the metadata fails', async () => {
    const server = fakeServer([[{ _id: new Int32(1) }]], (cmd) =>
      'listIndexes' in cmd
        ? Promise.reject(Object.assign(new Error('not authorized on shop'), { code: 13 }))
        : metadataHook(cmd),
    );
    const progress: IoProgress[] = [];
    const error = await exportToFile(server.client, bson(), path.join(dir, 'orders.bson'), {
      progress: (p) => progress.push(p),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as Error).message).toMatch(/not authorized/);
    expect(await readdir(dir)).toEqual([]);
    expect(progress).toEqual([]);
  });

  it('a cancel while the metadata is read removes both files', async () => {
    const controller = new AbortController();
    const server = fakeServer([[{ _id: new Int32(1) }]], (cmd) => {
      if ('listIndexes' in cmd) controller.abort();
      return metadataHook(cmd);
    });
    const error = await exportToFile(server.client, bson(), path.join(dir, 'orders.bson'), {
      signal: controller.signal,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'CANCELLED' });
    expect(await readdir(dir)).toEqual([]);
  });

  it.skipIf(!existsSync('/dev/full'))(
    'removes both files and rejects INTERNAL when the metadata cannot be written (disk full)',
    { timeout: 3000 },
    async () => {
      await symlink('/dev/full', path.join(dir, 'orders.metadata.json'));
      const server = fakeServer([[{ _id: new Int32(1) }]], metadataHook);
      const file = path.join(dir, 'orders.bson');
      const outcome = await Promise.race([
        exportToFile(server.client, bson(), file).then(
          () => 'resolved',
          (e: unknown) => e,
        ),
        new Promise((resolve) => setTimeout(() => resolve('still running after 2 s'), 2000)),
      ]);
      expect(outcome).toMatchObject({ code: 'INTERNAL' });
      expect((outcome as Error).message).toMatch(/ENOSPC/);
      expect(await readdir(dir)).toEqual([]);
    },
  );
});
