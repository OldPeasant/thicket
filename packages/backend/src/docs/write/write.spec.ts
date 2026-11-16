import type { ParsedParamsOf } from '@thicket/contract';
import { BSON, MongoServerError, type Document, type RunCommandOptions } from 'mongodb';
import { describe, expect, it } from 'vitest';

import type { ClientLike } from '../../connections/manager';
import { RpcError } from '../../server/rpc';
import {
  DEFAULT_PREVIEW_SAMPLE,
  deleteDocument,
  deleteMany,
  insertDocuments,
  previewMany,
  replaceDocument,
  updateDocument,
  updateMany,
} from './write';

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
const commandsOf = (client: { sent: Sent[] }) => client.sent.map((s) => firstKey(s.command));
const commandNamed = (client: { sent: Sent[] }, name: string): Document => {
  const found = client.sent.find((s) => firstKey(s.command) === name);
  if (!found) throw new Error(`no ${name} command was sent`);
  return found.command;
};
const cursorReply = (batch: Document[]): Document => ({
  cursor: { id: 0, ns: 'shop.orders', firstBatch: batch },
  ok: 1,
});
const countReply = (n: number): Document => cursorReply(n === 0 ? [] : [{ _id: 1, n }]);
const parse = (text: string) => BSON.EJSON.parse(text, { relaxed: false }) as Document;

const target = { profileId: 'p1', db: 'shop', coll: 'orders' };
const ID = '{"$oid":"64b7f0a1e4b0c1a2b3c4d5e6"}';
const oid = new BSON.ObjectId('64b7f0a1e4b0c1a2b3c4d5e6');

/** Answers write commands with `write`, finds with `found` and counts with `matching`. */
function server(
  options: { write?: Document; found?: Document[]; matching?: number } = {},
): ClientLike & { sent: Sent[] } {
  return fakeClient((_db, command) => {
    if ('insert' in command || 'update' in command || 'delete' in command)
      return options.write ?? { n: 1, nModified: 1, ok: 1 };
    if ('find' in command) return cursorReply(options.found ?? []);
    if ('aggregate' in command) return countReply(options.matching ?? 0);
    return { ok: 1 };
  });
}

const duplicateKey = (index: number) => ({
  index,
  code: 11000,
  codeName: 'DuplicateKey',
  errmsg: `E11000 duplicate key error collection: shop.orders index: _id_ (${index})`,
});
const writeConcernError = {
  code: 64,
  codeName: 'WriteConcernFailed',
  errmsg: 'waiting for replication timed out',
};

