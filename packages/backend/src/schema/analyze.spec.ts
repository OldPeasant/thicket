import type { ParsedParamsOf, Profile, SchemaField } from '@thicket/contract';
import { BSON, MongoServerError, type Document } from 'mongodb';
import type { Schema } from '@mongodb-js/mongodb-schema';
import { describe, expect, it, vi } from 'vitest';

import { ConnectionManager, type ClientLike } from '../connections/manager';
import { RpcError, type Handler } from '../server/rpc';
import {
  DEFAULT_SCHEMA_SAMPLE,
  EXAMPLE_LENGTH_LIMIT,
  MAX_SCHEMA_EXAMPLES,
  analyzeCollection,
  analyzeSample,
  flattenSchema,
  sampleCommand,
  typeAlias,
} from './analyze';
import { schemaHandlers } from './handlers';

const { Int32, Double, Long, Decimal128, ObjectId, Binary, Code } = BSON;

type Answer = (db: string, command: Document) => Document | Promise<Document>;

/** A fake driver client that answers each command with `answer` and records what it was sent. */
function fakeClient(answer: Answer): ClientLike & { sent: { db: string; command: Document }[] } {
  const sent: { db: string; command: Document }[] = [];
  return {
    sent,
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: (db: string) => ({
      command: async (command: Document) => {
        sent.push({ db, command });
        return answer(db, command);
      },
    }),
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
const cursorReply = (id: number | BSON.Long, batch: Document[], first = true): Document => ({
  cursor: { id, ns: 'shop.orders', [first ? 'firstBatch' : 'nextBatch']: batch },
  ok: 1,
});

const target = { profileId: 'p1', db: 'shop', coll: 'orders' };
const params = (
  extra: Partial<ParsedParamsOf<'schema.analyze'>> = {},
): ParsedParamsOf<'schema.analyze'> => ({ ...target, ...extra });

const fieldOf = (fields: readonly SchemaField[], path: string): SchemaField => {
  const found = fields.find((f) => f.path === path);
  if (!found) throw new Error(`no field ${path} in ${fields.map((f) => f.path).join(', ')}`);
  return found;
};
const typeOf = (field: SchemaField, bsonType: string) => {
  const found = field.types.find((t) => t.bsonType === bsonType);
  if (!found) throw new Error(`no type ${bsonType} at ${field.path}`);
  return found;
};
const examplesOf = (field: SchemaField, bsonType: string): unknown[] =>
  BSON.EJSON.parse(typeOf(field, bsonType).examples, { relaxed: false }) as unknown[];

describe('typeAlias', () => {
  it.each([
    ['Int32', 'int'],
    ['Int64', 'long'],
    ['Long', 'long'],
    ['Double', 'double'],
    ['Number', 'double'],
    ['Decimal128', 'decimal'],
    ['String', 'string'],
    ['Boolean', 'bool'],
    ['Date', 'date'],
    ['Null', 'null'],
    ['ObjectId', 'objectId'],
    ['Document', 'object'],
    ['DBRef', 'object'],
    ['Array', 'array'],
    ['Binary', 'binData'],
    ['BSONRegExp', 'regex'],
    ['RegExp', 'regex'],
    ['Code', 'javascript'],
    ['CodeWScope', 'javascriptWithScope'],
    ['Timestamp', 'timestamp'],
    ['MinKey', 'minKey'],
    ['MaxKey', 'maxKey'],
    ['BSONSymbol', 'symbol'],
  ])('%s → %s', (name, alias) => {
    expect(typeAlias(name)).toBe(alias);
  });

  it('lower-cases the first letter of an unknown type name', () => {
    expect(typeAlias('FutureType')).toBe('futureType');
    expect(typeAlias('x')).toBe('x');
    expect(typeAlias('')).toBe('');
  });
});

describe('sampleCommand', () => {
  it('without a filter samples the default 1000 documents, no $match', () => {
    expect(DEFAULT_SCHEMA_SAMPLE).toBe(1000);
    expect(sampleCommand(params())).toEqual({
      aggregate: 'orders',
      pipeline: [{ $sample: { size: 1000 } }],
      cursor: {},
    });
  });

  it('an empty filter adds no $match', () => {
    expect(sampleCommand(params({ filter: '{}' }))['pipeline']).toEqual([
      { $sample: { size: 1000 } },
    ]);
  });

  it('puts the parsed filter (BSON types kept) in a $match before the $sample', () => {
    const cmd = sampleCommand(
      params({ filter: '{"status":"open","n":{"$gt":{"$numberLong":"5"}}}', sampleSize: 25 }),
    );
    const pipeline = cmd['pipeline'] as Document[];
    expect(pipeline).toEqual([
      { $match: { status: 'open', n: { $gt: Long.fromNumber(5) } } },
      { $sample: { size: 25 } },
    ]);
    expect((pipeline[0]?.['$match'] as Document)['n'].$gt).toBeInstanceOf(Long);
    expect(cmd).not.toHaveProperty('maxTimeMS');
  });

  it('passes maxTimeMS on', () => {
    expect(sampleCommand(params({ maxTimeMS: 1500 }))).toMatchObject({ maxTimeMS: 1500 });
  });

  it.each([
    ['not EJSON', '{status:'],
    ['an array', '[{"a":1}]'],
    ['a scalar', '42'],
  ])('a filter that is %s is INVALID_PARAMS', (_what, filter) => {
    let error: unknown;
    try {
      sampleCommand(params({ filter }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe('INVALID_PARAMS');
  });
});

describe('analyzeSample', () => {
  it('an empty sample has no fields', async () => {
    await expect(analyzeSample([])).resolves.toEqual({ sampled: 0, fields: [] });
  });

  it('gives each field its share, missing rest and type shares (int, double, long, decimal apart)', async () => {
    const docs: Document[] = [
      { _id: new Int32(1), v: 'alpha' },
      { _id: new Int32(2), v: 'beta' },
      { _id: new Int32(3), v: 'alpha' },
      { _id: new Int32(4), v: new Int32(7) },
      { _id: new Int32(5), v: new Double(1.5) },
      { _id: new Int32(6), v: Long.fromNumber(9) },
      { _id: new Int32(7), v: Decimal128.fromString('2.25') },
      { _id: new Int32(8), v: null },
      { _id: new Int32(9) },
      { _id: new Int32(10) },
    ];
    const r = await analyzeSample(docs);
    expect(r.sampled).toBe(10);
    expect(r.fields.map((f) => f.path)).toEqual(['_id', 'v']);

    const id = fieldOf(r.fields, '_id');
    expect(id).toMatchObject({ probability: 1, count: 10 });
    expect(id.types.map((t) => t.bsonType)).toEqual(['int']);

    const v = fieldOf(r.fields, 'v');
    expect(v.probability).toBeCloseTo(0.8);
    expect(v.count).toBe(8);
    // Missing values are not a type: the field's own share already says it.
    expect(v.types.map((t) => t.bsonType)).not.toContain('undefined');
    // Most frequent first, equal counts by name.
    expect(v.types.map((t) => [t.bsonType, t.count])).toEqual([
      ['string', 3],
      ['decimal', 1],
      ['double', 1],
      ['int', 1],
      ['long', 1],
      ['null', 1],
    ]);
    expect(typeOf(v, 'string').probability).toBeCloseTo(0.3);
    expect(typeOf(v, 'int').probability).toBeCloseTo(0.1);
    // A field's type shares add up to its own share.
    const sum = v.types.reduce((n, t) => n + t.probability, 0);
    expect(sum).toBeCloseTo(v.probability);
  });

  it('keeps examples as canonical EJSON, distinct, at most 5 per type', async () => {
    expect(MAX_SCHEMA_EXAMPLES).toBe(5);
    const names = ['a', 'b', 'a', 'c', 'd', 'b', 'e', 'f', 'g'];
    const docs: Document[] = names.map((name, i) => ({ name, n: new Int32(i % 2) }));
    const r = await analyzeSample(docs);
    const name = fieldOf(r.fields, 'name');
    const examples = examplesOf(name, 'string');
    expect(examples).toHaveLength(5);
    expect(new Set(examples).size).toBe(5);
    expect(examples.every((e) => typeof e === 'string' && names.includes(e))).toBe(true);
    // Numbers stay typed in the examples (canonical, not relaxed).
    const n = fieldOf(r.fields, 'n');
    expect(typeOf(n, 'int').examples).toContain('{"$numberInt":');
    expect(examplesOf(n, 'int')).toHaveLength(2);
  });

  it('keeps no example that may have been cut, so every example is a full value (filterable)', async () => {
    expect(EXAMPLE_LENGTH_LIMIT).toBe(1000);
    const short = 'y'.repeat(EXAMPLE_LENGTH_LIMIT - 2);
    const docs: Document[] = [
      { text: 'x'.repeat(5000) },
      { text: 'z'.repeat(EXAMPLE_LENGTH_LIMIT) },
      { text: 'w'.repeat(EXAMPLE_LENGTH_LIMIT - 1) },
      // A cut that would split a surrogate pair leaves one character less.
      { text: 'a'.repeat(EXAMPLE_LENGTH_LIMIT - 1) + '\u{1F600}' },
      { text: short },
      { text: 'ok' },
    ];
    const r = await analyzeSample(docs);
    const text = fieldOf(r.fields, 'text');
    // Counted as strings all the same, only left out of the examples.
    expect(typeOf(text, 'string').count).toBe(6);
    const examples = examplesOf(text, 'string') as string[];
    expect(examples.sort()).toEqual(['ok', short].sort());
    for (const example of examples) {
      expect(docs.some((d) => d['text'] === example)).toBe(true);
    }
  });

  it('keeps no binary or code example that may have been cut', async () => {
    const bytes = (n: number) => new Uint8Array(n).fill(7);
    const docs: Document[] = [
      { bin: new Binary(bytes(EXAMPLE_LENGTH_LIMIT + 10)), code: new Code('x'.repeat(5000)) },
      { bin: new Binary(bytes(EXAMPLE_LENGTH_LIMIT)), code: new Code('1;'.repeat(600)) },
      { bin: new Binary(bytes(4)), code: new Code('return 1') },
    ];
    const r = await analyzeSample(docs);
    const bin = fieldOf(r.fields, 'bin');
    expect(typeOf(bin, 'binData').count).toBe(3);
    const bins = examplesOf(bin, 'binData') as BSON.Binary[];
    expect(bins.map((b) => b.length())).toEqual([4]);
    const code = fieldOf(r.fields, 'code');
    expect(typeOf(code, 'javascript').count).toBe(3);
    expect((examplesOf(code, 'javascript') as BSON.Code[]).map((c) => c.code)).toEqual([
      'return 1',
    ]);
  });

  it('keeps binary and code values just below the cut thresholds in full', async () => {
    const bytes = (n: number) => new Uint8Array(n).fill(3);
    const docs: Document[] = [
      // Binary is cut only above the limit, so limit - 1 bytes is always a full value.
      {
        bin: new Binary(bytes(EXAMPLE_LENGTH_LIMIT - 1)),
        code: new Code('c'.repeat(EXAMPLE_LENGTH_LIMIT - 2)),
      },
      // Code at limit - 1 may be a cut (surrogate pair) value: left out.
      { bin: new Binary(bytes(1)), code: new Code('d'.repeat(EXAMPLE_LENGTH_LIMIT - 1)) },
    ];
    const r = await analyzeSample(docs);
    const bins = examplesOf(fieldOf(r.fields, 'bin'), 'binData') as BSON.Binary[];
    expect(bins.map((b) => b.length()).sort((a, b) => a - b)).toEqual([
      1,
      EXAMPLE_LENGTH_LIMIT - 1,
    ]);
    const codes = examplesOf(fieldOf(r.fields, 'code'), 'javascript') as BSON.Code[];
    expect(codes.map((c) => c.code)).toEqual(['c'.repeat(EXAMPLE_LENGTH_LIMIT - 2)]);
  });

  it('leaves out code cut one character short to avoid splitting a surrogate pair', async () => {
    // The cut at the limit would split the emoji, so the analyzer keeps limit - 1 characters.
    const split = 'e'.repeat(EXAMPLE_LENGTH_LIMIT - 1) + '\u{1F600}';
    const r = await analyzeSample([{ code: new Code(split) }, { code: new Code('return 2') }]);
    const code = fieldOf(r.fields, 'code');
    expect(typeOf(code, 'javascript').count).toBe(2);
    expect((examplesOf(code, 'javascript') as BSON.Code[]).map((c) => c.code)).toEqual([
      'return 2',
    ]);
  });

  it('keeps long code with scope as an example (the analyzer never cuts it)', async () => {
    const long = 'x'.repeat(5000);
    const r = await analyzeSample([{ fn: new Code(long, { k: 'v' }) }]);
    const fn = fieldOf(r.fields, 'fn');
    expect(typeOf(fn, 'javascriptWithScope').count).toBe(1);
    const [example] = examplesOf(fn, 'javascriptWithScope') as BSON.Code[];
    expect(example?.code).toBe(long);
    expect(example?.scope).toEqual({ k: 'v' });
  });

  it('values left out as cut take no example slot: the full values still fill the 5', async () => {
    const longs = Array.from({ length: 7 }, (_, i) => ({
      s: String(i).repeat(EXAMPLE_LENGTH_LIMIT + 1),
    }));
    const shorts = ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => ({ s }));
    const r = await analyzeSample([...longs, ...shorts]);
    const s = fieldOf(r.fields, 's');
    expect(typeOf(s, 'string').count).toBe(13);
    const examples = examplesOf(s, 'string') as string[];
    expect(examples).toHaveLength(MAX_SCHEMA_EXAMPLES);
    for (const example of examples) expect(example).toHaveLength(1);
  });

  it('nested fields: dotted paths, shares relative to the parent documents', async () => {
    const docs: Document[] = [
      { a: { b: new Int32(1) } },
      { a: { b: 'two', c: true } },
      { a: { c: false } },
      { a: new Int32(5) },
    ];
    const r = await analyzeSample(docs);
    expect(r.fields.map((f) => f.path)).toEqual(['a', 'a.b', 'a.c']);
    const a = fieldOf(r.fields, 'a');
    expect(a.probability).toBe(1);
    expect(a.types.map((t) => [t.bsonType, t.count])).toEqual([
      ['object', 3],
      ['int', 1],
    ]);
    // 3 of the 4 `a` values are documents: the base of `a.b` and `a.c`.
    const ab = fieldOf(r.fields, 'a.b');
    expect(ab.count).toBe(2);
    expect(ab.probability).toBeCloseTo(2 / 3);
    expect(typeOf(ab, 'int').probability).toBeCloseTo(1 / 3);
    expect(typeOf(ab, 'string').probability).toBeCloseTo(1 / 3);
    const ac = fieldOf(r.fields, 'a.c');
    expect(ac.probability).toBeCloseTo(2 / 3);
    expect(typeOf(ac, 'bool').count).toBe(2);
  });

  it('array items are <path>.[] with share 1, typed per item; documents in arrays continue below', async () => {
    const docs: Document[] = [
      { tags: ['x', 'y'], items: [{ name: 'pen' }, { name: 'ink', qty: new Int32(2) }] },
      { tags: ['z', new Int32(1)] },
      { tags: 'single' },
      {},
    ];
    const r = await analyzeSample(docs);
    // Depth first; siblings in `mongodb-schema`'s (alphabetical) order.
    expect(r.fields.map((f) => f.path)).toEqual([
      'items',
      'items.[]',
      'items.[].name',
      'items.[].qty',
      'tags',
      'tags.[]',
    ]);
    const tags = fieldOf(r.fields, 'tags');
    expect(tags.probability).toBeCloseTo(0.75);
    expect(typeOf(tags, 'array').count).toBe(2);
    expect(typeOf(tags, 'string').count).toBe(1);

    const items = fieldOf(r.fields, 'tags.[]');
    expect(items.probability).toBe(1);
    expect(items.count).toBe(4);
    expect(typeOf(items, 'string').probability).toBeCloseTo(0.75);
    expect(typeOf(items, 'int').probability).toBeCloseTo(0.25);
    expect(examplesOf(items, 'string')).toEqual(['x', 'y', 'z']);

    expect(fieldOf(r.fields, 'items.[]')).toMatchObject({ probability: 1, count: 2 });
    expect(fieldOf(r.fields, 'items.[].name')).toMatchObject({ probability: 1, count: 2 });
    const qty = fieldOf(r.fields, 'items.[].qty');
    expect(qty.probability).toBeCloseTo(0.5);
    expect(qty.count).toBe(1);
  });

  it('empty arrays get no item path', async () => {
    const r = await analyzeSample([{ list: [] }, { list: [] }]);
    expect(r.fields.map((f) => f.path)).toEqual(['list']);
    expect(fieldOf(r.fields, 'list').types.map((t) => t.bsonType)).toEqual(['array']);
  });

  it('every share stays within 0..1 (contract range)', async () => {
    const docs: Document[] = [
      { a: [{ b: [new Int32(1), 'x'] }, { b: null }], o: { _id: new ObjectId() } },
      { a: [], o: {} },
      { a: [[new Int32(1)], [new Int32(2), new Int32(3)]] },
    ];
    const r = await analyzeSample(docs);
    for (const f of r.fields) {
      expect(f.probability).toBeGreaterThanOrEqual(0);
      expect(f.probability).toBeLessThanOrEqual(1);
      for (const t of f.types) {
        expect(t.probability).toBeGreaterThanOrEqual(0);
        expect(t.probability).toBeLessThanOrEqual(1);
      }
    }
    expect(r.fields.map((f) => f.path)).toContain('a.[].[]');
  });
});

describe('flattenSchema', () => {
  /** A minimal `mongodb-schema` result; only what `flattenSchema` reads. */
  const schema = (s: unknown) => s as Schema;

  it('merges type names with the same alias (DBRef + Document → object), examples deduplicated', () => {
    const fields = flattenSchema(
      schema({
        count: 4,
        fields: [
          {
            name: 'ref',
            path: ['ref'],
            count: 4,
            probability: 1,
            types: [
              {
                name: 'Document',
                bsonType: 'Document',
                count: 2,
                values: [],
                fields: [
                  {
                    name: 'k',
                    path: ['ref', 'k'],
                    count: 2,
                    types: [{ name: 'String', count: 2, values: ['x', 'y'] }],
                  },
                ],
              },
              { name: 'DBRef', bsonType: 'DBRef', count: 1, values: [] },
              { name: 'String', bsonType: 'String', count: 1, values: ['x'] },
            ],
          },
        ],
      }),
    );
    const ref = fieldOf(fields, 'ref');
    expect(ref.types.map((t) => [t.bsonType, t.count])).toEqual([
      ['object', 3],
      ['string', 1],
    ]);
    expect(typeOf(ref, 'object').probability).toBeCloseTo(0.75);
    // Only `Document` types have sub-fields; the base is their count.
    expect(fieldOf(fields, 'ref.k').probability).toBe(1);
    expect(examplesOf(fieldOf(fields, 'ref.k'), 'string')).toEqual(['x', 'y']);
  });

  it('merged types keep at most 5 distinct examples across the merged names', () => {
    const fields = flattenSchema(
      schema({
        count: 10,
        fields: [
          {
            name: 'n',
            count: 10,
            types: [
              { name: 'Int64', count: 5, values: [1, 2, 3].map((i) => Long.fromNumber(i)) },
              { name: 'Long', count: 5, values: [2, 3, 4, 5, 6, 7].map((i) => Long.fromNumber(i)) },
            ],
          },
        ],
      }),
    );
    const n = fieldOf(fields, 'n');
    expect(n.types).toHaveLength(1);
    expect(n.types[0]).toMatchObject({ bsonType: 'long', count: 10, probability: 1 });
    expect(examplesOf(n, 'long').map((v) => Number(v as BSON.Long))).toEqual([1, 2, 3, 4, 5]);
  });

  it('leaves out Undefined and zero-count types', () => {
    const fields = flattenSchema(
      schema({
        count: 4,
        fields: [
          {
            name: 'x',
            count: 2,
            types: [
              { name: 'Undefined', count: 2, values: [] },
              { name: 'String', count: 2, values: ['a'] },
              { name: 'Int32', count: 0, values: [] },
            ],
          },
        ],
      }),
    );
    expect(fieldOf(fields, 'x').types.map((t) => t.bsonType)).toEqual(['string']);
    expect(fieldOf(fields, 'x').probability).toBe(0.5);
  });

  it('a zero base gives share 0 instead of NaN; types without values have no examples', () => {
    const fields = flattenSchema(
      schema({ count: 0, fields: [{ name: 'x', count: 0, types: [{ name: 'Null', count: 1 }] }] }),
    );
    expect(fields).toEqual([
      {
        path: 'x',
        probability: 0,
        count: 0,
        types: [{ bsonType: 'null', probability: 0, count: 1, examples: '[]' }],
      },
    ]);
  });

  it('tolerates documents without fields and arrays without item types or totals', () => {
    const fields = flattenSchema(
      schema({
        count: 2,
        fields: [
          {
            name: 'x',
            count: 2,
            types: [
              { name: 'Document', count: 1 },
              { name: 'Array', count: 1 },
            ],
          },
        ],
      }),
    );
    expect(fields.map((f) => f.path)).toEqual(['x']);
    expect(fieldOf(fields, 'x').types.map((t) => t.bsonType)).toEqual(['array', 'object']);
  });

  it('no fields → empty list', () => {
    expect(flattenSchema(schema({ count: 3, fields: [] }))).toEqual([]);
  });
});

describe('analyzeCollection', () => {
  it('reads every batch of the sample (aggregate + getMore, same comment) and analyzes it', async () => {
    const client = fakeClient((_db, command) => {
      if ('aggregate' in command) {
        return cursorReply(BSON.Long.fromNumber(42), [{ a: new Int32(1) }, { a: 'x' }]);
      }
      if ('getMore' in command) return cursorReply(0, [{ a: new Int32(2) }, {}], false);
      return { ok: 1 };
    });
    const r = await analyzeCollection(
      client,
      params({ filter: '{"a":{"$exists":true}}', sampleSize: 4 }),
    );
    expect(r.sampled).toBe(4);
    const a = fieldOf(r.fields, 'a');
    expect(a.probability).toBeCloseTo(0.75);
    expect(typeOf(a, 'int').count).toBe(2);
    expect(client.sent.map((s) => firstKey(s.command))).toEqual(['aggregate', 'getMore']);
    expect(client.sent.every((s) => s.db === 'shop')).toBe(true);
    expect(client.sent[0]?.command).toMatchObject({
      aggregate: 'orders',
      pipeline: [{ $match: { a: { $exists: true } } }, { $sample: { size: 4 } }],
    });
    const comment = client.sent[0]?.command['comment'];
    expect(String(comment)).toMatch(/^thicket:/);
    expect(client.sent[1]?.command).toMatchObject({ collection: 'orders', comment });
  });

  it('decodes raw batches without promotion (int and double stay apart)', async () => {
    const raw = [
      BSON.serialize({ v: new Int32(1) }),
      BSON.serialize({ v: new Double(1) }),
      BSON.serialize({ v: Long.fromNumber(1) }),
    ];
    const client = fakeClient(() => cursorReply(0, raw as unknown as Document[]));
    const r = await analyzeCollection(client, params());
    expect(
      fieldOf(r.fields, 'v')
        .types.map((t) => t.bsonType)
        .sort(),
    ).toEqual(['double', 'int', 'long']);
  });

  it('a long value read from the server is counted but not offered as a (cut) example', async () => {
    const raw = [
      BSON.serialize({ note: 'n'.repeat(EXAMPLE_LENGTH_LIMIT * 3) }),
      BSON.serialize({ note: 'short note' }),
    ];
    const client = fakeClient(() => cursorReply(0, raw as unknown as Document[]));
    const r = await analyzeCollection(client, params());
    const note = fieldOf(r.fields, 'note');
    expect(typeOf(note, 'string').count).toBe(2);
    expect(examplesOf(note, 'string')).toEqual(['short note']);
  });

  it('an empty collection gives sampled 0 and no fields', async () => {
    const client = fakeClient(() => cursorReply(0, []));
    await expect(analyzeCollection(client, params())).resolves.toEqual({ sampled: 0, fields: [] });
  });

  it('a server error is answered with its contract code', async () => {
    const client = fakeClient(() => {
      throw new MongoServerError({ ok: 0, code: 26, codeName: 'NamespaceNotFound', errmsg: 'x' });
    });
    expect((await rejection(analyzeCollection(client, params()))).code).toBe('NOT_FOUND');
  });

  it('a failing getMore kills the open cursor and rejects', async () => {
    const client = fakeClient((_db, command) => {
      if ('aggregate' in command) return cursorReply(BSON.Long.fromNumber(9), [{ a: 1 }]);
      if ('getMore' in command) {
        throw new MongoServerError({ ok: 0, code: 2, codeName: 'BadValue', errmsg: 'boom' });
      }
      return { ok: 1 };
    });
    await expect(analyzeCollection(client, params())).rejects.toBeInstanceOf(RpcError);
    expect(client.sent.filter((s) => 'killCursors' in s.command).map((s) => s.command)).toEqual([
      { killCursors: 'orders', cursors: [BSON.Long.fromNumber(9)] },
    ]);
  });

  it('an invalid filter is INVALID_PARAMS and sends nothing', async () => {
    const client = fakeClient(() => cursorReply(0, []));
    expect((await rejection(analyzeCollection(client, params({ filter: '[1]' })))).code).toBe(
      'INVALID_PARAMS',
    );
    expect(client.sent).toEqual([]);
  });

  it('a signal aborted before the start rejects CANCELLED without sending anything', async () => {
    const client = fakeClient(() => cursorReply(0, []));
    const controller = new AbortController();
    controller.abort();
    const error = await rejection(analyzeCollection(client, params(), controller.signal));
    expect(error.code).toBe('CANCELLED');
    expect(client.sent).toEqual([]);
  });

  it('abort during sampling: CANCELLED, the server operation is killed by its comment', async () => {
    const pending = deferred<Document>();
    const client = fakeClient((_db, command) => {
      if ('aggregate' in command) return pending.promise;
      if ('currentOp' in command) return { inprog: [{ opid: 7 }], ok: 1 };
      return { ok: 1 };
    });
    const controller = new AbortController();
    const running = analyzeCollection(client, params(), controller.signal);
    await vi.waitFor(() =>
      expect(client.sent.map((s) => firstKey(s.command))).toEqual(['aggregate']),
    );
    controller.abort();
    await vi.waitFor(() => expect(client.sent.map((s) => firstKey(s.command))).toContain('killOp'));
    pending.resolve(cursorReply(0, []));
    expect((await rejection(running)).code).toBe('CANCELLED');
    const comment = client.sent[0]?.command['comment'];
    expect(client.sent[1]?.command).toMatchObject({ currentOp: 1, 'command.comment': comment });
    expect(client.sent.find((s) => 'killOp' in s.command)?.command).toEqual({ killOp: 1, op: 7 });
  });
});

describe('schemaHandlers', () => {
  const profile: Profile = {
    id: 'p1',
    name: 'Local',
    connectionString: 'mongodb://db.example.test:27017',
    readOnly: true,
    production: false,
  };

  async function setup(answer: Answer, open = true) {
    const client = fakeClient((db, command) => {
      if ('hello' in command) return { isWritablePrimary: true, ok: 1 };
      if ('buildInfo' in command) return { version: '8.2.0', ok: 1 };
      return answer(db, command);
    });
    const manager = new ConnectionManager({
      loadProfile: (id) =>
        id === 'p1' ? Promise.resolve(profile) : Promise.reject(new RpcError('NOT_FOUND', id)),
      loadSecrets: () => Promise.resolve(null),
      createClient: () => client,
    });
    if (open) await manager.open('p1', undefined);
    client.sent.length = 0;
    const handlers = schemaHandlers(manager);
    const call = (p: unknown, signal = new AbortController().signal) =>
      Promise.resolve(
        (handlers['schema.analyze'] as Handler)(p as never, { signal, requestId: 'r1' }),
      );
    return { handlers, call, client };
  }

  it('serves exactly schema.analyze', async () => {
    const { handlers } = await setup(() => ({ ok: 1 }));
    expect(Object.keys(handlers)).toEqual(['schema.analyze']);
  });

  it('analyzes on the open connection of the profile (read-only profiles too)', async () => {
    const { call, client } = await setup((_db, command) =>
      'aggregate' in command ? cursorReply(0, [{ a: new Int32(1) }]) : { ok: 1 },
    );
    const r = (await call(params())) as { sampled: number; fields: SchemaField[] };
    expect(r.sampled).toBe(1);
    expect(r.fields.map((f) => f.path)).toEqual(['a']);
    expect(client.sent.map((s) => firstKey(s.command))).toEqual(['aggregate']);
  });

  it('answers NOT_CONNECTED for a profile without an open connection', async () => {
    const { call } = await setup(() => ({ ok: 1 }), false);
    await expect(call(params())).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });

  it('answers CANCELLED at once while the sample is still pending', async () => {
    const never = new Promise<Document>(() => undefined);
    const { call } = await setup((_db, command) =>
      'aggregate' in command ? never : { inprog: [], ok: 1 },
    );
    const controller = new AbortController();
    const pending = call(params(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
