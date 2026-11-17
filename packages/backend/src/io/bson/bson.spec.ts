import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BSON, Binary, Int32, Long, type Document } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ClientLike } from '../../connections/manager';
import { Operation } from '../../docs/query/query';
import { RpcError } from '../../server/rpc';
import { ScanError } from '../scanner';
import {
  BsonScanner,
  MAX_DOC_BYTES,
  collectionMetadata,
  createDumpIndexes,
  createWithOptions,
  metadataPath,
  parseDumpedDocument,
  readMetadata,
  stringifyMetadata,
  type DumpedDocument,
} from './bson';

const UUID_HEX = '0123456789abcdef0123456789abcdef';

const bytesOf = (...docs: Document[]) => Buffer.concat(docs.map((d) => BSON.serialize(d)));

function scanChunks(chunks: Buffer[]): DumpedDocument[] {
  const scanner = new BsonScanner();
  const out: DumpedDocument[] = [];
  for (const chunk of chunks) out.push(...scanner.feed(chunk));
  out.push(...scanner.end());
  return out;
}

const decoded = (docs: DumpedDocument[]) =>
  docs.map((d) => BSON.EJSON.stringify(parseDumpedDocument(d), { relaxed: false }));

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('BsonScanner', () => {
  const docs = [
    { _id: new Int32(1), name: 'Widget' },
    {},
    { _id: new Int32(3), n: Long.fromNumber(5), tags: ['a', 'b'], pad: 'x'.repeat(300) },
  ];
  const file = bytesOf(...docs);

  it('splits a dump into documents numbered from 1', () => {
    const out = scanChunks([file]);
    expect(out.map((d) => d.line)).toEqual([1, 2, 3]);
    expect(out.map((d) => d.bytes.length)).toEqual(docs.map((d) => BSON.serialize(d).length));
    expect(decoded(out)).toEqual(docs.map((d) => BSON.EJSON.stringify(d, { relaxed: false })));
  });

  it('an empty file has no documents', () => {
    expect(scanChunks([])).toEqual([]);
    expect(scanChunks([Buffer.alloc(0)])).toEqual([]);
  });

  it('gives the same documents wherever the file is cut into two chunks', () => {
    const whole = decoded(scanChunks([file]));
    for (let at = 0; at <= file.length; at++) {
      const out = scanChunks([file.subarray(0, at), file.subarray(at)]);
      expect(decoded(out), `cut at ${String(at)}`).toEqual(whole);
      expect(out.map((d) => d.line)).toEqual([1, 2, 3]);
    }
  });

  it('gives the same documents when fed one byte at a time', () => {
    const chunks = Array.from({ length: file.length }, (_, i) => file.subarray(i, i + 1));
    expect(decoded(scanChunks(chunks))).toEqual(decoded(scanChunks([file])));
  });

  it('returns copies that do not share the read chunk', () => {
    const chunk = Buffer.from(file);
    const [first] = new BsonScanner().feed(chunk);
    chunk.fill(0);
    expect(decoded(first ? [first] : [])).toEqual([
      BSON.EJSON.stringify(docs[0], { relaxed: false }),
    ]);
  });

  it.each([
    ['below 5 bytes', 4],
    ['zero', 0],
    ['negative', -1],
    ['above MAX_DOC_BYTES', MAX_DOC_BYTES + 1],
  ])('refuses a length %s, naming the document', (_what, size) => {
    const head = Buffer.alloc(8);
    head.writeInt32LE(size, 0);
    const error = thrown(() => new BsonScanner().feed(Buffer.concat([bytesOf({ a: 1 }), head])));
    // The document before the broken one comes out first; the error follows on the next call.
    expect(error).toBeUndefined();
    const scanner = new BsonScanner();
    expect(scanner.feed(Buffer.concat([bytesOf({ a: 1 }), head]))).toHaveLength(1);
    const later = thrown(() => scanner.end());
    expect(later).toBeInstanceOf(ScanError);
    expect((later as ScanError).line).toBe(2);
    expect((later as Error).message).toBe(
      `Line 2: document 2 has an invalid length ${String(size)} (is the file a BSON dump?)`,
    );
  });

  it('accepts lengths of exactly 5 bytes and exactly MAX_DOC_BYTES', () => {
    expect(scanChunks([bytesOf({})])).toHaveLength(1);
    const big = Buffer.alloc(MAX_DOC_BYTES);
    big.writeInt32LE(MAX_DOC_BYTES, 0);
    const scanner = new BsonScanner();
    expect(scanner.feed(big).map((d) => d.bytes.length)).toEqual([MAX_DOC_BYTES]);
  });

  it('throws at once for a file that is no dump (text)', () => {
    expect(() => new BsonScanner().feed(Buffer.from('{"a":1}\n'))).toThrow(ScanError);
  });

  it('a broken scanner keeps failing', () => {
    const scanner = new BsonScanner();
    expect(() => scanner.feed(Buffer.from('not bson'))).toThrow(ScanError);
    const head = Buffer.alloc(4);
    head.writeInt32LE(1, 0);
    const second = new BsonScanner();
    second.feed(Buffer.concat([bytesOf({ a: 1 }), head]));
    expect(() => second.feed(bytesOf({ b: 2 }))).toThrow(/invalid length/);
  });

  it.each([
    ['inside the length', 2],
    ['after the length', 6],
    ['one byte short', -1],
  ])('refuses a file cut off %s', (_what, cut) => {
    const two = bytesOf({ a: 1 }, { b: 'text' });
    const first = BSON.serialize({ a: 1 }).length;
    const end = cut < 0 ? two.length + cut : first + cut;
    const scanner = new BsonScanner();
    expect(scanner.feed(two.subarray(0, end))).toHaveLength(1);
    const error = thrown(() => scanner.end());
    expect(error).toBeInstanceOf(ScanError);
    expect((error as Error).message).toBe(
      'Line 2: the file ends inside a document (was it cut off?)',
    );
  });
});

