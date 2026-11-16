import { serverErrorDetail } from '@thicket/contract';
import {
  BSON,
  MongoNetworkError,
  MongoNetworkTimeoutError,
  MongoServerError,
  MongoWriteConcernError,
  type Document,
  type RunCommandOptions,
} from 'mongodb';
import { describe, expect, it } from 'vitest';

import type { ClientLike } from '../connections/manager';
import { RpcError } from '../server/rpc';
import {
  collectionStats,
  createCollection,
  createDatabase,
  databaseStats,
  dropCollection,
  dropDatabase,
  listCollections,
  listDatabases,
  parseCreateOptions,
  renameCollection,
  toBrowseError,
  toNumber,
} from './browse';

/** One command the fake client received: database, command document and options. */
interface Sent {
  db: string;
  command: Document;
  options: RunCommandOptions | undefined;
}

type Answer = (db: string, command: Document) => Document | Promise<Document>;

/** A fake driver client that answers each command with `answer` and records what it was sent. */
function fakeClient(answer: Answer): ClientLike & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: (db: string) => ({
      command: async (command: Document, options?: RunCommandOptions) => {
        sent.push({ db, command, options });
        return answer(db, command);
      },
    }),
  };
}

function serverError(code: number, codeName: string, errmsg: string): MongoServerError {
  return new MongoServerError({ ok: 0, code, codeName, errmsg });
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

const firstKey = (doc: Document) => Object.keys(doc)[0];

describe('toBrowseError', () => {
  it('maps NamespaceNotFound (code 26) to NOT_FOUND with the server message', () => {
    const error = toBrowseError(serverError(26, 'NamespaceNotFound', 'ns shop.ghost not found'));
    expect(error).toBeInstanceOf(RpcError);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('ns shop.ghost not found');
  });

  it('maps a NamespaceNotFound code name without a numeric code to NOT_FOUND', () => {
    expect(toBrowseError({ codeName: 'NamespaceNotFound', message: 'gone' }).code).toBe(
      'NOT_FOUND',
    );
  });

  it('uses a default message when the NamespaceNotFound error has none', () => {
    expect(toBrowseError({ code: 26, message: '' }).message).toBe('Namespace not found');
    expect(toBrowseError({ code: 26 }).message).toBe('Namespace not found');
  });

  it('maps other server errors to SERVER_ERROR with code and code name as detail', () => {
    const error = toBrowseError(serverError(48, 'NamespaceExists', 'collection already exists'));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toEqual({ serverCode: 48, codeName: 'NamespaceExists' });
    expect(error.message).toMatch(/collection already exists/);
  });

  it('maps Unauthorized to SERVER_ERROR (only listDatabases falls back on it)', () => {
    const error = toBrowseError(serverError(13, 'Unauthorized', 'not authorized on hidden'));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toMatchObject({ codeName: 'Unauthorized' });
  });

  it('passes RpcErrors through unchanged', () => {
    const original = new RpcError('CANCELLED', 'stop');
    expect(toBrowseError(original)).toBe(original);
  });

  it.each([
    [48, 'NamespaceExists', 'Collection shop.certificates already exists with different options'],
    [13, 'Unauthorized', 'not authorized on TLS to execute command { create: "x" }'],
    [50, 'MaxTimeMSExpired', 'operation timed out on the server'],
    [8000, 'AtlasError', 'SSL handshake rejected for user authentication failed'],
  ])(
    'a server error %i (%s) is SERVER_ERROR whatever its message says',
    (code, codeName, errmsg) => {
      const error = toBrowseError(serverError(code, codeName, errmsg));
      expect(error.code).toBe('SERVER_ERROR');
      expect(error.detail).toEqual({ serverCode: code, codeName });
      expect(error.message).toBe(`The server refused the command: ${errmsg}`);
    },
  );

  it('reads a server code given as a BSON Int32 or Long', () => {
    expect(
      toBrowseError({ name: 'MongoServerError', code: new BSON.Int32(26), message: 'gone' }).code,
    ).toBe('NOT_FOUND');
    expect(
      toBrowseError({ code: BSON.Long.fromNumber(48), codeName: 'NamespaceExists', message: 'x' })
        .detail,
    ).toEqual({ serverCode: 48, codeName: 'NamespaceExists' });
  });

  it('a server error with only a code name has no serverCode', () => {
    const error = toBrowseError({ codeName: 'SomethingNew', message: 'odd' });
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toEqual({ codeName: 'SomethingNew' });
  });

  it('masks connection strings in server and NOT_FOUND messages', () => {
    const uri = 'mongodb://alice:s3cret@db.example.test:27017';
    for (const [code, codeName] of [
      [48, 'NamespaceExists'],
      [26, 'NamespaceNotFound'],
    ] as const) {
      const error = toBrowseError(serverError(code, codeName, `failed for ${uri}`));
      expect(error.message).not.toContain('s3cret');
    }
  });

  it('unexpected errors are INTERNAL with a browse prefix, not a connect prefix', () => {
    const error = toBrowseError(
      new TypeError("Cannot read properties of undefined (reading 'id')"),
    );
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toMatch(/^Unexpected error while browsing: Cannot read/);
    expect(error.message).not.toMatch(/connecting/);
    expect(toBrowseError('plain').message).toBe('Unexpected error while browsing: plain');
  });

  it('driver errors without a server answer keep their connection classification', () => {
    const timeout = Object.assign(new Error('Server selection timed out after 30000 ms'), {
      name: 'MongoServerSelectionError',
    });
    expect(toBrowseError(timeout).code).toBe('TIMEOUT');
  });

  it('classifies network errors like the connection code does', () => {
    const network = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(toBrowseError(network).code).toBe('NETWORK_ERROR');
    expect(toBrowseError(new Error('boom')).code).toBe('INTERNAL');
  });

  // Round 2: edge cases of the server-error mapping introduced for CR-1/CR-2/CR-6.

  it('a server error without a message answers the bare prefix and keeps its detail', () => {
    for (const error of [
      { name: 'MongoServerError', code: 11000, codeName: 'DuplicateKey', message: '' },
      { code: 11000, codeName: 'DuplicateKey' },
      { code: 11000, codeName: 'DuplicateKey', message: 42 },
    ]) {
      const mapped = toBrowseError(error);
      expect(mapped.code).toBe('SERVER_ERROR');
      expect(mapped.message).toBe('The server refused the command');
      expect(mapped.detail).toEqual({ serverCode: 11000, codeName: 'DuplicateKey' });
    }
  });

  it('an error with only an integer code (no name, no code name) counts as a server answer', () => {
    const error = toBrowseError({ code: 11000, message: 'E11000 duplicate key error' });
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toEqual({ serverCode: 11000 });
  });

  it('a MongoServerError without code or code name is SERVER_ERROR with a contract-valid detail', () => {
    const error = toBrowseError(new MongoServerError({ ok: 0, errmsg: 'odd answer' }));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toBe('The server refused the command: odd answer');
    expect(serverErrorDetail.safeParse(error.detail).success).toBe(true);
    expect(error.detail).not.toHaveProperty('serverCode');
  });

  it('a non-integer or non-numeric code alone does not make an error a server answer', () => {
    expect(toBrowseError({ code: 1.5, message: 'boom' }).code).toBe('INTERNAL');
    expect(toBrowseError({ code: '48', message: 'boom' }).code).toBe('INTERNAL');
  });

  it('every SERVER_ERROR detail validates against the contract ServerErrorDetail', () => {
    for (const error of [
      serverError(48, 'NamespaceExists', 'exists'),
      { name: 'MongoServerError', code: new BSON.Int32(13), codeName: 'Unauthorized' },
      { code: BSON.Long.fromNumber(8000), codeName: 'AtlasError' },
      { codeName: 'SomethingNew' },
    ]) {
      const mapped = toBrowseError(error);
      expect(mapped.code).toBe('SERVER_ERROR');
      expect(serverErrorDetail.strict().safeParse(mapped.detail).success).toBe(true);
    }
  });

  it('a write concern error is SERVER_ERROR even when its message says "timed out"', () => {
    const error = toBrowseError(
      new MongoWriteConcernError({
        ok: 1,
        writeConcernError: {
          code: 64,
          codeName: 'WriteConcernTimeout',
          errmsg: 'waiting for replication timed out',
        },
      }),
    );
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toEqual({ serverCode: 64, codeName: 'WriteConcernTimeout' });
    expect(error.message).toBe('The server refused the command: waiting for replication timed out');
  });

  it('a NamespaceNotFound whose message mentions TLS is still NOT_FOUND', () => {
    expect(
      toBrowseError(serverError(26, 'NamespaceNotFound', 'ns TLS.certificates not found')),
    ).toMatchObject({ code: 'NOT_FOUND', message: 'ns TLS.certificates not found' });
  });

  it('driver network errors without a server answer stay NETWORK_ERROR / TIMEOUT', () => {
    expect(
      toBrowseError(new MongoNetworkError('connection 3 to db.example.test:27017 closed')).code,
    ).toBe('NETWORK_ERROR');
    expect(
      toBrowseError(new MongoNetworkTimeoutError('connection 3 to db.example.test:27017 timed out'))
        .code,
    ).toBe('TIMEOUT');
  });

  it('masks connection strings in INTERNAL browse messages', () => {
    const error = toBrowseError(new Error('bad state for mongodb://alice:s3cret@db.example.test'));
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toMatch(/^Unexpected error while browsing: /);
    expect(error.message).not.toContain('s3cret');
  });

  it('null and undefined are INTERNAL with the bare browse prefix', () => {
    for (const value of [null, undefined]) {
      expect(toBrowseError(value)).toMatchObject({
        code: 'INTERNAL',
        message: 'Unexpected error while browsing',
      });
    }
  });
});

describe('toNumber', () => {
  it('reads promoted and unpromoted BSON numerics', () => {
    expect(toNumber(7)).toBe(7);
    expect(toNumber(7.5)).toBe(7.5);
    expect(toNumber(12n)).toBe(12);
    expect(toNumber(BSON.Long.fromString('9007199254740991'))).toBe(9007199254740991);
    expect(toNumber(new BSON.Int32(42))).toBe(42);
    expect(toNumber(new BSON.Double(1.25))).toBe(1.25);
    expect(toNumber(BSON.Decimal128.fromString('3.5'))).toBe(3.5);
  });

  it('answers undefined for non-numerics', () => {
    for (const value of [undefined, null, '5', true, {}, [], new BSON.ObjectId()]) {
      expect(toNumber(value)).toBeUndefined();
    }
  });
});

describe('parseCreateOptions', () => {
  it('answers an empty document without options', () => {
    expect(parseCreateOptions(undefined)).toEqual({});
  });

  it('parses canonical EJSON without losing BSON types', () => {
    const options = parseCreateOptions(
      '{"capped":true,"size":{"$numberLong":"65536"},"max":{"$numberInt":"10"}}',
    );
    expect(options['capped']).toBe(true);
    expect(options['size']).toBeInstanceOf(BSON.Long);
    expect(options['max']).toBeInstanceOf(BSON.Int32);
  });

  it('refuses text that is not JSON with INVALID_PARAMS', () => {
    let error: unknown;
    try {
      parseCreateOptions('{nope');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({
      code: 'INVALID_PARAMS',
      message: expect.stringMatching(/^options is not valid EJSON: /),
    });
  });

  it.each(['null', '[1,2]', '"text"', 'true'])(
    'refuses %s (not a document) with INVALID_PARAMS',
    (text) => {
      expect(() => parseCreateOptions(text)).toThrow(
        expect.objectContaining({
          code: 'INVALID_PARAMS',
          message: 'options must be an EJSON document',
        }),
      );
    },
  );

  // These start with "{" and so pass the contract's ejsonDocument check, but EJSON reads them as
  // a single BSON value (Int32, Date, ObjectId), not as a document of create options.
  it.each([
    '{"$numberInt":"5"}',
    '{"$date":{"$numberLong":"0"}}',
    '{"$oid":"0123456789abcdef01234567"}',
  ])('refuses %s (an EJSON value wrapper, not a document) with INVALID_PARAMS', (text) => {
    expect(() => parseCreateOptions(text)).toThrow(
      expect.objectContaining({ code: 'INVALID_PARAMS' }),
    );
  });
});

describe('parseCreateOptions: other EJSON value wrappers (TW-1 follow-up)', () => {
  it.each([
    '{"$numberLong":"5"}',
    '{"$numberDouble":"1.5"}',
    '{"$numberDecimal":"1.5"}',
    '{"$regularExpression":{"pattern":"a","options":""}}',
    '{"$binary":{"base64":"AA==","subType":"00"}}',
    '{"$timestamp":{"t":1,"i":1}}',
    '{"$minKey":1}',
    '{"$maxKey":1}',
  ])('refuses %s with INVALID_PARAMS', (text) => {
    expect(() => parseCreateOptions(text)).toThrow(
      expect.objectContaining({
        code: 'INVALID_PARAMS',
        message: 'options must be an EJSON document',
      }),
    );
  });

  it('accepts an empty document and documents with EJSON-typed fields', () => {
    expect(parseCreateOptions('{}')).toEqual({});
    const options = parseCreateOptions(
      '{"validator":{"$jsonSchema":{"bsonType":"object"}},"expireAfterSeconds":{"$numberLong":"60"}}',
    );
    expect(options['validator']).toEqual({ $jsonSchema: { bsonType: 'object' } });
    expect(options['expireAfterSeconds']).toBeInstanceOf(BSON.Long);
  });
});

describe('listDatabases', () => {
  const noPrivileges = { authInfo: { authenticatedUserPrivileges: [] }, ok: 1 };

  it('asks names only by default, reads answers raw and sorts by name', async () => {
    const client = fakeClient((_db, command) =>
      'listDatabases' in command
        ? { databases: [{ name: 'shop' }, { name: 'admin' }, { name: 'local' }], ok: 1 }
        : noPrivileges,
    );
    await expect(listDatabases(client, false)).resolves.toEqual({
      databases: [{ name: 'admin' }, { name: 'local' }, { name: 'shop' }],
    });
    expect(client.sent[0]).toMatchObject({
      db: 'admin',
      command: { listDatabases: 1, nameOnly: true },
      options: {
        promoteLongs: false,
        bsonRegExp: true,
        fieldsAsRaw: { firstBatch: true, nextBatch: true },
      },
    });
    // promoteValues: false in the command options would turn MongoServerError.code into an
    // Int32 object (round-1 CR-2): batch documents are kept by decoding their bytes instead.
    expect(client.sent[0]?.options?.promoteValues).toBeUndefined();
    expect(client.sent[1]).toMatchObject({
      db: 'admin',
      command: { connectionStatus: 1, showPrivileges: true },
    });
  });

  it('withSizes reads sizeOnDisk from Long/Double and keeps empty; drops negative or missing sizes', async () => {
    const client = fakeClient((_db, command) =>
      'listDatabases' in command
        ? {
            databases: [
              { name: 'a', sizeOnDisk: BSON.Long.fromNumber(8192), empty: false },
              { name: 'b', sizeOnDisk: new BSON.Double(0), empty: true },
              { name: 'c', sizeOnDisk: new BSON.Int32(-1) },
              { name: 'd' },
            ],
            ok: 1,
          }
        : noPrivileges,
    );
    const { databases } = await listDatabases(client, true);
    expect(databases).toEqual([
      { name: 'a', sizeOnDisk: 8192, empty: false },
      { name: 'b', sizeOnDisk: 0, empty: true },
      { name: 'c' },
      { name: 'd' },
    ]);
    expect(client.sent[0]?.command).toEqual({ listDatabases: 1, nameOnly: false });
  });

  it('adds databases the user holds privileges on that the server did not list (no duplicates)', async () => {
    const client = fakeClient((_db, command) =>
      'listDatabases' in command
        ? { databases: [{ name: 'reports' }], ok: 1 }
        : {
            authInfo: {
              authenticatedUserPrivileges: [
                { resource: { db: 'reports', collection: '' }, actions: ['find'] },
                { resource: { db: 'fresh', collection: '' }, actions: ['find'] },
                { resource: { db: 'fresh', collection: 'orders' }, actions: ['insert'] },
                { resource: { db: '', collection: '' }, actions: ['find'] },
                { resource: { cluster: true }, actions: ['listDatabases'] },
                { resource: { anyResource: true }, actions: ['anyAction'] },
                { actions: ['find'] },
              ],
            },
            ok: 1,
          },
    );
    await expect(listDatabases(client, true)).resolves.toEqual({
      databases: [{ name: 'fresh' }, { name: 'reports' }],
    });
  });

  it('when listDatabases is Unauthorized, the privileged databases are the list', async () => {
    const client = fakeClient((_db, command) => {
      if ('listDatabases' in command) throw serverError(13, 'Unauthorized', 'not authorized');
      return {
        authInfo: {
          authenticatedUserPrivileges: [
            { resource: { db: 'zeta', collection: '' }, actions: ['find'] },
            { resource: { db: 'alpha', collection: '' }, actions: ['find'] },
          ],
        },
        ok: 1,
      };
    });
    await expect(listDatabases(client, false)).resolves.toEqual({
      databases: [{ name: 'alpha' }, { name: 'zeta' }],
    });
  });

  it('recognises Unauthorized by code name too', async () => {
    const client = fakeClient((_db, command) => {
      if ('listDatabases' in command)
        throw Object.assign(new Error('no'), { codeName: 'Unauthorized' });
      return noPrivileges;
    });
    await expect(listDatabases(client, false)).resolves.toEqual({ databases: [] });
  });

  it('other listDatabases errors are mapped and thrown (no connectionStatus fallback)', async () => {
    const client = fakeClient(() => {
      throw serverError(8000, 'AtlasError', 'something failed');
    });
    const error = await rejection(listDatabases(client, false));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toMatchObject({ serverCode: 8000, codeName: 'AtlasError' });
    expect(client.sent).toHaveLength(1);
  });

  it('when listDatabases is Unauthorized and connectionStatus fails too, the refusal is answered', async () => {
    const client = fakeClient((_db, command) => {
      if ('listDatabases' in command)
        throw serverError(13, 'Unauthorized', 'not authorized on admin');
      throw serverError(8000, 'AtlasError', 'no connectionStatus');
    });
    const error = await rejection(listDatabases(client, false));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toEqual({ serverCode: 13, codeName: 'Unauthorized' });
    expect(error.message).toMatch(/not authorized on admin/);
  });

  it('a failing connectionStatus does not fail the listing', async () => {
    const client = fakeClient((_db, command) => {
      if ('listDatabases' in command) return { databases: [{ name: 'shop' }], ok: 1 };
      throw serverError(13, 'Unauthorized', 'no connectionStatus');
    });
    await expect(listDatabases(client, false)).resolves.toEqual({ databases: [{ name: 'shop' }] });
  });

  it('recognises Unauthorized given as an unpromoted Int32 code (CR-2)', async () => {
    const client = fakeClient((_db, command) => {
      if ('listDatabases' in command) {
        throw Object.assign(new Error('not authorized on admin'), {
          name: 'MongoServerError',
          code: new BSON.Int32(13),
        });
      }
      return {
        authInfo: {
          authenticatedUserPrivileges: [{ resource: { db: 'reports', collection: '' } }],
        },
        ok: 1,
      };
    });
    await expect(listDatabases(client, false)).resolves.toEqual({
      databases: [{ name: 'reports' }],
    });
  });

  it('when listDatabases is Unauthorized and connectionStatus has a network error, the refusal is answered', async () => {
    const client = fakeClient((_db, command) => {
      if ('listDatabases' in command) throw serverError(13, 'Unauthorized', 'not authorized');
      throw new MongoNetworkError('connection 4 to db.example.test:27017 closed');
    });
    const error = await rejection(listDatabases(client, false));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toEqual({ serverCode: 13, codeName: 'Unauthorized' });
  });

  it('a network error of listDatabases is answered as such, without asking connectionStatus', async () => {
    const client = fakeClient(() => {
      throw new MongoNetworkError('connection 4 to db.example.test:27017 closed');
    });
    expect((await rejection(listDatabases(client, false))).code).toBe('NETWORK_ERROR');
    expect(client.sent).toHaveLength(1);
  });

  it('a listDatabases answer without a databases array is INTERNAL (browse prefix)', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    const error = await rejection(listDatabases(client, false));
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toMatch(/^Unexpected error while browsing/);
  });

  it('connectionStatus without authInfo adds nothing', async () => {
    const client = fakeClient((_db, command) =>
      'listDatabases' in command ? { databases: [{ name: 'shop' }], ok: 1 } : { ok: 1 },
    );
    await expect(listDatabases(client, false)).resolves.toEqual({ databases: [{ name: 'shop' }] });
  });
});

describe('db.create / db.drop / db.stats', () => {
  it('createDatabase creates the first collection in that database', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    await expect(createDatabase(client, 'shop', 'orders')).resolves.toEqual({});
    expect(client.sent).toEqual([
      { db: 'shop', command: { create: 'orders' }, options: expect.anything() },
    ]);
  });

  it('dropDatabase runs dropDatabase on that database', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    await expect(dropDatabase(client, 'shop')).resolves.toEqual({});
    expect(client.sent[0]).toMatchObject({ db: 'shop', command: { dropDatabase: 1 } });
  });

  it('maps a server error of a write', async () => {
    const client = fakeClient(() => {
      throw serverError(48, 'NamespaceExists', 'already exists');
    });
    const error = await rejection(createDatabase(client, 'shop', 'orders'));
    expect(error.code).toBe('SERVER_ERROR');
  });

  it('decodes batch documents given as bytes without promotion: whole-number Doubles stay Doubles in raw', async () => {
    const entry = {
      name: 'v',
      type: 'view',
      options: {
        viewOn: 'c',
        pipeline: [{ $match: { x: new BSON.Double(1), y: BSON.Long.fromNumber(2), z: 3 } }],
      },
    };
    const cursor = {
      id: BSON.Long.fromNumber(0),
      ns: 'shop.$cmd',
      firstBatch: [BSON.serialize(entry)],
    };
    const client = fakeClient(() => ({ cursor, ok: 1 }));
    const { collections } = await listCollections(client, 'shop');
    expect(collections.map((c) => [c.name, c.type, c.viewOn])).toEqual([['v', 'view', 'c']]);
    expect(JSON.parse(collections[0]?.raw ?? '{}')).toMatchObject({
      options: {
        pipeline: [
          {
            $match: {
              x: { $numberDouble: '1.0' },
              y: { $numberLong: '2' },
              z: { $numberInt: '3' },
            },
          },
        ],
      },
    });
  });

  it('databaseStats reads unpromoted numerics and keeps raw canonical EJSON', async () => {
    const client = fakeClient(() => ({
      db: 'shop',
      collections: new BSON.Int32(3),
      views: new BSON.Int32(1),
      objects: BSON.Long.fromNumber(12),
      dataSize: new BSON.Double(2048.5),
      storageSize: new BSON.Double(8192),
      indexSize: new BSON.Double(4096),
      ok: new BSON.Double(1),
    }));
    const stats = await databaseStats(client, 'shop');
    expect(stats).toMatchObject({
      collections: 3,
      views: 1,
      objects: 12,
      dataSize: 2048.5,
      storageSize: 8192,
      indexSize: 4096,
    });
    expect(client.sent[0]).toMatchObject({ db: 'shop', command: { dbStats: 1, scale: 1 } });
    expect(JSON.parse(stats.raw)).toMatchObject({
      objects: { $numberLong: '12' },
      collections: { $numberInt: '3' },
    });
  });

  it('databaseStats answers 0 for missing, negative or non-finite values and truncates counts', async () => {
    const client = fakeClient(() => ({
      collections: new BSON.Double(2.9),
      objects: new BSON.Double(-5),
      dataSize: BSON.Decimal128.fromString('NaN'),
      storageSize: 'large',
      ok: 1,
    }));
    await expect(databaseStats(client, 'empty')).resolves.toMatchObject({
      collections: 2,
      views: 0,
      objects: 0,
      dataSize: 0,
      storageSize: 0,
      indexSize: 0,
    });
  });
});

