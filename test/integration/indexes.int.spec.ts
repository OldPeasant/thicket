import { randomBytes } from 'node:crypto';

import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  ConnectionManager,
  RpcClient,
  RpcError,
  guardWrites,
  indexHandlers,
  serve,
} from '@thicket/backend';
import { methods, type MethodName, type Profile, type ResultOf } from '@thicket/contract';

import { portPair } from '../../packages/backend/src/server/testing';
import { startFixture, type StartedFixture } from './fixtures/mongo';

// idx.* (task index-backend) against the 8.x replica set fixture, served like the backend serves
// them: contract validation of params and results, write guard around the writes.

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
    handlers: guardWrites(indexHandlers(manager), loadProfile),
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

const RW = profile('idx-rw');
const RO = profile('idx-ro', { readOnly: true });
const PROD = profile('idx-prod', { production: true });

const DB = `idx_${randomBytes(3).toString('hex')}`;
const COLL = 'items';

let backend: ReturnType<typeof backendFor>;
let direct: MongoClient;

const ns = { db: DB, coll: COLL };

/** The server's own `listIndexes` entry of `name`. */
async function serverSpec(name: string, coll = COLL) {
  const specs = await direct.db(DB).collection(coll).listIndexes().toArray();
  return specs.find((s) => s['name'] === name);
}

beforeAll(async () => {
  direct = new MongoClient(rs.uri, { serverSelectionTimeoutMS: 10_000 });
  await direct
    .db(DB)
    .collection(COLL)
    .insertMany([
      { a: 1, b: 'x', title: 'hello world', loc: { type: 'Point', coordinates: [7.4, 46.9] } },
      { a: 2, b: 'y', title: 'goodbye', loc: { type: 'Point', coordinates: [8.5, 47.4] } },
    ]);
  backend = backendFor([RW, RO, PROD]);
  for (const p of [RW, RO, PROD]) await backend.manager.open(p.id, undefined);
});

afterAll(async () => {
  await direct.db(DB).dropDatabase();
  await backend.close();
  await direct.close();
});

