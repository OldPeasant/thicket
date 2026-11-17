import { collMethods, MAX_VALIDATOR_CHECK_IDS } from '@thicket/contract';
import { BSON, MongoServerError, type Document, type RunCommandOptions } from 'mongodb';
import { describe, expect, it } from 'vitest';

import type { ClientLike } from '../../connections/manager';
import { RpcError } from '../../server/rpc';
import { checkValidator, getValidator, parseIds, parseValidator, setValidator } from './validator';

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

/** A cursor answer of a command (`firstBatch`) or a getMore (`nextBatch`). */
function cursorAnswer(id: number, batch: Document[], first = true) {
  return {
    cursor: {
      id: BSON.Long.fromNumber(id),
      ns: 'shop.x',
      [first ? 'firstBatch' : 'nextBatch']: batch,
    },
    ok: 1,
  };
}

/** A client whose `listCollections` returns `entries` and whose `find` returns `failing`. */
function collectionClient(entries: Document[], failing: Document[] = []) {
  return fakeClient((_db, command) => {
    if ('listCollections' in command) return cursorAnswer(0, entries);
    if ('find' in command) return cursorAnswer(0, failing);
    return { ok: 1 };
  });
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

const SCHEMA = { $jsonSchema: { bsonType: 'object', required: ['sku'] } };
const SCHEMA_TEXT = BSON.EJSON.stringify(SCHEMA, { relaxed: false });
const getResult = collMethods['coll.validator.get'].result;
const checkResult = collMethods['coll.validator.check'].result;

describe('parseValidator', () => {
  it('returns the document of valid canonical EJSON', () => {
    expect(parseValidator(SCHEMA_TEXT)).toEqual(SCHEMA);
    expect(parseValidator('{}')).toEqual({});
  });

  it('keeps BSON types of canonical EJSON values', () => {
    const parsed = parseValidator('{"qty":{"$gte":{"$numberLong":"5"}}}');
    expect((parsed['qty'] as Document)['$gte']).toBeInstanceOf(BSON.Long);
  });

  it.each([
    ['malformed JSON', '{ "a": ', /not valid EJSON/],
    ['an empty string', '', /not valid EJSON/],
    ['an array', '[{"a":1}]', /must be an EJSON document/],
    ['a string', '"text"', /must be an EJSON document/],
    ['a number', '5', /must be an EJSON document/],
    ['null', 'null', /must be an EJSON document/],
    ['an ObjectId value', '{"$oid":"64b7f0c2a1b2c3d4e5f60718"}', /must be an EJSON document/],
    ['an Int32 value', '{"$numberInt":"3"}', /must be an EJSON document/],
  ])('refuses %s with INVALID_PARAMS', (_name, text, message) => {
    let thrown: unknown;
    try {
      parseValidator(text);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RpcError);
    expect(thrown).toMatchObject({
      code: 'INVALID_PARAMS',
      message: expect.stringMatching(message),
    });
  });
});

describe('parseIds', () => {
  it('returns the _id values with their BSON types', () => {
    const ids = parseIds('[{"$numberInt":"1"},{"$oid":"64b7f0c2a1b2c3d4e5f60718"},"a"]');
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBeInstanceOf(BSON.Int32);
    expect(ids[1]).toBeInstanceOf(BSON.ObjectId);
    expect(ids[2]).toBe('a');
  });

  it('accepts an empty array and exactly MAX_VALIDATOR_CHECK_IDS values', () => {
    expect(parseIds('[]')).toEqual([]);
    const max = JSON.stringify(Array.from({ length: MAX_VALIDATOR_CHECK_IDS }, (_, i) => `id${i}`));
    expect(parseIds(max)).toHaveLength(MAX_VALIDATOR_CHECK_IDS);
  });

  it('refuses one value more than MAX_VALIDATOR_CHECK_IDS', () => {
    const tooMany = JSON.stringify(
      Array.from({ length: MAX_VALIDATOR_CHECK_IDS + 1 }, (_, i) => `id${i}`),
    );
    expect(() => parseIds(tooMany)).toThrow(
      expect.objectContaining({
        code: 'INVALID_PARAMS',
        message: `ids has ${MAX_VALIDATOR_CHECK_IDS + 1} values; at most ${MAX_VALIDATOR_CHECK_IDS} can be checked at once`,
      }),
    );
  });

  it.each([
    ['malformed JSON', '[1,', /ids is not valid EJSON/],
    ['a document', '{"_id":1}', /ids must be an EJSON array/],
    ['a string', '"abc"', /ids must be an EJSON array/],
  ])('refuses %s with INVALID_PARAMS', (_name, text, message) => {
    expect(() => parseIds(text)).toThrow(
      expect.objectContaining({ code: 'INVALID_PARAMS', message: expect.stringMatching(message) }),
    );
  });
});

describe('getValidator', () => {
  it('reads the listCollections entry of the collection only', async () => {
    const client = collectionClient([{ name: 'orders', type: 'collection', options: {} }]);
    await getValidator(client, 'shop', 'orders');
    expect(client.sent.map((s) => [s.db, s.command])).toEqual([
      ['shop', { listCollections: 1, filter: { name: 'orders' }, cursor: {} }],
    ]);
  });

  it('returns the stored validator as canonical EJSON with level and action', async () => {
    const client = collectionClient([
      {
        name: 'orders',
        options: {
          validator: {
            $jsonSchema: {
              bsonType: 'object',
              properties: { qty: { minimum: new BSON.Int32(1) } },
            },
          },
          validationLevel: 'moderate',
          validationAction: 'warn',
        },
      },
    ]);
    const result = await getValidator(client, 'shop', 'orders');
    expect(getResult.parse(result)).toEqual(result);
    expect(result).toEqual({
      validator:
        '{"$jsonSchema":{"bsonType":"object","properties":{"qty":{"minimum":{"$numberInt":"1"}}}}}',
      validationLevel: 'moderate',
      validationAction: 'warn',
    });
  });

  it('accepts errorAndLog and off', async () => {
    const client = collectionClient([
      { name: 'orders', options: { validationLevel: 'off', validationAction: 'errorAndLog' } },
    ]);
    await expect(getValidator(client, 'shop', 'orders')).resolves.toEqual({
      validator: null,
      validationLevel: 'off',
      validationAction: 'errorAndLog',
    });
  });

  it.each([
    ['no options', { name: 'orders' }],
    ['empty options', { name: 'orders', options: {} }],
    [
      'an empty validator (what collMod with {} leaves)',
      { name: 'orders', options: { validator: {} } },
    ],
    [
      'unknown level and action values',
      { name: 'orders', options: { validationLevel: 'sometimes', validationAction: 7 } },
    ],
  ])('defaults to no validator, strict and error for %s', async (_name, entry) => {
    const result = await getValidator(collectionClient([entry]), 'shop', 'orders');
    expect(result).toEqual({
      validator: null,
      validationLevel: 'strict',
      validationAction: 'error',
    });
    expect(getResult.parse(result)).toEqual(result);
  });

  it('answers NOT_FOUND for a collection that does not exist', async () => {
    const error = await rejection(getValidator(collectionClient([]), 'shop', 'missing'));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Collection shop.missing does not exist');
  });

  it('maps a server refusal to SERVER_ERROR', async () => {
    const client = fakeClient(() => {
      throw new MongoServerError({
        ok: 0,
        code: 13,
        codeName: 'Unauthorized',
        errmsg: 'not authorized on shop to execute command',
      });
    });
    const error = await rejection(getValidator(client, 'shop', 'orders'));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toContain('not authorized on shop');
  });
});

describe('setValidator', () => {
  it('sends one collMod with the parsed validator, level and action', async () => {
    const client = collectionClient([]);
    await expect(
      setValidator(client, 'shop', 'orders', SCHEMA_TEXT, 'moderate', 'warn'),
    ).resolves.toEqual({});
    expect(client.sent.map((s) => [s.db, s.command])).toEqual([
      [
        'shop',
        {
          collMod: 'orders',
          validator: SCHEMA,
          validationLevel: 'moderate',
          validationAction: 'warn',
        },
      ],
    ]);
  });

  it('removes the validator with validator: {} for null', async () => {
    const client = collectionClient([]);
    await setValidator(client, 'shop', 'orders', null, 'strict', 'error');
    expect(client.sent.map((s) => s.command)).toEqual([
      { collMod: 'orders', validator: {}, validationLevel: 'strict', validationAction: 'error' },
    ]);
  });

  it('refuses an invalid validator with INVALID_PARAMS before sending anything', async () => {
    const client = collectionClient([]);
    const error = await rejection(setValidator(client, 'shop', 'orders', '[]', 'strict', 'error'));
    expect(error.code).toBe('INVALID_PARAMS');
    expect(client.sent).toEqual([]);
  });

  it('maps a server refusal (e.g. an invalid $jsonSchema) to SERVER_ERROR', async () => {
    const client = fakeClient(() => {
      throw new MongoServerError({
        ok: 0,
        code: 9,
        codeName: 'FailedToParse',
        errmsg: 'Unknown $jsonSchema keyword: bsonTyp',
      });
    });
    const error = await rejection(
      setValidator(
        client,
        'shop',
        'orders',
        '{"$jsonSchema":{"bsonTyp":"object"}}',
        'strict',
        'error',
      ),
    );
    expect(error).toMatchObject({ code: 'SERVER_ERROR', detail: { codeName: 'FailedToParse' } });
  });
});

describe('checkValidator', () => {
  const stored = { name: 'orders', options: { validator: SCHEMA } };

  it("finds the failing _ids with the collection's validator as {_id: {$in}, $nor: [validator]}", async () => {
    const client = collectionClient([stored], [{ _id: new BSON.Int32(2) }]);
    const result = await checkValidator(
      client,
      'shop',
      'orders',
      '[{"$numberInt":"1"},{"$numberInt":"2"}]',
      undefined,
    );
    expect(result).toEqual({ invalid: '[{"$numberInt":"2"}]', hasValidator: true });
    expect(checkResult.parse(result)).toEqual(result);
    expect(client.sent.map((s) => [s.db, s.command])).toEqual([
      ['shop', { listCollections: 1, filter: { name: 'orders' }, cursor: {} }],
      [
        'shop',
        {
          find: 'orders',
          filter: { _id: { $in: [new BSON.Int32(1), new BSON.Int32(2)] }, $nor: [SCHEMA] },
          projection: { _id: 1 },
        },
      ],
    ]);
  });

  it('keeps the BSON types of the failing _ids in canonical EJSON', async () => {
    const oid = new BSON.ObjectId('64b7f0c2a1b2c3d4e5f60718');
    const client = collectionClient(
      [stored],
      [{ _id: oid }, { _id: BSON.Long.fromNumber(7) }, { _id: 'sku-1' }],
    );
    const result = await checkValidator(
      client,
      'shop',
      'orders',
      '[{"$oid":"64b7f0c2a1b2c3d4e5f60718"},{"$numberLong":"7"},"sku-1"]',
      undefined,
    );
    expect(result.invalid).toBe(
      '[{"$oid":"64b7f0c2a1b2c3d4e5f60718"},{"$numberLong":"7"},"sku-1"]',
    );
  });

  it('collects every batch of the failing _ids', async () => {
    const client = fakeClient((_db, command) => {
      if ('listCollections' in command) return cursorAnswer(0, [stored]);
      if ('find' in command) return cursorAnswer(42, [{ _id: 'a' }]);
      if ('getMore' in command) return cursorAnswer(0, [{ _id: 'b' }], false);
      return { ok: 1 };
    });
    const result = await checkValidator(client, 'shop', 'orders', '["a","b","c"]', undefined);
    expect(result.invalid).toBe('["a","b"]');
    expect(client.sent.at(-1)?.command).toEqual({
      getMore: BSON.Long.fromNumber(42),
      collection: 'orders',
    });
  });

  it('checks a draft validator without reading the stored one', async () => {
    const client = collectionClient([stored], [{ _id: 'x' }]);
    const draft = '{"qty":{"$gt":{"$numberInt":"0"}}}';
    const result = await checkValidator(client, 'shop', 'orders', '["x","y"]', draft);
    expect(result).toEqual({ invalid: '["x"]', hasValidator: true });
    expect(client.sent.map((s) => s.command)).toEqual([
      {
        find: 'orders',
        filter: { _id: { $in: ['x', 'y'] }, $nor: [{ qty: { $gt: new BSON.Int32(0) } }] },
        projection: { _id: 1 },
      },
    ]);
  });

  it('answers hasValidator false and sends nothing for an empty draft', async () => {
    const client = collectionClient([stored]);
    await expect(checkValidator(client, 'shop', 'orders', '["x"]', '{}')).resolves.toEqual({
      invalid: '[]',
      hasValidator: false,
    });
    expect(client.sent).toEqual([]);
  });

  it.each([
    ['without a validator', { name: 'orders', options: {} }],
    ['with an empty validator', { name: 'orders', options: { validator: {} } }],
  ])('answers hasValidator false for a collection %s, without a find', async (_name, entry) => {
    const client = collectionClient([entry]);
    await expect(checkValidator(client, 'shop', 'orders', '["x"]', undefined)).resolves.toEqual({
      invalid: '[]',
      hasValidator: false,
    });
    expect(client.sent.map((s) => Object.keys(s.command)[0])).toEqual(['listCollections']);
  });

  it('answers an empty list for no ids, without a find', async () => {
    const client = collectionClient([stored]);
    await expect(checkValidator(client, 'shop', 'orders', '[]', undefined)).resolves.toEqual({
      invalid: '[]',
      hasValidator: true,
    });
    expect(client.sent.some((s) => 'find' in s.command)).toBe(false);
  });

  it('answers NOT_FOUND for a missing collection without a draft', async () => {
    const error = await rejection(
      checkValidator(collectionClient([]), 'shop', 'gone', '["x"]', undefined),
    );
    expect(error.code).toBe('NOT_FOUND');
  });

  it.each([
    ['ids that are not an array', '{"_id":1}', undefined],
    ['malformed ids', '[', undefined],
    ['a draft that is not a document', '["x"]', '[1]'],
    ['a malformed draft', '["x"]', '{'],
  ])('refuses %s with INVALID_PARAMS before sending anything', async (_name, ids, draft) => {
    const client = collectionClient([stored]);
    const error = await rejection(checkValidator(client, 'shop', 'orders', ids, draft));
    expect(error.code).toBe('INVALID_PARAMS');
    expect(client.sent).toEqual([]);
  });

  it('refuses more than MAX_VALIDATOR_CHECK_IDS ids before sending anything', async () => {
    const client = collectionClient([stored]);
    const ids = JSON.stringify(Array.from({ length: MAX_VALIDATOR_CHECK_IDS + 1 }, (_, i) => i));
    const error = await rejection(checkValidator(client, 'shop', 'orders', ids, undefined));
    expect(error.code).toBe('INVALID_PARAMS');
    expect(client.sent).toEqual([]);
  });

  it('maps a server refusal of the find (e.g. an invalid query operator) to SERVER_ERROR', async () => {
    const client = fakeClient((_db, command) => {
      if ('find' in command) {
        throw new MongoServerError({
          ok: 0,
          code: 2,
          codeName: 'BadValue',
          errmsg: 'unknown operator: $foo',
        });
      }
      return cursorAnswer(0, [stored]);
    });
    const error = await rejection(
      checkValidator(client, 'shop', 'orders', '["x"]', '{"a":{"$foo":1}}'),
    );
    expect(error).toMatchObject({ code: 'SERVER_ERROR', detail: { codeName: 'BadValue' } });
  });

  it('stops paging with CANCELLED (and kills the cursor) once the signal is aborted', async () => {
    const controller = new AbortController();
    const client = fakeClient((_db, command) => {
      if ('listCollections' in command) return cursorAnswer(0, [stored]);
      if ('find' in command) {
        controller.abort();
        return cursorAnswer(42, [{ _id: 'a' }]);
      }
      return { ok: 1 };
    });
    const error = await rejection(
      checkValidator(client, 'shop', 'orders', '["a","b"]', undefined, controller.signal),
    );
    expect(error.code).toBe('CANCELLED');
    expect(client.sent.at(-1)?.command).toEqual({
      killCursors: 'orders',
      cursors: [BSON.Long.fromNumber(42)],
    });
  });
});