/** A cursor answer of a command (`firstBatch`) or a getMore (`nextBatch`). */
function cursorAnswer(id: number, batch: Document[], first: boolean, ns = 'shop.$cmd') {
  return {
    cursor: { id: BSON.Long.fromNumber(id), ns, [first ? 'firstBatch' : 'nextBatch']: batch },
    ok: 1,
  };
}

describe('listCollections', () => {
  const entry = (name: string, type = 'collection', options: Document = {}) => ({
    name,
    type,
    options,
    info: { readOnly: false },
  });

  it('types collections, views and time series, sets viewOn and sorts by name', async () => {
    const client = fakeClient(() =>
      cursorAnswer(
        0,
        [
          entry('orders_view', 'view', { viewOn: 'orders', pipeline: [] }),
          entry('orders'),
          entry('metrics', 'timeseries', { timeseries: { timeField: 't' } }),
          entry('system.views'),
          entry('unknownKind', 'somethingNew'),
        ],
        true,
      ),
    );
    const { collections } = await listCollections(client, 'shop');
    expect(collections.map((c) => [c.name, c.type, c.viewOn])).toEqual([
      ['metrics', 'timeseries', undefined],
      ['orders', 'collection', undefined],
      ['orders_view', 'view', 'orders'],
      ['system.views', 'collection', undefined],
      ['unknownKind', 'collection', undefined],
    ]);
    expect(client.sent[0]).toMatchObject({
      db: 'shop',
      command: { listCollections: 1, cursor: {} },
      options: { fieldsAsRaw: { firstBatch: true, nextBatch: true } },
    });
    const raw = JSON.parse(collections[0]?.raw ?? '{}') as Document;
    expect(raw).toMatchObject({ name: 'metrics', options: { timeseries: { timeField: 't' } } });
  });

  it('hides system.buckets.<name> only when its time series <name> is listed', async () => {
    const client = fakeClient(() =>
      cursorAnswer(
        0,
        [
          entry('series', 'timeseries'),
          entry('system.buckets.series'),
          entry('system.buckets.orphan'),
        ],
        true,
      ),
    );
    const { collections } = await listCollections(client, 'shop');
    expect(collections.map((c) => c.name)).toEqual(['series', 'system.buckets.orphan']);
  });

  it('a view without a string viewOn has no viewOn', async () => {
    const client = fakeClient(() => cursorAnswer(0, [{ name: 'v', type: 'view' }], true));
    const { collections } = await listCollections(client, 'shop');
    expect(collections).toEqual([{ name: 'v', type: 'view', raw: expect.any(String) }]);
  });

  it('pages through every batch with getMore on $cmd.listCollections', async () => {
    const answers = [
      cursorAnswer(77, [entry('c1'), entry('c2')], true),
      cursorAnswer(77, [entry('c3')], false),
      cursorAnswer(0, [entry('c4')], false),
    ];
    const client = fakeClient(() => answers.shift() ?? { ok: 0 });
    const { collections } = await listCollections(client, 'shop');
    expect(collections.map((c) => c.name)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(client.sent.map((s) => firstKey(s.command))).toEqual([
      'listCollections',
      'getMore',
      'getMore',
    ]);
    const getMore = client.sent[1]?.command;
    expect(getMore?.['collection']).toBe('$cmd.listCollections');
    expect(BSON.Long.isLong(getMore?.['getMore'])).toBe(true);
    expect(String(getMore?.['getMore'])).toBe('77');
  });

  it('a cancel between batches kills the cursor and answers CANCELLED', async () => {
    const controller = new AbortController();
    const client = fakeClient((_db, command) => {
      if ('listCollections' in command) {
        controller.abort();
        return cursorAnswer(91, [entry('c1')], true);
      }
      return { ok: 1 };
    });
    const error = await rejection(listCollections(client, 'shop', controller.signal));
    expect(error.code).toBe('CANCELLED');
    expect(client.sent.map((s) => s.command)).toEqual([
      { listCollections: 1, cursor: {} },
      { killCursors: '$cmd.listCollections', cursors: [BSON.Long.fromNumber(91)] },
    ]);
  });

  it('a failing killCursors still answers CANCELLED', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = fakeClient((_db, command) => {
      if ('killCursors' in command) throw serverError(43, 'CursorNotFound', 'gone');
      return cursorAnswer(5, [], true);
    });
    expect((await rejection(listCollections(client, 'shop', controller.signal))).code).toBe(
      'CANCELLED',
    );
  });

  it('an exhausted first batch needs no getMore, even when cancelled meanwhile', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = fakeClient(() => cursorAnswer(0, [entry('only')], true));
    const { collections } = await listCollections(client, 'shop', controller.signal);
    expect(collections.map((c) => c.name)).toEqual(['only']);
    expect(client.sent).toHaveLength(1);
  });

  it('an answer without a cursor is INTERNAL', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    expect((await rejection(listCollections(client, 'shop'))).code).toBe('INTERNAL');
  });

  it('a failing getMore is mapped', async () => {
    const client = fakeClient((_db, command) => {
      if ('getMore' in command) throw serverError(43, 'CursorNotFound', 'cursor id 3 not found');
      return cursorAnswer(3, [entry('c1')], true);
    });
    const error = await rejection(listCollections(client, 'shop'));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toMatchObject({ codeName: 'CursorNotFound' });
  });
});

