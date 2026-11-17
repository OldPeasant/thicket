import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  BSON,
  Binary,
  Decimal128,
  Double,
  Int32,
  Long,
  MongoClient,
  ObjectId,
  Timestamp,
  type Document,
} from 'mongodb';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
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
import { MONGO_IMAGES } from './fixtures/mongo';

// io.export / io.import as CSV and as BSON dumps (task io-advanced) against the 8.x standalone
// fixture, served like startBackend serves them. The native dialogs are replaced by a queue of
// temp file paths. mongodump / mongorestore run in a container of the fixture's image (they ship
// with it) on the host network, so they reach the fixture at its mapped port.

const mongo = inject('mongo').mongo8;
const run = randomBytes(3).toString('hex');
const DB = `ioadv_${run}`;
const RESTORED_DB = `ioadv_restored_${run}`;
const N = 500;

const PROFILE: Profile = {
  id: 'io-adv',
  name: 'IO advanced',
  connectionString: mongo.uri,
  readOnly: false,
  production: false,
  serverSelectionTimeoutMS: 10_000,
};

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

function backendFor() {
  const profileOf = (id: string): Profile => {
    if (id === PROFILE.id) return PROFILE;
    throw new RpcError('NOT_FOUND', `No profile ${id}`);
  };
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
  const waiting = new Map<string, () => void>();
  clientPort.onMessage((message) => {
    const event = message as Partial<Event>;
    if (typeof event.stream !== 'string' || event.kind === undefined) return;
    const list = events.get(event.stream) ?? [];
    list.push(event as Event);
    events.set(event.stream, list);
    if (event.kind !== 'data') waiting.get(event.stream)?.();
  });
  const call = <M extends MethodName>(method: M, params: ParamsOf<M>) =>
    client.call(method, params) as Promise<ResultOf<M>>;
  /** Waits for the stream's `end` or `error`. */
  const finished = async (streamId: string): Promise<StreamOutcome> => {
    const ended = () => (events.get(streamId) ?? []).some((e) => e.kind !== 'data');
    if (!ended()) await new Promise<void>((resolve) => waiting.set(streamId, resolve));
    const list = events.get(streamId) ?? [];
    const last = list.at(-1);
    return {
      progress: list.filter((e) => e.kind === 'data').map((e) => e.payload as IoProgress),
      ...(last?.kind === 'end' ? { end: last.payload as { delivered: number } } : {}),
      ...(last?.kind === 'error' ? { error: last.payload as ErrorInfo } : {}),
    };
  };
  const close = async () => {
    client.close();
    stop();
    await manager.closeAll();
  };
  return { manager, call, finished, close };
}

let backend: ReturnType<typeof backendFor>;
let direct: MongoClient;
let tools: StartedTestContainer;

const coll = (name: string, db = DB) => direct.db(db).collection<Document>(name);
const raw = { promoteValues: false, promoteLongs: false, promoteBuffers: false } as const;

/** Every document of a collection by `_id`, as canonical EJSON text (exact types). */
async function canonicalDocs(name: string, db = DB): Promise<string[]> {
  const docs = await coll(name, db).find({}, raw).sort({ _id: 1 }).toArray();
  return docs.map((d) => BSON.EJSON.stringify(d, { relaxed: false }));
}

/** The indexes of a collection without their `v` (name, key and options), sorted by name. */
async function indexesOf(name: string, db = DB): Promise<Document[]> {
  const list = await coll(name, db).listIndexes().toArray();
  return list
    .map((spec) => {
      const copy: Document = { ...spec };
      delete copy['v'];
      delete copy['ns'];
      return copy;
    })
    .sort((a, b) => String(a['name']).localeCompare(String(b['name'])));
}

/** A document with the types a CSV mapping can restore, varied per index. */
function typedDocument(i: number): Document {
  return {
    _id: new ObjectId(),
    n: new Int32(i),
    big: Long.fromString(`${String(i)}000000000000`),
    price: Decimal128.fromString(`${String(i)}.10`),
    ratio: new Double(i / 4),
    at: new Date(Date.UTC(2024, 0, 1) + i * 3_600_000),
    ok: i % 3 === 0,
    name: i % 7 === 0 ? `quoted "${String(i)}", with comma\nand a new line` : `item ${String(i)}`,
    address: { city: `City ${String(i % 10)}`, zip: new Int32(1000 + i) },
    tags: [`t${String(i % 5)}`, new Int32(i)],
  };
}