describe('insertDocuments', () => {
  const insert = (
    extra: Partial<ParsedParamsOf<'docs.insert'>> = {},
  ): ParsedParamsOf<'docs.insert'> => ({ ...target, docs: ['{"a":1}'], ...extra });

  it('generates an ObjectId _id as the first field when missing and returns every id', async () => {
    const client = server({ write: { n: 2, ok: 1 } });
    const result = await insertDocuments(
      client,
      insert({ docs: ['{"name":"Ada","n":{"$numberLong":"7"}}', '{"_id":{"$numberInt":"42"}}'] }),
    );
    expect(commandsOf(client)).toEqual(['insert']);
    const { db, command } = client.sent[0] as Sent;
    expect(db).toBe('shop');
    expect(command).toMatchObject({ insert: 'orders', ordered: true });
    expect(command['comment']).toMatch(/^thicket:/);
    const [generated, given] = command['documents'] as Document[];
    expect(Object.keys(generated ?? {})).toEqual(['_id', 'name', 'n']);
    expect(generated?.['_id']).toBeInstanceOf(BSON.ObjectId);
    // EJSON is parsed canonically: a Long stays a Long.
    expect(generated?.['n']).toBeInstanceOf(BSON.Long);
    expect(given).toEqual({ _id: new BSON.Int32(42) });
    expect(result.insertedIds).toEqual([
      BSON.EJSON.stringify(generated?.['_id'], { relaxed: false }),
      '{"$numberInt":"42"}',
    ]);
    expect(parse(result.insertedIds[0] as string)).toBeInstanceOf(BSON.ObjectId);
  });

  it('generates distinct ids for several documents without _id', async () => {
    const client = server({ write: { n: 2, ok: 1 } });
    const { insertedIds } = await insertDocuments(client, insert({ docs: ['{}', '{}'] }));
    expect(new Set(insertedIds).size).toBe(2);
  });

  it('passes ordered: false through', async () => {
    const client = server();
    await insertDocuments(client, insert({ ordered: false }));
    expect(commandNamed(client, 'insert')['ordered']).toBe(false);
  });

  it('a write error fails with SERVER_ERROR, its code and how many documents were inserted', async () => {
    const client = server({
      write: { n: new BSON.Int32(1), writeErrors: [duplicateKey(1), duplicateKey(2)], ok: 1 },
    });
    const error = await rejection(
      insertDocuments(client, insert({ docs: ['{"_id":1}', '{"_id":2}', '{"_id":3}'] })),
    );
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toBe(
      '1 of 3 documents inserted; insert failed: ' +
        'E11000 duplicate key error collection: shop.orders index: _id_ (1) (and 1 more write errors)',
    );
    expect(error.detail).toEqual({ serverCode: 11000, codeName: 'DuplicateKey' });
  });

  it('a single failing document says "0 of 1 document inserted"', async () => {
    const client = server({ write: { n: 0, writeErrors: [duplicateKey(0)], ok: 1 } });
    const error = await rejection(insertDocuments(client, insert()));
    expect(error.message).toMatch(/^0 of 1 document inserted; insert failed: E11000/);
    expect(error.message).not.toMatch(/more write errors/);
  });

  it('a write error without code, codeName or errmsg still fails with SERVER_ERROR', async () => {
    const client = server({ write: { n: 0, writeErrors: [{ index: 0 }], ok: 1 } });
    const error = await rejection(insertDocuments(client, insert()));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toBe('0 of 1 document inserted; insert failed: write error');
    expect(error.detail).toEqual({});
  });

  it('a write concern error fails with SERVER_ERROR and its code', async () => {
    const client = server({ write: { n: 1, writeConcernError, ok: 1 } });
    const error = await rejection(insertDocuments(client, insert()));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toBe(
      'insert: the write was applied but not acknowledged by the requested write concern: waiting for replication timed out',
    );
    expect(error.detail).toEqual({ serverCode: 64, codeName: 'WriteConcernFailed' });
  });

  it('a write concern error without details still fails with SERVER_ERROR', async () => {
    const client = server({ write: { n: 1, writeConcernError: {}, ok: 1 } });
    const error = await rejection(insertDocuments(client, insert()));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toBe(
      'insert: the write was applied but not acknowledged by the requested write concern: unknown',
    );
    expect(error.detail).toEqual({});
  });

  it('refuses a document that is not an EJSON document with INVALID_PARAMS, sending nothing', async () => {
    const client = server();
    const error = await rejection(insertDocuments(client, insert({ docs: ['{"a":1}', '[1]'] })));
    expect(error.code).toBe('INVALID_PARAMS');
    expect(error.message).toMatch(/docs\[1\]/);
    expect(client.sent).toEqual([]);
  });

  it('a command the server rejects fails with SERVER_ERROR', async () => {
    const client = fakeClient(() => {
      throw new MongoServerError({
        ok: 0,
        code: 2,
        codeName: 'BadValue',
        errmsg: 'bad value',
      });
    });
    const error = await rejection(insertDocuments(client, insert()));
    expect(error.code).toBe('SERVER_ERROR');
  });

  it('an aborted signal answers CANCELLED without sending the insert', async () => {
    const client = server();
    const controller = new AbortController();
    controller.abort();
    const error = await rejection(insertDocuments(client, insert(), controller.signal));
    expect(error.code).toBe('CANCELLED');
    expect(client.sent).toEqual([]);
  });
});

