import { idxMethods } from '@thicket/contract';
import {
  BSON,
  MongoNetworkError,
  MongoServerError,
  type Document,
  type RunCommandOptions,
} from 'mongodb';
import { describe, expect, it } from 'vitest';

import type { ClientLike } from '../connections/manager';
import { RpcError } from '../server/rpc';
import {
  createIndex,
  defaultIndexName,
  dropIndex,
  hideIndex,
  indexStatistics,
  listIndexes,
  toIndexInfo,
} from './indexes';

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

/** A cursor answer of a command (`firstBatch`) or a getMore (`nextBatch`). */
function cursorAnswer(id: number, batch: Document[], first = true, ns = 'shop.orders') {
  return {
    cursor: { id: BSON.Long.fromNumber(id), ns, [first ? 'firstBatch' : 'nextBatch']: batch },
    ok: 1,
  };
}

const isCollStats = (command: Document) =>
  'aggregate' in command &&
  (command['pipeline'] as Document[]).some((stage) => '$collStats' in stage);
const isIndexStats = (command: Document) =>
  'aggregate' in command &&
  (command['pipeline'] as Document[]).some((stage) => '$indexStats' in stage);

const idxStats = idxMethods['idx.stats'].result;
const idxList = idxMethods['idx.list'].result;

describe('defaultIndexName', () => {
  it('joins <field>_<value> per key like the driver does', () => {
    expect(defaultIndexName({ a: 1 })).toBe('a_1');
    expect(defaultIndexName({ a: 1, b: -1 })).toBe('a_1_b_-1');
    expect(defaultIndexName({ 'address.city': 1 })).toBe('address.city_1');
  });

  it('uses the index type for special indexes', () => {
    expect(defaultIndexName({ title: 'text' })).toBe('title_text');
    expect(defaultIndexName({ loc: '2dsphere' })).toBe('loc_2dsphere');
    expect(defaultIndexName({ '$**': 1 })).toBe('$**_1');
    expect(defaultIndexName({ tenant: 1, 'attrs.$**': 1 })).toBe('tenant_1_attrs.$**_1');
  });

  it('reads BSON numeric key values (EJSON-parsed keys) as their number', () => {
    expect(defaultIndexName({ a: new BSON.Int32(1), b: new BSON.Int32(-1) })).toBe('a_1_b_-1');
    expect(defaultIndexName({ a: BSON.Long.fromNumber(1) })).toBe('a_1');
  });
});

describe('toIndexInfo', () => {
  it('maps a plain spec: flags default to false, raw and key are canonical EJSON', () => {
    const info = toIndexInfo({
      v: new BSON.Int32(2),
      key: { _id: new BSON.Int32(1) },
      name: '_id_',
    });
    expect(info).toEqual({
      name: '_id_',
      key: '{"_id":{"$numberInt":"1"}}',
      unique: false,
      sparse: false,
      hidden: false,
      raw: '{"v":{"$numberInt":"2"},"key":{"_id":{"$numberInt":"1"}},"name":"_id_"}',
    });
  });

  it('reads unique, sparse, hidden only when exactly true', () => {
    expect(
      toIndexInfo({ name: 'a_1', key: { a: 1 }, unique: true, sparse: true, hidden: true }),
    ).toMatchObject({ unique: true, sparse: true, hidden: true });
    expect(
      toIndexInfo({ name: 'a_1', key: { a: 1 }, unique: 1, sparse: 'yes', hidden: false }),
    ).toMatchObject({ unique: false, sparse: false, hidden: false });
  });

  it('reads a TTL given as Int32, Long or Double, truncating fractions', () => {
    for (const [value, expected] of [
      [new BSON.Int32(3600), 3600],
      [BSON.Long.fromNumber(0), 0],
      [new BSON.Double(90.7), 90],
      [42, 42],
    ] as const) {
      expect(toIndexInfo({ name: 't', key: { t: 1 }, expireAfterSeconds: value })).toMatchObject({
        expireAfterSeconds: expected,
      });
    }
  });

  it('omits a negative, non-finite or non-numeric TTL', () => {
    for (const value of [
      new BSON.Int32(-1),
      new BSON.Double(NaN),
      new BSON.Double(Infinity),
      '60',
      null,
    ]) {
      const info = toIndexInfo({ name: 't', key: { t: 1 }, expireAfterSeconds: value });
      expect(info).not.toHaveProperty('expireAfterSeconds');
    }
  });

  it('keeps a partialFilterExpression document as canonical EJSON and ignores non-documents', () => {
    const info = toIndexInfo({
      name: 'qty_1',
      key: { qty: 1 },
      partialFilterExpression: { qty: { $gt: new BSON.Int32(10) } },
    });
    expect(info.partialFilterExpression).toBe('{"qty":{"$gt":{"$numberInt":"10"}}}');
    expect(
      toIndexInfo({ name: 'x', key: { x: 1 }, partialFilterExpression: 'qty > 10' }),
    ).not.toHaveProperty('partialFilterExpression');
    expect(
      toIndexInfo({ name: 'x', key: { x: 1 }, partialFilterExpression: null }),
    ).not.toHaveProperty('partialFilterExpression');
  });

  it('keeps every option (collation, weights, wildcardProjection) in raw', () => {
    const spec = {
      v: new BSON.Int32(2),
      key: { _fts: 'text', _ftsx: new BSON.Int32(1) },
      name: 'title_text',
      weights: { title: new BSON.Int32(10) },
      default_language: 'english',
      collation: { locale: 'fr', strength: new BSON.Int32(2) },
    };
    const info = toIndexInfo(spec);
    expect(BSON.EJSON.parse(info.raw, { relaxed: false })).toEqual(spec);
    expect(info.key).toBe('{"_fts":"text","_ftsx":{"$numberInt":"1"}}');
  });

  it('a spec without a key answers an empty key document', () => {
    expect(toIndexInfo({ name: 'odd' }).key).toBe('{}');
  });
});