describe('idx.create with each option (8.x replica set)', () => {
  const create = (key: string, options?: string) =>
    backend.call('idx.create', {
      profileId: RW.id,
      ...ns,
      key,
      ...(options !== undefined ? { options } : {}),
    });

  it('compound key with mixed directions gets the default name', async () => {
    const { name } = await create('{"a":{"$numberInt":"1"},"b":{"$numberInt":"-1"}}');
    expect(name).toBe('a_1_b_-1');
    expect((await serverSpec(name))?.['key']).toEqual({ a: 1, b: -1 });
    const { indexes } = await backend.call('idx.list', { profileId: RW.id, ...ns });
    const listed = indexes.find((i) => i.name === name);
    expect(listed).toMatchObject({
      key: '{"a":{"$numberInt":"1"},"b":{"$numberInt":"-1"}}',
      unique: false,
      sparse: false,
      hidden: false,
    });
    expect(listed?.expireAfterSeconds).toBeUndefined();
    expect(JSON.parse(listed?.raw ?? '{}')).toMatchObject({ name, v: { $numberInt: '2' } });
  });

  it('unique, with a custom name', async () => {
    const { name } = await create('{"b":{"$numberInt":"1"}}', '{"unique":true,"name":"b_unique"}');
    expect(name).toBe('b_unique');
    expect((await serverSpec(name))?.['unique']).toBe(true);
    const { indexes } = await backend.call('idx.list', { profileId: RW.id, ...ns });
    expect(indexes.find((i) => i.name === name)?.unique).toBe(true);
    // The server enforces it.
    await expect(direct.db(DB).collection(COLL).insertOne({ b: 'x' })).rejects.toThrow(/E11000/);
  });

  it('sparse', async () => {
    const { name } = await create('{"sparseField":{"$numberInt":"1"}}', '{"sparse":true}');
    expect((await serverSpec(name))?.['sparse']).toBe(true);
    const { indexes } = await backend.call('idx.list', { profileId: RW.id, ...ns });
    expect(indexes.find((i) => i.name === name)?.sparse).toBe(true);
  });

  it('partial filter expression', async () => {
    const { name } = await create(
      '{"a":{"$numberInt":"-1"}}',
      '{"partialFilterExpression":{"a":{"$gt":{"$numberInt":"1"}}}}',
    );
    expect((await serverSpec(name))?.['partialFilterExpression']).toEqual({ a: { $gt: 1 } });
    const { indexes } = await backend.call('idx.list', { profileId: RW.id, ...ns });
    expect(indexes.find((i) => i.name === name)?.partialFilterExpression).toBe(
      '{"a":{"$gt":{"$numberInt":"1"}}}',
    );
  });

  it('TTL (expireAfterSeconds)', async () => {
    const { name } = await create(
      '{"createdAt":{"$numberInt":"1"}}',
      '{"expireAfterSeconds":{"$numberInt":"3600"}}',
    );
    expect((await serverSpec(name))?.['expireAfterSeconds']).toBe(3600);
    const { indexes } = await backend.call('idx.list', { profileId: RW.id, ...ns });
    expect(indexes.find((i) => i.name === name)?.expireAfterSeconds).toBe(3600);
  });

  it('collation', async () => {
    const { name } = await create(
      '{"b":{"$numberInt":"-1"}}',
      '{"collation":{"locale":"fr","strength":{"$numberInt":"2"}}}',
    );
    expect((await serverSpec(name))?.['collation']).toMatchObject({ locale: 'fr', strength: 2 });
    const { indexes } = await backend.call('idx.list', { profileId: RW.id, ...ns });
    expect(JSON.parse(indexes.find((i) => i.name === name)?.raw ?? '{}')).toMatchObject({
      collation: { locale: 'fr', strength: { $numberInt: '2' } },
    });
  });

  it('hidden at creation', async () => {
    const { name } = await create('{"hiddenAtStart":{"$numberInt":"1"}}', '{"hidden":true}');
    expect((await serverSpec(name))?.['hidden']).toBe(true);
    const { indexes } = await backend.call('idx.list', { profileId: RW.id, ...ns });
    expect(indexes.find((i) => i.name === name)?.hidden).toBe(true);
  });

  it('text, with weights and a default language', async () => {
    const { name } = await create(
      '{"title":"text"}',
      '{"weights":{"title":{"$numberInt":"5"}},"default_language":"english"}',
    );
    expect(name).toBe('title_text');
    const spec = await serverSpec(name);
    expect(spec?.['weights']).toEqual({ title: 5 });
    expect(spec?.['default_language']).toBe('english');
    // The index is used by $text.
    const found = await direct
      .db(DB)
      .collection(COLL)
      .find({ $text: { $search: 'hello' } })
      .toArray();
    expect(found.map((d) => d['a'])).toEqual([1]);
  });

  it('2dsphere', async () => {
    const { name } = await create('{"loc":"2dsphere"}');
    expect(name).toBe('loc_2dsphere');
    expect((await serverSpec(name))?.['key']).toEqual({ loc: '2dsphere' });
    const near = await direct
      .db(DB)
      .collection(COLL)
      .find({ loc: { $near: { $geometry: { type: 'Point', coordinates: [7.4, 46.9] } } } })
      .toArray();
    expect(near.map((d) => d['a'])).toEqual([1, 2]);
  });

  it('wildcard, with a wildcardProjection', async () => {
    const { name } = await create(
      '{"$**":{"$numberInt":"1"}}',
      '{"wildcardProjection":{"title":{"$numberInt":"0"},"loc":{"$numberInt":"0"}}}',
    );
    expect(name).toBe('$**_1');
    expect((await serverSpec(name))?.['wildcardProjection']).toEqual({ title: 0, loc: 0 });
  });

  it('a server refusal is SERVER_ERROR (TTL on a compound key)', async () => {
    const error = await failure(
      create('{"x":{"$numberInt":"1"},"y":{"$numberInt":"1"}}', '{"expireAfterSeconds":10}'),
    );
    expect(error.code).toBe('SERVER_ERROR');
  });

  it('an empty key is INVALID_PARAMS', async () => {
    const error = await failure(create('{}'));
    expect(error.code).toBe('INVALID_PARAMS');
  });
});