describe('updateDocument', () => {
  const update = (
    extra: Partial<ParsedParamsOf<'docs.update'>> = {},
  ): ParsedParamsOf<'docs.update'> => ({
    ...target,
    id: ID,
    update: '{"$set":{"name":"b"}}',
    expected: '{"name":"a"}',
    ...extra,
  });

  it('matches _id and the expected values and applies the operator update', async () => {
    const client = server({ write: { n: 1, nModified: 1, ok: 1 } });
    await expect(updateDocument(client, update())).resolves.toEqual({ modified: true });
    expect(commandsOf(client)).toEqual(['update']);
    const command = commandNamed(client, 'update');
    expect(command).toMatchObject({ update: 'orders', ordered: true });
    expect(command['updates']).toEqual([
      {
        q: { $and: [{ _id: { $eq: oid } }, { name: 'a' }] },
        u: { $set: { name: 'b' } },
        multi: false,
        upsert: false,
      },
    ]);
  });

  it('matched but unchanged answers modified: false (no conflict)', async () => {
    const client = server({ write: { n: new BSON.Int32(1), nModified: 0, ok: 1 } });
    await expect(updateDocument(client, update())).resolves.toEqual({ modified: false });
    expect(commandsOf(client)).toEqual(['update']);
  });

  it('empty expected values match by _id alone', async () => {
    const client = server();
    await updateDocument(client, update({ expected: '{}' }));
    expect((commandNamed(client, 'update')['updates'] as Document[])[0]?.['q']).toEqual({
      _id: { $eq: oid },
    });
  });

  it('an operator-like id is matched literally, not as a query', async () => {
    const client = server();
    await updateDocument(client, update({ id: '{"$ne":null}', expected: '{}' }));
    expect((commandNamed(client, 'update')['updates'] as Document[])[0]?.['q']).toEqual({
      _id: { $eq: { $ne: null } },
    });
  });

  it('matched nothing → CONFLICT with the current server document', async () => {
    const client = server({
      write: { n: 0, nModified: 0, ok: 1 },
      found: [{ _id: oid, name: 'someone else', n: new BSON.Int32(3) }],
    });
    const error = await rejection(updateDocument(client, update()));
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('The document was changed on the server meanwhile');
    expect(error.detail).toEqual({
      current:
        '{"_id":{"$oid":"64b7f0a1e4b0c1a2b3c4d5e6"},"name":"someone else","n":{"$numberInt":"3"}}',
    });
    expect(commandsOf(client)).toEqual(['update', 'find']);
    const find = commandNamed(client, 'find');
    expect(find).toMatchObject({
      find: 'orders',
      filter: { _id: { $eq: oid } },
      limit: 1,
      singleBatch: true,
    });
  });

  it('matched nothing and the document is gone → CONFLICT with current null', async () => {
    const client = server({ write: { n: 0, nModified: 0, ok: 1 }, found: [] });
    const error = await rejection(updateDocument(client, update()));
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('The document was deleted on the server meanwhile');
    expect(error.detail).toEqual({ current: null });
  });

  it.each([
    ['a plain field', '{"name":"replaced"}', /found name$/],
    ['operators mixed with plain fields', '{"$set":{"a":1},"b":2,"c":3}', /found b, c$/],
  ])('refuses an update with %s (INVALID_PARAMS), sending nothing', async (_what, text, msg) => {
    const client = server();
    const error = await rejection(updateDocument(client, update({ update: text })));
    expect(error.code).toBe('INVALID_PARAMS');
    expect(error.message).toMatch(/^update must contain only update operators/);
    expect(error.message).toMatch(msg);
    expect(client.sent).toEqual([]);
  });

  it('refuses an empty update and an update pipeline (INVALID_PARAMS), sending nothing', async () => {
    const client = server();
    const empty = await rejection(updateDocument(client, update({ update: '{}' })));
    expect(empty).toMatchObject({ code: 'INVALID_PARAMS', message: 'update must not be empty' });
    const pipeline = await rejection(
      updateDocument(client, update({ update: '[{"$set":{"a":1}}]' })),
    );
    expect(pipeline.code).toBe('INVALID_PARAMS');
    expect(client.sent).toEqual([]);
  });

  it('refuses invalid id and expected EJSON (INVALID_PARAMS), sending nothing', async () => {
    const client = server();
    await expect(updateDocument(client, update({ id: '{"$oid":' }))).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    });
    await expect(updateDocument(client, update({ expected: '[1]' }))).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    });
    expect(client.sent).toEqual([]);
  });

  it('a write error → SERVER_ERROR without a conflict lookup', async () => {
    const client = server({
      write: {
        n: 0,
        nModified: 0,
        writeErrors: [
          { index: 0, code: 66, codeName: 'ImmutableField', errmsg: "field '_id' was altered" },
        ],
        ok: 1,
      },
    });
    const error = await rejection(updateDocument(client, update()));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toBe("update failed: field '_id' was altered");
    expect(error.detail).toEqual({ serverCode: 66, codeName: 'ImmutableField' });
    expect(commandsOf(client)).toEqual(['update']);
  });

  it('a write concern error → SERVER_ERROR', async () => {
    const client = server({ write: { n: 1, nModified: 1, writeConcernError, ok: 1 } });
    const error = await rejection(updateDocument(client, update()));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toBe(
      'update: the write was applied but not acknowledged by the requested write concern: waiting for replication timed out',
    );
    expect(error.detail).toEqual({ serverCode: 64, codeName: 'WriteConcernFailed' });
  });
});