/** A document with types a CSV cannot hold, for the dumps. */
function dumpDocument(i: number): Document {
  return {
    ...typedDocument(i),
    bin: new Binary(Buffer.from([i & 255, 1, 2])),
    uuid: new Binary(randomBytes(16), Binary.SUBTYPE_UUID),
    regex: new BSON.BSONRegExp(`^a${String(i)}`, 'i'),
    ts: new Timestamp({ t: 1_700_000_000 + i, i: 1 }),
    integral: new Double(i),
  };
}

async function exportTo(
  file: string,
  params: Partial<ParamsOf<'io.export'>> & Pick<ParamsOf<'io.export'>, 'coll' | 'format'>,
) {
  chosen.push(file);
  const result = await backend.call('io.export', {
    profileId: PROFILE.id,
    db: DB,
    source: { kind: 'find', filter: '{}', sort: '{"_id":1}' },
    ...params,
  });
  expect(result.path).toBe(file);
  return backend.finished(result.streamId ?? '');
}

async function importFrom(
  file: string,
  format: 'csv' | 'bson',
  target: string,
  extra: Partial<ParamsOf<'io.import'>> = {},
) {
  chosen.push(file);
  const preview = await backend.call('io.previewImport', { format });
  if (!preview) throw new Error('preview cancelled');
  const { streamId } = await backend.call('io.import', {
    profileId: PROFILE.id,
    db: DB,
    coll: target,
    fileToken: preview.fileToken,
    ...extra,
  });
  return { preview, outcome: await backend.finished(streamId) };
}

/** Runs a program in the tools container; throws with its output when it fails. */
async function inTools(command: string[]): Promise<string> {
  const result = await tools.exec(command);
  if (result.exitCode !== 0) throw new Error(`${command.join(' ')} failed:\n${result.output}`);
  return result.stdout;
}

/** A file of the tools container, read through base64 (exec output is text). */
async function fileFromTools(file: string): Promise<Buffer> {
  return Buffer.from((await inTools(['base64', '-w0', file])).trim(), 'base64');
}

/** The fixture as the tools container (host network) reaches it. */
const toolsUri = () => `mongodb://127.0.0.1:${String(mongo.port)}/?directConnection=true`;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'thicket-io-adv-'));
  direct = new MongoClient(mongo.uri, { serverSelectionTimeoutMS: 10_000 });
  await direct.connect();
  await coll('typed').insertMany(Array.from({ length: N }, (_, i) => typedDocument(i)));
  await coll('dumped').insertMany(Array.from({ length: N }, (_, i) => dumpDocument(i)));
  await coll('dumped').createIndexes([
    { key: { n: 1 }, name: 'n_unique', unique: true },
    { key: { 'address.city': 1, at: -1 }, name: 'city_at' },
    { key: { name: 'text' }, name: 'name_text', default_language: 'english' },
    { key: { ok: 1 }, name: 'ok_partial', partialFilterExpression: { ok: true } },
  ]);
  backend = backendFor();
  await backend.manager.open(PROFILE.id, undefined);
  tools = await new GenericContainer(MONGO_IMAGES['8'])
    .withNetworkMode('host')
    .withEntrypoint(['sleep'])
    .withCommand(['infinity'])
    .start();
}, 180_000);

afterAll(async () => {
  await backend.close();
  await direct.db(DB).dropDatabase();
  await direct.db(RESTORED_DB).dropDatabase();
  await direct.close();
  await tools.stop();
  await rm(dir, { recursive: true, force: true });
});

/** The mapping that gives every column of `typed` its type back. */
const TYPED_MAPPING: ParamsOf<'io.import'>['csvMapping'] = [
  { column: '_id', path: '_id', bsonType: 'objectId' },
  { column: 'n', path: 'n', bsonType: 'int' },
  { column: 'big', path: 'big', bsonType: 'long' },
  { column: 'price', path: 'price', bsonType: 'decimal' },
  { column: 'ratio', path: 'ratio', bsonType: 'double' },
  { column: 'at', path: 'at', bsonType: 'date' },
  { column: 'ok', path: 'ok', bsonType: 'bool' },
  { column: 'name', path: 'name', bsonType: 'string' },
  { column: 'address.city', path: 'address.city', bsonType: 'string' },
  { column: 'address.zip', path: 'address.zip', bsonType: 'int' },
  { column: 'tags', path: 'tags', bsonType: 'json' },
];