describe('coll.create / coll.drop / coll.rename', () => {
  it('createCollection puts create first and lets options not rename the collection', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    await createCollection(
      client,
      'shop',
      'events',
      '{"create":"other","capped":true,"size":{"$numberInt":"4096"}}',
    );
    const [sent] = client.sent;
    expect(sent?.db).toBe('shop');
    expect(Object.keys(sent?.command ?? {})).toEqual(['create', 'capped', 'size']);
    expect(sent?.command['create']).toBe('events');
    expect(sent?.command['size']).toEqual(new BSON.Int32(4096));
  });

  it('createCollection without options sends only create', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    await expect(createCollection(client, 'shop', 'events', undefined)).resolves.toEqual({});
    expect(client.sent[0]?.command).toEqual({ create: 'events' });
  });

  it('createCollection refuses invalid options before sending anything', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    expect((await rejection(createCollection(client, 'shop', 'e', '[]'))).code).toBe(
      'INVALID_PARAMS',
    );
    expect(client.sent).toEqual([]);
  });

  it('createCollection does not create a collection from a date given as options', async () => {
    // Regression guard for TW-1: '{"$date":...}' passes the contract check (starts with "{").
    const client = fakeClient(() => ({ ok: 1 }));
    const error = await rejection(
      createCollection(client, 'shop', 'e', '{"$date":{"$numberLong":"0"}}'),
    );
    expect(error.code).toBe('INVALID_PARAMS');
    expect(client.sent).toEqual([]);
  });

  it('dropCollection runs drop on the database', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    await expect(dropCollection(client, 'shop', 'orders')).resolves.toEqual({});
    expect(client.sent[0]).toMatchObject({ db: 'shop', command: { drop: 'orders' } });
  });

  it('createCollection of a name whose message mentions certificates is SERVER_ERROR, not TLS_ERROR (CR-1)', async () => {
    const client = fakeClient(() => {
      throw serverError(
        48,
        'NamespaceExists',
        'Collection shop.certificates already exists with different options',
      );
    });
    const error = await rejection(createCollection(client, 'shop', 'certificates', '{}'));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toEqual({ serverCode: 48, codeName: 'NamespaceExists' });
  });

  it('createCollection accepts a document whose fields are EJSON values (only the top level must be plain)', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    await createCollection(
      client,
      'shop',
      'logs',
      '{"expireAfterSeconds":{"$numberLong":"60"},"timeseries":{"timeField":"t"}}',
    );
    expect(client.sent[0]?.command['expireAfterSeconds']).toBeInstanceOf(BSON.Long);
  });

  it('dropCollection of a missing collection is NOT_FOUND', async () => {
    const client = fakeClient(() => {
      throw serverError(26, 'NamespaceNotFound', 'ns not found');
    });
    expect((await rejection(dropCollection(client, 'shop', 'ghost'))).code).toBe('NOT_FOUND');
  });

  it('renameCollection runs on admin with full namespaces in the same database', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    await expect(renameCollection(client, 'shop', 'old', 'new', true)).resolves.toEqual({});
    expect(client.sent[0]).toMatchObject({
      db: 'admin',
      command: { renameCollection: 'shop.old', to: 'shop.new', dropTarget: true },
    });
  });
});