describe('listIndexes', () => {
  it('runs listIndexes with a cursor on the database and maps every entry in server order', async () => {
    const client = fakeClient(() =>
      cursorAnswer(0, [
        { v: 2, key: { _id: 1 }, name: '_id_' },
        { v: 2, key: { sku: 1 }, name: 'sku_1', unique: true },
        { v: 2, key: { at: 1 }, name: 'at_1', expireAfterSeconds: 60, hidden: true },
      ]),
    );
    const result = await listIndexes(client, 'shop', 'orders');
    expect(result.indexes.map((i) => [i.name, i.unique, i.hidden, i.expireAfterSeconds])).toEqual([
      ['_id_', false, false, undefined],
      ['sku_1', true, false, undefined],
      ['at_1', false, true, 60],
    ]);
    expect(idxList.safeParse(result).success).toBe(true);
    expect(client.sent).toHaveLength(1);
    expect(client.sent[0]).toMatchObject({
      db: 'shop',
      command: { listIndexes: 'orders', cursor: {} },
      options: { fieldsAsRaw: { firstBatch: true, nextBatch: true } },
    });
  });

  it('pages through batches with getMore on the collection', async () => {
    const answers = [
      cursorAnswer(31, [{ key: { _id: 1 }, name: '_id_' }]),
      cursorAnswer(0, [{ key: { a: 1 }, name: 'a_1' }], false),
    ];
    const client = fakeClient(() => answers.shift() ?? { ok: 0 });
    const { indexes } = await listIndexes(client, 'shop', 'orders');
    expect(indexes.map((i) => i.name)).toEqual(['_id_', 'a_1']);
    expect(client.sent[1]?.command).toEqual({
      getMore: BSON.Long.fromNumber(31),
      collection: 'orders',
    });
  });

  it('decodes batch documents given as BSON bytes without losing types in raw', async () => {
    const spec = {
      v: new BSON.Int32(2),
      key: { at: new BSON.Int32(1) },
      name: 'at_1',
      expireAfterSeconds: BSON.Long.fromNumber(3600),
    };
    const client = fakeClient(() => cursorAnswer(0, [BSON.serialize(spec) as unknown as Document]));
    const { indexes } = await listIndexes(client, 'shop', 'orders');
    expect(indexes[0]?.expireAfterSeconds).toBe(3600);
    expect(JSON.parse(indexes[0]?.raw ?? '{}')).toMatchObject({
      expireAfterSeconds: { $numberLong: '3600' },
    });
  });

  it('a missing collection is NOT_FOUND', async () => {
    const client = fakeClient(() => {
      throw serverError(26, 'NamespaceNotFound', 'ns does not exist: shop.ghost');
    });
    expect((await rejection(listIndexes(client, 'shop', 'ghost'))).code).toBe('NOT_FOUND');
  });

  it('a cancel between batches kills the cursor and answers CANCELLED', async () => {
    const controller = new AbortController();
    const client = fakeClient((_db, command) => {
      if ('listIndexes' in command) {
        controller.abort();
        return cursorAnswer(9, [{ key: { _id: 1 }, name: '_id_' }]);
      }
      return { ok: 1 };
    });
    const error = await rejection(listIndexes(client, 'shop', 'orders', controller.signal));
    expect(error.code).toBe('CANCELLED');
    expect(client.sent.map((s) => Object.keys(s.command)[0])).toEqual([
      'listIndexes',
      'killCursors',
    ]);
  });
});

