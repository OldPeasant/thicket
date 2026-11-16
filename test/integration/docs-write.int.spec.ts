import { randomBytes } from 'node:crypto';

import { BSON, MongoClient, type Document } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import {
  ConnectionManager,
  RpcClient,
  RpcError,
  docsWriteHandlers,
  guardWrites,
  serve,
} from '@thicket/backend';
import {
  methods,
  type ConflictDetail,
  type ErrorInfo,
  type MethodName,
  type ParamsOf,
  type Profile,
  type ResultOf,
} from '@thicket/contract';
import { diffDocuments, parseEJsonDocument, stringifyEJson } from '@thicket/core';

import { portPair } from '../../packages/backend/src/server/testing';

// docs.insert / update / replace / delete / previewMany / updateMany / deleteMany (task
// docs-write-backend) against the 8.x replica set fixture, served like startBackend serves them:
// contract validation and every write handler wrapped by the write guard.

const rs = inject('mongo').mongo8rs;
const run = randomBytes(3).toString('hex');
const DB = `docsw_${run}`;

const base = { connectionString: rs.uri, serverSelectionTimeoutMS: 10_000 };
const PROFILES: Record<string, Profile> = {
  plain: { id: 'plain', name: 'Plain', readOnly: false, production: false, ...base },
  readonly: { id: 'readonly', name: 'Read-only', readOnly: true, production: false, ...base },
  prod: { id: 'prod', name: 'Production', readOnly: false, production: true, ...base },
};

function profileOf(id: string): Profile {
  const profile = PROFILES[id];
  if (!profile) throw new RpcError('NOT_FOUND', `No profile ${id}`);
  return profile;
}

function backendFor() {
  const manager = new ConnectionManager({
    loadProfile: (id) => Promise.resolve(profileOf(id)),
    loadSecrets: () => Promise.resolve(null),
  });
  const [serverPort, clientPort] = portPair();
  const stop = serve(serverPort, {
    table: methods,
    route: 'backend',
    handlers: guardWrites(docsWriteHandlers(manager), profileOf),
  });
  const client = new RpcClient(clientPort);
  const call = <M extends MethodName>(method: M, params: ParamsOf<M>) =>
    client.call(method, params) as Promise<ResultOf<M>>;
  const close = async () => {
    client.close();
    stop();
    await manager.closeAll();
  };
  return { manager, call, close };
}

let backend: ReturnType<typeof backendFor>;
let direct: MongoClient;

const parse = (text: string) => BSON.EJSON.parse(text, { relaxed: false }) as Document;
const coll = (name: string) => direct.db(DB).collection<Document>(name);
const read = { promoteValues: false, promoteLongs: false } as const;

/** The error a call failed with (fails the test when it succeeded). */
async function failure(promise: Promise<unknown>): Promise<ErrorInfo> {
  try {
    await promise;
  } catch (error) {
    return error as ErrorInfo;
  }
  throw new Error('expected the call to fail');
}

beforeAll(async () => {
  direct = new MongoClient(rs.uri, { serverSelectionTimeoutMS: 10_000 });
  backend = backendFor();
  await backend.manager.open('plain', undefined);
  await backend.manager.open('prod', undefined);
  await backend.manager.open('readonly', undefined);
});

afterAll(async () => {
  await direct.db(DB).dropDatabase();
  await backend.close();
  await direct.close();
});

const target = (c: string) => ({ profileId: 'plain', db: DB, coll: c });