describe('collectionStats', () => {
  const stats = (fields: Document, shard?: string) => ({
    ns: 'shop.orders',
    ...(shard ? { shard } : {}),
    storageStats: fields,
  });

  it('runs $collStats storageStats and reads one answer; raw is that document', async () => {
    const client = fakeClient(() =>
      cursorAnswer(
        0,
        [
          stats({
            count: new BSON.Int32(5),
            size: new BSON.Int32(250),
            storageSize: BSON.Long.fromNumber(4096),
            totalIndexSize: new BSON.Int32(8192),
            nindexes: new BSON.Int32(2),
          }),
        ],
        true,
      ),
    );
    const result = await collectionStats(client, 'shop', 'orders');
    expect(result).toMatchObject({
      count: 5,
      size: 250,
      storageSize: 4096,
      totalIndexSize: 8192,
      nindexes: 2,
    });
    expect(client.sent[0]).toMatchObject({
      db: 'shop',
      command: {
        aggregate: 'orders',
        pipeline: [{ $collStats: { storageStats: { scale: 1 } } }],
        cursor: {},
      },
    });
    expect(JSON.parse(result.raw)).toMatchObject({
      ns: 'shop.orders',
      storageStats: { storageSize: { $numberLong: '4096' } },
    });
  });

  it('sums counts and sizes over shards, takes the largest nindexes; raw lists the shards', async () => {
    const client = fakeClient(() =>
      cursorAnswer(
        0,
        [
          stats({ count: 3, size: 30, storageSize: 300, totalIndexSize: 3000, nindexes: 2 }, 's0'),
          stats({ count: 4, size: 40, storageSize: 400, totalIndexSize: 4000, nindexes: 3 }, 's1'),
          stats({}, 's2'),
        ],
        true,
      ),
    );
    const result = await collectionStats(client, 'shop', 'orders');
    expect(result).toMatchObject({
      count: 7,
      size: 70,
      storageSize: 700,
      totalIndexSize: 7000,
      nindexes: 3,
    });
    const raw = JSON.parse(result.raw) as { shards: { shard: string }[] };
    expect(raw.shards.map((s) => s.shard)).toEqual(['s0', 's1', 's2']);
  });

  it('a document without storageStats counts as zeros', async () => {
    const client = fakeClient(() => cursorAnswer(0, [{ ns: 'shop.orders' }], true));
    await expect(collectionStats(client, 'shop', 'orders')).resolves.toMatchObject({
      count: 0,
      size: 0,
      storageSize: 0,
      totalIndexSize: 0,
      nindexes: 0,
    });
  });

  it('no stats document is NOT_FOUND', async () => {
    const client = fakeClient(() => cursorAnswer(0, [], true));
    const error = await rejection(collectionStats(client, 'shop', 'ghost'));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Collection shop.ghost does not exist');
  });

  it('pages through shards with getMore on the collection and kills it on cancel', async () => {
    const controller = new AbortController();
    const client = fakeClient((_db, command) => {
      if ('aggregate' in command) return cursorAnswer(12, [stats({ count: 1 }, 's0')], true);
      if ('getMore' in command) {
        controller.abort();
        return cursorAnswer(12, [stats({ count: 1 }, 's1')], false);
      }
      return { ok: 1 };
    });
    const error = await rejection(collectionStats(client, 'shop', 'orders', controller.signal));
    expect(error.code).toBe('CANCELLED');
    expect(client.sent.map((s) => s.command)).toEqual([
      expect.objectContaining({ aggregate: 'orders' }),
      { getMore: BSON.Long.fromNumber(12), collection: 'orders' },
      { killCursors: 'orders', cursors: [BSON.Long.fromNumber(12)] },
    ]);
  });
});

