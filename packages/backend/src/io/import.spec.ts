import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { IoProgress } from '@thicket/contract';
import {
  BSON,
  Decimal128,
  Double,
  Int32,
  Long,
  ObjectId,
  ReadPreference,
  WriteConcern,
  type Document,
} from 'mongodb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ClientLike } from '../connections/manager';
import { RpcError } from '../server/rpc';
import {
  CSV_PREVIEW_ROWS,
  DEFAULT_SAMPLE_SIZE,
  IMPORT_BATCH_BYTES,
  IMPORT_BATCH_DOCS,
  MAX_REPORTED_ERRORS,
  importFile,
  parseImportedDocument,
  previewFile,
  scanFile,
  type ImportFormat,
  type ImportOptions,
} from './import';
import { MAX_VALUE_CHARS, type ScannedValue } from './scanner';

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

    it('a refused earlier line found when flushing wins over a later bad line', async () => {
      // Line 3 does not parse and stops reading; the pending batch (lines 1-2) is then written
      // and the server refuses line 2: the import stopped there, not at line 3.
      const file = await fileWith('dup-bad.jsonl', '{"_id":1}\n{"_id":1}\n{"bad": }\n{"_id":4}\n');
      const server = fakeServer((documents, ordered) => duplicateAt(documents, 1, ordered));
      const { result, progress } = await runImport(server.client, file, 'jsonl');
      expect(result).toBeInstanceOf(RpcError);
      expect(result).toMatchObject({ code: 'SERVER_ERROR' });
      expect((result as Error).message).toBe('Import stopped: Line 2: E11000 duplicate key error');
      expect(server.inserts.map((i) => i.documents.length)).toEqual([2]);
      expect(progress).toHaveLength(1);
      expect(progress[0]).toMatchObject({ processed: 3, failed: 2 });
      expect(progress[0]?.errors.map((e) => [e.index, e.error.code])).toEqual([
        [2, 'SERVER_ERROR'],
        [3, 'INVALID_PARAMS'],
      ]);
    });

    it('unordered: a refused earlier line found when flushing wins over a later bad line', async () => {
      // Line 5 does not parse and stops reading; the unordered batch (lines 1-4) is then written,
      // the server refuses line 2 and inserts the others: the import stopped at line 2.
      const file = await fileWith(
        'dup-bad-unordered.jsonl',
        '{"_id":1}\n{"_id":1}\n{"_id":3}\n{"_id":4}\n{"bad": }\n{"_id":6}\n',
      );
      const server = fakeServer((documents, ordered) => duplicateAt(documents, 1, ordered));
      const { result, progress } = await runImport(server.client, file, 'jsonl', {
        ordered: false,
      });
      expect(result).toBeInstanceOf(RpcError);
      expect(result).toMatchObject({ code: 'SERVER_ERROR' });
      expect((result as Error).message).toBe('Import stopped: Line 2: E11000 duplicate key error');
      // One unordered insert of the 4 lines read before the bad one; nothing is sent again.
      expect(server.inserts.map((i) => [i.documents.length, i.ordered])).toEqual([[4, false]]);
      expect(progress).toEqual([
        {
          processed: 5,
          failed: 2,
          errors: [
            {
              index: 2,
              error: { code: 'SERVER_ERROR', message: 'Line 2: E11000 duplicate key error' },
            },
            { index: 5, error: expect.objectContaining({ code: 'INVALID_PARAMS' }) },
          ],
        },
      ]);
    });

    it('a bad line after a refused line of an earlier flushed batch keeps the earlier stop', async () => {
      // The refusal at line 2 (in a full batch) stops reading at once: a later bad line is
      // never read, so it can neither replace the stop nor appear in the errors.
      const count = IMPORT_BATCH_DOCS;
      const lines = Array.from({ length: count }, (_, i) => `{"_id":${String(i)}}`);
      const file = await fileWith('dup-then-bad.jsonl', `${lines.join('\n')}\n{"bad": }\n`);
      const server = fakeServer((documents, ordered) => duplicateAt(documents, 1, ordered));
      const { result, progress } = await runImport(server.client, file, 'jsonl');
      expect((result as Error).message).toBe('Import stopped: Line 2: E11000 duplicate key error');
      expect(server.inserts).toHaveLength(1);
      expect(progress.at(-1)?.errors.map((e) => e.index)).toEqual([2]);
      expect(progress.at(-1)).toMatchObject({ processed: count, failed: 1 });
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

    it('reports errors in line order when a refused line comes before a bad one', async () => {
      const file = await fileWith('order.jsonl', '{"_id":1}\n{"_id":1}\n{"bad": }\n{"_id":4}\n');
      const server = fakeServer((documents, ordered, call) =>
        call === 1 ? duplicateAt(documents, 1, ordered) : { n: documents.length, ok: 1 },
      );
      const { result } = await runImport(server.client, file, 'jsonl', { stopOnError: false });
      expect(result).toMatchObject({ processed: 4, failed: 2, inserted: 2 });
      expect((result as IoProgress).errors.map((e) => e.index)).toEqual([2, 3]);
    });

    it(`keeps the first ${String(MAX_REPORTED_ERRORS)} lines when errors come out of order`, async () => {
      // Line 1 is refused by the server only after every bad line after it was read.
      const bad = MAX_REPORTED_ERRORS + 5;
      const file = await fileWith('late-dup.jsonl', `{"_id":1}\n${'{"x": }\n'.repeat(bad)}`);
      const server = fakeServer((documents, ordered) => duplicateAt(documents, 0, ordered));
      const { result } = await runImport(server.client, file, 'jsonl', { stopOnError: false });
      expect(result).toMatchObject({ processed: bad + 1, failed: bad + 1, inserted: 0 });
      const errors = (result as IoProgress).errors;
      expect(errors).toHaveLength(MAX_REPORTED_ERRORS);
      expect(errors.map((e) => e.index)).toEqual(
        Array.from({ length: MAX_REPORTED_ERRORS }, (_, k) => k + 1),
      );
      expect(errors[0]?.error.code).toBe('SERVER_ERROR');
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

  it.each([
    ['json', 'unclosed.json', '{"_id":1}\n{"s":"'],
    ['jsonl', 'minified.jsonl', '{"_id":1}\n[{"s":"'],
  ] as const)(
    'a %s value longer than MAX_VALUE_CHARS stops the import with INVALID_PARAMS naming its line',
    async (format, name, head) => {
      const file = await fileWith(name, `${head}${'x'.repeat(MAX_VALUE_CHARS + 1024)}`);
      const server = fakeServer();
      const { result, progress } = await runImport(server.client, file, format, {
        stopOnError: false,
      });
      expect(result).toBeInstanceOf(RpcError);
      expect(result).toMatchObject({ code: 'INVALID_PARAMS' });
      expect((result as Error).message).toMatch(/^Line 2: a value is longer than \d+ characters/);
      expect(server.inserts.map((i) => texts(i.documents))).toEqual([
        ['{"_id":{"$numberInt":"1"}}'],
      ]);
      expect(progress).toEqual([{ processed: 1, failed: 0, errors: [] }]);

      const preview = await previewFile(file, format).catch((e: unknown) => e);
      expect(preview).toBeInstanceOf(RpcError);
      expect(preview).toMatchObject({ code: 'INVALID_PARAMS' });
      expect((preview as Error).message).toMatch(/^Line 2: a value is longer than/);
    },
    60_000,
  );

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

  it('inserts carry the profile write concern and no read preference (raw-cmd-read-pref)', async () => {
    const file = await fileWith('wc.jsonl', '{"_id":1}\n{"_id":2}\n');
    const sent: { command: Document; readPreference: unknown }[] = [];
    const client: ClientLike = {
      connect: () => Promise.resolve(),
      close: () => Promise.resolve(),
      db: () => ({
        readPreference: ReadPreference.secondaryPreferred,
        writeConcern: new WriteConcern('majority'),
        command: (command, options) => {
          sent.push({ command, readPreference: options?.readPreference });
          const documents = command['documents'] as Document[] | undefined;
          return Promise.resolve({ n: documents?.length ?? 0, ok: 1 });
        },
      }),
    };
    const { result } = await runImport(client, file, 'jsonl');
    expect(result).toMatchObject({ inserted: 2, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.command['writeConcern']).toEqual({ w: 'majority' });
    expect(sent[0]?.readPreference).toBeUndefined();
  });
});

/**
 * A server for CSV and BSON imports: inserts answer `n`, listCollections answers `collections`,
 * `fail` may refuse any command. Records every command in order.
 */
function dumpServer(
  collections: Document[] = [],
  fail?: (cmd: Document) => Error | Document | undefined,
) {
  const sent: Document[] = [];
  const client: ClientLike = {
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: () => ({
      command: (cmd) => {
        sent.push(cmd);
        const custom = fail?.(cmd);
        if (custom instanceof Error) return Promise.reject(custom);
        if (custom) return Promise.resolve(custom);
        if ('listCollections' in cmd) {
          return Promise.resolve({
            cursor: { id: 0, ns: 'shop.$cmd.listCollections', firstBatch: collections },
            ok: 1,
          });
        }
        if ('insert' in cmd) {
          return Promise.resolve({ n: (cmd['documents'] as unknown[]).length, ok: 1 });
        }
        return Promise.resolve({ ok: 1 });
      },
    }),
  };
  const names = () => sent.map((c) => Object.keys(c)[0]);
  const inserted = () =>
    sent.filter((c) => 'insert' in c).flatMap((c) => texts(c['documents'] as Document[]));
  return { client, sent, names, inserted };
}

async function importAs(
  client: ClientLike,
  file: string,
  format: ImportFormat,
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

describe('CSV import', () => {
  const CSV =
    'sku,name,qty,price,city,added\n' +
    'A-1,"Widget, large",3,9.5,Springfield,2024-02-03T00:00:00Z\n' +
    'A-2,"Gadget ""mini""",,10,"Shelby-\nville",\n';

  describe('previewFile', () => {
    it('gives the header, the cells of the first rows and a sample with the default mapping', async () => {
      const file = await fileWith('p.csv', CSV);
      expect(await previewFile(file, 'csv', 5)).toEqual({
        sizeBytes: Buffer.byteLength(CSV),
        csvColumns: ['sku', 'name', 'qty', 'price', 'city', 'added'],
        csvRows: [
          ['A-1', 'Widget, large', '3', '9.5', 'Springfield', '2024-02-03T00:00:00Z'],
          ['A-2', 'Gadget "mini"', '', '10', 'Shelby-\nville', ''],
        ],
        sample: [
          '{"sku":"A-1","name":"Widget, large","qty":{"$numberInt":"3"},' +
            '"price":{"$numberDouble":"9.5"},"city":"Springfield","added":"2024-02-03T00:00:00Z"}',
          '{"sku":"A-2","name":"Gadget \\"mini\\"","price":{"$numberInt":"10"},' +
            '"city":"Shelby-\\nville"}',
        ],
      });
    });

    it(`shows at most ${String(CSV_PREVIEW_ROWS)} rows and sampleSize documents`, async () => {
      const rows = Array.from({ length: CSV_PREVIEW_ROWS + 10 }, (_, i) => `${String(i)}\n`);
      const file = await fileWith('many.csv', `n\n${rows.join('')}`);
      const preview = await previewFile(file, 'csv', 3);
      expect(preview.csvRows).toHaveLength(CSV_PREVIEW_ROWS);
      expect(preview.csvRows?.at(-1)).toEqual([String(CSV_PREVIEW_ROWS - 1)]);
      expect(preview.sample).toEqual([
        '{"n":{"$numberInt":"0"}}',
        '{"n":{"$numberInt":"1"}}',
        '{"n":{"$numberInt":"2"}}',
      ]);
    });

    it(`reads on for a sampleSize above ${String(CSV_PREVIEW_ROWS)} rows, keeping the rows capped`, async () => {
      const rows = Array.from({ length: CSV_PREVIEW_ROWS + 10 }, (_, i) => `${String(i)}\n`);
      const file = await fileWith('big-sample.csv', `n\n${rows.join('')}`);
      const preview = await previewFile(file, 'csv', CSV_PREVIEW_ROWS + 5);
      expect(preview.csvRows).toHaveLength(CSV_PREVIEW_ROWS);
      expect(preview.sample).toHaveLength(CSV_PREVIEW_ROWS + 5);
      expect(preview.sample.at(-1)).toBe(`{"n":{"$numberInt":"${String(CSV_PREVIEW_ROWS + 4)}"}}`);
    });

    it('keeps the cells of a row that does not parse but leaves it out of the sample', async () => {
      const file = await fileWith('long.csv', 'a,b\n1,2,3\n4,5\n');
      const preview = await previewFile(file, 'csv');
      expect(preview.csvRows).toEqual([
        ['1', '2', '3'],
        ['4', '5'],
      ]);
      expect(preview.sample).toEqual(['{"a":{"$numberInt":"4"},"b":{"$numberInt":"5"}}']);
    });

    it('an empty file has no columns, rows or sample', async () => {
      const file = await fileWith('empty.csv', '');
      expect(await previewFile(file, 'csv')).toEqual({
        sizeBytes: 0,
        csvColumns: [],
        csvRows: [],
        sample: [],
      });
    });

    it('a header-only file has its columns and no rows', async () => {
      const file = await fileWith('header.csv', '﻿a,b\r\n');
      expect(await previewFile(file, 'csv')).toMatchObject({
        csvColumns: ['a', 'b'],
        csvRows: [],
        sample: [],
      });
    });

    it('answers INVALID_PARAMS for a broken file before any row', async () => {
      const file = await fileWith('broken.csv', 'a,b\n"open,1\n');
      await expect(previewFile(file, 'csv')).rejects.toMatchObject({
        code: 'INVALID_PARAMS',
        message: 'Line 2: the file ends inside a quoted cell',
      });
    });

    it('answers NOT_FOUND for a file that no longer exists', async () => {
      await expect(previewFile(path.join(dir, 'gone.csv'), 'csv')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    // The column mapping is chosen after the preview, so the preview must not refuse a header
    // whose names are no valid default mapping: repeated names, a name ending in a dot, or names
    // where one is the prefix path of another.
    it.each([
      ['a repeated column name', 'name,qty,name\nWidget,3,Gadget\n', ['name', 'qty', 'name']],
      ['a column name ending in a dot', 'No.,name\n1,Widget\n', ['No.', 'name']],
      ['overlapping column names', 'address,address.city\nX,Y\n', ['address', 'address.city']],
    ])('previews a file with %s (the mapping is chosen later)', async (_what, text, columns) => {
      const file = await fileWith('header-names.csv', text);
      const preview = await previewFile(file, 'csv');
      expect(preview.csvColumns).toEqual(columns);
      expect(preview.csvRows).toHaveLength(1);
    });

    it('builds the sample of a repeated or overlapping header from the first column only', async () => {
      const file = await fileWith(
        'mixed-preview.csv',
        'name,qty,name,address,address.city,No.\nWidget,3,Gadget,Main St,Springfield,7\n',
      );
      const preview = await previewFile(file, 'csv');
      expect(preview.csvRows).toEqual([['Widget', '3', 'Gadget', 'Main St', 'Springfield', '7']]);
      expect(preview.sample).toEqual([
        '{"name":"Widget","qty":{"$numberInt":"3"},"address":"Main St"}',
      ]);
    });
  });

  describe('importFile', () => {
    it('imports every named column as auto without a mapping', async () => {
      const file = await fileWith('auto.csv', 'sku,,qty\nA-1,skipped,3\n');
      const server = dumpServer();
      const { result, progress } = await importAs(server.client, file, 'csv');
      expect(result).toEqual({ processed: 1, failed: 0, errors: [], inserted: 1 });
      expect(server.inserted()).toEqual(['{"sku":"A-1","qty":{"$numberInt":"3"}}']);
      expect(progress.at(-1)).toEqual({ processed: 1, failed: 0, errors: [] });
    });

    it('imports the mapped columns under their paths with their types, others left out', async () => {
      const file = await fileWith('typed.csv', CSV);
      const server = dumpServer();
      const { result } = await importAs(server.client, file, 'csv', {
        csvMapping: [
          { column: 'sku', path: '_id', bsonType: 'string' },
          { column: 'qty', path: 'stock.qty', bsonType: 'long' },
          { column: 'price', path: 'price', bsonType: 'decimal' },
          { column: 'city', path: 'stock.city', bsonType: 'string' },
          { column: 'added', path: 'added', bsonType: 'date' },
        ],
      });
      expect(result).toEqual({ processed: 2, failed: 0, errors: [], inserted: 2 });
      expect(server.inserted()).toEqual([
        '{"_id":"A-1","stock":{"qty":{"$numberLong":"3"},"city":"Springfield"},' +
          '"price":{"$numberDecimal":"9.5"},"added":{"$date":{"$numberLong":"1706918400000"}}}',
        // qty is blank: stock is first made for city, after price.
        '{"_id":"A-2","price":{"$numberDecimal":"10"},"stock":{"city":"Shelby-\\nville"}}',
      ]);
      // No metadata or collection commands for CSV.
      expect(server.names()).toEqual(['insert']);
    });

    it('without a mapping leaves out a repeated or overlapping column (like the preview)', async () => {
      // A Thicket export of documents with mixed shapes: `a` and `a.b` are both columns.
      const file = await fileWith('mixed.csv', 'a,a.b,a,n\n1,,9,x\n,2,,y\n');
      const server = dumpServer();
      const { result } = await importAs(server.client, file, 'csv');
      expect(result).toEqual({ processed: 2, failed: 0, errors: [], inserted: 2 });
      expect(server.inserted()).toEqual(['{"a":{"$numberInt":"1"},"n":"x"}', '{"n":"y"}']);
    });

    it('imports the chosen one of two columns with the same name by its index', async () => {
      const file = await fileWith('repeated.csv', 'name,qty,name\nfirst,3,second\n');
      const server = dumpServer();
      const { result } = await importAs(server.client, file, 'csv', {
        csvMapping: [{ column: 'name', index: 2, path: 'name', bsonType: 'string' }],
      });
      expect(result).toEqual({ processed: 1, failed: 0, errors: [], inserted: 1 });
      expect(server.inserted()).toEqual(['{"name":"second"}']);
    });

    it('refuses a repeated column named without its index before inserting anything', async () => {
      const file = await fileWith('repeated.csv', 'name,qty,name\nfirst,3,second\n');
      const server = dumpServer();
      const { result } = await importAs(server.client, file, 'csv', {
        csvMapping: [{ column: 'name', path: 'name', bsonType: 'string' }],
      });
      expect(result).toMatchObject({
        code: 'INVALID_PARAMS',
        message: 'The file has more than one column "name": choose one by its index',
      });
      expect(server.names()).toEqual([]);
    });

    it('refuses an index that does not hold the named column before inserting anything', async () => {
      const file = await fileWith('shifted.csv', 'name,qty,name\nfirst,3,second\n');
      const server = dumpServer();
      const { result } = await importAs(server.client, file, 'csv', {
        csvMapping: [{ column: 'name', index: 1, path: 'name', bsonType: 'string' }],
      });
      expect(result).toMatchObject({
        code: 'INVALID_PARAMS',
        message: 'The file has no column "name" at index 1',
      });
      expect(server.names()).toEqual([]);
    });

    it('refuses a mapping naming a column the file lacks before inserting anything', async () => {
      const file = await fileWith('m.csv', 'a,b\n1,2\n');
      const server = dumpServer();
      const { result } = await importAs(server.client, file, 'csv', {
        csvMapping: [{ column: 'c', path: 'c', bsonType: 'auto' }],
      });
      expect(result).toBeInstanceOf(RpcError);
      expect(result).toMatchObject({
        code: 'INVALID_PARAMS',
        message: 'The file has no column "c"',
      });
      expect(server.names()).toEqual([]);
    });

    it('stop mode: inserts the rows before a bad cell, then rejects naming line and column', async () => {
      // The quoted line break makes the bad row start on line 4.
      const file = await fileWith('stop.csv', 'n,note\n1,"two\nlines"\nx,ok\n3,ok\n');
      const server = dumpServer();
      const { result, progress } = await importAs(server.client, file, 'csv', {
        csvMapping: [{ column: 'n', path: 'n', bsonType: 'int' }],
      });
      expect(result).toBeInstanceOf(RpcError);
      expect((result as Error).message).toBe(
        'Import stopped: Line 4: column "n": "x" is not a 32-bit integer',
      );
      expect(server.inserted()).toEqual(['{"n":{"$numberInt":"1"}}']);
      expect(progress.at(-1)).toMatchObject({ processed: 2, failed: 1, errors: [{ index: 4 }] });
    });

    it('continue mode: skips bad rows (bad cells, too many cells) and reports their lines', async () => {
      const file = await fileWith('go-on.csv', 'n\n1\nx\n2,extra\n3\n');
      const server = dumpServer();
      const { result } = await importAs(server.client, file, 'csv', {
        stopOnError: false,
        csvMapping: [{ column: 'n', path: 'n', bsonType: 'int' }],
      });
      expect(result).toMatchObject({ processed: 4, failed: 2, inserted: 2 });
      expect((result as { errors: { index: number }[] }).errors.map((e) => e.index)).toEqual([
        3, 4,
      ]);
      expect(server.inserted()).toEqual(['{"n":{"$numberInt":"1"}}', '{"n":{"$numberInt":"3"}}']);
    });

    it('a broken structure inserts the rows before it and rejects with INVALID_PARAMS', async () => {
      const file = await fileWith('broken.csv', 'a\n1\n2\n"3"x\n4\n');
      const server = dumpServer();
      const { result } = await importAs(server.client, file, 'csv', { stopOnError: false });
      expect(result).toMatchObject({
        code: 'INVALID_PARAMS',
        message: 'Line 4: text after a closing quote',
      });
      expect(server.inserted()).toEqual(['{"a":{"$numberInt":"1"}}', '{"a":{"$numberInt":"2"}}']);
    });

    it('an aborted signal cancels the import before any row is inserted', async () => {
      const file = await fileWith('cancel.csv', 'n\n1\n2\n');
      const controller = new AbortController();
      controller.abort();
      const server = dumpServer();
      const { result } = await importAs(server.client, file, 'csv', {
        signal: controller.signal,
      });
      expect(result).toMatchObject({ code: 'CANCELLED' });
      expect(server.names()).toEqual([]);
    });

    it('an empty CSV file imports nothing, also with a mapping', async () => {
      const file = await fileWith('empty.csv', '');
      const server = dumpServer();
      const { result } = await importAs(server.client, file, 'csv', {
        csvMapping: [{ column: 'a', path: 'a', bsonType: 'auto' }],
      });
      expect(result).toEqual({ processed: 0, failed: 0, errors: [], inserted: 0 });
      expect(server.names()).toEqual([]);
    });
  });
});

describe('BSON import', () => {
  const DOCS = [
    { _id: new Int32(1), sku: 'A-1', n: Long.fromNumber(3) },
    { _id: new Int32(2), at: new Date(Date.UTC(2024, 0, 1)), price: Decimal128.fromString('1.10') },
    { _id: new ObjectId('64b7f0c2a1b2c3d4e5f60718') },
  ];
  const dumpBytes = (docs: Document[] = DOCS) => Buffer.concat(docs.map((d) => BSON.serialize(d)));
  const METADATA =
    '{"options":{"capped":true,"size":{"$numberInt":"4096"},"uuid":"ignored"},' +
    '"indexes":[{"v":{"$numberInt":"2"},"key":{"_id":{"$numberInt":"1"}},"name":"_id_"},' +
    '{"v":{"$numberInt":"2"},"key":{"sku":{"$numberInt":"1"}},"name":"sku_1","unique":true}],' +
    '"uuid":"0123456789abcdef0123456789abcdef","collectionName":"orders","type":"collection"}\n';

  async function dump(name: string, bytes: Buffer, metadata?: string): Promise<string> {
    const file = path.join(dir, name);
    await writeFile(file, bytes);
    if (metadata !== undefined) {
      await writeFile(path.join(dir, `${name.replace(/\.bson$/i, '')}.metadata.json`), metadata);
    }
    return file;
  }

  describe('previewFile', () => {
    it('gives the first documents with exact types and the metadata file name', async () => {
      const bytes = dumpBytes();
      const file = await dump('orders.bson', bytes, METADATA);
      expect(await previewFile(file, 'bson', 2)).toEqual({
        sizeBytes: bytes.length,
        sample: DOCS.slice(0, 2).map((d) => BSON.EJSON.stringify(d, { relaxed: false })),
        metadataFile: 'orders.metadata.json',
      });
    });

    it('has no metadataFile without a metadata file next to it', async () => {
      const file = await dump('orders.bson', dumpBytes());
      const preview = await previewFile(file, 'bson');
      expect(preview).not.toHaveProperty('metadataFile');
      expect(preview.sample).toHaveLength(3);
    });

    it('answers INVALID_PARAMS for an invalid metadata file', async () => {
      const file = await dump('orders.bson', dumpBytes(), '{"options":');
      await expect(previewFile(file, 'bson')).rejects.toMatchObject({
        code: 'INVALID_PARAMS',
        message: 'orders.metadata.json is not a valid metadata file',
      });
    });

    it('answers INVALID_PARAMS for a file that is no BSON dump', async () => {
      const file = await dump('text.bson', Buffer.from('{"a":1}\n'));
      await expect(previewFile(file, 'bson')).rejects.toMatchObject({
        code: 'INVALID_PARAMS',
        message: expect.stringMatching(/^Line 1: document 1 has an invalid length/) as string,
      });
    });

    it('skips a document whose bytes are no valid BSON', async () => {
      const bad = BSON.serialize({ s: 'x' });
      bad[bad.length - 1] = 9;
      const file = await dump('bad.bson', Buffer.concat([bad, BSON.serialize({ ok: true })]));
      expect((await previewFile(file, 'bson')).sample).toEqual(['{"ok":true}']);
    });
  });

  describe('importFile', () => {
    it('an aborted signal cancels the import before any document is inserted', async () => {
      const file = await dump('cancel.bson', dumpBytes());
      const controller = new AbortController();
      controller.abort();
      const server = dumpServer();
      const { result } = await importAs(server.client, file, 'bson', {
        signal: controller.signal,
      });
      expect(result).toMatchObject({ code: 'CANCELLED' });
      expect(server.names()).toEqual([]);
    });

    it('without metadata inserts the documents exactly as dumped and nothing else', async () => {
      const file = await dump('orders.bson', dumpBytes());
      const server = dumpServer();
      const { result } = await importAs(server.client, file, 'bson');
      expect(result).toEqual({ processed: 3, failed: 0, errors: [], inserted: 3 });
      expect(server.names()).toEqual(['insert']);
      expect(server.inserted()).toEqual(
        DOCS.map((d) => BSON.EJSON.stringify(d, { relaxed: false })),
      );
    });

    it('with metadata creates a new collection with its options, then the documents, then the indexes', async () => {
      const file = await dump('orders.bson', dumpBytes(), METADATA);
      const server = dumpServer([]);
      const { result } = await importAs(server.client, file, 'bson');
      expect(result).toMatchObject({ inserted: 3, failed: 0 });
      expect(server.names()).toEqual(['listCollections', 'create', 'insert', 'createIndexes']);
      const create = server.sent[1] ?? {};
      expect(create).toMatchObject({ create: 'orders', capped: true, size: new Int32(4096) });
      expect(create).not.toHaveProperty('uuid');
      expect(server.sent[3]).toMatchObject({
        createIndexes: 'orders',
        indexes: [{ key: { sku: new Int32(1) }, name: 'sku_1', unique: true }],
      });
    });

    it('an existing collection keeps its options; the indexes are still created', async () => {
      const file = await dump('orders.bson', dumpBytes(), METADATA);
      const server = dumpServer([{ name: 'orders', type: 'collection' }]);
      await importAs(server.client, file, 'bson');
      expect(server.names()).toEqual(['listCollections', 'insert', 'createIndexes']);
    });

    it('continue mode: reports a failed document by its number, then creates the indexes', async () => {
      const bad = BSON.serialize({ s: 'x' });
      bad[bad.length - 1] = 9;
      const bytes = Buffer.concat([BSON.serialize({ _id: 1 }), bad, BSON.serialize({ _id: 3 })]);
      const file = await dump('orders.bson', bytes, METADATA);
      const server = dumpServer([{ name: 'orders' }]);
      const { result } = await importAs(server.client, file, 'bson', { stopOnError: false });
      expect(result).toMatchObject({ processed: 3, failed: 1, inserted: 2 });
      const errors = (result as { errors: { index: number; error: { message: string } }[] }).errors;
      expect(errors).toHaveLength(1);
      expect(errors[0]?.index).toBe(2);
      expect(errors[0]?.error.message).toMatch(/^Document 2: not valid BSON/);
      expect(server.names().at(-1)).toBe('createIndexes');
    });

    it('stop mode: a failed document stops the import and no indexes are created', async () => {
      const file = await dump('orders.bson', dumpBytes(), METADATA);
      const server = dumpServer([{ name: 'orders' }], (cmd) =>
        'insert' in cmd
          ? {
              n: 1,
              writeErrors: [{ index: 1, code: 11000, errmsg: 'E11000 duplicate key error' }],
              ok: 1,
            }
          : undefined,
      );
      const { result } = await importAs(server.client, file, 'bson');
      expect(result).toBeInstanceOf(RpcError);
      expect((result as Error).message).toMatch(/^Import stopped: Line 2: E11000/);
      expect(server.names()).not.toContain('createIndexes');
    });

    it('a cut-off dump inserts the documents before the cut, rejects, and creates no indexes', async () => {
      const bytes = dumpBytes();
      const file = await dump('orders.bson', bytes.subarray(0, bytes.length - 3), METADATA);
      const server = dumpServer([{ name: 'orders' }]);
      const { result } = await importAs(server.client, file, 'bson', { stopOnError: false });
      expect(result).toMatchObject({
        code: 'INVALID_PARAMS',
        message: 'Line 3: the file ends inside a document (was it cut off?)',
      });
      expect(server.inserted()).toHaveLength(2);
      expect(server.names()).not.toContain('createIndexes');
    });

    it('an invalid metadata file is refused before anything is written', async () => {
      const file = await dump('orders.bson', dumpBytes(), '[]');
      const server = dumpServer();
      const { result } = await importAs(server.client, file, 'bson');
      expect(result).toMatchObject({
        code: 'INVALID_PARAMS',
        message: 'orders.metadata.json is not a valid metadata file',
      });
      expect(server.sent).toEqual([]);
    });

    it('a failed create stops before any document is inserted', async () => {
      const file = await dump('orders.bson', dumpBytes(), METADATA);
      const server = dumpServer([], (cmd) =>
        'create' in cmd ? new Error('not authorized to create') : undefined,
      );
      const { result } = await importAs(server.client, file, 'bson');
      expect(result).toMatchObject({ code: 'SERVER_ERROR' });
      expect((result as Error).message).toMatch(/^Could not create orders with the dump's options/);
      expect(server.names()).not.toContain('insert');
    });

    it('a failed index build is a SERVER_ERROR after the documents were inserted', async () => {
      const file = await dump('orders.bson', dumpBytes(), METADATA);
      const server = dumpServer([{ name: 'orders' }], (cmd) =>
        'createIndexes' in cmd ? new Error('E11000 duplicate key on sku') : undefined,
      );
      const { result } = await importAs(server.client, file, 'bson');
      expect(result).toMatchObject({ code: 'SERVER_ERROR' });
      expect((result as Error).message).toMatch(/^The documents were imported, but/);
      expect(server.inserted()).toHaveLength(3);
    });
  });
});