describe('docs.insert', () => {
  it('inserts documents and returns their _ids (generated when missing), keeping BSON types', async () => {
    const result = await backend.call('docs.insert', {
      ...target('insert'),
      docs: [
        '{"name":"no id","n":{"$numberLong":"7"},"i":{"$numberInt":"3"}}',
        '{"_id":{"$numberInt":"42"},"name":"given id"}',
      ],
    });
    expect(result.insertedIds).toHaveLength(2);
    const [generated, given] = result.insertedIds.map(parse);
    expect(generated).toBeInstanceOf(BSON.ObjectId);
    expect(given).toEqual(new BSON.Int32(42));
    const stored = await coll('insert').findOne(
      { _id: generated as unknown as BSON.ObjectId },
      read,
    );
    expect(stored?.['n']).toBeInstanceOf(BSON.Long);
    expect(stored?.['i']).toBeInstanceOf(BSON.Int32);
    expect(Object.keys(stored ?? {})[0]).toBe('_id');
    expect(await coll('insert').countDocuments({ _id: 42 } as Document)).toBe(1);
  });

  it('a duplicate _id fails with SERVER_ERROR (DuplicateKey)', async () => {
    await coll('insertdup').insertOne({ _id: 1 } as Document);
    const error = await failure(
      backend.call('docs.insert', { ...target('insertdup'), docs: ['{"_id":1}'] }),
    );
    expect(error.code).toBe('SERVER_ERROR');
    expect((error.detail as { serverCode?: number }).serverCode).toBe(11000);
  });
});

describe('docs.update with conflict detection', () => {
  const original = '{"_id":{"$numberInt":"1"},"name":"a","tags":["x"],"n":{"$numberInt":"1"}}';
  const edited = '{"_id":{"$numberInt":"1"},"name":"b","tags":["x","y"],"n":{"$numberInt":"1"}}';
  const diff = diffDocuments(parseEJsonDocument(original), parseEJsonDocument(edited));
  if (diff.kind !== 'update') throw new Error('expected an update diff');
  const params = {
    ...target('update'),
    id: '{"$numberInt":"1"}',
    update: stringifyEJson(diff.update),
    expected: stringifyEJson(diff.expected),
  };

  beforeEach(async () => {
    await coll('update').deleteMany({});
    await coll('update').insertOne(parse(original));
  });

  it('applies the diff when the expected values still match', async () => {
    await expect(backend.call('docs.update', params)).resolves.toEqual({ modified: true });
    const stored = await coll('update').findOne({ _id: 1 } as Document);
    expect(stored).toEqual({ _id: 1, name: 'b', tags: ['x', 'y'], n: 1 });
  });

  it('a concurrent change of a changed field → CONFLICT with the current server document', async () => {
    await coll('update').updateOne({ _id: 1 } as Document, { $set: { name: 'someone else' } });
    const error = await failure(backend.call('docs.update', params));
    expect(error.code).toBe('CONFLICT');
    const { current } = error.detail as ConflictDetail;
    expect(current).not.toBeNull();
    expect(parse(current as string)).toEqual(
      parse('{"_id":{"$numberInt":"1"},"name":"someone else","tags":["x"],"n":{"$numberInt":"1"}}'),
    );
    // Nothing was written.
    expect((await coll('update').findOne({ _id: 1 } as Document))?.['name']).toBe('someone else');
  });

  it('a concurrent change of an untouched field does not conflict', async () => {
    await coll('update').updateOne({ _id: 1 } as Document, { $set: { n: 99 } });
    await expect(backend.call('docs.update', params)).resolves.toEqual({ modified: true });
    expect(await coll('update').findOne({ _id: 1 } as Document)).toEqual({
      _id: 1,
      name: 'b',
      tags: ['x', 'y'],
      n: 99,
    });
  });

  it('a concurrently deleted document → CONFLICT with current null', async () => {
    await coll('update').deleteOne({ _id: 1 } as Document);
    const error = await failure(backend.call('docs.update', params));
    expect(error.code).toBe('CONFLICT');
    expect((error.detail as ConflictDetail).current).toBeNull();
  });

  it('an update without operators is refused (INVALID_PARAMS) instead of replacing', async () => {
    const error = await failure(
      backend.call('docs.update', { ...params, update: '{"name":"replaced"}' }),
    );
    expect(error.code).toBe('INVALID_PARAMS');
    expect((await coll('update').findOne({ _id: 1 } as Document))?.['name']).toBe('a');
  });
});

