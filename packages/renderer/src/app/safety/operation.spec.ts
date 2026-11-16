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
});