describe('idx.list, idx.stats, hide/unhide, drop', () => {
  const COLL2 = 'stats';
  const ns2 = { db: DB, coll: COLL2 };

  beforeAll(async () => {
    const coll = direct.db(DB).collection(COLL2);
    await coll.insertMany(Array.from({ length: 50 }, (_, i) => ({ n: i, s: `v${i}` })));
    await coll.createIndex({ n: 1 });
  });

  it('idx.list lists _id_ first and every index of the collection', async () => {
    const { indexes } = await backend.call('idx.list', { profileId: RW.id, ...ns2 });
    expect(indexes.map((i) => i.name)).toEqual(['_id_', 'n_1']);
    expect(indexes[0]?.key).toBe('{"_id":{"$numberInt":"1"}}');
  });

  it('idx.stats reports a size and $indexStats usage per index', async () => {
    await direct.db(DB).collection(COLL2).find({ n: 3 }).hint('n_1').toArray();
    await direct.db(DB).collection(COLL2).find({ n: 4 }).hint('n_1').toArray();
    const { indexes } = await backend.call('idx.stats', { profileId: RW.id, ...ns2 });
    expect(indexes.map((i) => i.name).sort()).toEqual(['_id_', 'n_1']);
    const n1 = indexes.find((i) => i.name === 'n_1');
    expect(n1?.sizeBytes).toBeGreaterThan(0);
    expect(n1?.accesses).toBeGreaterThanOrEqual(2);
    expect(Number.isNaN(Date.parse(n1?.since ?? ''))).toBe(false);
    expect(indexes.find((i) => i.name === '_id_')?.sizeBytes).toBeGreaterThan(0);
  });

  it('idx.list / idx.stats of a missing collection are NOT_FOUND', async () => {
    for (const method of ['idx.list', 'idx.stats'] as const) {
      const error = await failure(
        backend.call(method, { profileId: RW.id, db: DB, coll: 'ghost' }),
      );
      expect(error.code).toBe('NOT_FOUND');
    }
  });

  it('idx.hide hides and unhides an index; a hidden index is not used by the planner', async () => {
    const coll = direct.db(DB).collection(COLL2);
    await backend.call('idx.hide', { profileId: RW.id, ...ns2, name: 'n_1', hidden: true });
    expect((await serverSpec('n_1', COLL2))?.['hidden']).toBe(true);
    let { indexes } = await backend.call('idx.list', { profileId: RW.id, ...ns2 });
    expect(indexes.find((i) => i.name === 'n_1')?.hidden).toBe(true);
    const hiddenPlan = JSON.stringify(await coll.find({ n: 3 }).explain());
    expect(hiddenPlan).toContain('COLLSCAN');
    expect(hiddenPlan).not.toContain('IXSCAN');

    await backend.call('idx.hide', { profileId: RW.id, ...ns2, name: 'n_1', hidden: false });
    expect((await serverSpec('n_1', COLL2))?.['hidden']).toBeUndefined();
    ({ indexes } = await backend.call('idx.list', { profileId: RW.id, ...ns2 }));
    expect(indexes.find((i) => i.name === 'n_1')?.hidden).toBe(false);
    expect(JSON.stringify(await coll.find({ n: 3 }).explain())).toContain('IXSCAN');
  });

  it('idx.hide of a missing index is SERVER_ERROR', async () => {
    const error = await failure(
      backend.call('idx.hide', { profileId: RW.id, ...ns2, name: 'nope', hidden: true }),
    );
    expect(error.code).toBe('SERVER_ERROR');
  });

  it('idx.drop drops one index by name; "*" is refused', async () => {
    await direct.db(DB).collection(COLL2).createIndex({ s: 1 });
    const star = await failure(backend.call('idx.drop', { profileId: RW.id, ...ns2, name: '*' }));
    expect(star.code).toBe('INVALID_PARAMS');
    expect((await direct.db(DB).collection(COLL2).listIndexes().toArray()).length).toBe(3);

    await expect(
      backend.call('idx.drop', { profileId: RW.id, ...ns2, name: 's_1' }),
    ).resolves.toEqual({});
    const names = (await direct.db(DB).collection(COLL2).listIndexes().toArray()).map(
      (s) => s['name'],
    );
    expect(names).toEqual(['_id_', 'n_1']);
  });

  it('idx.drop of a missing index is SERVER_ERROR', async () => {
    const error = await failure(
      backend.call('idx.drop', { profileId: RW.id, ...ns2, name: 'nope' }),
    );
    expect(error.code).toBe('SERVER_ERROR');
  });
});

