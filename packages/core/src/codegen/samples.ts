import type { BsonDocument } from '../bson/model';
import type { BsonType, BsonValue } from '../bson/model';
import { parseShellSyntaxDocument } from '../shellsyntax';
import type { CodegenQuery } from './model';

const d = (text: string): BsonDocument => parseShellSyntaxDocument(text);
const pipeline = (...stages: string[]): BsonDocument[] => stages.map(d);

/**
 * Ten find queries and pipelines for the code export tests; together they use every BSON type
 * (checked by the spec). Shared by the unit snapshots and the integration test.
 */
export const CODEGEN_SAMPLES: readonly { readonly name: string; readonly query: CodegenQuery }[] = [
  {
    name: 'find with filter, projection, sort, skip and limit',
    query: {
      kind: 'find',
      database: 'shop',
      collection: 'orders',
      filter: d('{ status: "open", total: { $gt: NumberDecimal("100.50") } }'),
      projection: d('{ _id: 0, status: 1, total: 1 }'),
      sort: d('{ total: -1, _id: 1 }'),
      skip: 10,
      limit: 5,
    },
  },
  {
    name: 'find with an empty filter',
    query: { kind: 'find', database: 'shop', collection: 'orders', filter: d('{}') },
  },
  {
    name: 'find with ids, dates and numbers',
    query: {
      kind: 'find',
      database: 'shop',
      collection: 'events',
      filter: d(`{
        _id: ObjectId("65a1b2c3d4e5f60718293a4b"),
        at: { $gte: ISODate("2024-01-02T03:04:05.678Z"), $lt: ISODate("2025-01-01T00:00:00Z") },
        count: 42, big: NumberLong("9007199254740993"), ratio: 0.25, whole: Double(3),
        flag: true, missing: null
      }`),
    },
  },
  {
    name: 'find with binary, uuid, regex and timestamp',
    query: {
      kind: 'find',
      database: 'files',
      collection: 'blobs',
      filter: d(`{
        hash: BinData(0, "AAECAwQ="), owner: UUID("0e5a6b43-1f2c-4d8e-9a7b-6c5d4e3f2a1b"),
        name: /^report-\\d+\\.pdf$/i, op: Timestamp({ t: 1700000000, i: 7 })
      }`),
      collation: d('{ locale: "en", strength: 2 }'),
    },
  },
  {
    name: 'find with min/max keys, code and special doubles',
    query: {
      kind: 'find',
      database: 'lab',
      collection: 'odd',
      filter: d(`{
        $or: [{ low: MinKey() }, { high: MaxKey() }],
        script: Code("function () { return 1; }"),
        nan: NaN, inf: Infinity, ninf: -Infinity, negZero: -0, huge: 1e300, tiny: 5e-324
      }`),
    },
  },
  {
    name: 'find with deprecated types',
    query: {
      kind: 'find',
      database: 'legacy',
      collection: 'old',
      filter: d(`{
        sym: BSONSymbol("abc"), undef: undefined,
        ptr: DBPointer("other.coll", ObjectId("65a1b2c3d4e5f60718293a4b")),
        scoped: Code("function () { return x; }", { x: 1 })
      }`),
    },
  },
  {
    name: 'find with awkward keys and strings',
    query: {
      kind: 'find',
      database: 'my-db',
      collection: 'weird.names',
      filter: d(`{
        "a.b": "quote \\" and backslash \\\\", "with space": "line\\nbreak\\ttab",
        "__proto__": "x", "ünï": "çödé ✓", "$expr": { $eq: ["$a", "$b"] }
      }`),
      sort: d('{ "a.b": 1 }'),
    },
  },
  {
    name: 'pipeline match, group, sort',
    query: {
      kind: 'aggregate',
      database: 'shop',
      collection: 'orders',
      pipeline: pipeline(
        '{ $match: { status: "open" } }',
        '{ $group: { _id: "$customer", total: { $sum: "$total" }, n: { $sum: 1 } } }',
        '{ $sort: { total: -1 } }',
        '{ $limit: 10 }',
      ),
    },
  },
  {
    name: 'pipeline with typed values',
    query: {
      kind: 'aggregate',
      database: 'shop',
      collection: 'orders',
      pipeline: pipeline(
        `{ $match: { createdAt: { $gte: ISODate("2020-02-29T12:00:00Z") },
           amount: { $in: [NumberLong(5), NumberDecimal("1.10"), Double(2), 7] } } }`,
        `{ $addFields: { tags: ["a", "b"], nested: { deep: { deeper: [1, [2, [3]]] } },
           ts: Timestamp({ t: 4294967295, i: 4294967295 }) } }`,
        '{ $project: { _id: 0 } }',
      ),
    },
  },
  {
    name: 'empty pipeline',
    query: { kind: 'aggregate', database: 'shop', collection: 'orders', pipeline: [] },
  },
];

/** BSON types used anywhere in a value. */
export function typesIn(value: BsonValue, into = new Set<BsonType>()): Set<BsonType> {
  into.add(value.type);
  if (value.type === 'object') value.fields.forEach((f) => typesIn(f.value, into));
  if (value.type === 'array') value.items.forEach((i) => typesIn(i, into));
  if (value.type === 'javascriptWithScope') typesIn(value.scope, into);
  return into;
}
