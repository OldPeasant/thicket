import { BSON, MongoClient, type Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  diffDocuments,
  parseEJson,
  parseEJsonDocument,
  stringifyEJson,
  str,
  type BsonDocument,
  type BsonValue,
} from '@thicket/core';
import { DIFF_CASES } from '../../packages/core/src/diff/fixtures.ts';

// Applies the update produced by diffDocuments to a real server (8.x and 7.0) and checks the
// result and the conflict filter (task diff-ops).

/** Model → driver value (canonical EJSON keeps every BSON type). */
const toDriver = (value: BsonValue): Document =>
  BSON.EJSON.parse(stringifyEJson(value), { relaxed: false }) as Document;
/** Driver document read with `promoteValues: false` → canonical EJSON text. */
const fromDriver = (value: Document): string =>
  stringifyEJson(parseEJson(BSON.EJSON.stringify(value, { relaxed: false })));
const canonical = (text: string) => stringifyEJson(parseEJson(text));

/** The original with one top-level field changed (or added) by "another user". */
function concurrentChange(original: BsonDocument, key: string): BsonDocument {
  const value = str(`changed by someone else: ${key}`);
  const exists = original.fields.some((f) => f.key === key);
  return {
    type: 'object',
    fields: exists
      ? original.fields.map((f) => (f.key === key ? { key, value } : f))
      : [...original.fields, { key, value }],
  };
}

const readOptions = { promoteValues: false, promoteLongs: false, promoteBuffers: false } as const;

describe.each(['mongo8', 'mongo7'] as const)('diff-ops against %s', (fixture) => {
  let client: MongoClient;
  beforeAll(async () => {
    client = new MongoClient(inject('mongo')[fixture].uri, { serverSelectionTimeoutMS: 5_000 });
    await client.connect();
  });
  afterAll(async () => {
    await client.close();
  });
  const coll = (name: string) =>
    client.db('diff_ops').collection(name.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60));

  const changing = DIFF_CASES.filter((c) => c.update !== 'none');

  it.each(changing)('applying the update yields the edited document: $name', async (c) => {
    const original = parseEJsonDocument(c.original);
    const diff = diffDocuments(original, parseEJsonDocument(c.edited));
    if (diff.kind === 'none') throw new Error('expected a change');
    const col = coll(c.name);
    await col.deleteMany({});
    await col.insertOne(toDriver(original));

    const filter = toDriver(diff.filter);
    const result =
      diff.kind === 'update'
        ? await col.updateOne(filter, toDriver(diff.update))
        : await col.replaceOne(filter, toDriver(diff.replacement));
    expect(result.matchedCount).toBe(1);
    expect(result.modifiedCount).toBe(1);

    const stored = await col.findOne({}, readOptions);
    expect(fromDriver(stored as Document)).toBe(canonical(c.applied ?? c.edited));
  });

  it.each(changing)('conflict filter: $name', async (c) => {
    const original = parseEJsonDocument(c.original);
    const diff = diffDocuments(original, parseEJsonDocument(c.edited));
    if (diff.kind === 'none') throw new Error('expected a change');
    const col = coll(`f ${c.name}`);
    const filter = toDriver(diff.filter);

    // Unchanged server document: matches exactly once.
    await col.deleteMany({});
    await col.insertOne(toDriver(original));
    expect(await col.countDocuments(filter)).toBe(1);

    // A field the edit did not touch was changed concurrently: still no conflict. (Delete +
    // insert instead of replaceOne: replacements may not contain top-level `$` keys.)
    await col.deleteMany({});
    await col.insertOne(toDriver(concurrentChange(original, 'unrelatedConcurrentField')));
    expect(await col.countDocuments(filter)).toBe(1);

    // Any changed top-level field modified on the server: the filter matches nothing.
    expect(diff.changedFields.length).toBeGreaterThan(0);
    for (const key of diff.changedFields) {
      await col.deleteMany({});
      await col.insertOne(toDriver(concurrentChange(original, key)));
      expect(await col.countDocuments(filter), key).toBe(0);
    }
  });

  it.each(changing)('conflict filter detects a concurrent removal: $name', async (c) => {
    const original = parseEJsonDocument(c.original);
    const diff = diffDocuments(original, parseEJsonDocument(c.edited));
    if (diff.kind === 'none') throw new Error('expected a change');
    const col = coll(`r ${c.name}`);
    const filter = toDriver(diff.filter);

    // Another user removed a changed top-level field that existed in the original.
    const removable = diff.changedFields.filter((k) => original.fields.some((f) => f.key === k));
    for (const key of removable) {
      await col.deleteMany({});
      await col.insertOne(
        toDriver({ type: 'object', fields: original.fields.filter((f) => f.key !== key) }),
      );
      expect(await col.countDocuments(filter), key).toBe(0);
    }
  });

  it('a stale save does not overwrite a concurrent change (updateOne matches nothing)', async () => {
    const original = parseEJsonDocument(
      '{"_id":{"$oid":"65a1b2c3d4e5f60718293a4c"},"qty":1,"meta":{"by":"ann"}}',
    );
    const diff = diffDocuments(
      original,
      parseEJsonDocument('{"_id":{"$oid":"65a1b2c3d4e5f60718293a4c"},"qty":2,"meta":{"by":"ann"}}'),
    );
    if (diff.kind !== 'update') throw new Error('expected an update');
    const col = coll('stale save');
    await col.deleteMany({});
    await col.insertOne(toDriver(original));
    // Someone else saved qty = 5 first.
    await col.updateOne({}, { $set: { qty: 5 } });

    const result = await col.updateOne(toDriver(diff.filter), toDriver(diff.update));
    expect(result.matchedCount).toBe(0);
    const stored = await col.findOne({}, readOptions);
    expect(fromDriver(stored as Document)).toBe(
      canonical('{"_id":{"$oid":"65a1b2c3d4e5f60718293a4c"},"qty":5,"meta":{"by":"ann"}}'),
    );
  });
});
