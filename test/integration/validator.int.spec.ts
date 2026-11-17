import { randomBytes } from 'node:crypto';

import { MongoClient, ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  ConnectionManager,
  RpcClient,
  RpcError,
  guardWrites,
  serve,
  validatorHandlers,
} from '@thicket/backend';
import { methods, type MethodName, type Profile, type ResultOf } from '@thicket/contract';

import { portPair } from '../../packages/backend/src/server/testing';

// coll.validator.* (task validator) against the 8.x replica set and the 7.0 standalone, served
// like the backend serves them: contract validation of params and results, write guard on set.

const mongo = inject('mongo');

const SCHEMA = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['name', 'age'],
    properties: {
      name: { bsonType: 'string' },
      age: { bsonType: 'int', minimum: 0 },
    },
  },
};
const SCHEMA_EJSON = JSON.stringify({
  $jsonSchema: {
    bsonType: 'object',
    required: ['name', 'age'],
    properties: {
      name: { bsonType: 'string' },
      age: { bsonType: 'int', minimum: { $numberInt: '0' } },
    },
  },
});

async function failure(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw new Error(`expected an RpcError, got ${String(error)}`, { cause: error });
  }
  throw new Error('expected a failure');
}

for (const [label, uri] of [
  ['8.x replica set', mongo.mongo8rs.uri],
  ['7.0 standalone', mongo.mongo7.uri],
] as const) {
  describe(`coll.validator.* (${label})`, () => {
    const RW: Profile = {
      id: 'val-rw',
      name: 'Validator RW',
      connectionString: uri,
      readOnly: false,
      production: false,
      serverSelectionTimeoutMS: 10_000,
    };
    const RO: Profile = { ...RW, id: 'val-ro', name: 'Validator RO', readOnly: true };
    const DB = `val_${randomBytes(3).toString('hex')}`;
    const COLL = 'people';
    const ns = { profileId: RW.id, db: DB, coll: COLL };

    const good = new ObjectId();
    const missingAge = new ObjectId();
    const wrongType = new ObjectId();

    let direct: MongoClient;
    let manager: ConnectionManager;
    let client: RpcClient;
    let stop: () => void;
    const call = <M extends MethodName>(method: M, params: unknown) =>
      client.call(method, params) as Promise<ResultOf<M>>;

    beforeAll(async () => {
      direct = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
      await direct
        .db(DB)
        .collection(COLL)
        .insertMany([
          { _id: good, name: 'Ada', age: 36 },
          { _id: missingAge, name: 'Bob' },
          { _id: wrongType, name: 'Cy', age: 'old' },
          // Non-ObjectId _ids keep their type through the check.
          { _id: 7 as unknown as ObjectId, name: 7 },
          { _id: 'ok' as unknown as ObjectId, name: 'Str', age: 1 },
        ]);
      const profiles = [RW, RO];
      const loadProfile = (id: string) => {
        const found = profiles.find((p) => p.id === id);
        return found
          ? Promise.resolve(found)
          : Promise.reject(new RpcError('NOT_FOUND', `No profile with id ${id}`));
      };
      manager = new ConnectionManager({ loadProfile, loadSecrets: () => Promise.resolve(null) });
      const [serverPort, clientPort] = portPair();
      stop = serve(serverPort, {
        table: methods,
        route: 'backend',
        handlers: guardWrites(validatorHandlers(manager), loadProfile),
      });
      client = new RpcClient(clientPort);
      for (const p of profiles) await manager.open(p.id, undefined);
    });

    afterAll(async () => {
      await direct.db(DB).dropDatabase();
      client.close();
      stop();
      await manager.closeAll();
      await direct.close();
    });

    const allIds = () =>
      JSON.stringify([
        { $oid: good.toHexString() },
        { $oid: missingAge.toHexString() },
        { $oid: wrongType.toHexString() },
        { $numberInt: '7' },
        'ok',
      ]);

    it('a collection without a validator has none and flags nothing', async () => {
      expect(await call('coll.validator.get', ns)).toEqual({
        validator: null,
        validationLevel: 'strict',
        validationAction: 'error',
      });
      expect(await call('coll.validator.check', { ...ns, ids: allIds() })).toEqual({
        invalid: '[]',
        hasValidator: false,
      });
    });

    it('set validator, then the invalid documents are flagged by the check method', async () => {
      await call('coll.validator.set', {
        ...ns,
        validator: SCHEMA_EJSON,
        validationLevel: 'moderate',
        validationAction: 'warn',
      });
      // The server has it.
      const [info] = (await direct.db(DB).listCollections({ name: COLL }).toArray()) as {
        options?: unknown;
      }[];
      expect(info?.options).toMatchObject({
        validator: SCHEMA,
        validationLevel: 'moderate',
        validationAction: 'warn',
      });

      const got = await call('coll.validator.get', ns);
      expect(got.validationLevel).toBe('moderate');
      expect(got.validationAction).toBe('warn');
      expect(JSON.parse(got.validator ?? 'null')).toEqual(JSON.parse(SCHEMA_EJSON));

      const result = await call('coll.validator.check', { ...ns, ids: allIds() });
      expect(result.hasValidator).toBe(true);
      const invalid = JSON.parse(result.invalid) as unknown[];
      expect(invalid).toHaveLength(3);
      expect(invalid).toEqual(
        expect.arrayContaining([
          { $oid: missingAge.toHexString() },
          { $oid: wrongType.toHexString() },
          { $numberInt: '7' },
        ]),
      );
    });

    it('only the given ids are checked; unknown ids are not listed', async () => {
      const ids = JSON.stringify([
        { $oid: good.toHexString() },
        { $oid: new ObjectId().toHexString() },
      ]);
      expect(await call('coll.validator.check', { ...ns, ids })).toEqual({
        invalid: '[]',
        hasValidator: true,
      });
      const one = JSON.stringify([{ $oid: wrongType.toHexString() }]);
      expect(JSON.parse((await call('coll.validator.check', { ...ns, ids: one })).invalid)).toEqual(
        [{ $oid: wrongType.toHexString() }],
      );
    });

    it('checks against a draft validator without saving it', async () => {
      const draft = JSON.stringify({ $jsonSchema: { required: ['age'] } });
      const result = await call('coll.validator.check', { ...ns, ids: allIds(), validator: draft });
      expect(JSON.parse(result.invalid)).toEqual(
        expect.arrayContaining([{ $oid: missingAge.toHexString() }, { $numberInt: '7' }]),
      );
      expect(JSON.parse(result.invalid)).toHaveLength(2);
      // The stored validator is unchanged.
      expect(JSON.parse((await call('coll.validator.get', ns)).validator ?? 'null')).toEqual(
        JSON.parse(SCHEMA_EJSON),
      );
    });

    it('a query-operator validator works the same way', async () => {
      const draft = JSON.stringify({ name: { $type: 'string' } });
      const result = await call('coll.validator.check', { ...ns, ids: allIds(), validator: draft });
      expect(JSON.parse(result.invalid)).toEqual([{ $numberInt: '7' }]);
    });

    it('the server enforces the saved validator; null removes it', async () => {
      await call('coll.validator.set', {
        ...ns,
        validator: SCHEMA_EJSON,
        validationLevel: 'strict',
        validationAction: 'error',
      });
      await expect(direct.db(DB).collection(COLL).insertOne({ name: 'NoAge' })).rejects.toThrow(
        /validation/i,
      );
      await call('coll.validator.set', {
        ...ns,
        validator: null,
        validationLevel: 'strict',
        validationAction: 'error',
      });
      expect((await call('coll.validator.get', ns)).validator).toBeNull();
      expect((await call('coll.validator.check', { ...ns, ids: allIds() })).hasValidator).toBe(
        false,
      );
    });

    it('errors: a missing collection is NOT_FOUND, a bad schema is SERVER_ERROR, read-only is refused', async () => {
      expect((await failure(call('coll.validator.get', { ...ns, coll: 'nope' }))).code).toBe(
        'NOT_FOUND',
      );
      expect(
        (
          await failure(
            call('coll.validator.set', {
              ...ns,
              validator: '{"$jsonSchema":{"bsonType":"nonsense"}}',
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          )
        ).code,
      ).toBe('SERVER_ERROR');
      expect(
        (
          await failure(
            call('coll.validator.set', {
              ...ns,
              profileId: RO.id,
              validator: SCHEMA_EJSON,
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          )
        ).code,
      ).toBe('READ_ONLY');
      expect((await call('coll.validator.get', ns)).validator).toBeNull();
    });
  });
}