describe('replaceDocument', () => {
  const replace = (
    extra: Partial<ParsedParamsOf<'docs.replace'>> = {},
  ): ParsedParamsOf<'docs.replace'> => ({
    ...target,
    id: '1',
    doc: '{"_id":1,"b":3}',
    ...extra,
  });

  it('without expected values replaces by _id', async () => {
    const client = server({ write: { n: 1, nModified: 1, ok: 1 } });
    await expect(replaceDocument(client, replace())).resolves.toEqual({ modified: true });
    expect(commandNamed(client, 'update')['updates']).toEqual([
      {
        q: { _id: { $eq: new BSON.Int32(1) } },
        u: { _id: new BSON.Int32(1), b: new BSON.Int32(3) },
        multi: false,
        upsert: false,
      },
    ]);
  });

  it('with expected values ANDs them to the _id filter', async () => {
    const client = server({ write: { n: 1, nModified: 0, ok: 1 } });
    await expect(replaceDocument(client, replace({ expected: '{"b":2}' }))).resolves.toEqual({
      modified: false,
    });
    expect((commandNamed(client, 'update')['updates'] as Document[])[0]?.['q']).toEqual({
      $and: [{ _id: { $eq: new BSON.Int32(1) } }, { b: new BSON.Int32(2) }],
    });
  });

  it('matched nothing → CONFLICT with the current server document', async () => {
    const client = server({
      write: { n: 0, nModified: 0, ok: 1 },
      found: [{ _id: new BSON.Int32(1), b: new BSON.Int32(9) }],
    });
    const error = await rejection(replaceDocument(client, replace({ expected: '{"b":2}' })));
    expect(error.code).toBe('CONFLICT');
    expect(error.detail).toEqual({ current: '{"_id":{"$numberInt":"1"},"b":{"$numberInt":"9"}}' });
  });

  it('matched nothing without expected (document gone) → CONFLICT with current null', async () => {
    const client = server({ write: { n: 0, nModified: 0, ok: 1 }, found: [] });
    const error = await rejection(replaceDocument(client, replace()));
    expect(error.code).toBe('CONFLICT');
    expect(error.detail).toEqual({ current: null });
  });

  it('refuses $-prefixed top-level fields in the replacement (INVALID_PARAMS), sending nothing', async () => {
    const client = server();
    const error = await rejection(
      replaceDocument(client, replace({ doc: '{"$set":{"a":1},"b":1,"$inc":{"n":1}}' })),
    );
    expect(error.code).toBe('INVALID_PARAMS');
    expect(error.message).toBe('replacement field names must not start with $: $set, $inc');
    expect(client.sent).toEqual([]);
  });

  it('a write error → SERVER_ERROR', async () => {
    const client = server({
      write: {
        n: 0,
        writeErrors: [{ index: 0, code: 66, codeName: 'ImmutableField', errmsg: 'immutable' }],
        ok: 1,
      },
    });
    await expect(replaceDocument(client, replace())).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      detail: { serverCode: 66, codeName: 'ImmutableField' },
    });
    expect(commandsOf(client)).toEqual(['update']);
  });
});