// Round 3 (round-2 CR-1): cursor batches arrive as BSON bytes (`fieldsAsRaw`) and are decoded
// without promotion, so `raw` keeps every BSON type, also in getMore batches and $collStats.
describe('lossless cursor batches given as BSON bytes', () => {
  /** A cursor answer whose batch documents are BSON bytes, like the driver hands them with fieldsAsRaw. */
  function rawCursorAnswer(id: number, batch: Document[], first: boolean, ns = 'shop.$cmd') {
    return cursorAnswer(
      id,
      batch.map((doc) => BSON.serialize(doc)) as unknown as Document[],
      first,
      ns,
    );
  }

  /** The canonical EJSON text, read back and serialized, gives the server's exact bytes. */
  function expectSameBson(raw: string, original: Document) {
    const reparsed = BSON.EJSON.parse(raw, { relaxed: false }) as Document;
    expect(
      Buffer.from(BSON.serialize(reparsed)).equals(Buffer.from(BSON.serialize(original))),
    ).toBe(true);
  }

  const validatedEntry = {
    name: 'orders',
    type: 'collection',
    options: {
      validator: {
        $and: [
          { total: { $gte: new BSON.Double(0) } },
          { qty: { $lte: BSON.Long.fromString('9007199254740993') } },
          { tag: new BSON.BSONRegExp('^ord-', 'i') },
          { price: { $ne: BSON.Decimal128.fromString('0.10') } },
          { half: new BSON.Double(-0) },
          { big: new BSON.Double(Infinity) },
          { since: { $gt: new Date('2026-01-02T03:04:05.006Z') } },
          { blob: new BSON.Binary(new Uint8Array([1, 2, 3]), 0) },
          { ts: new BSON.Timestamp({ t: 1_700_000_000, i: 7 }) },
          { lo: new BSON.MinKey() },
        ],
      },
      validationLevel: 'strict',
      size: new BSON.Int32(4096),
    },
    info: { readOnly: false, uuid: new BSON.Binary(new Uint8Array(16), 4) },
    idIndex: { v: new BSON.Int32(2), key: { _id: new BSON.Int32(1) }, name: '_id_' },
  };

  it('coll.list raw of a validator keeps Double, Int64 beyond 2^53, Decimal128, regex, Binary, Date and Timestamp', async () => {
    const client = fakeClient(() => rawCursorAnswer(0, [validatedEntry], true));
    const { collections } = await listCollections(client, 'shop');
    expect(collections).toHaveLength(1);
    const raw = collections[0]?.raw ?? '';
    expectSameBson(raw, validatedEntry);
    const parsed = JSON.parse(raw) as { options: { validator: { $and: Document[] } } };
    expect(parsed.options.validator.$and).toEqual([
      { total: { $gte: { $numberDouble: '0.0' } } },
      { qty: { $lte: { $numberLong: '9007199254740993' } } },
      { tag: { $regularExpression: { pattern: '^ord-', options: 'i' } } },
      { price: { $ne: { $numberDecimal: '0.10' } } },
      { half: { $numberDouble: '-0.0' } },
      { big: { $numberDouble: 'Infinity' } },
      { since: { $gt: { $date: { $numberLong: '1767323045006' } } } },
      { blob: { $binary: { base64: 'AQID', subType: '00' } } },
      { ts: { $timestamp: { t: 1_700_000_000, i: 7 } } },
      { lo: { $minKey: 1 } },
    ]);
    expect(JSON.parse(raw)).toMatchObject({
      options: { size: { $numberInt: '4096' } },
      idIndex: { v: { $numberInt: '2' } },
    });
  });

  it('decodes getMore nextBatch bytes losslessly, like the first batch', async () => {
    const view = (name: string, x: number) => ({
      name,
      type: 'view',
      options: { viewOn: 'orders', pipeline: [{ $match: { x: new BSON.Double(x) } }] },
    });
    const answers = [
      rawCursorAnswer(55, [view('v1', 1)], true),
      rawCursorAnswer(55, [view('v2', 2), view('v3', 3)], false),
      rawCursorAnswer(0, [view('v4', 4)], false),
    ];
    const client = fakeClient(() => answers.shift() ?? { ok: 0 });
    const { collections } = await listCollections(client, 'shop');
    expect(collections.map((c) => [c.name, c.type, c.viewOn])).toEqual([
      ['v1', 'view', 'orders'],
      ['v2', 'view', 'orders'],
      ['v3', 'view', 'orders'],
      ['v4', 'view', 'orders'],
    ]);
    collections.forEach((c, i) => {
      expect(JSON.parse(c.raw)).toMatchObject({
        options: { pipeline: [{ $match: { x: { $numberDouble: `${i + 1}.0` } } }] },
      });
    });
    // getMore is still sent with the Long cursor id (fieldsAsRaw does not touch `id`).
    expect(client.sent.map((s) => s.command)).toEqual([
      { listCollections: 1, cursor: {} },
      { getMore: BSON.Long.fromNumber(55), collection: '$cmd.listCollections' },
      { getMore: BSON.Long.fromNumber(55), collection: '$cmd.listCollections' },
    ]);
    for (const sent of client.sent) {
      expect(sent.options).toMatchObject({ fieldsAsRaw: { firstBatch: true, nextBatch: true } });
      expect(sent.options?.promoteValues).toBeUndefined();
    }
  });

  it('hides system.buckets.<name> and reads viewOn from byte-decoded entries', async () => {
    const client = fakeClient(() =>
      rawCursorAnswer(
        0,
        [
          { name: 'series', type: 'timeseries', options: { timeseries: { timeField: 't' } } },
          { name: 'system.buckets.series', type: 'collection', options: {} },
        ],
        true,
      ),
    );
    const { collections } = await listCollections(client, 'shop');
    expect(collections.map((c) => [c.name, c.type])).toEqual([['series', 'timeseries']]);
  });

  it('decodes a batch document given as a Uint8Array view with a byte offset', async () => {
    const bytes = BSON.serialize(validatedEntry);
    const backing = new Uint8Array(bytes.length + 11);
    backing.set(bytes, 7);
    const view = new Uint8Array(backing.buffer, 7, bytes.length);
    expect(Buffer.isBuffer(view)).toBe(false);
    const client = fakeClient(() => cursorAnswer(0, [view as unknown as Document], true));
    const { collections } = await listCollections(client, 'shop');
    expect(collections.map((c) => c.name)).toEqual(['orders']);
    expectSameBson(collections[0]?.raw ?? '', validatedEntry);
  });

  it('a cursor without a batch array lists nothing (and coll.stats answers NOT_FOUND)', async () => {
    const noBatch = { cursor: { id: BSON.Long.fromNumber(0), ns: 'shop.$cmd' }, ok: 1 };
    await expect(
      listCollections(
        fakeClient(() => noBatch),
        'shop',
      ),
    ).resolves.toEqual({
      collections: [],
    });
    const error = await rejection(
      collectionStats(
        fakeClient(() => noBatch),
        'shop',
        'orders',
      ),
    );
    expect(error.code).toBe('NOT_FOUND');
  });

  it('coll.stats reads unpromoted Int32/Long/Double sizes from bytes; raw keeps whole-number Doubles', async () => {
    const statsDoc = {
      ns: 'shop.orders',
      host: 'db0.example.test:27017',
      localTime: new Date('2026-11-16T12:00:00.000Z'),
      storageStats: {
        size: new BSON.Double(250),
        count: new BSON.Int32(5),
        avgObjSize: new BSON.Double(50),
        storageSize: BSON.Long.fromNumber(4096),
        freeStorageSize: new BSON.Int32(0),
        capped: false,
        nindexes: new BSON.Int32(2),
        totalIndexSize: new BSON.Double(8192),
        totalSize: BSON.Long.fromNumber(12288),
        scaleFactor: new BSON.Int32(1),
      },
    };
    const client = fakeClient(() => rawCursorAnswer(0, [statsDoc], true, 'shop.orders'));
    const result = await collectionStats(client, 'shop', 'orders');
    expect(result).toMatchObject({
      count: 5,
      size: 250,
      storageSize: 4096,
      totalIndexSize: 8192,
      nindexes: 2,
    });
    expectSameBson(result.raw, statsDoc);
    expect(JSON.parse(result.raw)).toMatchObject({
      storageStats: {
        size: { $numberDouble: '250.0' },
        count: { $numberInt: '5' },
        avgObjSize: { $numberDouble: '50.0' },
        storageSize: { $numberLong: '4096' },
        totalIndexSize: { $numberDouble: '8192.0' },
      },
    });
  });

  it('coll.stats over shards in a getMore batch: sums decoded values, raw shards stay lossless', async () => {
    const shard = (name: string, count: number) => ({
      ns: 'shop.orders',
      shard: name,
      storageStats: {
        count: BSON.Long.fromNumber(count),
        size: new BSON.Double(count * 10),
        storageSize: new BSON.Int32(count * 100),
        totalIndexSize: new BSON.Double(count * 1000),
        nindexes: new BSON.Int32(count),
      },
    });
    const answers = [
      rawCursorAnswer(8, [shard('s0', 1)], true, 'shop.orders'),
      rawCursorAnswer(0, [shard('s1', 2)], false, 'shop.orders'),
    ];
    const client = fakeClient(() => answers.shift() ?? { ok: 0 });
    const result = await collectionStats(client, 'shop', 'orders');
    expect(result).toMatchObject({
      count: 3,
      size: 30,
      storageSize: 300,
      totalIndexSize: 3000,
      nindexes: 2,
    });
    expect(client.sent[1]?.command).toEqual({
      getMore: BSON.Long.fromNumber(8),
      collection: 'orders',
    });
    expectSameBson(result.raw, { shards: [shard('s0', 1), shard('s1', 2)] });
  });
});
