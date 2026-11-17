import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { IoProgress } from '@thicket/contract';
import { BSON, Int32, Long, ObjectId, type Document } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ClientLike } from '../connections/manager';
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

  it.each(['csv', 'bson'] as const)(
    'refuses %s with UNSUPPORTED and creates no file',
    async (format) => {
      const server = fakeServer([docs(0, 1)]);
      await expect(
        exportToFile(server.client, params({ format }), path.join(dir, `x.${format}`)),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
      expect(server.sent).toEqual([]);
      expect(await readdir(dir)).toEqual([]);
    },
  );

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

  it('rejects INTERNAL naming the file when it cannot be created (server answers at once)', async () => {
    const file = path.join(dir, 'missing-folder', 'x.jsonl');
    const error = await exportToFile(fakeServer([docs(0, 1)]).client, params(), file).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: 'INTERNAL' });
    expect((error as Error).message).toContain(file);
  });

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
});
