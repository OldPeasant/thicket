import { randomBytes } from 'node:crypto';

import { BSON, BSONRegExp, Decimal128, Double, Int32, Long, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  ConnectionManager,
  RpcClient,
  RpcError,
  browseHandlers,
  guardWrites,
  serve,
} from '@thicket/backend';
import { methods, type MethodName, type Profile, type ResultOf } from '@thicket/contract';

import { portPair } from '../../packages/backend/src/server/testing';
import { startFixture, type StartedFixture } from './fixtures/mongo';

// db.* and coll.* (task browse-backend) against the 8.x replica set fixture, served like the
// backend serves them: contract validation of params and results, write guard around the writes.

const mongo = inject('mongo');
const rs = mongo.mongo8rs;

function profile(id: string, fields: Partial<Profile> = {}): Profile {
  return {
    id,
    name: `Profile ${id}`,
    connectionString: rs.uri,
    readOnly: false,
    production: false,
    serverSelectionTimeoutMS: 10_000,
    ...fields,
  };
}

/** A backend (manager + guarded browse handlers) behind a real `serve()`, and a client for it. */
function backendFor(profiles: Profile[], secrets: Record<string, Record<string, string>> = {}) {
  const loadProfile = (id: string) => {
    const found = profiles.find((p) => p.id === id);
    return found
      ? Promise.resolve(found)
      : Promise.reject(new RpcError('NOT_FOUND', `No profile with id ${id}`));
  };
  const manager = new ConnectionManager({
    loadProfile,
    loadSecrets: (id) => Promise.resolve(secrets[id] ?? null),
  });
  const [serverPort, clientPort] = portPair();
  const stop = serve(serverPort, {
    table: methods,
    route: 'backend',
    handlers: guardWrites(browseHandlers(manager), loadProfile),
  });
  const client = new RpcClient(clientPort);
  const call = <M extends MethodName>(method: M, params: unknown) =>
    client.call(method, params) as Promise<ResultOf<M>>;
  const close = async () => {
    client.close();
    stop();
    await manager.closeAll();
  };
  return { manager, call, close };
}

async function failure(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw new Error(`expected an RpcError, got ${String(error)}`, { cause: error });
  }
  throw new Error('expected a failure');
}

const RW = profile('browse-rw');
const RO = profile('browse-ro', { readOnly: true });
const PROD = profile('browse-prod', { production: true });

let backend: ReturnType<typeof backendFor>;
let direct: MongoClient;

/** Unique database names per run, so reruns against a reused fixture don't collide. */
const run = randomBytes(3).toString('hex');
const DB = `browse_${run}`;

beforeAll(async () => {
  direct = new MongoClient(rs.uri, { serverSelectionTimeoutMS: 10_000 });
  backend = backendFor([RW, RO, PROD]);
  for (const p of [RW, RO, PROD]) await backend.manager.open(p.id, undefined);
});

afterAll(async () => {
  for (const name of [DB, `${DB}_new`, `${DB}_ro`, `${DB}_drop`]) {
    await direct.db(name).dropDatabase();
  }
  await backend.close();
  await direct.close();
});