describe('the write guard on idx.*', () => {
  const COLL3 = 'guarded';
  const ns3 = { db: DB, coll: COLL3 };

  beforeAll(async () => {
    await direct.db(DB).collection(COLL3).insertOne({ g: 1 });
    await direct.db(DB).collection(COLL3).createIndex({ g: 1 });
  });

  const names = async () =>
    (await direct.db(DB).collection(COLL3).listIndexes().toArray()).map((s) => [
      s['name'],
      s['hidden'] === true,
    ]);

  const writes: [MethodName, Record<string, unknown>][] = [
    ['idx.create', { ...ns3, key: '{"h":{"$numberInt":"1"}}' }],
    ['idx.drop', { ...ns3, name: 'g_1' }],
    ['idx.hide', { ...ns3, name: 'g_1', hidden: true }],
  ];

  it.each(writes)('%s is READ_ONLY on a read-only profile, even confirmed', async (method, p) => {
    for (const confirmed of [undefined, true]) {
      const error = await failure(
        backend.call(method, { profileId: RO.id, ...p, ...(confirmed ? { confirmed } : {}) }),
      );
      expect(error.code).toBe('READ_ONLY');
    }
    // Nothing changed on the server.
    expect(await names()).toEqual([
      ['_id_', false],
      ['g_1', false],
    ]);
  });

  it('reads work on the read-only profile', async () => {
    const { indexes } = await backend.call('idx.list', { profileId: RO.id, ...ns3 });
    expect(indexes.map((i) => i.name)).toEqual(['_id_', 'g_1']);
    const stats = await backend.call('idx.stats', { profileId: RO.id, ...ns3 });
    expect(stats.indexes.map((i) => i.name).sort()).toEqual(['_id_', 'g_1']);
  });

  it('a production profile needs confirmed: true', async () => {
    const p = { profileId: PROD.id, ...ns3, key: '{"p":{"$numberInt":"1"}}' };
    const error = await failure(backend.call('idx.create', p));
    expect(error.code).toBe('CONFIRMATION_REQUIRED');
    await expect(backend.call('idx.create', { ...p, confirmed: true })).resolves.toEqual({
      name: 'p_1',
    });
    await backend.call('idx.drop', { profileId: PROD.id, ...ns3, name: 'p_1', confirmed: true });
    expect(await names()).toEqual([
      ['_id_', false],
      ['g_1', false],
    ]);
  });
});

describe('idx.stats for a user without the indexStats privilege (server with access control)', () => {
  // Shared fixtures run without --auth, where privileges aren't enforced: this needs its own server.
  const ROOT = { username: 'root', password: randomBytes(18).toString('base64url') };
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
      await root.db('allowed').collection('items').insertMany([{ n: 1 }, { n: 2 }]);
      await root.db('allowed').collection('items').createIndex({ n: 1 });
      await root.db('allowed').command({
        createUser: 'reader',
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
        username: 'reader',
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

  it('answers sizes without accesses', async () => {
    const { indexes } = await auth.call('idx.stats', {
      profileId: 'reader',
      db: 'allowed',
      coll: 'items',
    });
    expect(indexes.map((i) => i.name).sort()).toEqual(['_id_', 'n_1']);
    for (const index of indexes) {
      expect(index.sizeBytes).toBeGreaterThan(0);
      expect(index.accesses).toBeUndefined();
      expect(index.since).toBeUndefined();
    }
  });

  it('idx.create is refused by the server (SERVER_ERROR), not by the guard', async () => {
    const error = await failure(
      auth.call('idx.create', {
        profileId: 'reader',
        db: 'allowed',
        coll: 'items',
        key: '{"x":{"$numberInt":"1"}}',
      }),
    );
    expect(error.code).toBe('SERVER_ERROR');
  });
});
