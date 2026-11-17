import type { ParsedParamsOf, ResultOf, SchemaField } from '@thicket/contract';
import { BSON, type Document } from 'mongodb';
import { parseSchema, type Schema, type SchemaType } from 'mongodb-schema';

import type { ClientLike } from '../connections/manager';
import { Operation, parseDocument } from '../docs/query/query';

/**
 * Schema analysis (`schema.analyze`): a `$sample` of the collection (after the optional filter)
 * read like `docs/query` (raw batches decoded without promotion, so `int`, `long`, `double` and
 * `decimal` stay apart; the command carries a `comment`, so a cancel kills it), analyzed with
 * `mongodb-schema` and flattened into one entry per field path.
 *
 * Paths are dotted; the items of an array are `<path>.[]` (documents in arrays continue below
 * it: `tags.[].name`). Shares (`probability`) are relative to the parent: for a top-level field
 * the sampled documents, for `a.b` the sampled values of `a` that are documents, for `a.[]` the
 * items of all sampled arrays at `a` (always 1). A type's share is relative to the same base, so
 * a field's type shares add up to its own share; its missing ratio is `1 - probability`.
 */

/** Documents sampled when `sampleSize` is not given (SPEC.md M3). */
export const DEFAULT_SCHEMA_SAMPLE = 1000;

/** Example values kept per path and type. */
export const MAX_SCHEMA_EXAMPLES = 5;

/** Longest string kept as an example (longer ones are cut by `mongodb-schema`). */
const EXAMPLE_STRING_LIMIT = 200;

/** `mongodb-schema` type names → the `$type` aliases the query language uses. */
const TYPE_ALIASES: Readonly<Record<string, string>> = {
  Array: 'array',
  Binary: 'binData',
  Boolean: 'bool',
  BSONRegExp: 'regex',
  BSONSymbol: 'symbol',
  Code: 'javascript',
  CodeWScope: 'javascriptWithScope',
  Date: 'date',
  DBRef: 'object',
  Decimal128: 'decimal',
  Document: 'object',
  Double: 'double',
  Int32: 'int',
  Int64: 'long',
  Long: 'long',
  MaxKey: 'maxKey',
  MinKey: 'minKey',
  Null: 'null',
  Number: 'double',
  ObjectId: 'objectId',
  RegExp: 'regex',
  String: 'string',
  Symbol: 'symbol',
  Timestamp: 'timestamp',
  Undefined: 'undefined',
};

/** The `$type` alias of a `mongodb-schema` type name (unknown names lower-cased). */
export function typeAlias(name: string): string {
  return TYPE_ALIASES[name] ?? name.charAt(0).toLowerCase() + name.slice(1);
}

interface TypeAcc {
  bsonType: string;
  count: number;
  examples: unknown[];
}

const valuesOf = (type: SchemaType): unknown[] => {
  const values = (type as { values?: unknown[] }).values;
  return Array.isArray(values) ? values : [];
};

const exampleKey = (value: unknown): string => BSON.EJSON.stringify([value], { relaxed: false });

/** Collects the types of one path, merging names with the same alias (`DBRef` and `Document`). */
function mergeTypes(types: readonly SchemaType[]): TypeAcc[] {
  const byAlias = new Map<string, TypeAcc & { seen: Set<string> }>();
  for (const type of types) {
    // Missing values: the field's own share already says how often it is missing.
    if (type.name === 'Undefined' || type.count === 0) continue;
    const bsonType = typeAlias(type.name);
    let acc = byAlias.get(bsonType);
    if (!acc) {
      acc = { bsonType, count: 0, examples: [], seen: new Set() };
      byAlias.set(bsonType, acc);
    }
    acc.count += type.count;
    for (const value of valuesOf(type)) {
      if (acc.examples.length >= MAX_SCHEMA_EXAMPLES) break;
      const key = exampleKey(value);
      if (acc.seen.has(key)) continue;
      acc.seen.add(key);
      acc.examples.push(value);
    }
  }
  return [...byAlias.values()]
    .map(({ bsonType, count, examples }) => ({ bsonType, count, examples }))
    .sort((a, b) => b.count - a.count || a.bsonType.localeCompare(b.bsonType));
}