describe('db.* on the 8.x replica set', () => {
  it('db.create creates the database with its first collection; listDatabases lists it', async () => {
    await expect(
      backend.call('db.create', { profileId: RW.id, db: `${DB}_new`, firstCollection: 'first' }),
    ).resolves.toEqual({});
    const names = await direct.db(`${DB}_new`).listCollections().toArray();
    expect(names.map((c) => c.name)).toEqual(['first']);

    const { databases } = await backend.call('db.listDatabases', { profileId: RW.id });
    const listed = databases.find((d) => d.name === `${DB}_new`);
    expect(listed).toEqual({ name: `${DB}_new` });
    expect(databases.map((d) => d.name)).toEqual(expect.arrayContaining(['admin', 'local']));
    // Sorted by name.
    expect(databases.map((d) => d.name)).toEqual([...databases.map((d) => d.name)].sort());
  });

  it('db.listDatabases withSizes reports sizeOnDisk and empty', async () => {
    await direct
      .db(DB)
      .collection('sized')
      .insertMany([{ a: 1 }, { a: 2 }]);
    const { databases } = await backend.call('db.listDatabases', {
      profileId: RW.id,
      withSizes: true,
    });
    const sized = databases.find((d) => d.name === DB);
    expect(sized?.sizeOnDisk).toBeGreaterThan(0);
    expect(sized?.empty).toBe(false);
  });

  it('db.stats counts collections, views and objects; raw is canonical EJSON', async () => {
    const db = direct.db(`${DB}_stats`);
    await db.collection('c1').insertMany([{ x: 1 }, { x: 2 }, { x: 3 }]);
    await db.createCollection('v1', { viewOn: 'c1', pipeline: [] });
    try {
      const stats = await backend.call('db.stats', { profileId: RW.id, db: `${DB}_stats` });
      // c1 and system.views (where the view is defined).
      expect(stats.collections).toBe(2);
      expect(stats.views).toBe(1);
      // Three documents plus the view's definition in system.views.
      expect(stats.objects).toBe(4);
      expect(stats.dataSize).toBeGreaterThan(0);
      expect(stats.storageSize).toBeGreaterThan(0);
      expect(stats.indexSize).toBeGreaterThan(0);
      const raw = JSON.parse(stats.raw) as Record<string, unknown>;
      expect(raw['db']).toBe(`${DB}_stats`);
      // Canonical: numbers keep their BSON type.
      expect(raw['objects']).toMatchObject({ $numberLong: '4' });
    } finally {
      await db.dropDatabase();
    }
  });

  it('db.drop drops the database', async () => {
    await direct.db(`${DB}_drop`).collection('x').insertOne({ a: 1 });
    await expect(backend.call('db.drop', { profileId: RW.id, db: `${DB}_drop` })).resolves.toEqual(
      {},
    );
    const { databases } = await direct.db('admin').admin().listDatabases({ nameOnly: true });
    expect(databases.map((d) => d.name)).not.toContain(`${DB}_drop`);
  });

  it('answers NOT_CONNECTED for a profile without an open connection', async () => {
    const error = await failure(backend.call('db.listDatabases', { profileId: 'nobody' }));
    expect(error.code).toBe('NOT_CONNECTED');
  });
});