describe('parseDumpedDocument', () => {
  it('keeps every BSON type (no promotion to JS numbers or buffers)', () => {
    const doc = parseDumpedDocument({
      bytes: BSON.serialize({
        i: new Int32(1),
        l: Long.fromNumber(2),
        b: new Binary(new Uint8Array([1])),
        r: new BSON.BSONRegExp('^a', 'i'),
      }),
      line: 1,
    });
    expect(doc['i']).toBeInstanceOf(Int32);
    expect(doc['l']).toBeInstanceOf(Long);
    expect(doc['b']).toBeInstanceOf(Binary);
    expect(doc['r']).toBeInstanceOf(BSON.BSONRegExp);
  });

  it('refuses bytes that are no valid BSON, naming the document number', () => {
    const bytes = BSON.serialize({ s: 'text' });
    bytes[bytes.length - 1] = 7; // the terminating zero is gone
    const error = thrown(() => parseDumpedDocument({ bytes, line: 4 }));
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: 'INVALID_PARAMS' });
    expect((error as Error).message).toMatch(/^Document 4: not valid BSON: /);
  });
});

describe('metadataPath', () => {
  it.each([
    ['/dumps/shop/orders.bson', '/dumps/shop/orders.metadata.json'],
    ['/dumps/shop/orders.BSON', '/dumps/shop/orders.metadata.json'],
    ['/dumps/orders.v2.bson', '/dumps/orders.v2.metadata.json'],
    ['/dumps/orders', '/dumps/orders.metadata.json'],
    ['/dumps/orders.dat', '/dumps/orders.dat.metadata.json'],
    ['orders.bson', 'orders.metadata.json'],
  ])('%s -> %s', (file, expected) => {
    // Only the test was wrong on Windows: the product returns a native path there (`\dumps\...`),
    // which is right for the file system, so compare against the native form of the expectation.
    expect(metadataPath(file)).toBe(path.normalize(expected));
  });
});

