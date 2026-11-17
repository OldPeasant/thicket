import { randomBytes } from 'node:crypto';

import { Decimal128, Double, Int32, Long, MongoClient, ObjectId, type Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  ConnectionManager,
  RpcClient,
  RpcError,
  guardWrites,
  schemaHandlers,
  serve,
} from '@thicket/backend';
import { methods, type Profile, type ResultOf, type SchemaField } from '@thicket/contract';

import { portPair } from '../../packages/backend/src/server/testing';

// schema.analyze (task schema-analysis) against the 8.x standalone, served like the backend
// serves it: contract validation of params and result.

const mongo = inject('mongo');

/**
 * 100 documents: `value` is a string in 50, an int in 20, a double in 10, a long in 5, a decimal
 * in 5, null in 5 and missing in 5; `nested.flag` exists in every `nested` document (40 of
 * them), `nested.extra` in 10 of those; `tags` is an array of strings and ints in 20.
 */
function fixtureDocs(): Document[] {
  const docs: Document[] = [];
  for (let i = 0; i < 100; i++) {
    const doc: Document = { _id: new ObjectId(), i: new Int32(i) };
    if (i < 50) doc['value'] = `s${i % 7}`;
    else if (i < 70) doc['value'] = new Int32(i);
    else if (i < 80) doc['value'] = new Double(i + 0.5);
    else if (i < 85) doc['value'] = Long.fromNumber(i);
    else if (i < 90) doc['value'] = Decimal128.fromString(`${i}.25`);
    else if (i < 95) doc['value'] = null;
    if (i % 5 < 2) {
      doc['nested'] = { flag: i % 2 === 0 };
      if (i < 25) doc['nested'].extra = 'x';
    }
    if (i % 5 === 2) doc['tags'] = ['a', new Int32(i), 'b'];
    docs.push(doc);
  }
  return docs;
}

const field = (r: ResultOf<'schema.analyze'>, path: string): SchemaField => {
  const found = r.fields.find((f) => f.path === path);
  if (!found) throw new Error(`no field ${path} in ${r.fields.map((f) => f.path).join(', ')}`);
  return found;
};

const shares = (f: SchemaField): Record<string, number> =>
  Object.fromEntries(f.types.map((t) => [t.bsonType, t.probability]));

describe('schema.analyze (8.x standalone)', () => {
  const uri = mongo.mongo8.uri;
  const PROFILE: Profile = {
    id: 'schema-ro',
    name: 'Schema',
    connectionString: uri,
    readOnly: true,
    production: false,
    serverSelectionTimeoutMS: 10_000,
  };
  const DB = `schema_${randomBytes(3).toString('hex')}`;
  const ns = { profileId: PROFILE.id, db: DB, coll: 'mixed' };

  let direct: MongoClient;
  let manager: ConnectionManager;
  let client: RpcClient;
  let stop: () => void;
  const analyze = (params: Record<string, unknown>) =>
    client.call('schema.analyze', { ...ns, ...params }) as Promise<ResultOf<'schema.analyze'>>;

  beforeAll(async () => {
    direct = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
    await direct.db(DB).collection('mixed').insertMany(fixtureDocs());
    const loadProfile = (id: string) =>
      id === PROFILE.id
        ? Promise.resolve(PROFILE)
        : Promise.reject(new RpcError('NOT_FOUND', `No profile with id ${id}`));
    manager = new ConnectionManager({ loadProfile, loadSecrets: () => Promise.resolve(null) });
    const [serverPort, clientPort] = portPair();
    stop = serve(serverPort, {
      table: methods,
      route: 'backend',
      handlers: guardWrites(schemaHandlers(manager), loadProfile),
    });
    client = new RpcClient(clientPort);
    await manager.open(PROFILE.id, undefined);
  });

  afterAll(async () => {
    await direct.db(DB).dropDatabase();
    client.close();
    stop();
    await manager.closeAll();
    await direct.close();
  });

  it('gives the expected type shares and missing ratio for mixed types (whole collection)', async () => {
    const r = await analyze({});
    expect(r.sampled).toBe(100);
    expect(r.fields.map((f) => f.path)).toEqual([
      '_id',
      'i',
      'nested',
      'nested.extra',
      'nested.flag',
      'tags',
      'tags.[]',
      'value',
    ]);

    const value = field(r, 'value');
    expect(value.count).toBe(95);
    expect(value.probability).toBeCloseTo(0.95);
    expect(shares(value)).toEqual({
      string: 0.5,
      int: 0.2,
      double: 0.1,
      long: 0.05,
      decimal: 0.05,
      null: 0.05,
    });
    // Most frequent type first.
    expect(value.types[0]?.bsonType).toBe('string');
    const strings = value.types.find((t) => t.bsonType === 'string');
    const examples = JSON.parse(strings?.examples ?? '[]') as unknown[];
    expect(examples.length).toBeGreaterThan(0);
    expect(examples.length).toBeLessThanOrEqual(5);
    expect(new Set(examples).size).toBe(examples.length);
    for (const ex of examples) expect(String(ex)).toMatch(/^s\d$/);
    // Examples are canonical EJSON: BSON types survive.
    const longs = JSON.parse(value.types.find((t) => t.bsonType === 'long')?.examples ?? '[]');
    expect(longs[0]).toHaveProperty('$numberLong');
    const decimals = JSON.parse(
      value.types.find((t) => t.bsonType === 'decimal')?.examples ?? '[]',
    );
    expect(decimals[0]).toHaveProperty('$numberDecimal');

    expect(field(r, '_id')).toMatchObject({ probability: 1, count: 100 });
    expect(shares(field(r, '_id'))).toEqual({ objectId: 1 });

    const nested = field(r, 'nested');
    expect(nested.probability).toBeCloseTo(0.4);
    expect(shares(nested)).toEqual({ object: 0.4 });
    // Relative to the 40 `nested` documents.
    expect(field(r, 'nested.flag')).toMatchObject({ probability: 1, count: 40 });
    expect(shares(field(r, 'nested.flag'))).toEqual({ bool: 1 });
    const extra = field(r, 'nested.extra');
    expect(extra.count).toBe(10);
    expect(extra.probability).toBeCloseTo(0.25);

    expect(field(r, 'tags').probability).toBeCloseTo(0.2);
    const items = field(r, 'tags.[]');
    expect(items.count).toBe(60);
    expect(items.probability).toBe(1);
    const itemShares = shares(items);
    expect(itemShares['string']).toBeCloseTo(2 / 3);
    expect(itemShares['int']).toBeCloseTo(1 / 3);
  });

  it('applies the filter before sampling', async () => {
    const r = await analyze({ filter: JSON.stringify({ value: { $type: 'string' } }) });
    expect(r.sampled).toBe(50);
    expect(field(r, 'value')).toMatchObject({ probability: 1, count: 50 });
    expect(shares(field(r, 'value'))).toEqual({ string: 1 });
  });

  it('samples at most sampleSize documents', async () => {
    const r = await analyze({ sampleSize: 10 });
    expect(r.sampled).toBe(10);
    expect(field(r, '_id').count).toBe(10);
  });

  it('an empty or missing collection gives no fields', async () => {
    expect(await analyze({ coll: 'nothing_here' })).toEqual({ sampled: 0, fields: [] });
  });

  it('an invalid filter is INVALID_PARAMS', async () => {
    await expect(analyze({ filter: '{"$bad": ' })).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    });
  });
});