describe('coll.* on the 8.x replica set', () => {
  it('coll.list lists collections, views and time series with their raw entries', async () => {
    const db = direct.db(DB);
    await db.collection('plain').insertOne({ a: 1 });
    await db.createCollection('series', { timeseries: { timeField: 't', metaField: 'm' } });
    await db.createCollection('plain_view', {
      viewOn: 'plain',
      pipeline: [{ $match: { x: new Double(1), y: Long.fromNumber(2), z: 3 } }],
    });
    const { collections } = await backend.call('coll.list', { profileId: RW.id, db: DB });
    const byName = Object.fromEntries(collections.map((c) => [c.name, c]));
    expect(byName['plain']?.type).toBe('collection');
    expect(byName['plain_view']).toMatchObject({ type: 'view', viewOn: 'plain' });
    // raw is lossless: a whole-number Double stays a Double, Int64 stays Int64, Int32 stays Int32.
    expect(JSON.parse(byName['plain_view']?.raw ?? '{}')).toMatchObject({
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
    expect(byName['series']?.type).toBe('timeseries');
    // The time series' bucket collection is not listed next to it.
    expect(collections.map((c) => c.name)).not.toContain('system.buckets.series');
    const raw = JSON.parse(byName['series']?.raw ?? '{}') as {
      options: { timeseries: { timeField: string } };
    };
    expect(raw.options.timeseries.timeField).toBe('t');
    expect(collections.map((c) => c.name)).toEqual([...collections.map((c) => c.name)].sort());
  });

  it('coll.list lists 130 collections, each with a lossless raw', async () => {
    // Note: the server answers these 130 entries in its first batch (listCollections has no
    // 101-document default); the getMore path is exercised by the next test.
    const db = direct.db(`${DB}_many`);
    try {
      for (let i = 0; i < 130; i++) {
        await db.createCollection(`c${String(i).padStart(3, '0')}`, {
          validator: { n: { $gte: new Double(i) } },
        });
      }
      const { collections } = await backend.call('coll.list', {
        profileId: RW.id,
        db: `${DB}_many`,
      });
      expect(collections).toHaveLength(130);
      for (const c of collections) {
        const i = Number(c.name.slice(1));
        expect(JSON.parse(c.raw)).toMatchObject({
          options: { validator: { n: { $gte: { $numberDouble: `${i}.0` } } } },
        });
      }
    } finally {
      await db.dropDatabase();
    }
  });

  it('coll.list pages with getMore past a 16 MB first batch; nextBatch entries keep a lossless raw', async () => {
    const db = direct.db(`${DB}_big`);
    // Five ~4 MB validators: more than one 16 MB reply, so the server needs getMore.
    const filler = 'f'.repeat(4 * 1024 * 1024);
    try {
      for (let i = 0; i < 5; i++) {
        await db.createCollection(`big${i}`, {
          validator: { $and: [{ n: { $gte: new Double(i) } }, { s: { $ne: filler } }] },
        });
      }
      const first = await db.command({ listCollections: 1, cursor: {} }, { promoteLongs: false });
      const cursor = first['cursor'] as { id: unknown; firstBatch: unknown[] };
      expect(cursor.firstBatch.length).toBeLessThan(5);
      expect(String(cursor.id)).not.toBe('0');
      await db.command({ killCursors: '$cmd.listCollections', cursors: [cursor.id] });

      const { collections } = await backend.call('coll.list', {
        profileId: RW.id,
        db: `${DB}_big`,
      });
      expect(collections.map((c) => c.name)).toEqual(['big0', 'big1', 'big2', 'big3', 'big4']);
      for (const [i, c] of collections.entries()) {
        expect(JSON.parse(c.raw)).toMatchObject({
          options: { validator: { $and: [{ n: { $gte: { $numberDouble: `${i}.0` } } }, {}] } },
        });
      }
    } finally {
      await db.dropDatabase();
    }
  });

  it('coll.list raw of a validator keeps Double, Int64 beyond 2^53, Decimal128 and regex', async () => {
    await direct.db(DB).createCollection('validated', {
      validator: {
        $and: [
          { total: { $gte: new Double(0) } },
          { qty: { $lte: Long.fromString('9007199254740993') } },
          { price: { $ne: Decimal128.fromString('0.10') } },
          { tag: new BSONRegExp('^ord-', 'i') },
          { small: { $lt: new Int32(7) } },
        ],
      },
    });
    const { collections } = await backend.call('coll.list', { profileId: RW.id, db: DB });
    const entry = collections.find((c) => c.name === 'validated');
    expect(JSON.parse(entry?.raw ?? '{}')).toMatchObject({
      options: {
        validator: {
          $and: [
            { total: { $gte: { $numberDouble: '0.0' } } },
            { qty: { $lte: { $numberLong: '9007199254740993' } } },
            { price: { $ne: { $numberDecimal: '0.10' } } },
            { tag: { $regularExpression: { pattern: '^ord-', options: 'i' } } },
            { small: { $lt: { $numberInt: '7' } } },
          ],
        },
      },
    });
  });

  it('coll.create creates a collection with options given as canonical EJSON', async () => {
    await backend.call('coll.create', {
      profileId: RW.id,
      db: DB,
      coll: 'capped',
      options: JSON.stringify({
        capped: true,
        size: { $numberInt: '65536' },
        validator: { n: { $type: 'int' } },
      }),
    });
    const [info] = await direct.db(DB).listCollections({ name: 'capped' }).toArray();
    expect(info).toMatchObject({
      options: { capped: true, size: 65536, validator: { n: { $type: 'int' } } },
    });
  });

  it('coll.create without options; an existing name with other options is a SERVER_ERROR', async () => {
    await backend.call('coll.create', { profileId: RW.id, db: DB, coll: 'bare' });
    expect(await direct.db(DB).listCollections({ name: 'bare' }).toArray()).toHaveLength(1);
    // MongoDB 7+: `create` of an existing collection with the same options succeeds, other options fail.
    const error = await failure(
      backend.call('coll.create', {
        profileId: RW.id,
        db: DB,
        coll: 'bare',
        options: JSON.stringify({ capped: true, size: { $numberInt: '4096' } }),
      }),
    );
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toEqual({ serverCode: 48, codeName: 'NamespaceExists' });
  });

  it('coll.create refuses options that are not EJSON (INVALID_PARAMS)', async () => {
    const error = await failure(
      backend.call('coll.create', { profileId: RW.id, db: DB, coll: 'bad', options: '{nope' }),
    );
    expect(error.code).toBe('INVALID_PARAMS');
  });

  it('coll.create refuses an EJSON value wrapper as options and creates nothing (TW-1)', async () => {
    const error = await failure(
      backend.call('coll.create', {
        profileId: RW.id,
        db: DB,
        coll: 'dated',
        options: '{"$date":{"$numberLong":"0"}}',
      }),
    );
    expect(error.code).toBe('INVALID_PARAMS');
    expect(await direct.db(DB).listCollections({ name: 'dated' }).toArray()).toEqual([]);
  });

  it('a server refusal whose message names "certificates" is SERVER_ERROR, not TLS_ERROR (CR-1)', async () => {
    await direct.db(DB).createCollection('certificates');
    const error = await failure(
      backend.call('coll.create', {
        profileId: RW.id,
        db: DB,
        coll: 'certificates',
        options: JSON.stringify({ capped: true, size: { $numberInt: '4096' } }),
      }),
    );
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toEqual({ serverCode: 48, codeName: 'NamespaceExists' });
    expect(error.message).toMatch(/^The server refused the command: .*certificates/);
  });

  it('coll.stats reports count, sizes and indexes', async () => {
    const coll = direct.db(DB).collection('counted');
    await coll.insertMany(Array.from({ length: 5 }, (_, i) => ({ i })));
    await coll.createIndex({ i: 1 });
    const stats = await backend.call('coll.stats', { profileId: RW.id, db: DB, coll: 'counted' });
    expect(stats.count).toBe(5);
    expect(stats.size).toBeGreaterThan(0);
    expect(stats.storageSize).toBeGreaterThan(0);
    expect(stats.totalIndexSize).toBeGreaterThan(0);
    expect(stats.nindexes).toBe(2);
    const raw = JSON.parse(stats.raw) as { ns: string; storageStats: Record<string, unknown> };
    expect(raw.ns).toBe(`${DB}.counted`);

    // raw keeps the BSON types the server sent: compare with an unpromoted read of $collStats.
    const [unpromoted] = await direct
      .db(DB)
      .collection('counted')
      .aggregate([{ $collStats: { storageStats: { scale: 1 } } }], {
        promoteValues: false,
        promoteLongs: false,
      })
      .toArray();
    const expected = JSON.parse(BSON.EJSON.stringify(unpromoted ?? {}, { relaxed: false })) as {
      storageStats: Record<string, unknown>;
    };
    const typeOf = (value: unknown) =>
      typeof value === 'object' && value !== null ? Object.keys(value)[0] : typeof value;
    for (const field of [
      'count',
      'size',
      'avgObjSize',
      'storageSize',
      'nindexes',
      'totalIndexSize',
    ]) {
      expect(field in raw.storageStats, field).toBe(true);
      expect(typeOf(raw.storageStats[field]), field).toBe(typeOf(expected.storageStats[field]));
    }
    expect(raw.storageStats['count']).toEqual(expected.storageStats['count']);
    expect(raw.storageStats['nindexes']).toEqual(expected.storageStats['nindexes']);
  });

  it('coll.stats of a missing collection is NOT_FOUND', async () => {
    const error = await failure(
      backend.call('coll.stats', { profileId: RW.id, db: DB, coll: 'missing' }),
    );
    expect(error.code).toBe('NOT_FOUND');
  });

  it('coll.rename renames within the database; dropTarget replaces an existing target', async () => {
    const db = direct.db(DB);
    await db.collection('before').insertOne({ v: 'moved' });
    await backend.call('coll.rename', {
      profileId: RW.id,
      db: DB,
      coll: 'before',
      newName: 'after',
    });
    expect(await db.collection('after').findOne({}, { projection: { _id: 0 } })).toEqual({
      v: 'moved',
    });
    expect(await db.listCollections({ name: 'before' }).toArray()).toEqual([]);

    await db.collection('other').insertOne({ v: 'other' });
    const exists = await failure(
      backend.call('coll.rename', { profileId: RW.id, db: DB, coll: 'other', newName: 'after' }),
    );
    expect(exists.code).toBe('SERVER_ERROR');
    expect(exists.detail).toEqual({ serverCode: 48, codeName: 'NamespaceExists' });
    await backend.call('coll.rename', {
      profileId: RW.id,
      db: DB,
      coll: 'other',
      newName: 'after',
      dropTarget: true,
    });
    expect(await db.collection('after').findOne({}, { projection: { _id: 0 } })).toEqual({
      v: 'other',
    });
  });

  it('coll.rename of a missing collection is NOT_FOUND', async () => {
    const error = await failure(
      backend.call('coll.rename', { profileId: RW.id, db: DB, coll: 'ghost', newName: 'g2' }),
    );
    expect(error.code).toBe('NOT_FOUND');
  });

  it('coll.drop drops a collection and a view', async () => {
    const db = direct.db(DB);
    await db.collection('doomed').insertOne({ a: 1 });
    await db.createCollection('doomed_view', { viewOn: 'doomed', pipeline: [] });
    await backend.call('coll.drop', { profileId: RW.id, db: DB, coll: 'doomed_view' });
    await backend.call('coll.drop', { profileId: RW.id, db: DB, coll: 'doomed' });
    const left = await db.listCollections({ name: /^doomed/ }).toArray();
    expect(left).toEqual([]);
  });
});

describe('the write guard on db.* / coll.*', () => {
  beforeAll(async () => {
    const db = direct.db(`${DB}_ro`);
    await db.collection('keep').insertOne({ a: 1 });
  });

  const writes: [MethodName, Record<string, unknown>][] = [
    ['db.create', { db: `${DB}_ro_new`, firstCollection: 'x' }],
    ['db.drop', { db: `${DB}_ro` }],
    ['coll.create', { db: `${DB}_ro`, coll: 'x' }],
    ['coll.drop', { db: `${DB}_ro`, coll: 'keep' }],
    ['coll.rename', { db: `${DB}_ro`, coll: 'keep', newName: 'renamed' }],
  ];

  it.each(writes)('%s is READ_ONLY on a read-only profile, even confirmed', async (method, p) => {
    for (const confirmed of [undefined, true]) {
      const error = await failure(
        backend.call(method, { profileId: RO.id, ...p, ...(confirmed ? { confirmed } : {}) }),
      );
      expect(error.code).toBe('READ_ONLY');
    }
    // Nothing changed on the server.
    const names = (await direct.db(`${DB}_ro`).listCollections().toArray()).map((c) => c.name);
    expect(names).toEqual(['keep']);
    const dbs = await direct.db('admin').admin().listDatabases({ nameOnly: true });
    expect(dbs.databases.map((d) => d.name)).not.toContain(`${DB}_ro_new`);
  });

  it('reads work on the read-only profile', async () => {
    const { collections } = await backend.call('coll.list', { profileId: RO.id, db: `${DB}_ro` });
    expect(collections.map((c) => c.name)).toEqual(['keep']);
    const stats = await backend.call('coll.stats', {
      profileId: RO.id,
      db: `${DB}_ro`,
      coll: 'keep',
    });
    expect(stats.count).toBe(1);
  });

  it('a production profile needs confirmed: true', async () => {
    const error = await failure(
      backend.call('coll.create', { profileId: PROD.id, db: `${DB}_ro`, coll: 'prod' }),
    );
    expect(error.code).toBe('CONFIRMATION_REQUIRED');
    await backend.call('coll.create', {
      profileId: PROD.id,
      db: `${DB}_ro`,
      coll: 'prod',
      confirmed: true,
    });
    await backend.call('coll.drop', {
      profileId: PROD.id,
      db: `${DB}_ro`,
      coll: 'prod',
      confirmed: true,
    });
  });
});

describe('a user with only `read` on one database (server with access control)', () => {
  // Shared fixtures run without --auth, where privileges aren't enforced: this needs its own server.
  const ROOT = { username: 'root', password: randomBytes(18).toString('base64url') };
  const READER = 'reader';
  const READER_PASSWORD = randomBytes(18).toString('base64url');
  let fixture: StartedFixture;
  let auth: ReturnType<typeof backendFor>;

  beforeAll(async () => {
    fixture = await startFixture({ version: '8', auth: ROOT }, undefined);
    const root = new MongoClient(fixture.info.uri, {
      auth: ROOT,
      authSource: 'admin',
      serverSelectionTimeoutMS: 30_000,
    });
    try {
      await root
        .db('allowed')
        .collection('items')
        .insertMany([{ n: 1 }, { n: 2 }]);
      await root.db('allowed').createCollection('items_view', { viewOn: 'items', pipeline: [] });
      await root.db('hidden').collection('secret').insertOne({ n: 1 });
      await root.db('allowed').command({
        createUser: READER,
        pwd: READER_PASSWORD,
        roles: [{ role: 'read', db: 'allowed' }],
      });
    } finally {
      await root.close();
    }
    const readerProfile: Profile = {
      id: 'reader',
      name: 'reader',
      connectionString: fixture.info.uri,
      auth: {
        mechanism: 'SCRAM-SHA-256',
        username: READER,
        authSource: 'allowed',
        secretMode: 'saved',
      },
      readOnly: false,
      production: false,
      serverSelectionTimeoutMS: 10_000,
    };
    auth = backendFor([readerProfile], { reader: { password: READER_PASSWORD } });
    await auth.manager.open('reader', undefined);
  });

  afterAll(async () => {
    await auth.close();
    await fixture.container.stop();
  });

  it('db.listDatabases lists only the authorized database', async () => {
    const { databases } = await auth.call('db.listDatabases', { profileId: 'reader' });
    expect(databases.map((d) => d.name)).toEqual(['allowed']);
    const sized = await auth.call('db.listDatabases', { profileId: 'reader', withSizes: true });
    expect(sized.databases.map((d) => d.name)).toEqual(['allowed']);
  });

  it('coll.list, coll.stats and db.stats work on that database', async () => {
    const { collections } = await auth.call('coll.list', { profileId: 'reader', db: 'allowed' });
    expect(collections.map((c) => [c.name, c.type])).toEqual([
      ['items', 'collection'],
      ['items_view', 'view'],
      ['system.views', 'collection'],
    ]);
    const stats = await auth.call('coll.stats', {
      profileId: 'reader',
      db: 'allowed',
      coll: 'items',
    });
    expect(stats.count).toBe(2);
    const dbStats = await auth.call('db.stats', { profileId: 'reader', db: 'allowed' });
    expect(dbStats.objects).toBe(3); // two items + the view definition
  });

  it('db.listDatabases adds an authorized database that holds no data yet', async () => {
    // The server's authorizedDatabases listing leaves out databases without data; the privileges
    // from connectionStatus add them, so a user granted `read` on a new database still sees it.
    const password = randomBytes(18).toString('base64url');
    const root = new MongoClient(fixture.info.uri, {
      auth: ROOT,
      authSource: 'admin',
      serverSelectionTimeoutMS: 30_000,
    });
    try {
      await root.db('admin').command({
        createUser: 'fresh_reader',
        pwd: password,
        roles: [
          { role: 'read', db: 'allowed' },
          { role: 'read', db: 'fresh_empty' },
        ],
      });
    } finally {
      await root.close();
    }
    const freshProfile: Profile = {
      id: 'fresh',
      name: 'fresh',
      connectionString: fixture.info.uri,
      auth: {
        mechanism: 'SCRAM-SHA-256',
        username: 'fresh_reader',
        authSource: 'admin',
        secretMode: 'saved',
      },
      readOnly: false,
      production: false,
      serverSelectionTimeoutMS: 10_000,
    };
    const fresh = backendFor([freshProfile], { fresh: { password } });
    try {
      await fresh.manager.open('fresh', undefined);
      const { databases } = await fresh.call('db.listDatabases', { profileId: 'fresh' });
      expect(databases.map((d) => d.name)).toEqual(['allowed', 'fresh_empty']);
      const { collections } = await fresh.call('coll.list', {
        profileId: 'fresh',
        db: 'fresh_empty',
      });
      expect(collections).toEqual([]);
    } finally {
      await fresh.close();
    }
  });

  it('the server refuses other databases (SERVER_ERROR Unauthorized)', async () => {
    const error = await failure(auth.call('coll.list', { profileId: 'reader', db: 'hidden' }));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toEqual({ serverCode: 13, codeName: 'Unauthorized' });
  });
});