describe('indexStatistics', () => {
  const collStats = (indexSizes: Document | undefined, shard?: string) => ({
    ns: 'shop.orders',
    ...(shard ? { shard } : {}),
    storageStats: indexSizes === undefined ? {} : { indexSizes },
  });
  const usage = (name: string, ops: unknown, since: unknown, shard?: string) => ({
    name,
    key: {},
    host: 'db0.example.test:27017',
    ...(shard ? { shard } : {}),
    accesses: { ops, since },
  });

  it('sends $collStats storageStats then $indexStats on the collection', async () => {
    const client = fakeClient((_db, command) =>
      isCollStats(command)
        ? cursorAnswer(0, [collStats({ _id_: 4096 })])
        : cursorAnswer(0, [usage('_id_', 3, new Date('2026-01-01T00:00:00.000Z'))]),
    );
    const result = await indexStatistics(client, 'shop', 'orders');
    expect(result).toEqual({
      indexes: [{ name: '_id_', sizeBytes: 4096, accesses: 3, since: '2026-01-01T00:00:00.000Z' }],
    });
    expect(idxStats.safeParse(result).success).toBe(true);
    expect(client.sent.map((s) => [s.db, s.command])).toEqual([
      [
        'shop',
        {
          aggregate: 'orders',
          pipeline: [{ $collStats: { storageStats: { scale: 1 } } }],
          cursor: {},
        },
      ],
      ['shop', { aggregate: 'orders', pipeline: [{ $indexStats: {} }], cursor: {} }],
    ]);
  });

  it('reads Int32, Long and Double sizes and Long access counts', async () => {
    const client = fakeClient((_db, command) =>
      isCollStats(command)
        ? cursorAnswer(0, [
            collStats({
              _id_: new BSON.Int32(20480),
              a_1: BSON.Long.fromNumber(8192),
              b_1: new BSON.Double(4096),
            }),
          ])
        : cursorAnswer(0, [
            usage('_id_', BSON.Long.fromNumber(7), new Date('2026-02-01T00:00:00.000Z')),
            usage('a_1', new BSON.Int32(0), new Date('2026-02-01T00:00:00.000Z')),
          ]),
    );
    const { indexes } = await indexStatistics(client, 'shop', 'orders');
    expect(indexes).toEqual([
      { name: '_id_', sizeBytes: 20480, accesses: 7, since: '2026-02-01T00:00:00.000Z' },
      { name: 'a_1', sizeBytes: 8192, accesses: 0, since: '2026-02-01T00:00:00.000Z' },
      { name: 'b_1', sizeBytes: 4096 },
    ]);
  });

  it('on a sharded cluster sums sizes and accesses over shards and keeps the earliest since', async () => {
    const client = fakeClient((_db, command) =>
      isCollStats(command)
        ? cursorAnswer(0, [
            collStats({ _id_: 1000, sku_1: 300 }, 's0'),
            collStats({ _id_: 2000, sku_1: 700 }, 's1'),
          ])
        : cursorAnswer(0, [
            usage('_id_', 5, new Date('2026-03-02T00:00:00.000Z'), 's0'),
            usage('_id_', 4, new Date('2026-03-01T00:00:00.000Z'), 's1'),
            // Earliest first here: a later shard's since must not replace it.
            usage('sku_1', 1, new Date('2026-03-04T00:00:00.000Z'), 's0'),
            usage('sku_1', 2, new Date('2026-03-05T00:00:00.000Z'), 's1'),
          ]),
    );
    const { indexes } = await indexStatistics(client, 'shop', 'orders');
    expect(indexes).toEqual([
      { name: '_id_', sizeBytes: 3000, accesses: 9, since: '2026-03-01T00:00:00.000Z' },
      { name: 'sku_1', sizeBytes: 1000, accesses: 3, since: '2026-03-04T00:00:00.000Z' },
    ]);
  });

  it('sums shards answered over several batches (getMore)', async () => {
    const answers = [
      cursorAnswer(14, [collStats({ _id_: 100 }, 's0')]),
      cursorAnswer(0, [collStats({ _id_: 200 }, 's1')], false),
      cursorAnswer(0, []),
    ];
    const client = fakeClient(() => answers.shift() ?? { ok: 0 });
    const { indexes } = await indexStatistics(client, 'shop', 'orders');
    expect(indexes).toEqual([{ name: '_id_', sizeBytes: 300 }]);
    expect(client.sent[1]?.command).toEqual({
      getMore: BSON.Long.fromNumber(14),
      collection: 'orders',
    });
  });

  it('missing, zero, negative or non-numeric sizes count as 0 but still list the index', async () => {
    const client = fakeClient((_db, command) =>
      isCollStats(command)
        ? cursorAnswer(0, [
            collStats({ a: 0, b: -5, c: 'big', d: new BSON.Double(NaN), e: null }),
            collStats(undefined, 's1'),
            { ns: 'shop.orders' },
          ])
        : cursorAnswer(0, []),
    );
    const result = await indexStatistics(client, 'shop', 'orders');
    expect(result.indexes).toEqual(
      ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name, sizeBytes: 0 })),
    );
    expect(idxStats.safeParse(result).success).toBe(true);
  });

  it('an index known only to $indexStats is listed with size 0', async () => {
    const client = fakeClient((_db, command) =>
      isCollStats(command)
        ? cursorAnswer(0, [collStats({ _id_: 4096 })])
        : cursorAnswer(0, [usage('building_1', 0, new Date('2026-04-01T00:00:00.000Z'))]),
    );
    const { indexes } = await indexStatistics(client, 'shop', 'orders');
    expect(indexes).toEqual([
      { name: '_id_', sizeBytes: 4096 },
      { name: 'building_1', sizeBytes: 0, accesses: 0, since: '2026-04-01T00:00:00.000Z' },
    ]);
  });

  it('negative, non-numeric or missing ops count as 0 accesses; fractions are truncated', async () => {
    const client = fakeClient((_db, command) =>
      isCollStats(command)
        ? cursorAnswer(0, [collStats({ a: 1, b: 1, c: 1, d: 1 })])
        : cursorAnswer(0, [
            usage('a', -3, undefined),
            usage('b', 'many', undefined),
            { name: 'c' },
            usage('d', new BSON.Double(2.9), undefined),
          ]),
    );
    const result = await indexStatistics(client, 'shop', 'orders');
    expect(result.indexes.map((i) => [i.name, i.accesses, i.since])).toEqual([
      ['a', 0, undefined],
      ['b', 0, undefined],
      ['c', 0, undefined],
      ['d', 2, undefined],
    ]);
    expect(idxStats.safeParse(result).success).toBe(true);
  });

  it('ignores an invalid or non-Date since', async () => {
    const client = fakeClient((_db, command) =>
      isCollStats(command)
        ? cursorAnswer(0, [collStats({ a: 1, b: 1 })])
        : cursorAnswer(0, [
            usage('a', 1, new Date(Number.NaN)),
            usage('b', 1, '2026-01-01T00:00:00.000Z'),
          ]),
    );
    const { indexes } = await indexStatistics(client, 'shop', 'orders');
    expect(indexes).toEqual([
      { name: 'a', sizeBytes: 1, accesses: 1 },
      { name: 'b', sizeBytes: 1, accesses: 1 },
    ]);
  });

  it('decodes $indexStats batches given as BSON bytes (since stays a Date)', async () => {
    const doc = usage('_id_', BSON.Long.fromNumber(12), new Date('2026-05-06T07:08:09.010Z'));
    const client = fakeClient((_db, command) =>
      isCollStats(command)
        ? cursorAnswer(0, [
            BSON.serialize(collStats({ _id_: new BSON.Int32(8192) })) as unknown as Document,
          ])
        : cursorAnswer(0, [BSON.serialize(doc) as unknown as Document]),
    );
    await expect(indexStatistics(client, 'shop', 'orders')).resolves.toEqual({
      indexes: [{ name: '_id_', sizeBytes: 8192, accesses: 12, since: '2026-05-06T07:08:09.010Z' }],
    });
  });

  it('a user who may not run $indexStats (Unauthorized, code 13) gets sizes without usage', async () => {
    const client = fakeClient((_db, command) => {
      if (isIndexStats(command)) {
        throw serverError(13, 'Unauthorized', 'not authorized on shop to execute command');
      }
      return cursorAnswer(0, [collStats({ _id_: 4096, a_1: 1024 })]);
    });
    const result = await indexStatistics(client, 'shop', 'orders');
    expect(result).toEqual({
      indexes: [
        { name: '_id_', sizeBytes: 4096 },
        { name: 'a_1', sizeBytes: 1024 },
      ],
    });
    expect(result.indexes.every((i) => !('accesses' in i) && !('since' in i))).toBe(true);
  });

  it('recognises Unauthorized by code name alone', async () => {
    const client = fakeClient((_db, command) => {
      if (isIndexStats(command)) {
        throw Object.assign(new Error('not authorized'), {
          name: 'MongoServerError',
          codeName: 'Unauthorized',
        });
      }
      return cursorAnswer(0, [collStats({ _id_: 1 })]);
    });
    await expect(indexStatistics(client, 'shop', 'orders')).resolves.toEqual({
      indexes: [{ name: '_id_', sizeBytes: 1 }],
    });
  });

  it('recognises Unauthorized given as an unpromoted Int32 code', async () => {
    const client = fakeClient((_db, command) => {
      if (isIndexStats(command)) {
        throw Object.assign(new Error('not authorized'), {
          name: 'MongoServerError',
          code: new BSON.Int32(13),
        });
      }
      return cursorAnswer(0, [collStats({ _id_: 1 })]);
    });
    await expect(indexStatistics(client, 'shop', 'orders')).resolves.toEqual({
      indexes: [{ name: '_id_', sizeBytes: 1 }],
    });
  });

  it.each([
    [
      'another server error',
      () => serverError(8000, 'AtlasError', 'aggregate failed'),
      'SERVER_ERROR',
    ],
    [
      'a network error',
      () => new MongoNetworkError('connection 5 to db.example.test:27017 closed'),
      'NETWORK_ERROR',
    ],
    ['a missing collection', () => serverError(26, 'NamespaceNotFound', 'gone'), 'NOT_FOUND'],
  ])('$indexStats failing with %s is answered, not swallowed', async (_what, make, code) => {
    const client = fakeClient((_db, command) => {
      if (isIndexStats(command)) throw make();
      return cursorAnswer(0, [collStats({ _id_: 1 })]);
    });
    expect((await rejection(indexStatistics(client, 'shop', 'orders'))).code).toBe(code);
  });

  it('a cancel during $indexStats is CANCELLED, not treated as missing usage', async () => {
    const controller = new AbortController();
    const client = fakeClient((_db, command) => {
      if (isIndexStats(command)) {
        controller.abort();
        return cursorAnswer(6, [usage('_id_', 1, undefined)]);
      }
      if ('killCursors' in command) return { ok: 1 };
      return cursorAnswer(0, [collStats({ _id_: 1 })]);
    });
    const error = await rejection(indexStatistics(client, 'shop', 'orders', controller.signal));
    expect(error.code).toBe('CANCELLED');
  });

  it('no $collStats document is NOT_FOUND without asking $indexStats', async () => {
    const client = fakeClient(() => cursorAnswer(0, []));
    const error = await rejection(indexStatistics(client, 'shop', 'ghost'));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Collection shop.ghost does not exist');
    expect(client.sent).toHaveLength(1);
  });

  it('a failing $collStats is answered without asking $indexStats', async () => {
    const client = fakeClient(() => {
      throw serverError(13, 'Unauthorized', 'not authorized on shop');
    });
    const error = await rejection(indexStatistics(client, 'shop', 'orders'));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toMatchObject({ codeName: 'Unauthorized' });
    expect(client.sent).toHaveLength(1);
  });
});

