import { BSON, MongoServerError, type Document, type RunCommandOptions } from 'mongodb';
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

  it('classifies network errors like the connection code does', () => {
    const network = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(toBrowseError(network).code).toBe('NETWORK_ERROR');
    expect(toBrowseError(new Error('boom')).code).toBe('INTERNAL');
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
      options: { promoteLongs: false, promoteValues: false },
    });
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

  it('a failing connectionStatus does not fail the listing', async () => {
    const client = fakeClient((_db, command) => {
      if ('listDatabases' in command) return { databases: [{ name: 'shop' }], ok: 1 };
      throw serverError(13, 'Unauthorized', 'no connectionStatus');
    });
    await expect(listDatabases(client, false)).resolves.toEqual({ databases: [{ name: 'shop' }] });
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
      options: { promoteValues: false },
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
