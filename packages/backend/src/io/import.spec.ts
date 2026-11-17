import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { IoProgress } from '@thicket/contract';
import { BSON, Decimal128, Double, Int32, Long, ObjectId, type Document } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ClientLike } from '../connections/manager';
import { RpcError } from '../server/rpc';
import {
  DEFAULT_SAMPLE_SIZE,
  IMPORT_BATCH_BYTES,
  IMPORT_BATCH_DOCS,
  MAX_REPORTED_ERRORS,
  importFile,
  parseImportedDocument,
  previewFile,
  scanFile,
  type ImportOptions,
} from './import';
import type { ScannedValue } from './scanner';

const value = (text: string, line = 1): ScannedValue => ({ text, line });

describe('parseImportedDocument', () => {
  it('parses canonical and relaxed EJSON into exact BSON types', () => {
    const doc = parseImportedDocument(
      value(
        '{"_id":{"$oid":"64b7f0c2a1b2c3d4e5f60718"},"i":1,"big":3000000000,"d":1.5,' +
          '"l":{"$numberLong":"5"},"dec":{"$numberDecimal":"1.10"},' +
          '"at":{"$date":"2024-02-03T00:00:00Z"},"s":"x","nested":{"a":[1,"b"]}}',
      ),
    );
    expect(doc['_id']).toEqual(new ObjectId('64b7f0c2a1b2c3d4e5f60718'));
    expect(doc['i']).toBeInstanceOf(Int32);
    expect(doc['big']).toBeInstanceOf(Long);
    expect(doc['d']).toBeInstanceOf(Double);
    expect(doc['l']).toEqual(Long.fromNumber(5));
    expect(doc['dec']).toEqual(Decimal128.fromString('1.10'));
    expect(doc['at']).toEqual(new Date(Date.UTC(2024, 1, 3)));
    expect(doc['s']).toBe('x');
    expect(BSON.EJSON.stringify(doc['nested'], { relaxed: false })).toBe(
      '{"a":[{"$numberInt":"1"},"b"]}',
    );
  });

  it('refuses text that is not JSON, naming the line', () => {
    const error = (() => {
      try {
        parseImportedDocument(value('{"a": }', 12));
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: 'INVALID_PARAMS' });
    expect((error as Error).message).toMatch(/^Line 12: not valid JSON: /);
  });

  it.each([
    ['an array', '[{"a":1}]'],
    ['a number', '42'],
    ['a string', '"text"'],
    ['null', 'null'],
    ['a type wrapper ($oid)', '{"$oid":"64b7f0c2a1b2c3d4e5f60718"}'],
    ['a type wrapper ($date)', '{"$date":"2024-01-01T00:00:00Z"}'],
    ['a type wrapper ($numberLong)', '{"$numberLong":"1"}'],
  ])('refuses %s as not a document', (_what, text) => {
    expect(() => parseImportedDocument(value(text, 3))).toThrow(
      expect.objectContaining({ code: 'INVALID_PARAMS', message: 'Line 3: not a document' }),
    );
  });

  it('refuses an invalid type wrapper as not valid JSON', () => {
    expect(() => parseImportedDocument(value('{"a":{"$oid":"nope"}}', 2))).toThrow(
      /^Line 2: not valid JSON/,
    );
  });
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'thicket-import-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function fileWith(name: string, text: string): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, text);
  return file;
}

async function collect(iterable: AsyncIterable<ScannedValue>): Promise<ScannedValue[]> {
  const out: ScannedValue[] = [];
  for await (const v of iterable) out.push(v);
  return out;
}

describe('scanFile', () => {
  it('reads JSON and JSON Lines files value by value', async () => {
    const json = await fileWith('a.json', '[\n{"a":1},\n{"b":2}\n]');
    const jsonl = await fileWith('a.jsonl', '{"a":1}\n\n{"b":2}\n');
    expect(await collect(scanFile(json, 'json'))).toEqual([
      { text: '{"a":1}', line: 2 },
      { text: '{"b":2}', line: 3 },
    ]);
    expect(await collect(scanFile(jsonl, 'jsonl'))).toEqual([
      { text: '{"a":1}', line: 1 },
      { text: '{"b":2}', line: 3 },
    ]);
  });

  it('reads a file larger than one read chunk (values cut between chunks)', async () => {
    const lines = Array.from(
      { length: 20_000 },
      (_, i) => `{"i":${String(i)},"s":"${'x'.repeat(i % 50)}"}`,
    );
    const file = await fileWith('big.json', `[\n${lines.join(',\n')}\n]\n`);
    const values = await collect(scanFile(file, 'json'));
    expect(values).toHaveLength(lines.length);
    expect(values.every((v, i) => v.text === lines[i] && v.line === i + 2)).toBe(true);
  });

  it('throws the ScanError of a broken structure', async () => {
    const file = await fileWith('broken.json', '[{"a":1},\n{"b":2}');
    await expect(collect(scanFile(file, 'json'))).rejects.toMatchObject({ name: 'ScanError' });
  });

  it('stops with CANCELLED once the signal is aborted', async () => {
    const file = await fileWith('c.jsonl', '{"a":1}\n');
    const controller = new AbortController();
    controller.abort();
    await expect(collect(scanFile(file, 'jsonl', controller.signal))).rejects.toMatchObject({
      code: 'CANCELLED',
    });
  });
});

describe('previewFile', () => {
  it('returns the size and the first documents as canonical EJSON, skipping bad values', async () => {
    const text = '{"a":1}\n{"bad": }\n[1]\n{"b":{"$numberLong":"2"}}\n{"c":3}\n';
    const file = await fileWith('p.jsonl', text);
    expect(await previewFile(file, 'jsonl', 2)).toEqual({
      sizeBytes: Buffer.byteLength(text),
      sample: ['{"a":{"$numberInt":"1"}}', '{"b":{"$numberLong":"2"}}'],
    });
  });

  it('takes DEFAULT_SAMPLE_SIZE documents by default', async () => {
    const lines = Array.from({ length: DEFAULT_SAMPLE_SIZE + 5 }, (_, i) => `{"i":${String(i)}}`);
    const file = await fileWith('d.jsonl', lines.join('\n'));
    const preview = await previewFile(file, 'jsonl');
    expect(preview.sample).toHaveLength(DEFAULT_SAMPLE_SIZE);
    expect(preview.sample[0]).toBe('{"i":{"$numberInt":"0"}}');
  });

  it('an empty file has an empty sample', async () => {
    const file = await fileWith('e.json', '');
    expect(await previewFile(file, 'json')).toEqual({ sizeBytes: 0, sample: [] });
  });

  it('answers NOT_FOUND for a file that no longer exists', async () => {
    await expect(previewFile(path.join(dir, 'gone.json'), 'json')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('answers INVALID_PARAMS for a broken structure before the sample is complete', async () => {
    const file = await fileWith('b.json', '[{"a":1}] trailing');
    const error = await previewFile(file, 'json').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: 'INVALID_PARAMS' });
    expect((error as Error).message).toMatch(/after the closing \]/);
  });

  it('a broken structure after the sample is complete still gives the sample', async () => {
    const file = await fileWith('late.json', '[{"a":1},\n{"b":2},\n{"c":3},\n}');
    expect((await previewFile(file, 'json', 2)).sample).toEqual([
      '{"a":{"$numberInt":"1"}}',
      '{"b":{"$numberInt":"2"}}',
    ]);
  });

  it('answers INTERNAL for other read errors (a folder)', async () => {
    await expect(previewFile(dir, 'jsonl')).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});

/** An insert command's documents, in canonical EJSON text, for comparisons. */
const texts = (documents: Document[]) =>
  documents.map((d) => BSON.EJSON.stringify(d, { relaxed: false }));

type InsertAnswer = (documents: Document[], ordered: boolean, call: number) => Document;

/** Answers every insert with `n` = number of documents, unless `answer` says otherwise. */
function fakeServer(answer?: InsertAnswer) {
  const inserts: { documents: Document[]; ordered: boolean }[] = [];
  const client: ClientLike = {
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: () => ({
      command: (cmd) => {
        if ('insert' in cmd) {
          const documents = cmd['documents'] as Document[];
          const ordered = cmd['ordered'] as boolean;
          inserts.push({ documents, ordered });
          return Promise.resolve(
            answer?.(documents, ordered, inserts.length) ?? { n: documents.length, ok: 1 },
          );
        }
        return Promise.resolve({ ok: 1 });
      },
    }),
  };
  return { client, inserts };
}

/** A duplicate key answer for the document at `index` of an insert (as the server sends). */
const duplicateAt = (documents: Document[], index: number, ordered: boolean): Document => ({
  n: ordered ? index : documents.length - 1,
  writeErrors: [{ index, code: 11000, errmsg: 'E11000 duplicate key error' }],
  ok: 1,
});

async function runImport(
  client: ClientLike,
  file: string,
  format: 'json' | 'jsonl',
  options: Partial<ImportOptions> = {},
) {
  const progress: IoProgress[] = [];
  const result = await importFile(client, file, format, {
    db: 'shop',
    coll: 'orders',
    progress: (p) => progress.push(p),
    ...options,
  }).catch((error: unknown) => error);
  return { result, progress };
}

describe('importFile', () => {
  it('inserts every document in order with exact types and reports totals', async () => {
    const file = await fileWith(
      'ok.jsonl',
      '{"_id":1,"a":{"$numberLong":"2"}}\n{"_id":2,"d":{"$date":"2024-01-01T00:00:00Z"}}\n',
    );
    const server = fakeServer();
    const { result, progress } = await runImport(server.client, file, 'jsonl');
    expect(result).toEqual({ processed: 2, failed: 0, errors: [], inserted: 2 });
    expect(progress).toEqual([{ processed: 2, failed: 0, errors: [] }]);
    expect(server.inserts).toHaveLength(1);
    expect(server.inserts[0]?.ordered).toBe(true);
    expect(texts(server.inserts[0]?.documents ?? [])).toEqual([
      '{"_id":{"$numberInt":"1"},"a":{"$numberLong":"2"}}',
      '{"_id":{"$numberInt":"2"},"d":{"$date":{"$numberLong":"1704067200000"}}}',
    ]);
  });

  it('sends batches of at most IMPORT_BATCH_DOCS documents with a progress event after each', async () => {
    const count = IMPORT_BATCH_DOCS * 2 + 3;
    const lines = Array.from({ length: count }, (_, i) => `{"i":${String(i)}}`);
    const file = await fileWith('many.json', `[${lines.join(',')}]`);
    const server = fakeServer();
    const { result, progress } = await runImport(server.client, file, 'json');
    expect(server.inserts.map((i) => i.documents.length)).toEqual([
      IMPORT_BATCH_DOCS,
      IMPORT_BATCH_DOCS,
      3,
    ]);
    expect(progress.map((p) => p.processed)).toEqual([
      IMPORT_BATCH_DOCS,
      2 * IMPORT_BATCH_DOCS,
      count,
    ]);
    expect(result).toMatchObject({ inserted: count, failed: 0 });
  });

  it('starts a new batch before IMPORT_BATCH_BYTES would be exceeded', async () => {
    const big = 'x'.repeat(3 * 1024 * 1024);
    const file = await fileWith(
      'bytes.jsonl',
      [1, 2, 3, 4].map((i) => `{"i":${String(i)},"s":"${big}"}`).join('\n'),
    );
    const server = fakeServer();
    const { result } = await runImport(server.client, file, 'jsonl');
    const sizes = server.inserts.map((i) => i.documents.length);
    expect(sizes).toEqual([2, 2]);
    for (const insert of server.inserts) {
      const bytes = insert.documents.reduce((sum, d) => sum + BSON.calculateObjectSize(d), 0);
      expect(bytes).toBeLessThanOrEqual(IMPORT_BATCH_BYTES);
    }
    expect(result).toMatchObject({ inserted: 4 });
  });

  it('an empty file imports nothing and sends one final progress event', async () => {
    const file = await fileWith('empty.jsonl', '\n\n');
    const server = fakeServer();
    const { result, progress } = await runImport(server.client, file, 'jsonl');
    expect(result).toEqual({ processed: 0, failed: 0, errors: [], inserted: 0 });
    expect(server.inserts).toEqual([]);
    expect(progress).toEqual([{ processed: 0, failed: 0, errors: [] }]);
  });

  describe('stop mode (the default)', () => {
    it('inserts the lines before a bad line, then rejects with its error', async () => {
      const file = await fileWith('stop.jsonl', '{"_id":1}\n{"_id":2}\n{"bad": }\n{"_id":4}\n');
      const server = fakeServer();
      const { result, progress } = await runImport(server.client, file, 'jsonl');
      expect(result).toBeInstanceOf(RpcError);
      expect(result).toMatchObject({ code: 'INVALID_PARAMS' });
      expect((result as Error).message).toMatch(/^Import stopped: Line 3: not valid JSON/);
      expect(server.inserts.map((i) => texts(i.documents))).toEqual([
        ['{"_id":{"$numberInt":"1"}}', '{"_id":{"$numberInt":"2"}}'],
      ]);
      expect(progress.at(-1)).toMatchObject({ processed: 3, failed: 1, errors: [{ index: 3 }] });
    });

    it('stops at a refused insert (ordered) and reports its line', async () => {
      const file = await fileWith('dup.jsonl', '{"_id":1}\n{"_id":1}\n{"_id":2}\n');
      const server = fakeServer((documents, ordered) => duplicateAt(documents, 1, ordered));
      const { result, progress } = await runImport(server.client, file, 'jsonl');
      expect(result).toMatchObject({ code: 'SERVER_ERROR' });
      expect((result as Error).message).toMatch(/^Import stopped: Line 2: E11000/);
      expect(server.inserts).toHaveLength(1);
      expect(progress.at(-1)).toEqual({
        processed: 3,
        failed: 1,
        errors: [
          {
            index: 2,
            error: { code: 'SERVER_ERROR', message: 'Line 2: E11000 duplicate key error' },
          },
        ],
      });
    });

    it('a refused insert in a full batch stops reading the file', async () => {
      const count = IMPORT_BATCH_DOCS + 50;
      const lines = Array.from({ length: count }, (_, i) => `{"_id":${String(i)}}`);
      const file = await fileWith('full.jsonl', lines.join('\n'));
      const server = fakeServer((documents, ordered) => duplicateAt(documents, 5, ordered));
      const { result, progress } = await runImport(server.client, file, 'jsonl');
      expect(result).toMatchObject({ code: 'SERVER_ERROR' });
      expect((result as Error).message).toMatch(/Line 6: /);
      expect(server.inserts).toHaveLength(1);
      expect(progress.at(-1)).toMatchObject({ processed: IMPORT_BATCH_DOCS, failed: 1 });
    });

    it('a refused insert in a batch flushed by size stops before the next document', async () => {
      const big = 'x'.repeat(5 * 1024 * 1024);
      const file = await fileWith(
        'size.jsonl',
        [1, 2, 3].map((i) => `{"_id":${String(i)},"s":"${big}"}`).join('\n'),
      );
      const server = fakeServer((documents, ordered) => duplicateAt(documents, 0, ordered));
      const { result, progress } = await runImport(server.client, file, 'jsonl');
      expect(result).toMatchObject({ code: 'SERVER_ERROR' });
      expect((result as Error).message).toMatch(/Line 1: /);
      expect(server.inserts.map((i) => i.documents.length)).toEqual([1]);
      expect(progress.at(-1)).toMatchObject({ processed: 2, failed: 1 });
    });

    it('a bad element in a JSON array stops at its line', async () => {
      const file = await fileWith('stop.json', '[\n{"_id":1},\n42,\n{"_id":3}\n]');
      const server = fakeServer();
      const { result } = await runImport(server.client, file, 'json');
      expect((result as Error).message).toBe('Import stopped: Line 3: not a document');
      expect(server.inserts.map((i) => i.documents.length)).toEqual([1]);
    });
  });

  describe('continue mode', () => {
    it('skips bad lines, reports their line numbers and imports the rest', async () => {
      const file = await fileWith(
        'cont.jsonl',
        '{"_id":1}\n{"bad": }\n\n[1]\n{"_id":4}\r\n"text"\n{"_id":6}',
      );
      const server = fakeServer();
      const { result } = await runImport(server.client, file, 'jsonl', { stopOnError: false });
      expect(result).toMatchObject({ processed: 6, failed: 3, inserted: 3 });
      const errors = (result as IoProgress).errors;
      expect(errors.map((e) => e.index)).toEqual([2, 4, 6]);
      expect(errors.every((e) => e.error.code === 'INVALID_PARAMS')).toBe(true);
      expect(texts(server.inserts[0]?.documents ?? [])).toEqual([
        '{"_id":{"$numberInt":"1"}}',
        '{"_id":{"$numberInt":"4"}}',
        '{"_id":{"$numberInt":"6"}}',
      ]);
    });

    it('ordered: resubmits the rest of the batch after a refused document', async () => {
      const file = await fileWith('o.jsonl', '{"_id":1}\n{"_id":1}\n{"_id":2}\n{"_id":3}\n');
      const server = fakeServer((documents, ordered, call) =>
        call === 1 ? duplicateAt(documents, 1, ordered) : { n: documents.length, ok: 1 },
      );
      const { result, progress } = await runImport(server.client, file, 'jsonl', {
        stopOnError: false,
      });
      expect(server.inserts.map((i) => i.documents.length)).toEqual([4, 2]);
      expect(texts(server.inserts[1]?.documents ?? [])).toEqual([
        '{"_id":{"$numberInt":"2"}}',
        '{"_id":{"$numberInt":"3"}}',
      ]);
      expect(result).toMatchObject({ processed: 4, failed: 1, inserted: 3 });
      expect((result as IoProgress).errors.map((e) => e.index)).toEqual([2]);
      // One progress event per batch read from the file, not per resubmission.
      expect(progress).toHaveLength(1);
    });

    it('unordered: sends the batch once; every refused document is reported', async () => {
      const file = await fileWith('u.jsonl', '{"_id":1}\n{"_id":1}\n{"_id":2}\n{"_id":2}\n');
      const server = fakeServer(() => ({
        n: 2,
        writeErrors: [
          { index: 1, errmsg: 'dup 1' },
          { index: 3, errmsg: 'dup 2' },
        ],
        ok: 1,
      }));
      const { result } = await runImport(server.client, file, 'jsonl', {
        stopOnError: false,
        ordered: false,
      });
      expect(server.inserts).toHaveLength(1);
      expect(server.inserts[0]?.ordered).toBe(false);
      expect(result).toMatchObject({ processed: 4, failed: 2, inserted: 2 });
      expect((result as IoProgress).errors.map((e) => [e.index, e.error.message])).toEqual([
        [2, 'Line 2: dup 1'],
        [4, 'Line 4: dup 2'],
      ]);
    });

    it(`keeps only the first ${String(MAX_REPORTED_ERRORS)} errors but counts all`, async () => {
      const bad = MAX_REPORTED_ERRORS + 20;
      const file = await fileWith('bad.jsonl', `${'{"x": }\n'.repeat(bad)}{"ok":1}\n`);
      const server = fakeServer();
      const { result } = await runImport(server.client, file, 'jsonl', { stopOnError: false });
      expect(result).toMatchObject({ processed: bad + 1, failed: bad, inserted: 1 });
      const errors = (result as IoProgress).errors;
      expect(errors).toHaveLength(MAX_REPORTED_ERRORS);
      expect(errors.at(-1)?.index).toBe(MAX_REPORTED_ERRORS);
    });
  });

  it('a write concern error rejects with SERVER_ERROR', async () => {
    const file = await fileWith('wc.jsonl', '{"_id":1}\n');
    const server = fakeServer((documents) => ({
      n: documents.length,
      writeConcernError: { code: 64, errmsg: 'waiting for replication timed out' },
      ok: 1,
    }));
    const { result } = await runImport(server.client, file, 'jsonl', { stopOnError: false });
    expect(result).toMatchObject({ code: 'SERVER_ERROR' });
    expect((result as Error).message).toMatch(/not acknowledged.*waiting for replication/);
  });

  it.each([
    ['continue mode', { stopOnError: false }],
    ['stop mode', {}],
  ] as const)(
    'a broken JSON structure (%s) inserts the documents read before it, then rejects INVALID_PARAMS',
    async (_mode, options) => {
      // The last element has no , or ] after it, so the scanner never completes it.
      const file = await fileWith('broken.json', '[{"_id":1},\n{"_id":2},\n{"_id":3}');
      const server = fakeServer();
      const { result, progress } = await runImport(server.client, file, 'json', options);
      expect(result).toBeInstanceOf(RpcError);
      expect(result).toMatchObject({ code: 'INVALID_PARAMS' });
      expect((result as Error).message).toMatch(/^Line 3: the file ends before the closing \]/);
      expect(server.inserts.map((i) => texts(i.documents))).toEqual([
        ['{"_id":{"$numberInt":"1"}}', '{"_id":{"$numberInt":"2"}}'],
      ]);
      expect(progress).toEqual([{ processed: 2, failed: 0, errors: [] }]);
    },
  );

  it('a broken structure after a full batch keeps the flushed batch and the rest read before it', async () => {
    const lines = Array.from({ length: IMPORT_BATCH_DOCS + 2 }, (_, k) => `{"_id":${String(k)}}`);
    const file = await fileWith('broken-late.json', `[${lines.join(',\n')},\n}`);
    const server = fakeServer();
    const { result, progress } = await runImport(server.client, file, 'json', {
      stopOnError: false,
    });
    expect(result).toMatchObject({ code: 'INVALID_PARAMS' });
    expect((result as Error).message).toMatch(
      new RegExp(`^Line ${String(IMPORT_BATCH_DOCS + 3)}:`),
    );
    expect(server.inserts.map((i) => i.documents.length)).toEqual([IMPORT_BATCH_DOCS, 2]);
    expect(progress.at(-1)).toEqual({ processed: IMPORT_BATCH_DOCS + 2, failed: 0, errors: [] });
  });

  it('continue mode: a broken structure after a bad element keeps the skipped line in the report', async () => {
    const file = await fileWith('bad-broken.json', '[{"_id":1},\n42,\n{"_id":3},\n}');
    const server = fakeServer();
    const { result, progress } = await runImport(server.client, file, 'json', {
      stopOnError: false,
    });
    expect(result).toBeInstanceOf(RpcError);
    expect(result).toMatchObject({ code: 'INVALID_PARAMS' });
    expect((result as Error).message).toBe('Line 4: unexpected }');
    expect(server.inserts.map((i) => texts(i.documents))).toEqual([
      ['{"_id":{"$numberInt":"1"}}', '{"_id":{"$numberInt":"3"}}'],
    ]);
    expect(progress).toEqual([
      {
        processed: 3,
        failed: 1,
        errors: [
          { index: 2, error: { code: 'INVALID_PARAMS', message: 'Line 2: not a document' } },
        ],
      },
    ]);
  });

  it.each([
    [
      'documents one after another with a stray }',
      'seq.json',
      '{"_id":1}\n{"_id":2}\n}\n{"_id":4}\n',
      'Line 3: unexpected }',
    ],
    [
      'text after the closing ]',
      'trail.json',
      '[{"_id":1},\n{"_id":2}]\nmore',
      'Line 3: unexpected text after the closing ]',
    ],
  ])(
    'a broken structure (%s) inserts the documents before it, then rejects',
    async (_what, name, text, message) => {
      const file = await fileWith(name, text);
      const server = fakeServer();
      const { result, progress } = await runImport(server.client, file, 'json', {
        stopOnError: false,
      });
      expect(result).toBeInstanceOf(RpcError);
      expect(result).toMatchObject({ code: 'INVALID_PARAMS', message });
      expect(server.inserts.map((i) => texts(i.documents))).toEqual([
        ['{"_id":{"$numberInt":"1"}}', '{"_id":{"$numberInt":"2"}}'],
      ]);
      expect(progress).toEqual([{ processed: 2, failed: 0, errors: [] }]);
    },
  );

  it('a broken structure in a later read chunk inserts every document before it', async () => {
    // Far more than one 256 KiB read chunk: the broken point comes with a later chunk.
    const count = 30_000;
    const lines = Array.from({ length: count }, (_, k) => `{"_id":${String(k)}}`);
    const file = await fileWith('broken-big.json', `[\n${lines.join(',\n')},\n,\n]`);
    const server = fakeServer();
    const { result, progress } = await runImport(server.client, file, 'json');
    expect(result).toMatchObject({ code: 'INVALID_PARAMS' });
    expect((result as Error).message).toBe(`Line ${String(count + 2)}: missing value before ,`);
    const inserted = texts(server.inserts.flatMap((i) => i.documents));
    expect(inserted).toHaveLength(count);
    expect(inserted.at(-1)).toBe(`{"_id":{"$numberInt":"${String(count - 1)}"}}`);
    expect(progress.at(-1)).toEqual({ processed: count, failed: 0, errors: [] });
  });

  it('continue mode: a refused insert in the last batch before a broken structure is reported', async () => {
    const file = await fileWith('dup-broken-cont.json', '[{"_id":1},\n{"_id":1},\n{"_id":2},\n}');
    const server = fakeServer((documents, ordered, call) =>
      call === 1 ? duplicateAt(documents, 1, ordered) : { n: documents.length, ok: 1 },
    );
    const { result, progress } = await runImport(server.client, file, 'json', {
      stopOnError: false,
    });
    expect(result).toMatchObject({ code: 'INVALID_PARAMS', message: 'Line 4: unexpected }' });
    // Ordered: the rest after the refused document is sent again.
    expect(server.inserts.map((i) => i.documents.length)).toEqual([3, 1]);
    expect(progress).toEqual([
      {
        processed: 3,
        failed: 1,
        errors: [
          {
            index: 2,
            error: { code: 'SERVER_ERROR', message: 'Line 2: E11000 duplicate key error' },
          },
        ],
      },
    ]);
  });

  it('a failing final insert after a broken structure rejects with the server error', async () => {
    const file = await fileWith('wc-broken.json', '[{"_id":1},\n}');
    const server = fakeServer((documents) => ({
      n: documents.length,
      writeConcernError: { code: 64, errmsg: 'waiting for replication timed out' },
      ok: 1,
    }));
    const { result, progress } = await runImport(server.client, file, 'json');
    expect(result).toMatchObject({ code: 'SERVER_ERROR' });
    expect((result as Error).message).toMatch(/not acknowledged/);
    expect(server.inserts).toHaveLength(1);
    expect(progress).toEqual([]);
  });

  it('a stop before the broken structure wins (its line comes first)', async () => {
    const file = await fileWith('dup-broken.json', '[{"_id":1},\n{"_id":1},\n{"_id":2}');
    const server = fakeServer((documents, ordered) => duplicateAt(documents, 1, ordered));
    const { result } = await runImport(server.client, file, 'json');
    expect(result).toMatchObject({ code: 'SERVER_ERROR' });
    expect((result as Error).message).toMatch(/^Import stopped: Line 2: E11000/);
    expect(server.inserts).toHaveLength(1);
  });

  it('a cancel while reading does not write the documents of the unfinished batch', async () => {
    // About 1 500 documents per 256 KiB read chunk: the first batch fills inside the first
    // chunk, the cancel arrives just after its insert answered, and the next chunk read sees it.
    const pad = 'x'.repeat(150);
    const lines = Array.from({ length: 4000 }, (_, k) => `{"_id":${String(k)},"p":"${pad}"}`);
    const file = await fileWith('cancel.jsonl', `${lines.join('\n')}\n`);
    const controller = new AbortController();
    const server = fakeServer((documents) => {
      setImmediate(() => controller.abort());
      return { n: documents.length, ok: 1 };
    });
    const { result, progress } = await runImport(server.client, file, 'jsonl', {
      signal: controller.signal,
    });
    expect(result).toMatchObject({ code: 'CANCELLED' });
    expect(server.inserts.map((i) => i.documents.length)).toEqual([IMPORT_BATCH_DOCS]);
    // Only the progress of the written batch: no final flush, no final progress.
    expect(progress).toEqual([{ processed: IMPORT_BATCH_DOCS, failed: 0, errors: [] }]);
  });

  it('a file that no longer exists answers NOT_FOUND', async () => {
    const { result } = await runImport(fakeServer().client, path.join(dir, 'gone.jsonl'), 'jsonl');
    expect(result).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('an aborted signal cancels the import before anything is inserted', async () => {
    const file = await fileWith('c.jsonl', '{"_id":1}\n');
    const controller = new AbortController();
    controller.abort();
    const server = fakeServer();
    const { result } = await runImport(server.client, file, 'jsonl', {
      signal: controller.signal,
    });
    expect(result).toMatchObject({ code: 'CANCELLED' });
    expect(server.inserts).toEqual([]);
  });
});