describe('createIndex', () => {
  const ok = () => ({ ok: 1, numIndexesBefore: 1, numIndexesAfter: 2 });

  it('sends createIndexes with one spec named by default and answers that name', async () => {
    const client = fakeClient(ok);
    await expect(
      createIndex(client, 'shop', 'orders', '{"a":1,"b":-1}', undefined),
    ).resolves.toEqual({ name: 'a_1_b_-1' });
    expect(client.sent).toHaveLength(1);
    expect(client.sent[0]?.db).toBe('shop');
    expect(client.sent[0]?.command).toEqual({
      createIndexes: 'orders',
      indexes: [{ key: { a: new BSON.Int32(1), b: new BSON.Int32(-1) }, name: 'a_1_b_-1' }],
    });
  });

  it('keeps the key order of a compound key', async () => {
    const client = fakeClient(ok);
    await createIndex(client, 'shop', 'orders', '{"z":1,"a":1,"m":-1}', undefined);
    const spec = (client.sent[0]?.command['indexes'] as Document[])[0];
    expect(Object.keys(spec?.['key'] as Document)).toEqual(['z', 'a', 'm']);
    expect(spec?.['name']).toBe('z_1_a_1_m_-1');
  });

  it('uses an explicit name and passes every other option through with its BSON type', async () => {
    const client = fakeClient(ok);
    const result = await createIndex(
      client,
      'shop',
      'orders',
      '{"at":1}',
      JSON.stringify({
        name: 'expire_at',
        expireAfterSeconds: { $numberLong: '3600' },
        unique: true,
        sparse: true,
        hidden: true,
        partialFilterExpression: { qty: { $gt: { $numberInt: '10' } } },
        collation: { locale: 'fr', strength: 2 },
      }),
    );
    expect(result).toEqual({ name: 'expire_at' });
    const spec = (client.sent[0]?.command['indexes'] as Document[])[0] ?? {};
    expect(Object.keys(spec)).toEqual([
      'key',
      'name',
      'expireAfterSeconds',
      'unique',
      'sparse',
      'hidden',
      'partialFilterExpression',
      'collation',
    ]);
    expect(spec['expireAfterSeconds']).toBeInstanceOf(BSON.Long);
    expect(spec).toMatchObject({
      unique: true,
      sparse: true,
      hidden: true,
      partialFilterExpression: { qty: { $gt: new BSON.Int32(10) } },
      collation: { locale: 'fr', strength: new BSON.Int32(2) },
    });
  });

  it.each([
    ['text', '{"title":"text","body":"text"}', '{"weights":{"title":10}}', 'title_text_body_text'],
    ['2dsphere', '{"loc":"2dsphere"}', undefined, 'loc_2dsphere'],
    ['wildcard', '{"$**":1}', '{"wildcardProjection":{"secret":0}}', '$**_1'],
  ])('creates a %s index with its driver default name', async (_kind, key, options, name) => {
    const client = fakeClient(ok);
    await expect(createIndex(client, 'shop', 'docs', key, options)).resolves.toEqual({ name });
  });

  it('a key option cannot replace the key', async () => {
    const client = fakeClient(ok);
    await createIndex(client, 'shop', 'orders', '{"a":1}', '{"key":{"b":1}}');
    const spec = (client.sent[0]?.command['indexes'] as Document[])[0];
    expect(spec).toEqual({ key: { a: new BSON.Int32(1) }, name: 'a_1' });
  });

  it('an empty options document creates the plain index', async () => {
    const client = fakeClient(ok);
    await expect(createIndex(client, 'shop', 'orders', '{"a":1}', '{}')).resolves.toEqual({
      name: 'a_1',
    });
  });

  it.each([
    ['an empty key', '{}', undefined, 'key must name at least one field'],
    ['a key that is not JSON', '{a:1', undefined, /^key is not valid EJSON/],
    ['a key that is an array', '[{"a":1}]', undefined, 'key must be an EJSON document'],
    [
      'a key that is an EJSON value',
      '{"$numberInt":"1"}',
      undefined,
      'key must be an EJSON document',
    ],
    ['options that are not JSON', '{"a":1}', '{nope', /^options is not valid EJSON/],
    ['options that are not a document', '{"a":1}', 'null', 'options must be an EJSON document'],
    ['an empty name', '{"a":1}', '{"name":""}', 'options.name must be a non-empty string'],
    ['a numeric name', '{"a":1}', '{"name":5}', 'options.name must be a non-empty string'],
    ['a null name', '{"a":1}', '{"name":null}', 'options.name must be a non-empty string'],
  ])(
    'refuses %s with INVALID_PARAMS before sending anything',
    async (_what, key, options, message) => {
      const client = fakeClient(ok);
      const error = await rejection(createIndex(client, 'shop', 'orders', key, options));
      expect(error.code).toBe('INVALID_PARAMS');
      if (typeof message === 'string') expect(error.message).toBe(message);
      else expect(error.message).toMatch(message);
      expect(client.sent).toEqual([]);
    },
  );

  it('maps a server refusal (duplicate keys for a unique index)', async () => {
    const client = fakeClient(() => {
      throw serverError(
        11000,
        'DuplicateKey',
        'E11000 duplicate key error collection: shop.orders',
      );
    });
    const error = await rejection(
      createIndex(client, 'shop', 'orders', '{"sku":1}', '{"unique":true}'),
    );
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toEqual({ serverCode: 11000, codeName: 'DuplicateKey' });
  });

  it('maps a conflicting index to SERVER_ERROR', async () => {
    const client = fakeClient(() => {
      throw serverError(85, 'IndexOptionsConflict', 'Index already exists with a different name');
    });
    const error = await rejection(
      createIndex(client, 'shop', 'orders', '{"a":1}', '{"name":"other"}'),
    );
    expect(error.detail).toMatchObject({ codeName: 'IndexOptionsConflict' });
  });
});