/** A fake server: cursor commands answer `cursors[name]`, everything else `{ok: 1}`. */
function fakeServer(
  answers: { collections?: Document[]; indexes?: Document[] } = {},
  fail?: (cmd: Document) => Error | undefined,
) {
  const sent: Document[] = [];
  const reply = (batch: Document[]) => ({
    cursor: { id: 0, ns: 'shop.$cmd', firstBatch: batch },
    ok: 1,
  });
  const client: ClientLike = {
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: () => ({
      command: (cmd) => {
        sent.push(cmd);
        const error = fail?.(cmd);
        if (error) return Promise.reject(error);
        if ('listCollections' in cmd) return Promise.resolve(reply(answers.collections ?? []));
        if ('listIndexes' in cmd) return Promise.resolve(reply(answers.indexes ?? []));
        return Promise.resolve({ ok: 1 });
      },
    }),
  };
  return { client, sent };
}

describe('collectionMetadata', () => {
  const info = {
    name: 'orders',
    type: 'collection',
    options: { validator: { qty: { $gte: 0 } }, collation: { locale: 'en' } },
    info: { readOnly: false, uuid: new Binary(Buffer.from(UUID_HEX, 'hex'), 4) },
  };
  const indexes = [
    { v: 2, key: { _id: 1 }, name: '_id_' },
    { v: 2, key: { sku: 1 }, name: 'sku_1', unique: true, ns: 'shop.orders' },
  ];

  it('holds the options, the index specs without ns and the uuid as hex', async () => {
    const server = fakeServer({ collections: [info], indexes });
    const metadata = await collectionMetadata(server.client, 'shop', 'orders', true);
    expect(metadata).toEqual({
      options: info.options,
      indexes: [
        { v: 2, key: { _id: 1 }, name: '_id_' },
        { v: 2, key: { sku: 1 }, name: 'sku_1', unique: true },
      ],
      uuid: UUID_HEX,
      collectionName: 'orders',
      type: 'collection',
    });
    expect(server.sent[0]).toMatchObject({ listCollections: 1, filter: { name: 'orders' } });
    expect(server.sent.find((c) => 'listIndexes' in c)).toMatchObject({ listIndexes: 'orders' });
  });

  it('without indexes (an aggregation export) asks the server nothing', async () => {
    const server = fakeServer({ collections: [info], indexes });
    expect(await collectionMetadata(server.client, 'shop', 'orders', false)).toEqual({
      options: {},
      indexes: [],
      collectionName: 'orders',
      type: 'collection',
    });
    expect(server.sent).toEqual([]);
  });

  it.each([
    ['a view', [{ name: 'orders', type: 'view', options: { viewOn: 'x', pipeline: [] } }]],
    ['a time series collection', [{ name: 'orders', type: 'timeseries', options: {} }]],
    ['a missing collection', []],
  ])('dumps %s as a plain collection without options or indexes', async (_what, collections) => {
    const server = fakeServer({ collections, indexes });
    expect(await collectionMetadata(server.client, 'shop', 'orders', true)).toEqual({
      options: {},
      indexes: [],
      collectionName: 'orders',
      type: 'collection',
    });
    expect(server.sent.some((c) => 'listIndexes' in c)).toBe(false);
  });

  it('a collection without type, options or uuid (older servers) still gets its indexes', async () => {
    const server = fakeServer({ collections: [{ name: 'orders' }], indexes: [indexes[0] ?? {}] });
    expect(await collectionMetadata(server.client, 'shop', 'orders', true)).toEqual({
      options: {},
      indexes: [{ v: 2, key: { _id: 1 }, name: '_id_' }],
      collectionName: 'orders',
      type: 'collection',
    });
  });
});