describe('CSV', () => {
  it('round trip: exported CSV imported with a type per column gives the same documents', async () => {
    const file = path.join(dir, 'typed.csv');
    const exported = await exportTo(file, { coll: 'typed', format: 'csv', ejsonMode: 'canonical' });
    expect(exported.error).toBeUndefined();
    expect(exported.end?.delivered).toBe(N);
    const text = await readFile(file, 'utf8');
    // The columns are the flattened paths of the documents; nested documents become a.b columns.
    expect(text.split('\n')[0]).toBe(
      '_id,n,big,price,ratio,at,ok,name,address.city,address.zip,tags',
    );
    expect(text).toContain('"quoted ""0"", with comma\nand a new line"');

    const { preview, outcome } = await importFrom(file, 'csv', 'typed_copy', {
      csvMapping: TYPED_MAPPING,
    });
    expect(preview.csvColumns).toEqual(TYPED_MAPPING?.map((m) => m.column));
    expect(preview.csvRows?.[1]?.slice(0, 3)).toEqual([expect.any(String), '1', '1000000000000']);
    expect(outcome.error).toBeUndefined();
    expect(outcome.end?.delivered).toBe(N);
    expect(outcome.progress.at(-1)).toEqual({ processed: N, failed: 0, errors: [] });
    const [original, copy] = await Promise.all([
      canonicalDocs('typed'),
      canonicalDocs('typed_copy'),
    ]);
    expect(copy).toHaveLength(N);
    expect(copy).toEqual(original);
  });

  it('exports the chosen fields in their order, with array elements and missing fields', async () => {
    const file = path.join(dir, 'fields.csv');
    const exported = await exportTo(file, {
      coll: 'typed',
      format: 'csv',
      source: { kind: 'find', filter: '{"n":{"$lt":2}}', sort: '{"n":1}' },
      csvFields: ['n', 'address', 'tags.0', 'missing', 'at'],
    });
    expect(exported.end?.delivered).toBe(2);
    expect((await readFile(file, 'utf8')).split('\n')).toEqual([
      'n,address,tags.0,missing,at',
      '0,"{""city"":""City 0"",""zip"":1000}",t0,,2024-01-01T00:00:00.000Z',
      '1,"{""city"":""City 1"",""zip"":1001}",t1,,2024-01-01T01:00:00.000Z',
      '',
    ]);
  });

  it('imports without a mapping as auto types, renames and skips columns with one', async () => {
    const file = path.join(dir, 'auto.csv');
    await writeFile(
      file,
      '﻿id,qty,price,flag,when,note\r\n1,5,2.5,true,2024-05-01,plain\r\n2,9999999999,-1e3,false,,"multi\r\nline"\r\n',
    );
    const auto = await importFrom(file, 'csv', 'auto');
    expect(auto.outcome.error).toBeUndefined();
    const docs = await coll('auto')
      .find({}, { ...raw, projection: { _id: 0 } })
      .sort({ id: 1 })
      .toArray();
    expect(docs.map((d) => BSON.EJSON.stringify(d, { relaxed: false }))).toEqual([
      '{"id":{"$numberInt":"1"},"qty":{"$numberInt":"5"},"price":{"$numberDouble":"2.5"},"flag":true,"when":"2024-05-01","note":"plain"}',
      '{"id":{"$numberInt":"2"},"qty":{"$numberLong":"9999999999"},"price":{"$numberDouble":"-1000.0"},"flag":false,"note":"multi\\r\\nline"}',
    ]);

    const mapped = await importFrom(file, 'csv', 'mapped', {
      csvMapping: [
        { column: 'id', path: '_id', bsonType: 'long' },
        { column: 'when', path: 'meta.when', bsonType: 'date' },
        { column: 'qty', path: 'meta.qty', bsonType: 'decimal' },
      ],
    });
    expect(mapped.outcome.error).toBeUndefined();
    expect(await canonicalDocs('mapped')).toEqual([
      '{"_id":{"$numberLong":"1"},"meta":{"when":{"$date":{"$numberLong":"1714521600000"}},"qty":{"$numberDecimal":"5"}}}',
      '{"_id":{"$numberLong":"2"},"meta":{"qty":{"$numberDecimal":"9999999999"}}}',
    ]);
  });

  it('a cell that is no value of its type fails its row with the line and column', async () => {
    const file = path.join(dir, 'bad.csv');
    await writeFile(file, 'n,at\n1,2024-01-01\nx,2024-01-02\n3,someday\n4,2024-01-04\n');
    const mapping: ParamsOf<'io.import'>['csvMapping'] = [
      { column: 'n', path: 'n', bsonType: 'int' },
      { column: 'at', path: 'at', bsonType: 'date' },
    ];
    const { outcome } = await importFrom(file, 'csv', 'bad_continue', {
      csvMapping: mapping,
      stopOnError: false,
    });
    expect(outcome.end?.delivered).toBe(2);
    const last = outcome.progress.at(-1);
    expect(last).toMatchObject({ processed: 4, failed: 2 });
    expect(last?.errors.map((e) => e.index)).toEqual([3, 4]);
    expect(last?.errors[0]?.error.message).toBe('Line 3: column "n": "x" is not a 32-bit integer');
    expect(await coll('bad_continue').countDocuments()).toBe(2);

    const stopped = await importFrom(file, 'csv', 'bad_stop', { csvMapping: mapping });
    expect(stopped.outcome.error?.code).toBe('INVALID_PARAMS');
    expect(await coll('bad_stop').countDocuments()).toBe(1);
  });

  it('a CSV export of documents with mixed shapes previews and imports back', async () => {
    // `a` is a scalar in one document and a nested document in the other: columns a and a.b.
    await direct
      .db(DB)
      .collection<{ _id: Int32 } & Document>('mixed')
      .insertMany([
        { _id: new Int32(1), a: new Int32(5), n: 'x' },
        { _id: new Int32(2), a: { b: new Int32(6) }, n: 'y' },
      ]);
    const file = path.join(dir, 'mixed.csv');
    const exported = await exportTo(file, { coll: 'mixed', format: 'csv' });
    expect(exported.error).toBeUndefined();
    expect((await readFile(file, 'utf8')).split('\n')[0]).toBe('_id,a,n,a.b');

    // The `a` column holds the nested document as Extended JSON text, `a.b` its field.
    expect((await readFile(file, 'utf8')).split('\n')[2]).toBe('2,"{""b"":6}",y,6');

    // Without a mapping the overlapping `a.b` column is left out (the first one wins), so the
    // preview and the import work; `auto` keeps the nested document's text as a string.
    const auto = await importFrom(file, 'csv', 'mixed_auto');
    expect(auto.preview.csvColumns).toEqual(['_id', 'a', 'n', 'a.b']);
    expect(auto.preview.sample).toHaveLength(2);
    expect(auto.outcome.error).toBeUndefined();
    expect(await canonicalDocs('mixed_auto')).toEqual([
      '{"_id":{"$numberInt":"1"},"a":{"$numberInt":"5"},"n":"x"}',
      '{"_id":{"$numberInt":"2"},"a":"{\\"b\\":6}","n":"y"}',
    ]);

    // Mapping `a` as Extended JSON gives both shapes back exactly.
    const mapped = await importFrom(file, 'csv', 'mixed_mapped', {
      csvMapping: [
        { column: '_id', path: '_id', bsonType: 'int' },
        { column: 'a', path: 'a', bsonType: 'json' },
        { column: 'n', path: 'n', bsonType: 'string' },
      ],
    });
    expect(mapped.outcome.error).toBeUndefined();
    expect(await canonicalDocs('mixed_mapped')).toEqual(await canonicalDocs('mixed'));
  });

  it('imports the second of two equally named columns by its index', async () => {
    const file = path.join(dir, 'repeated.csv');
    await writeFile(file, 'id,name,name\n1,first,second\n');
    const byIndex = await importFrom(file, 'csv', 'repeated', {
      csvMapping: [
        { column: 'id', path: '_id', bsonType: 'int' },
        { column: 'name', index: 2, path: 'name', bsonType: 'string' },
      ],
    });
    expect(byIndex.outcome.error).toBeUndefined();
    expect(await canonicalDocs('repeated')).toEqual(['{"_id":{"$numberInt":"1"},"name":"second"}']);

    const byName = await importFrom(file, 'csv', 'repeated_refused', {
      csvMapping: [{ column: 'name', path: 'name', bsonType: 'string' }],
    });
    expect(byName.outcome.error).toMatchObject({
      code: 'INVALID_PARAMS',
      message: 'The file has more than one column "name": choose one by its index',
    });
    expect(await coll('repeated_refused').countDocuments()).toBe(0);
  });

  it('refuses a mapping that names a column the file does not have', async () => {
    const file = path.join(dir, 'cols.csv');
    await writeFile(file, 'a,b\n1,2\n');
    const { outcome } = await importFrom(file, 'csv', 'cols', {
      csvMapping: [{ column: 'c', path: 'c', bsonType: 'int' }],
    });
    expect(outcome.error).toMatchObject({
      code: 'INVALID_PARAMS',
      message: 'The file has no column "c"',
    });
    expect(await coll('cols').countDocuments()).toBe(0);
  });
});