describe('docs.replace', () => {
  beforeEach(async () => {
    await coll('replace').deleteMany({});
    await coll('replace').insertOne({ _id: 1, a: 1, b: 2 } as Document);
  });

  it('replaces the document; a changed expected value → CONFLICT', async () => {
    await expect(
      backend.call('docs.replace', {
        ...target('replace'),
        id: '1',
        doc: '{"_id":1,"b":3,"a":1}',
        expected: '{"b":2}',
      }),
    ).resolves.toEqual({ modified: true });
    expect(await coll('replace').findOne({ _id: 1 } as Document)).toEqual({ _id: 1, b: 3, a: 1 });
    const error = await failure(
      backend.call('docs.replace', {
        ...target('replace'),
        id: '1',
        doc: '{"_id":1,"b":4}',
        expected: '{"b":2}',
      }),
    );
    expect(error.code).toBe('CONFLICT');
    expect(parse((error.detail as ConflictDetail).current as string)).toEqual(
      parse('{"_id":1,"b":3,"a":1}'),
    );
  });
});

describe('docs.delete', () => {
  beforeEach(async () => {
    await coll('delete').deleteMany({});
    await coll('delete').insertMany([
      { _id: 1, v: 'a' } as Document,
      { _id: 2, v: 'b' } as Document,
    ]);
  });

  it('deletes the document by _id', async () => {
    await expect(backend.call('docs.delete', { ...target('delete'), id: '1' })).resolves.toEqual({
      deleted: true,
    });
    expect(await coll('delete').countDocuments({})).toBe(1);
    expect(await coll('delete').findOne({ _id: 1 } as Document)).toBeNull();
  });

  it('an already deleted document answers deleted: false', async () => {
    await coll('delete').deleteOne({ _id: 1 } as Document);
    await expect(
      backend.call('docs.delete', { ...target('delete'), id: '1', expected: '{"v":"a"}' }),
    ).resolves.toEqual({ deleted: false });
  });

  it('a changed expected value → CONFLICT, nothing deleted', async () => {
    await coll('delete').updateOne({ _id: 2 } as Document, { $set: { v: 'changed' } });
    const error = await failure(
      backend.call('docs.delete', { ...target('delete'), id: '2', expected: '{"v":"b"}' }),
    );
    expect(error.code).toBe('CONFLICT');
    expect((error.detail as ConflictDetail).current).toBe(
      '{"_id":{"$numberInt":"2"},"v":"changed"}',
    );
    expect(await coll('delete').countDocuments({})).toBe(2);
  });
});

describe('updateMany / deleteMany with preview', () => {
  const N = 250;
  beforeEach(async () => {
    await coll('many').deleteMany({});
    await coll('many').insertMany(
      Array.from({ length: N }, (_, i): Document => ({
        _id: i,
        group: i % 3,
        name: i % 2 ? 'Odd' : 'even',
      })),
    );
  });
  const confirmed = { ...target('many'), confirmed: true };

  it('updateMany: the preview count equals the matched and modified count of the execute step', async () => {
    const filter = '{"group":1}';
    const preview = await backend.call('docs.previewMany', {
      ...target('many'),
      filter,
      sampleSize: 5,
    });
    expect(preview.matched).toBe(await coll('many').countDocuments({ group: 1 }));
    expect(preview.sample).toHaveLength(5);
    for (const text of preview.sample) expect(parse(text)['group']).toEqual(new BSON.Int32(1));
    const result = await backend.call('docs.updateMany', {
      ...confirmed,
      filter,
      update: '{"$set":{"flag":true}}',
      expectedCount: preview.matched,
    });
    expect(result).toEqual({ matched: preview.matched, modified: preview.matched });
    expect(await coll('many').countDocuments({ flag: true })).toBe(preview.matched);
  });

  it('updateMany with an update pipeline and a collation', async () => {
    const preview = await backend.call('docs.previewMany', {
      ...target('many'),
      filter: '{"name":"odd"}',
      collation: '{"locale":"en","strength":2}',
    });
    expect(preview.matched).toBe(N / 2);
    expect(preview.sample).toHaveLength(20);
    const result = await backend.call('docs.updateMany', {
      ...confirmed,
      filter: '{"name":"odd"}',
      collation: '{"locale":"en","strength":2}',
      update: '[{"$set":{"upper":{"$toUpper":"$name"}}}]',
    });
    expect(result.matched).toBe(preview.matched);
    expect(await coll('many').countDocuments({ upper: 'ODD' })).toBe(preview.matched);
  });

  it('deleteMany: the preview count equals the deleted count', async () => {
    const filter = '{"group":{"$in":[0,2]}}';
    const preview = await backend.call('docs.previewMany', { ...target('many'), filter });
    expect(preview.matched).toBe(await coll('many').countDocuments({ group: { $in: [0, 2] } }));
    const result = await backend.call('docs.deleteMany', {
      ...confirmed,
      filter,
      expectedCount: preview.matched,
    });
    expect(result).toEqual({ deleted: preview.matched });
    expect(await coll('many').countDocuments({})).toBe(N - preview.matched);
  });

  it('more matches than the confirmed preview count → CONFLICT, nothing written', async () => {
    const preview = await backend.call('docs.previewMany', { ...target('many'), filter: '{}' });
    await coll('many').insertOne({ _id: 'late' } as Document);
    const error = await failure(
      backend.call('docs.deleteMany', {
        ...confirmed,
        filter: '{}',
        expectedCount: preview.matched,
      }),
    );
    expect(error.code).toBe('CONFLICT');
    expect(await coll('many').countDocuments({})).toBe(N + 1);
  });

  it('a preview with no matches has an empty sample', async () => {
    await expect(
      backend.call('docs.previewMany', { ...target('many'), filter: '{"group":7}' }),
    ).resolves.toEqual({ matched: 0, sample: [] });
  });
});

