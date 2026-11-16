import { describe, expect, it } from 'vitest';

import { describeWrite, shell } from './operation';

const t = { profileId: 'p', db: 'shop', coll: 'orders' };
const C = 'db.getSiblingDB("shop").getCollection("orders")';
const OID = '{"$oid":"64b7f0c2a1b2c3d4e5f60718"}';

describe('describeWrite', () => {
  it('prints EJSON in shell syntax', () => {
    expect(shell(`{"_id":${OID},"n":{"$numberLong":"5"}}`, 0)).toBe(
      '{ _id: ObjectId("64b7f0c2a1b2c3d4e5f60718"), n: NumberLong(5) }',
    );
    expect(shell('not json')).toBe('not json');
  });

  it('single-document writes use the _id + expected values filter', () => {
    expect(
      describeWrite('docs.update', {
        ...t,
        id: OID,
        update: '{"$set":{"status":"paid"}}',
        expected: '{"status":"open"}',
      }),
    ).toBe(
      `${C}.updateOne({ _id: ObjectId("64b7f0c2a1b2c3d4e5f60718"), status: "open" }, {\n` +
        `  $set: {\n    status: "paid"\n  }\n})`,
    );
    expect(describeWrite('docs.delete', { ...t, id: OID })).toBe(
      `${C}.deleteOne({ _id: ObjectId("64b7f0c2a1b2c3d4e5f60718") })`,
    );
    expect(describeWrite('docs.replace', { ...t, id: '1', doc: '{"a":1}' })).toBe(
      `${C}.replaceOne({ _id: 1 }, {\n  a: 1\n})`,
    );
  });

  it('inserts: insertOne for one document, insertMany for several', () => {
    expect(describeWrite('docs.insert', { ...t, docs: ['{"a":1}'] })).toBe(
      `${C}.insertOne({\n  a: 1\n})`,
    );
    expect(describeWrite('docs.insert', { ...t, docs: ['{}', '{}'], ordered: false })).toBe(
      `${C}.insertMany([{}, {}], { ordered: false })`,
    );
  });

  it('bulk writes', () => {
    expect(describeWrite('docs.deleteMany', { ...t, filter: '{"a":{"$lt":3}}' })).toBe(
      `${C}.deleteMany({\n  a: {\n    $lt: 3\n  }\n})`,
    );
    expect(
      describeWrite('docs.updateMany', {
        ...t,
        filter: '{}',
        update: '[{"$set":{"b":1}}]',
        collation: '{"locale":"en"}',
      }),
    ).toBe(
      `${C}.updateMany({}, [\n  {\n    $set: {\n      b: 1\n    }\n  }\n], { collation: { locale: "en" } })`,
    );
  });

  it('collection, database, index, view and admin writes', () => {
    const D = 'db.getSiblingDB("shop")';
    expect(describeWrite('coll.drop', t)).toBe(`${C}.drop()`);
    expect(describeWrite('coll.create', { ...t })).toBe(`${D}.createCollection("orders")`);
    expect(describeWrite('coll.rename', { ...t, newName: 'o2', dropTarget: true })).toBe(
      `${C}.renameCollection("o2", true)`,
    );
    expect(
      describeWrite('coll.validator.set', {
        ...t,
        validator: null,
        validationLevel: 'off',
        validationAction: 'warn',
      }),
    ).toContain('collMod: "orders"');
    expect(describeWrite('db.drop', { profileId: 'p', db: 'shop' })).toBe(`${D}.dropDatabase()`);
    expect(describeWrite('db.create', { profileId: 'p', db: 'shop', firstCollection: 'a' })).toBe(
      `${D}.createCollection("a")`,
    );
    expect(describeWrite('idx.create', { ...t, key: '{"a":1}' })).toBe(
      `${C}.createIndex({ a: 1 })`,
    );
    expect(describeWrite('idx.drop', { ...t, name: 'a_1' })).toBe(`${C}.dropIndex("a_1")`);
    expect(describeWrite('idx.hide', { ...t, name: 'a_1', hidden: false })).toBe(
      `${C}.unhideIndex("a_1")`,
    );
    expect(describeWrite('agg.run', { ...t, pipeline: '[{"$out":"x"}]' })).toBe(
      `${C}.aggregate([\n  {\n    $out: "x"\n  }\n])`,
    );
    expect(
      describeWrite('agg.createView', {
        profileId: 'p',
        db: 'shop',
        view: 'v',
        viewOn: 'orders',
        pipeline: '[]',
      }),
    ).toBe(`${D}.createView("v", "orders", [])`);
    expect(describeWrite('admin.killOp', { profileId: 'p', opId: '{"$numberInt":"42"}' })).toBe(
      'db.killOp(42)',
    );
    expect(
      describeWrite('io.import', { ...t, fileToken: 'tok', ordered: true, stopOnError: false }),
    ).toContain('{ ordered: true, stopOnError: false }');
  });

  it('prints optional arguments only when given', () => {
    const D = 'db.getSiblingDB("shop")';
    expect(describeWrite('coll.create', { ...t, options: '{"capped":true,"size":1024}' })).toBe(
      `${D}.createCollection("orders", {\n  capped: true,\n  size: 1024\n})`,
    );
    expect(describeWrite('coll.rename', { ...t, newName: 'o2' })).toBe(
      `${C}.renameCollection("o2")`,
    );
    expect(describeWrite('idx.create', { ...t, key: '{"a":1}', options: '{"unique":true}' })).toBe(
      `${C}.createIndex({ a: 1 }, {\n  unique: true\n})`,
    );
    expect(describeWrite('idx.hide', { ...t, name: 'a_1', hidden: true })).toBe(
      `${C}.hideIndex("a_1")`,
    );
    expect(
      describeWrite('docs.deleteMany', { ...t, filter: '{}', collation: '{"locale":"de"}' }),
    ).toBe(`${C}.deleteMany({}, { collation: { locale: "de" } })`);
    expect(
      describeWrite('docs.updateMany', { ...t, filter: '{}', update: '{"$set":{"a":1}}' }),
    ).toBe(`${C}.updateMany({}, {\n  $set: {\n    a: 1\n  }\n})`);
    expect(describeWrite('docs.insert', { ...t, docs: ['{}', '{}'] })).toBe(
      `${C}.insertMany([{}, {}])`,
    );
    expect(describeWrite('io.import', { ...t, fileToken: 'tok' })).toBe(
      `// Import the chosen file\n${C}.insertMany(<file documents>)`,
    );
  });

  it('prints the full collMod command with a validator', () => {
    expect(
      describeWrite('coll.validator.set', {
        ...t,
        validator: '{"$jsonSchema":{"required":["a"]}}',
        validationLevel: 'strict',
        validationAction: 'error',
      }),
    ).toBe(
      'db.getSiblingDB("shop").runCommand({\n' +
        '  collMod: "orders",\n' +
        '  validator: {\n    $jsonSchema: {\n      required: [\n        "a"\n      ]\n    }\n  },\n' +
        '  validationLevel: "strict",\n' +
        '  validationAction: "error"\n})',
    );
  });

  it('a document-delete with expected values shows them in the filter', () => {
    expect(
      describeWrite('docs.delete', { ...t, id: OID, expected: '{"v":{"$numberInt":"3"},"s":"a"}' }),
    ).toBe(`${C}.deleteOne({ _id: ObjectId("64b7f0c2a1b2c3d4e5f60718"), v: 3, s: "a" })`);
  });

  it('escapes database and collection names as string literals', () => {
    expect(describeWrite('coll.drop', { profileId: 'p', db: 'we"ird', coll: 'a\\b\nc' })).toBe(
      'db.getSiblingDB("we\\"ird").getCollection("a\\\\b\\nc").drop()',
    );
  });

  it('dates and ids appear in shell syntax', () => {
    expect(
      describeWrite('docs.deleteMany', {
        ...t,
        filter: '{"at":{"$lt":{"$date":"2025-01-01T00:00:00Z"}}}',
      }),
    ).toContain('ISODate("2025-01-01T00:00:00');
  });

  it('shell() indents by two by default and leaves invalid EJSON as it is', () => {
    expect(shell('{"a":1}')).toBe('{\n  a: 1\n}');
    expect(shell('{"a":', 0)).toBe('{"a":');
  });
});