describe('deleteDocument', () => {
  const del = (
    extra: Partial<ParsedParamsOf<'docs.delete'>> = {},
  ): ParsedParamsOf<'docs.delete'> => ({ ...target, id: ID, ...extra });

  it('deletes one document by _id', async () => {
    const client = server({ write: { n: 1, ok: 1 } });
    await expect(deleteDocument(client, del())).resolves.toEqual({ deleted: true });
    expect(commandsOf(client)).toEqual(['delete']);
    const command = commandNamed(client, 'delete');
    expect(command).toMatchObject({ delete: 'orders', ordered: true });
    expect(command['deletes']).toEqual([{ q: { _id: { $eq: oid } }, limit: 1 }]);
  });

  it('with expected values ANDs them to the _id filter', async () => {
    const client = server({ write: { n: 1, ok: 1 } });
    await deleteDocument(client, del({ expected: '{"v":"b"}' }));
    expect((commandNamed(client, 'delete')['deletes'] as Document[])[0]?.['q']).toEqual({
      $and: [{ _id: { $eq: oid } }, { v: 'b' }],
    });
  });

  it('nothing deleted without expected values → deleted: false, no lookup', async () => {
    const client = server({ write: { n: 0, ok: 1 } });
    await expect(deleteDocument(client, del())).resolves.toEqual({ deleted: false });
    expect(commandsOf(client)).toEqual(['delete']);
  });

  it('nothing deleted with empty expected values → deleted: false, no lookup', async () => {
    const client = server({ write: { n: 0, ok: 1 } });
    await expect(deleteDocument(client, del({ expected: '{}' }))).resolves.toEqual({
      deleted: false,
    });
    expect(commandsOf(client)).toEqual(['delete']);
  });

  it('nothing deleted, expected given, document already gone → deleted: false', async () => {
    const client = server({ write: { n: 0, ok: 1 }, found: [] });
    await expect(deleteDocument(client, del({ expected: '{"v":"a"}' }))).resolves.toEqual({
      deleted: false,
    });
    expect(commandsOf(client)).toEqual(['delete', 'find']);
  });

  it('nothing deleted, document exists with other values → CONFLICT with it', async () => {
    const client = server({ write: { n: 0, ok: 1 }, found: [{ _id: oid, v: 'changed' }] });
    const error = await rejection(deleteDocument(client, del({ expected: '{"v":"b"}' })));
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('The document was changed on the server meanwhile');
    expect(error.detail).toEqual({
      current: '{"_id":{"$oid":"64b7f0a1e4b0c1a2b3c4d5e6"},"v":"changed"}',
    });
  });

  it('a write error → SERVER_ERROR', async () => {
    const client = server({
      write: { n: 0, writeErrors: [{ index: 0, code: 13, errmsg: 'not authorized' }], ok: 1 },
    });
    const error = await rejection(deleteDocument(client, del({ expected: '{"v":"b"}' })));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toBe('delete failed: not authorized');
    expect(error.detail).toEqual({ serverCode: 13 });
    expect(commandsOf(client)).toEqual(['delete']);
  });

  it('a write concern error → SERVER_ERROR', async () => {
    const client = server({ write: { n: 1, writeConcernError, ok: 1 } });
    await expect(deleteDocument(client, del())).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      message:
        'delete: the write was applied but not acknowledged by the requested write concern: waiting for replication timed out',
    });
  });

  it('refuses invalid expected values (INVALID_PARAMS), sending nothing', async () => {
    const client = server();
    await expect(deleteDocument(client, del({ expected: '"x"' }))).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    });
    expect(client.sent).toEqual([]);
  });
});