describe('write guard', () => {
  beforeEach(async () => {
    await coll('guard').deleteMany({});
    await coll('guard').insertOne({ _id: 1, v: 1 } as Document);
  });
  const on = (profileId: string) => ({ profileId, db: DB, coll: 'guard' });

  it('a read-only profile refuses every write with READ_ONLY, even when confirmed', async () => {
    const calls: Promise<unknown>[] = [
      backend.call('docs.insert', { ...on('readonly'), docs: ['{"v":2}'] }),
      backend.call('docs.update', {
        ...on('readonly'),
        confirmed: true,
        id: '1',
        update: '{"$set":{"v":2}}',
        expected: '{"v":1}',
      }),
      backend.call('docs.replace', { ...on('readonly'), id: '1', doc: '{"v":2}' }),
      backend.call('docs.delete', { ...on('readonly'), id: '1' }),
      backend.call('docs.updateMany', {
        ...on('readonly'),
        confirmed: true,
        filter: '{}',
        update: '{"$set":{"v":2}}',
      }),
      backend.call('docs.deleteMany', { ...on('readonly'), confirmed: true, filter: '{}' }),
    ];
    for (const call of calls) expect((await failure(call)).code).toBe('READ_ONLY');
    expect(await coll('guard').find({}).toArray()).toEqual([{ _id: 1, v: 1 }]);
  });

  it('a read-only profile can still preview (a read)', async () => {
    await expect(
      backend.call('docs.previewMany', { ...on('readonly'), filter: '{}' }),
    ).resolves.toMatchObject({ matched: 1 });
  });

  it('a production profile refuses unconfirmed writes and accepts confirmed ones', async () => {
    const insert = { ...on('prod'), docs: ['{"_id":2}'] };
    expect((await failure(backend.call('docs.insert', insert))).code).toBe('CONFIRMATION_REQUIRED');
    const del = { ...on('prod'), id: '1' };
    expect((await failure(backend.call('docs.delete', del))).code).toBe('CONFIRMATION_REQUIRED');
    expect(await coll('guard').countDocuments({})).toBe(1);
    await expect(backend.call('docs.insert', { ...insert, confirmed: true })).resolves.toEqual({
      insertedIds: ['{"$numberInt":"2"}'],
    });
    await expect(backend.call('docs.delete', { ...del, confirmed: true })).resolves.toEqual({
      deleted: true,
    });
  });

  it('updateMany / deleteMany need confirmed: true on every profile', async () => {
    const error1 = await failure(
      backend.call('docs.updateMany', { ...on('plain'), filter: '{}', update: '{"$set":{"v":2}}' }),
    );
    const error2 = await failure(backend.call('docs.deleteMany', { ...on('plain'), filter: '{}' }));
    expect([error1.code, error2.code]).toEqual(['CONFIRMATION_REQUIRED', 'CONFIRMATION_REQUIRED']);
    expect(await coll('guard').find({}).toArray()).toEqual([{ _id: 1, v: 1 }]);
  });
});