describe('dropIndex', () => {
  it('sends dropIndexes for one index name', async () => {
    const client = fakeClient(() => ({ ok: 1, nIndexesWas: 2 }));
    await expect(dropIndex(client, 'shop', 'orders', 'a_1')).resolves.toEqual({});
    expect(client.sent).toEqual([
      {
        db: 'shop',
        command: { dropIndexes: 'orders', index: 'a_1' },
        options: expect.anything(),
      },
    ]);
  });

  it('refuses "*" (every index) with INVALID_PARAMS before sending anything', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    const error = await rejection(dropIndex(client, 'shop', 'orders', '*'));
    expect(error.code).toBe('INVALID_PARAMS');
    expect(error.message).toMatch(/"\*" is not allowed/);
    expect(client.sent).toEqual([]);
  });

  it('drops an index whose name merely contains "*" (a wildcard index name)', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    await dropIndex(client, 'shop', 'orders', '$**_1');
    expect(client.sent[0]?.command).toEqual({ dropIndexes: 'orders', index: '$**_1' });
  });

  it('maps a missing index to SERVER_ERROR and a missing collection to NOT_FOUND', async () => {
    const missingIndex = fakeClient(() => {
      throw serverError(27, 'IndexNotFound', 'index not found with name [ghost_1]');
    });
    const error = await rejection(dropIndex(missingIndex, 'shop', 'orders', 'ghost_1'));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toEqual({ serverCode: 27, codeName: 'IndexNotFound' });

    const missingColl = fakeClient(() => {
      throw serverError(26, 'NamespaceNotFound', 'ns not found shop.ghost');
    });
    expect((await rejection(dropIndex(missingColl, 'shop', 'ghost', 'a_1'))).code).toBe(
      'NOT_FOUND',
    );
  });
});

describe('hideIndex', () => {
  it.each([true, false])('sends collMod with index { name, hidden: %s }', async (hidden) => {
    const client = fakeClient(() => ({ ok: 1, hidden_old: !hidden, hidden_new: hidden }));
    await expect(hideIndex(client, 'shop', 'orders', 'a_1', hidden)).resolves.toEqual({});
    expect(client.sent).toEqual([
      {
        db: 'shop',
        command: { collMod: 'orders', index: { name: 'a_1', hidden } },
        options: expect.anything(),
      },
    ]);
  });

  it('maps a server refusal (hiding _id_)', async () => {
    const client = fakeClient(() => {
      throw serverError(72, 'InvalidOptions', 'cannot modify hidden field of the _id_ index');
    });
    const error = await rejection(hideIndex(client, 'shop', 'orders', '_id_', true));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.detail).toEqual({ serverCode: 72, codeName: 'InvalidOptions' });
  });
});