describe('previewMany', () => {
  const preview = (
    extra: Partial<ParsedParamsOf<'docs.previewMany'>> = {},
  ): ParsedParamsOf<'docs.previewMany'> => ({ ...target, filter: '{"group":1}', ...extra });

  it('counts the matches and reads a sample of the default size', async () => {
    const client = server({
      matching: 84,
      found: [{ _id: new BSON.Int32(1), group: new BSON.Int32(1) }],
    });
    const result = await previewMany(client, preview());
    expect(result).toEqual({
      matched: 84,
      sample: ['{"_id":{"$numberInt":"1"},"group":{"$numberInt":"1"}}'],
    });
    expect(commandsOf(client)).toEqual(['aggregate', 'find']);
    expect((commandNamed(client, 'aggregate')['pipeline'] as Document[])[0]).toEqual({
      $match: { group: new BSON.Int32(1) },
    });
    expect(commandNamed(client, 'find')).toMatchObject({
      find: 'orders',
      filter: { group: new BSON.Int32(1) },
      limit: DEFAULT_PREVIEW_SAMPLE,
      batchSize: DEFAULT_PREVIEW_SAMPLE,
      singleBatch: true,
    });
    expect(DEFAULT_PREVIEW_SAMPLE).toBe(20);
  });

  it('uses sampleSize, collation and maxTimeMS for the count and the sample', async () => {
    const client = server({ matching: 3, found: [{ _id: 1 }] });
    await previewMany(
      client,
      preview({ sampleSize: 5, collation: '{"locale":"en","strength":2}', maxTimeMS: 500 }),
    );
    const aggregate = commandNamed(client, 'aggregate');
    expect(aggregate).toMatchObject({
      collation: { locale: 'en', strength: 2 },
      maxTimeMS: 500,
    });
    expect(commandNamed(client, 'find')).toMatchObject({
      limit: 5,
      batchSize: 5,
      collation: { locale: 'en', strength: 2 },
      maxTimeMS: 500,
    });
  });

  it('without matches answers an empty sample without reading one', async () => {
    const client = server({ matching: 0 });
    await expect(previewMany(client, preview())).resolves.toEqual({ matched: 0, sample: [] });
    expect(commandsOf(client)).toEqual(['aggregate']);
  });

  it('refuses an invalid filter or collation (INVALID_PARAMS), sending nothing', async () => {
    const client = server();
    await expect(previewMany(client, preview({ filter: '{' }))).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    });
    await expect(previewMany(client, preview({ collation: '[1]' }))).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    });
    expect(client.sent).toEqual([]);
  });
});