const share = (count: number, base: number): number =>
  base > 0 ? Math.min(1, Math.max(0, count / base)) : 0;

/**
 * Appends the field at `path` (seen `count` times out of `base`) with its `types`, then the fields
 * below its document types and the items of its array types.
 */
function addPath(
  out: SchemaField[],
  path: string,
  count: number,
  base: number,
  types: readonly SchemaType[],
): void {
  const merged = mergeTypes(types);
  out.push({
    path,
    probability: share(count, base),
    count,
    types: merged.map((t) => ({
      bsonType: t.bsonType,
      probability: share(t.count, base),
      count: t.count,
      examples: BSON.EJSON.stringify(t.examples, { relaxed: false }),
    })),
  });
  const documents = types.filter((t) => t.name === 'Document');
  const subBase = documents.reduce((n, t) => n + t.count, 0);
  const subFields = new Map<string, { count: number; types: SchemaType[] }>();
  for (const doc of documents) {
    for (const field of (doc as { fields?: Schema['fields'] }).fields ?? []) {
      const entry = subFields.get(field.name) ?? { count: 0, types: [] };
      entry.count += field.count;
      entry.types.push(...field.types);
      subFields.set(field.name, entry);
    }
  }
  for (const [name, entry] of subFields) {
    addPath(out, `${path}.${name}`, entry.count, subBase, entry.types);
  }
  const items: SchemaType[] = [];
  let itemCount = 0;
  for (const type of types) {
    if (type.name !== 'Array') continue;
    const array = type as { types?: SchemaType[]; totalCount?: number };
    items.push(...(array.types ?? []));
    itemCount += array.totalCount ?? 0;
  }
  if (itemCount > 0) addPath(out, `${path}.[]`, itemCount, itemCount, items);
}

/** Flattens a `mongodb-schema` result into the contract's field list (depth first). */
export function flattenSchema(schema: Schema): SchemaField[] {
  const out: SchemaField[] = [];
  for (const field of schema.fields) {
    addPath(out, field.name, field.count, schema.count, field.types);
  }
  return out;
}

/** Analyzes documents already in memory (BSON values, not promoted). */
export async function analyzeSample(
  docs: readonly Document[],
  signal?: AbortSignal,
): Promise<ResultOf<'schema.analyze'>> {
  const schema = await parseSchema(docs, {
    storeValues: true,
    semanticTypes: false,
    storedValuesLengthLimit: EXAMPLE_STRING_LIMIT,
    signal,
  });
  return { sampled: schema.count, fields: flattenSchema(schema) };
}

/** The `aggregate` command that reads the sample. */
export function sampleCommand(p: ParsedParamsOf<'schema.analyze'>): Document {
  const pipeline: Document[] = [];
  if (p.filter !== undefined) {
    const filter = parseDocument(p.filter, 'filter');
    if (Object.keys(filter).length > 0) pipeline.push({ $match: filter });
  }
  pipeline.push({ $sample: { size: p.sampleSize ?? DEFAULT_SCHEMA_SAMPLE } });
  const cmd: Document = { aggregate: p.coll, pipeline, cursor: {} };
  if (p.maxTimeMS !== undefined) cmd['maxTimeMS'] = p.maxTimeMS;
  return cmd;
}

/** `schema.analyze`: samples the collection and analyzes the sample. */
export async function analyzeCollection(
  client: ClientLike,
  p: ParsedParamsOf<'schema.analyze'>,
  signal?: AbortSignal,
): Promise<ResultOf<'schema.analyze'>> {
  const cmd = sampleCommand(p);
  const op = new Operation(client, p.db, p.coll, signal);
  const docs: Document[] = [];
  try {
    docs.push(...(await op.open(cmd)));
    while (op.hasMore) docs.push(...(await op.more()));
  } finally {
    await op.close();
  }
  return analyzeSample(docs, signal);
}