describe('stringifyMetadata', () => {
  it('writes one line of canonical Extended JSON', () => {
    const text = stringifyMetadata({
      options: { capped: true, size: new Int32(4096) },
      indexes: [{ v: new Int32(2), key: { _id: new Int32(1) }, name: '_id_' }],
      uuid: UUID_HEX,
      collectionName: 'orders',
      type: 'collection',
    });
    expect(text).not.toContain('\n');
    expect(text).toBe(
      '{"options":{"capped":true,"size":{"$numberInt":"4096"}},' +
        '"indexes":[{"v":{"$numberInt":"2"},"key":{"_id":{"$numberInt":"1"}},"name":"_id_"}],' +
        `"uuid":"${UUID_HEX}","collectionName":"orders","type":"collection"}`,
    );
  });
});

describe('readMetadata', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'thicket-bson-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the canonical Extended JSON next to the .bson file', async () => {
    await writeFile(
      path.join(dir, 'orders.metadata.json'),
      '{"options":{"size":{"$numberInt":"4096"}},"indexes":[],"collectionName":"orders"}\n',
    );
    const metadata = await readMetadata(path.join(dir, 'orders.bson'));
    expect(metadata?.['options']).toEqual({ size: new Int32(4096) });
    expect(metadata?.['options']['size']).toBeInstanceOf(Int32);
  });

  it('is undefined without a metadata file', async () => {
    expect(await readMetadata(path.join(dir, 'orders.bson'))).toBeUndefined();
  });

  it.each([
    ['not JSON', '{"options":'],
    ['an array', '[]'],
    ['null', 'null'],
    ['a string', '"orders"'],
  ])('refuses a metadata file that is %s', async (_what, text) => {
    await writeFile(path.join(dir, 'orders.metadata.json'), text);
    await expect(readMetadata(path.join(dir, 'orders.bson'))).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      message: 'orders.metadata.json is not a valid metadata file',
    });
  });

  it('refuses a metadata file holding a single number (not a document)', async () => {
    // Canonical EJSON parses 5 into an Int32 object: it must not pass as a metadata document.
    await writeFile(path.join(dir, 'orders.metadata.json'), '5');
    await expect(readMetadata(path.join(dir, 'orders.bson'))).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      message: 'orders.metadata.json is not a valid metadata file',
    });
  });

  it('passes other read errors on (a folder)', async () => {
    await mkdir(path.join(dir, 'orders.metadata.json'));
    const error = await readMetadata(path.join(dir, 'orders.bson')).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: 'EISDIR' });
  });
});

describe('createWithOptions', () => {
  const op = (client: ClientLike) => new Operation(client, 'shop', 'orders', undefined);

  it('creates a new collection with the restorable options only', async () => {
    const server = fakeServer({ collections: [] });
    await createWithOptions(op(server.client), server.client, 'shop', 'orders', {
      options: {
        capped: true,
        size: new Int32(4096),
        validator: { qty: { $gte: 0 } },
        uuid: 'ignored',
        autoIndexId: false,
        viewOn: 'nope',
      },
    });
    expect(server.sent[0]).toMatchObject({
      listCollections: 1,
      filter: { name: 'orders' },
      nameOnly: true,
    });
    const create = server.sent.find((c) => 'create' in c);
    expect(create).toMatchObject({
      create: 'orders',
      capped: true,
      size: new Int32(4096),
      validator: { qty: { $gte: 0 } },
    });
    expect(create).not.toHaveProperty('uuid');
    expect(create).not.toHaveProperty('autoIndexId');
    expect(create).not.toHaveProperty('viewOn');
  });

  it('leaves an existing collection with its own options', async () => {
    const server = fakeServer({ collections: [{ name: 'orders', type: 'collection' }] });
    await createWithOptions(op(server.client), server.client, 'shop', 'orders', {
      options: { capped: true, size: 4096 },
    });
    expect(server.sent.some((c) => 'create' in c)).toBe(false);
  });

  it.each([
    ['no options', {}],
    ['empty options', { options: {} }],
    ['only options a restore does not apply', { options: { uuid: 'x', autoIndexId: true } }],
    ['options that are not a document', { options: 'capped' }],
    ['null options', { options: null }],
  ])('with %s asks the server nothing', async (_what, metadata) => {
    const server = fakeServer({ collections: [] });
    await createWithOptions(op(server.client), server.client, 'shop', 'orders', metadata);
    expect(server.sent).toEqual([]);
  });

  it('a failed create is a SERVER_ERROR naming the step', async () => {
    const server = fakeServer({ collections: [] }, (cmd) =>
      'create' in cmd ? new Error('invalid validator') : undefined,
    );
    const error = await createWithOptions(op(server.client), server.client, 'shop', 'orders', {
      options: { validator: { $bad: 1 } },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: 'SERVER_ERROR' });
    expect((error as Error).message).toMatch(
      /^Could not create orders with the dump's options: .*invalid validator/,
    );
  });

  it('a cancelled create stays CANCELLED', async () => {
    const server = fakeServer({ collections: [] });
    const controller = new AbortController();
    const cancelled = new Operation(server.client, 'shop', 'orders', controller.signal);
    controller.abort();
    const error = await createWithOptions(cancelled, server.client, 'shop', 'orders', {
      options: { capped: true, size: 1 },
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'CANCELLED' });
  });
});

