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

  it('prints agg.run options and the agg.createView collation', () => {
    expect(
      describeWrite('agg.run', {
        ...t,
        pipeline: '[]',
        collation: '{"locale":"de"}',
        hint: '{"a":1}',
        allowDiskUse: true,
        maxTimeMS: 5000,
        batchSize: 100,
      }),
    ).toBe(
      `${C}.aggregate([], { collation: { locale: "de" }, hint: { a: 1 }, allowDiskUse: true, ` +
        'maxTimeMS: 5000, batchSize: 100 })',
    );
    expect(describeWrite('agg.run', { ...t, pipeline: '[]', hint: '"a_1"' })).toBe(
      `${C}.aggregate([], { hint: "a_1" })`,
    );
    expect(
      describeWrite('agg.createView', {
        profileId: 'p',
        db: 'shop',
        view: 'v',
        viewOn: 'orders',
        pipeline: '[]',
        collation: '{"locale":"fr"}',
      }),
    ).toBe(
      'db.getSiblingDB("shop").createView("v", "orders", [], { collation: { locale: "fr" } })',
    );
  });

  it('agg.run prints falsy options that were given and omits the options object without any', () => {
    expect(
      describeWrite('agg.run', { ...t, pipeline: '[]', allowDiskUse: false, maxTimeMS: 0 }),
    ).toBe(`${C}.aggregate([], { allowDiskUse: false, maxTimeMS: 0 })`);
    expect(describeWrite('agg.run', { ...t, pipeline: '[{"$match":{"a":1}}]' })).toBe(
      `${C}.aggregate([\n  {\n    $match: {\n      a: 1\n    }\n  }\n])`,
    );
    expect(
      describeWrite('agg.createView', {
        profileId: 'p',
        db: 'shop',
        view: 'v',
        viewOn: 'orders',
        pipeline: '[]',
      }),
    ).toBe('db.getSiblingDB("shop").createView("v", "orders", [])');
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

  it('gridfs.upload shows the bucket and the stored name, or a placeholder for the chosen file', () => {
    const B = 'db.getSiblingDB("shop").getGridFSBucket({ bucketName: "fs" })';
    expect(describeWrite('gridfs.upload', { profileId: 'p', db: 'shop', bucket: 'fs' })).toBe(
      `// Upload the chosen file\n${B}.openUploadStream(<file name>)`,
    );
    expect(
      describeWrite('gridfs.upload', {
        profileId: 'p',
        db: 'shop',
        bucket: 'fs',
        filename: 'report "Q1".pdf',
      }),
    ).toBe(`// Upload the chosen file\n${B}.openUploadStream("report \\"Q1\\".pdf")`);
  });

  it('gridfs.delete prints the file id in shell syntax, whatever its BSON type', () => {
    const B = 'db.getSiblingDB("shop").getGridFSBucket({ bucketName: "images" })';
    const p = { profileId: 'p', db: 'shop', bucket: 'images' };
    expect(describeWrite('gridfs.delete', { ...p, id: OID })).toBe(
      `${B}.delete(ObjectId("64b7f0c2a1b2c3d4e5f60718"))`,
    );
    expect(describeWrite('gridfs.delete', { ...p, id: '"my-id"' })).toBe(`${B}.delete("my-id")`);
    expect(describeWrite('gridfs.delete', { ...p, id: '{"$numberInt":"7"}' })).toBe(
      `${B}.delete(7)`,
    );
  });

  it('gridfs escapes database and bucket names as string literals', () => {
    expect(
      describeWrite('gridfs.delete', { profileId: 'p', db: 'we"ird', bucket: 'a\\b', id: OID }),
    ).toBe(
      'db.getSiblingDB("we\\"ird").getGridFSBucket({ bucketName: "a\\\\b" })' +
        '.delete(ObjectId("64b7f0c2a1b2c3d4e5f60718"))',
    );
  });

  describe('user and role changes', () => {
    const D = 'db.getSiblingDB("shop")';
    const PW = 'fictitious-Pw-93aa';
    const u = { profileId: 'p', db: 'shop' };
    const roles = [
      { role: 'read', db: 'shop' },
      { role: 'readAnyDatabase', db: 'admin' },
    ];
    const ROLES = '[{ role: "read", db: "shop" }, { role: "readAnyDatabase", db: "admin" }]';

    it('createUser hides the password and prints roles and custom data', () => {
      const text = describeWrite('admin.createUser', {
        ...u,
        user: 'carl',
        password: PW,
        roles,
        customData: '{"team":"sales"}',
      });
      expect(text).toBe(
        `${D}.createUser({ user: "carl", pwd: "<hidden>", roles: ${ROLES}, customData: { team: "sales" } })`,
      );
      expect(text).not.toContain(PW);
    });

    it('createUser of a $external user has no pwd', () => {
      expect(
        describeWrite('admin.createUser', {
          profileId: 'p',
          db: '$external',
          user: 'x',
          roles: [],
        }),
      ).toBe('db.getSiblingDB("$external").createUser({ user: "x", roles: [] })');
    });

    it('updateUser prints only the fields sent; the password is hidden', () => {
      const text = describeWrite('admin.updateUser', { ...u, user: 'alice', password: PW });
      expect(text).toBe(`${D}.updateUser("alice", { pwd: "<hidden>" })`);
      expect(text).not.toContain(PW);
      expect(describeWrite('admin.updateUser', { ...u, user: 'alice', roles: [] })).toBe(
        `${D}.updateUser("alice", { roles: [] })`,
      );
      expect(describeWrite('admin.updateUser', { ...u, user: 'alice', customData: '{}' })).toBe(
        `${D}.updateUser("alice", { customData: {} })`,
      );
      expect(
        describeWrite('admin.updateUser', {
          ...u,
          user: 'alice',
          password: PW,
          roles,
          customData: '{"n":{"$numberInt":"3"}}',
        }),
      ).toBe(
        `${D}.updateUser("alice", { pwd: "<hidden>", roles: ${ROLES}, customData: { n: 3 } })`,
      );
    });

    it('drops name the user or role', () => {
      expect(describeWrite('admin.dropUser', { ...u, user: 'alice' })).toBe(
        `${D}.dropUser("alice")`,
      );
      expect(describeWrite('admin.dropRole', { ...u, role: 'clerk' })).toBe(
        `${D}.dropRole("clerk")`,
      );
    });

    it('createRole and updateRole print the privileges in shell syntax', () => {
      const privileges = '[{"resource":{"db":"shop","collection":""},"actions":["find"]}]';
      expect(
        describeWrite('admin.createRole', { ...u, role: 'clerk', privileges, roles: [] }),
      ).toBe(
        `${D}.createRole({ role: "clerk", privileges: [\n` +
          `  {\n    resource: {\n      db: "shop",\n      collection: ""\n    },\n` +
          `    actions: [\n      "find"\n    ]\n  }\n], roles: [] })`,
      );
      expect(describeWrite('admin.updateRole', { ...u, role: 'clerk', roles })).toBe(
        `${D}.updateRole("clerk", { roles: ${ROLES} })`,
      );
      expect(describeWrite('admin.updateRole', { ...u, role: 'clerk', privileges: '[]' })).toBe(
        `${D}.updateRole("clerk", { privileges: [] })`,
      );
    });

    it.each([
      ['admin.grantRoles', 'user', 'grantRolesToUser'],
      ['admin.grantRoles', 'role', 'grantRolesToRole'],
      ['admin.revokeRoles', 'user', 'revokeRolesFromUser'],
      ['admin.revokeRoles', 'role', 'revokeRolesFromRole'],
    ] as const)('%s for a %s prints %s', (method, kind, fn) => {
      expect(describeWrite(method, { ...u, kind, name: 'alice', roles })).toBe(
        `${D}.${fn}("alice", ${ROLES})`,
      );
    });

    it('escapes user, role and database names', () => {
      expect(describeWrite('admin.dropUser', { profileId: 'p', db: 'a"b', user: 'x"y\\z' })).toBe(
        'db.getSiblingDB("a\\"b").dropUser("x\\"y\\\\z")',
      );
      expect(
        describeWrite('admin.grantRoles', {
          ...u,
          kind: 'user',
          name: 'alice',
          roles: [{ role: 'r"1', db: 'shop' }],
        }),
      ).toBe(`${D}.grantRolesToUser("alice", [{ role: "r\\"1", db: "shop" }])`);
    });
  });

  it('shell() indents by two by default and leaves invalid EJSON as it is', () => {
    expect(shell('{"a":1}')).toBe('{\n  a: 1\n}');
    expect(shell('{"a":', 0)).toBe('{"a":');
  });
});