describe('BSON dump', () => {
  it('a .bson written by Thicket restores with mongorestore (documents and indexes)', async () => {
    const file = path.join(dir, 'dumped.bson');
    const exported = await exportTo(file, { coll: 'dumped', format: 'bson' });
    expect(exported.error).toBeUndefined();
    expect(exported.end?.delivered).toBe(N);
    const metadata = JSON.parse(await readFile(path.join(dir, 'dumped.metadata.json'), 'utf8')) as {
      collectionName: string;
      indexes: { name: string }[];
    };
    expect(metadata.collectionName).toBe('dumped');
    expect(metadata.indexes.map((i) => i.name).sort()).toEqual(
      ['_id_', 'city_at', 'n_unique', 'name_text', 'ok_partial'].sort(),
    );

    await tools.copyContentToContainer([
      { content: await readFile(file), target: '/dump/in/dumped.bson' },
      {
        content: await readFile(path.join(dir, 'dumped.metadata.json')),
        target: '/dump/in/dumped.metadata.json',
      },
    ]);
    await inTools([
      'mongorestore',
      `--uri=${toolsUri()}`,
      `--db=${RESTORED_DB}`,
      '--collection=restored',
      '/dump/in/dumped.bson',
    ]);
    expect(await canonicalDocs('restored', RESTORED_DB)).toEqual(await canonicalDocs('dumped'));
    expect(await indexesOf('restored', RESTORED_DB)).toEqual(await indexesOf('dumped'));
  });

  it('a mongodump .bson imports with Thicket (documents and indexes)', async () => {
    await inTools([
      'mongodump',
      `--uri=${toolsUri()}`,
      `--db=${DB}`,
      '--collection=dumped',
      '--out=/dump/out',
    ]);
    const file = path.join(dir, 'from-mongodump.bson');
    await writeFile(file, await fileFromTools(`/dump/out/${DB}/dumped.bson`));
    await writeFile(
      path.join(dir, 'from-mongodump.metadata.json'),
      await fileFromTools(`/dump/out/${DB}/dumped.metadata.json`),
    );

    const { preview, outcome } = await importFrom(file, 'bson', 'from_dump');
    expect(preview.metadataFile).toBe('from-mongodump.metadata.json');
    expect(preview.sizeBytes).toBe((await stat(file)).size);
    expect(preview.sample).toHaveLength(20);
    expect(outcome.error).toBeUndefined();
    expect(outcome.end?.delivered).toBe(N);
    expect(await canonicalDocs('from_dump')).toEqual(await canonicalDocs('dumped'));
    expect(await indexesOf('from_dump')).toEqual(await indexesOf('dumped'));
  });

  it('a Thicket .bson of a query imports back with Thicket', async () => {
    const file = path.join(dir, 'query.bson');
    const exported = await exportTo(file, {
      coll: 'dumped',
      format: 'bson',
      source: { kind: 'aggregate', pipeline: '[{"$match":{"ok":true}},{"$sort":{"_id":1}}]' },
    });
    expect(exported.end?.delivered).toBe(Math.ceil(N / 3));
    const { outcome } = await importFrom(file, 'bson', 'query_copy');
    expect(outcome.end?.delivered).toBe(Math.ceil(N / 3));
    const okDocs = (await coll('dumped').find({ ok: true }, raw).sort({ _id: 1 }).toArray()).map(
      (d) => BSON.EJSON.stringify(d, { relaxed: false }),
    );
    expect(await canonicalDocs('query_copy')).toEqual(okDocs);
    // An aggregation's dump carries no indexes.
    expect((await indexesOf('query_copy')).map((i) => i['name'])).toEqual(['_id_']);
  });
});