describe('updateMany', () => {
  const many = (
    extra: Partial<ParsedParamsOf<'docs.updateMany'>> = {},
  ): ParsedParamsOf<'docs.updateMany'> => ({
    ...target,
    confirmed: true,
    filter: '{"group":1}',
    update: '{"$set":{"flag":true}}',
    ...extra,
  });

  it('sends one multi-update and answers the matched and modified counts', async () => {
    const client = server({ write: { n: new BSON.Int32(84), nModified: 80, ok: 1 } });
    await expect(updateMany(client, many())).resolves.toEqual({ matched: 84, modified: 80 });
    expect(commandsOf(client)).toEqual(['update']);
    const command = commandNamed(client, 'update');
    expect(command).toMatchObject({ update: 'orders', ordered: true });
    expect(command['updates']).toEqual([
      {
        q: { group: new BSON.Int32(1) },
        u: { $set: { flag: true } },
        multi: true,
        upsert: false,
      },
    ]);
  });

  it('accepts an update pipeline and a collation', async () => {
    const client = server({ write: { n: 2, nModified: 2, ok: 1 } });
    await updateMany(
      client,
      many({
        update: '[{"$set":{"upper":{"$toUpper":"$name"}}}]',
        collation: '{"locale":"en","strength":2}',
      }),
    );
    const [statement] = commandNamed(client, 'update')['updates'] as Document[];
    expect(statement?.['u']).toEqual([{ $set: { upper: { $toUpper: '$name' } } }]);
    // Collation is parsed relaxed: plain numbers, as the server expects.
    expect(statement?.['collation']).toEqual({ locale: 'en', strength: 2 });
  });

  it.each([
    ['an empty pipeline', '[]', 'update pipeline must not be empty'],
    ['a pipeline stage that is a string', '[{"$set":{"a":1}},"x"]', /every stage/],
    // Canonical EJSON parses 1 to a BSON Int32 object: still not a document.
    ['a pipeline stage that is a number', '[{"$set":{"a":1}},1]', /every stage/],
    [
      'a pipeline stage that is an ObjectId',
      '[{"$oid":"64b7f0a1e4b0c1a2b3c4d5e6"}]',
      /every stage/,
    ],
    ['a pipeline stage that is an array', '[[]]', /every stage/],
    ['a pipeline stage that is null', '[null]', /every stage/],
    ['a non-operator update', '{"flag":true}', /only update operators/],
    ['an empty update document', '{}', 'update must not be empty'],
  ])('refuses %s (INVALID_PARAMS), sending nothing', async (_what, update, message) => {
    const client = server();
    const error = await rejection(updateMany(client, many({ update, expectedCount: 3 })));
    expect(error.code).toBe('INVALID_PARAMS');
    expect(error.message).toMatch(message);
    expect(client.sent).toEqual([]);
  });

  it('without expectedCount does not count first', async () => {
    const client = server();
    await updateMany(client, many());
    expect(commandsOf(client)).toEqual(['update']);
  });

  it.each([
    ['equal to', 5],
    ['fewer than', 3],
  ])('runs when the matches now are %s the confirmed count', async (_what, now) => {
    const client = server({ matching: now, write: { n: now, nModified: now, ok: 1 } });
    await expect(updateMany(client, many({ expectedCount: 5 }))).resolves.toEqual({
      matched: now,
      modified: now,
    });
    expect(commandsOf(client)).toEqual(['aggregate', 'update']);
  });

  it('more matches now than confirmed → CONFLICT, nothing written', async () => {
    const client = server({ matching: 6 });
    const error = await rejection(
      updateMany(client, many({ expectedCount: 5, collation: '{"locale":"en"}' })),
    );
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('6 documents match now, but the preview showed 5; preview again');
    expect(commandsOf(client)).toEqual(['aggregate']);
    // The count uses the same filter and collation as the write.
    const aggregate = commandNamed(client, 'aggregate');
    expect((aggregate['pipeline'] as Document[])[0]).toEqual({
      $match: { group: new BSON.Int32(1) },
    });
    expect(aggregate['collation']).toEqual({ locale: 'en' });
  });

  it('expectedCount 0 refuses as soon as anything matches', async () => {
    const client = server({ matching: 1 });
    await expect(updateMany(client, many({ expectedCount: 0 }))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(commandsOf(client)).toEqual(['aggregate']);
  });

  it('a write error → SERVER_ERROR saying how many were modified', async () => {
    const client = server({
      write: {
        n: 10,
        nModified: 4,
        writeErrors: [{ index: 0, code: 14, codeName: 'TypeMismatch', errmsg: 'bad type' }],
        ok: 1,
      },
    });
    const error = await rejection(updateMany(client, many()));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toBe('4 documents modified; updateMany failed: bad type');
    expect(error.detail).toEqual({ serverCode: 14, codeName: 'TypeMismatch' });
  });

  it('a write concern error → SERVER_ERROR', async () => {
    const client = server({ write: { n: 2, nModified: 2, writeConcernError, ok: 1 } });
    await expect(updateMany(client, many())).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      message:
        'updateMany: the write was applied but not acknowledged by the requested write concern: waiting for replication timed out',
    });
  });
});