describe('createDumpIndexes', () => {
  const op = (client: ClientLike, signal?: AbortSignal) =>
    new Operation(client, 'shop', 'orders', signal);

  it('creates every index but _id_, without v and ns, and answers their number', async () => {
    const server = fakeServer();
    const count = await createDumpIndexes(op(server.client), 'orders', {
      indexes: [
        { v: 2, key: { _id: 1 }, name: '_id_' },
        { v: 2, key: { sku: 1 }, name: 'sku_1', unique: true, ns: 'shop.orders' },
        { v: 1, key: { at: -1 }, name: 'at_-1', expireAfterSeconds: 60 },
        'not a spec',
        null,
      ],
    });
    expect(count).toBe(2);
    expect(server.sent).toHaveLength(1);
    expect(server.sent[0]).toMatchObject({
      createIndexes: 'orders',
      indexes: [
        { key: { sku: 1 }, name: 'sku_1', unique: true },
        { key: { at: -1 }, name: 'at_-1', expireAfterSeconds: 60 },
      ],
    });
    for (const spec of server.sent[0]?.['indexes'] as Document[]) {
      expect(spec).not.toHaveProperty('v');
      expect(spec).not.toHaveProperty('ns');
    }
  });

  it.each([
    ['no indexes field', {}],
    ['indexes that are not an array', { indexes: { name: 'x' } }],
    ['only the _id_ index', { indexes: [{ v: 2, key: { _id: 1 }, name: '_id_' }] }],
    ['an empty list', { indexes: [] }],
  ])('with %s creates nothing and answers 0', async (_what, metadata) => {
    const server = fakeServer();
    expect(await createDumpIndexes(op(server.client), 'orders', metadata)).toBe(0);
    expect(server.sent).toEqual([]);
  });

  it('a failed createIndexes is a SERVER_ERROR saying the documents were imported', async () => {
    const server = fakeServer({}, () => new Error('Index build failed: duplicate key'));
    const error = await createDumpIndexes(op(server.client), 'orders', {
      indexes: [{ key: { sku: 1 }, name: 'sku_1', unique: true }],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: 'SERVER_ERROR' });
    expect((error as Error).message).toMatch(
      /^The documents were imported, but the dump's indexes could not be created: .*duplicate key/,
    );
  });

  it('a cancel stays CANCELLED', async () => {
    const server = fakeServer();
    const controller = new AbortController();
    controller.abort();
    const error = await createDumpIndexes(op(server.client, controller.signal), 'orders', {
      indexes: [{ key: { sku: 1 }, name: 'sku_1' }],
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'CANCELLED' });
  });
});
