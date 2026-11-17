import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { gridfsFile, MAX_GRIDFS_FILES } from '@thicket/contract';
import { BSON, Db, MongoClient, ObjectId, type Document } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClientLike } from '../connections/manager';
import { RpcError } from '../server/rpc';
import {
  deleteFile,
  downloadFile,
  driverDb,
  escapeRegex,
  fileInfo,
  GRIDFS_PROGRESS_BYTES,
  listBuckets,
  listFiles,
  parseFileId,
  toGridfsFile,
  uploadFile,
} from './gridfs';

// Pure helpers and the parts of gridfs.* that need no server. Data paths (listing, round trips,
// progress, delete) run against a real server in test/integration/gridfs.int.spec.ts.

const OID = '64b7f0c2a1b2c3d4e5f60718';
const UPLOADED = new Date('2026-03-04T05:06:07.000Z');

/** A fake client whose `db()` is not a driver `Db` (what most backend unit tests use). */
const fakeClient: ClientLike = {
  connect: () => Promise.resolve(),
  close: () => Promise.resolve(),
  db: () => ({ command: () => Promise.resolve({ ok: 1 }) }),
};

async function rejection(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RpcError);
    return error as RpcError;
  }
  throw new Error('expected a rejection');
}

function aborted(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

describe('escapeRegex', () => {
  it('escapes every regular expression metacharacter', () => {
    expect(escapeRegex('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe(
      'a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o',
    );
  });

  it('leaves plain text, spaces, dashes and non-ASCII text as they are', () => {
    expect(escapeRegex('report 2026-Q1 äöü')).toBe('report 2026-Q1 äöü');
    expect(escapeRegex('')).toBe('');
  });

  it('the escaped text matches itself literally and nothing broader', () => {
    for (const text of ['.*', 'a+b', '(x)', 'file[1].txt', '^$', 'c:\\temp']) {
      const regex = new RegExp(escapeRegex(text), 'i');
      expect(regex.test(`prefix ${text} suffix`)).toBe(true);
    }
    expect(new RegExp(escapeRegex('.*'), 'i').test('anything')).toBe(false);
    expect(new RegExp(escapeRegex('file.txt'), 'i').test('fileXtxt')).toBe(false);
  });
});

describe('parseFileId', () => {
  it('parses canonical EJSON of any BSON type', () => {
    const oid = parseFileId(`{"$oid":"${OID}"}`);
    expect(oid).toBeInstanceOf(ObjectId);
    expect((oid as ObjectId).toHexString()).toBe(OID);
    expect(parseFileId('"my-id"')).toBe('my-id');
    expect(parseFileId('{"$numberInt":"7"}')).toEqual(new BSON.Int32(7));
  });

  it('rejects text that is not EJSON as INVALID_PARAMS naming the id', () => {
    let error: unknown;
    try {
      parseFileId('{"$oid":');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe('INVALID_PARAMS');
    expect((error as RpcError).message).toMatch(/^id is not valid EJSON/);
  });
});

describe('toGridfsFile', () => {
  const full: Document = {
    _id: new ObjectId(OID),
    length: new BSON.Int32(20 * 1024 * 1024),
    chunkSize: new BSON.Int32(255 * 1024),
    uploadDate: UPLOADED,
    filename: 'report.pdf',
    contentType: 'application/pdf',
    metadata: { owner: 'example-user', pages: new BSON.Int32(3) },
  };

  it('maps a files document read without promotion to the contract shape', () => {
    const file = toGridfsFile(full);
    expect(file).toEqual({
      id: `{"$oid":"${OID}"}`,
      filename: 'report.pdf',
      length: 20 * 1024 * 1024,
      chunkSize: 255 * 1024,
      uploadDate: '2026-03-04T05:06:07.000Z',
      contentType: 'application/pdf',
      metadata: '{"owner":"example-user","pages":{"$numberInt":"3"}}',
    });
    expect(gridfsFile.safeParse(file).success).toBe(true);
  });

  it('keeps the BSON type of a non-ObjectId _id in canonical EJSON', () => {
    expect(toGridfsFile({ ...full, _id: 'my-id' }).id).toBe('"my-id"');
    expect(toGridfsFile({ ...full, _id: new BSON.Int32(5) }).id).toBe('{"$numberInt":"5"}');
    expect(toGridfsFile({ ...full, _id: BSON.Long.fromNumber(5) }).id).toBe('{"$numberLong":"5"}');
  });

  it('reads Long, Double, number and bigint lengths; truncates fractions', () => {
    expect(toGridfsFile({ ...full, length: BSON.Long.fromNumber(5_000_000_000) }).length).toBe(
      5_000_000_000,
    );
    expect(toGridfsFile({ ...full, length: new BSON.Double(10.9) }).length).toBe(10);
    expect(toGridfsFile({ ...full, length: 42 }).length).toBe(42);
    expect(toGridfsFile({ ...full, length: 42n }).length).toBe(42);
  });

  it('counts missing, negative, non-numeric or infinite sizes as 0', () => {
    for (const length of [undefined, -1, 'big', Number.NaN, Number.POSITIVE_INFINITY, null]) {
      const file = toGridfsFile({ ...full, length, chunkSize: length });
      expect(file.length).toBe(0);
      expect(file.chunkSize).toBe(0);
    }
  });

  it('a minimal document (only _id) gets empty name and date and no optional fields', () => {
    const file = toGridfsFile({ _id: new ObjectId(OID) });
    expect(file).toEqual({
      id: `{"$oid":"${OID}"}`,
      filename: '',
      length: 0,
      chunkSize: 0,
      uploadDate: '',
    });
    expect(gridfsFile.safeParse(file).success).toBe(true);
  });

  it('an invalid or non-Date uploadDate becomes empty', () => {
    expect(toGridfsFile({ ...full, uploadDate: new Date(Number.NaN) }).uploadDate).toBe('');
    expect(toGridfsFile({ ...full, uploadDate: '2026-03-04' }).uploadDate).toBe('');
  });

  it('a filename that is not a string becomes empty; a BSON symbol is read as text', () => {
    expect(toGridfsFile({ ...full, filename: new BSON.Int32(3) }).filename).toBe('');
    expect(toGridfsFile({ ...full, filename: new BSON.BSONSymbol('legacy.bin') }).filename).toBe(
      'legacy.bin',
    );
  });

  it('takes contentType from the top level first, then from metadata.contentType', () => {
    expect(toGridfsFile({ ...full, metadata: { contentType: 'text/plain' } }).contentType).toBe(
      'application/pdf',
    );
    const fromMetadata = toGridfsFile({
      ...full,
      contentType: undefined,
      metadata: { contentType: 'image/png' },
    });
    expect(fromMetadata.contentType).toBe('image/png');
    expect(fromMetadata.metadata).toBe('{"contentType":"image/png"}');
  });

  it('has no contentType when neither place holds a string', () => {
    const file = toGridfsFile({
      ...full,
      contentType: new BSON.Int32(1),
      metadata: { contentType: 5 },
    });
    expect(file).not.toHaveProperty('contentType');
  });

  it('ignores metadata that is not a document (array, BSON value, scalar, null)', () => {
    for (const metadata of [['a'], new ObjectId(OID), 'text', 7, null]) {
      const file = toGridfsFile({ ...full, contentType: undefined, metadata });
      expect(file).not.toHaveProperty('metadata');
      expect(file).not.toHaveProperty('contentType');
      expect(gridfsFile.safeParse(file).success).toBe(true);
    }
  });
});

describe('driverDb', () => {
  it('refuses a client whose databases are not driver Dbs (INTERNAL)', () => {
    let error: unknown;
    try {
      driverDb(fakeClient, 'shop');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe('INTERNAL');
    expect((error as RpcError).message).toBe('GridFS needs a driver connection');
  });

  it('returns the driver Db of a MongoClient (no connection needed)', () => {
    const client = new MongoClient('mongodb://db.example.test:27017');
    const db = driverDb(client as unknown as ClientLike, 'shop');
    expect(db).toBeInstanceOf(Db);
    expect(db.databaseName).toBe('shop');
  });

  it('every operation fails with INTERNAL on a fake client', async () => {
    const transfer = { signal: new AbortController().signal, progress: () => undefined };
    const codes = await Promise.all([
      rejection(listBuckets(fakeClient, 'shop')),
      rejection(listFiles(fakeClient, 'shop', 'fs', {})),
      rejection(fileInfo(fakeClient, 'shop', 'fs', new ObjectId(OID))),
      rejection(deleteFile(fakeClient, 'shop', 'fs', new ObjectId(OID))),
      rejection(downloadFile(fakeClient, 'shop', 'fs', 'x', 1, '/nonexistent/x', transfer)),
    ]);
    expect(codes.map((e) => e.code)).toEqual(Array(5).fill('INTERNAL'));
  });
});

describe('constants', () => {
  it('progress steps are 1 MiB and the list limit is 1000', () => {
    expect(GRIDFS_PROGRESS_BYTES).toBe(1024 * 1024);
    expect(MAX_GRIDFS_FILES).toBe(1000);
  });
});

// A real driver Db on a server that is not there: the driver fails fast (refused connection,
// short server selection), so cancellation and clean-up paths run without a container.
describe('transfers without a reachable server', () => {
  let client: MongoClient;
  let dir: string;

  beforeAll(() => {
    client = new MongoClient('mongodb://127.0.0.1:1/?directConnection=true', {
      serverSelectionTimeoutMS: 150,
      connectTimeoutMS: 150,
    });
  });
  afterAll(async () => {
    await client.close();
  });
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'thicket-gridfs-unit-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const driver = () => client as unknown as ClientLike;

  it('a cancelled download is CANCELLED, reports no progress and leaves no local file', async () => {
    const target = path.join(dir, 'copy.bin');
    const progress: unknown[] = [];
    const error = await rejection(
      downloadFile(driver(), 'shop', 'fs', new ObjectId(OID), 10, target, {
        signal: aborted(),
        progress: (p) => progress.push(p),
      }),
    );
    expect(error.code).toBe('CANCELLED');
    expect(progress).toEqual([]);
    expect(existsSync(target)).toBe(false);
  });

  it('a failed download removes the file it started to write', async () => {
    const target = path.join(dir, 'copy.bin');
    const error = await rejection(
      downloadFile(driver(), 'shop', 'fs', new ObjectId(OID), 10, target, {
        signal: new AbortController().signal,
        progress: () => undefined,
      }),
    );
    expect(error.code).not.toBe('CANCELLED');
    expect(existsSync(target)).toBe(false);
  });

  it('a cancelled upload is CANCELLED before anything is read', async () => {
    const source = path.join(dir, 'source.txt');
    await writeFile(source, 'fictitious content');
    const progress: unknown[] = [];
    const error = await rejection(
      uploadFile(driver(), 'shop', 'fs', source, 'source.txt', {
        signal: aborted(),
        progress: (p) => progress.push(p),
      }),
    );
    expect(error.code).toBe('CANCELLED');
    expect(progress).toEqual([]);
  });

  it('a cancelled file list is CANCELLED', async () => {
    const error = await rejection(listFiles(driver(), 'shop', 'fs', {}, aborted()));
    expect(error.code).toBe('CANCELLED');
  });

  it('server errors of list, info and delete are mapped (not raw driver errors)', async () => {
    const errors = await Promise.all([
      rejection(listBuckets(driver(), 'shop')),
      rejection(listFiles(driver(), 'shop', 'fs', { nameContains: 'a.b' })),
      rejection(fileInfo(driver(), 'shop', 'fs', new ObjectId(OID))),
      rejection(deleteFile(driver(), 'shop', 'fs', new ObjectId(OID))),
    ]);
    for (const error of errors) {
      expect(error.code).not.toBe('CANCELLED');
      expect(error.message.length).toBeGreaterThan(0);
    }
  });
});