describe('deleteMany', () => {
  const many = (
    extra: Partial<ParsedParamsOf<'docs.deleteMany'>> = {},
  ): ParsedParamsOf<'docs.deleteMany'> => ({
    ...target,
    confirmed: true,
    filter: '{"group":{"$in":[0,2]}}',
    ...extra,
  });

  it('sends one unlimited delete and answers the deleted count', async () => {
    const client = server({ write: { n: BSON.Long.fromNumber(167), ok: 1 } });
    await expect(deleteMany(client, many())).resolves.toEqual({ deleted: 167 });
    expect(commandsOf(client)).toEqual(['delete']);
    const command = commandNamed(client, 'delete');
    expect(command).toMatchObject({ delete: 'orders', ordered: true });
    expect(command['deletes']).toEqual([
      { q: { group: { $in: [new BSON.Int32(0), new BSON.Int32(2)] } }, limit: 0 },
    ]);
  });

  it('passes the collation to the delete statement', async () => {
    const client = server({ write: { n: 1, ok: 1 } });
    await deleteMany(client, many({ collation: '{"locale":"en","strength":2}' }));
    expect((commandNamed(client, 'delete')['deletes'] as Document[])[0]?.['collation']).toEqual({
      locale: 'en',
      strength: 2,
    });
  });

  it('more matches now than confirmed → CONFLICT, nothing deleted', async () => {
    const client = server({ matching: 168 });
    const error = await rejection(deleteMany(client, many({ expectedCount: 167 })));
    expect(error.code).toBe('CONFLICT');
    expect(commandsOf(client)).toEqual(['aggregate']);
  });

  it('the confirmed count still matching → deletes', async () => {
    const client = server({ matching: 167, write: { n: 167, ok: 1 } });
    await expect(deleteMany(client, many({ expectedCount: 167 }))).resolves.toEqual({
      deleted: 167,
    });
    expect(commandsOf(client)).toEqual(['aggregate', 'delete']);
  });

  it('refuses an invalid filter (INVALID_PARAMS), sending nothing', async () => {
    const client = server();
    await expect(
      deleteMany(client, many({ filter: '[1]', expectedCount: 1 })),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(client.sent).toEqual([]);
  });

  it('a write error → SERVER_ERROR saying how many were deleted', async () => {
    const client = server({
      write: { n: 2, writeErrors: [{ index: 0, code: 50, errmsg: 'time limit exceeded' }], ok: 1 },
    });
    await expect(deleteMany(client, many())).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      message: '2 documents deleted; deleteMany failed: time limit exceeded',
      detail: { serverCode: 50 },
    });
  });

  it('a write concern error → SERVER_ERROR', async () => {
    const client = server({ write: { n: 2, writeConcernError, ok: 1 } });
    await expect(deleteMany(client, many())).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      detail: { serverCode: 64, codeName: 'WriteConcernFailed' },
    });
  });

  it('a negative or missing n counts as 0', async () => {
    await expect(deleteMany(server({ write: { n: -3, ok: 1 } }), many())).resolves.toEqual({
      deleted: 0,
    });
    await expect(deleteMany(server({ write: { ok: 1 } }), many())).resolves.toEqual({
      deleted: 0,
    });
  });
});
