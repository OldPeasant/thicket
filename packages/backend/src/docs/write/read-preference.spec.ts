import {
  BSON,
  MongoWriteConcernError,
  ReadPreference,
  WriteConcern,
  type Document,
  type RunCommandOptions,
  type RunCursorCommandOptions,
} from 'mongodb';
import { describe, expect, it } from 'vitest';

import type { ClientLike, CursorLike, DbLike } from '../../connections/manager';
import { RpcError } from '../../server/rpc';
import {
  deleteDocument,
  deleteMany,
  insertDocuments,
  previewMany,
  replaceDocument,
  updateDocument,
  updateMany,
} from './write';

/**
 * Task raw-cmd-read-pref: document writes carry the profile's write concern and run on the
 * primary; the reads that belong to a write (preview, expected-count check, conflict detail) go
 * to the primary whatever the profile's read preference is.
 */

const SECONDARY = new ReadPreference('secondaryPreferred');
const W2 = new WriteConcern(2);

interface Sent {
  db: string;
  command: Document;
  options: RunCommandOptions | undefined;
}

interface Opened {
  command: Document;
  options: RunCursorCommandOptions | undefined;
}

/** A single-batch driver cursor with `docs` (BSON bytes, as with `raw: true`). */
function singleBatch(docs: Document[]): CursorLike {
  let buffered: Uint8Array[] = [];
  let id: BSON.Long | undefined;
  return {
    get id() {
      return id;
    },
    hasNext() {
      buffered = docs.map((d) => BSON.serialize(d));
      id = BSON.Long.ZERO;
      return Promise.resolve(buffered.length > 0);
    },
    readBufferedDocuments() {
      const out = buffered;
      buffered = [];
      return out;
    },
    setComment: () => undefined,
    setBatchSize: () => undefined,
    close: () => Promise.resolve(),
  };
}

/**
 * A profile client (`secondaryPreferred`, `w: 2`) with driver cursors: writes answer `write`
 * (or throw it), finds answer `found`, count aggregations `matching`.
 */
function profileServer(
  options: { write?: Document | Error; found?: Document[]; matching?: number } = {},
): ClientLike & { sent: Sent[]; opened: Opened[] } {
  const sent: Sent[] = [];
  const opened: Opened[] = [];
  return {
    sent,
    opened,
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: (db: string): DbLike => ({
      readPreference: SECONDARY,
      writeConcern: W2,
      command: (command: Document, opts?: RunCommandOptions) => {
        sent.push({ db, command, options: opts });
        const write = options.write ?? { n: 1, nModified: 1, ok: 1 };
        if (write instanceof Error) return Promise.reject(write);
        return Promise.resolve(write);
      },
      runCursorCommand: (command: Document, opts?: RunCursorCommandOptions) => {
        opened.push({ command, options: opts });
        if ('aggregate' in command) {
          const n = options.matching ?? 0;
          return singleBatch(n === 0 ? [] : [{ _id: 1, n }]);
        }
        return singleBatch(options.found ?? []);
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

const target = { profileId: 'p1', db: 'shop', coll: 'orders' };
const ID = '{"$numberInt":"7"}';
const readPreferences = (client: { opened: Opened[] }) =>
  client.opened.map((o) => o.options?.readPreference);

describe('document writes: primary with the profile write concern', () => {
  it('insert, update, replace and delete carry writeConcern and no read preference', async () => {
    const client = profileServer();
    await insertDocuments(client, { ...target, docs: ['{"_id":1}'] });
    await updateDocument(client, { ...target, id: ID, update: '{"$set":{"a":1}}', expected: '{}' });
    await replaceDocument(client, { ...target, id: ID, doc: '{"a":2}' });
    await deleteDocument(client, { ...target, id: ID });
    await updateMany(client, { ...target, filter: '{}', update: '{"$set":{"b":1}}' });
    await deleteMany(client, { ...target, filter: '{}' });
    expect(client.sent.map((s) => Object.keys(s.command)[0])).toEqual([
      'insert',
      'update',
      'update',
      'delete',
      'update',
      'delete',
    ]);
    for (const s of client.sent) {
      expect(s.command['writeConcern']).toEqual({ w: 2 });
      expect(s.options?.readPreference).toBeUndefined();
    }
    expect(client.opened).toEqual([]);
  });
});

describe('reads that belong to a write go to the primary', () => {
  it('docs.update conflict detail reads the current document from the primary', async () => {
    const client = profileServer({ write: { n: 0, nModified: 0, ok: 1 }, found: [{ _id: 7 }] });
    const error = await rejection(
      updateDocument(client, {
        ...target,
        id: ID,
        update: '{"$set":{"a":1}}',
        expected: '{"a":0}',
      }),
    );
    expect(error.code).toBe('CONFLICT');
    expect(client.opened.map((o) => Object.keys(o.command)[0])).toEqual(['find']);
    expect(readPreferences(client)).toEqual([ReadPreference.primary]);
  });

  it('docs.delete with expected values reads the conflict detail from the primary', async () => {
    const client = profileServer({ write: { n: 0, ok: 1 }, found: [{ _id: 7, a: 1 }] });
    const error = await rejection(
      deleteDocument(client, { ...target, id: ID, expected: '{"a":0}' }),
    );
    expect(error.code).toBe('CONFLICT');
    expect(readPreferences(client)).toEqual([ReadPreference.primary]);
  });

  it('docs.previewMany counts and samples on the primary', async () => {
    const client = profileServer({ matching: 2, found: [{ _id: 1 }, { _id: 2 }] });
    const preview = await previewMany(client, { ...target, filter: '{}', sampleSize: 2 });
    expect(preview.matched).toBe(2);
    expect(preview.sample).toHaveLength(2);
    expect(client.opened.map((o) => Object.keys(o.command)[0])).toEqual(['aggregate', 'find']);
    expect(readPreferences(client)).toEqual([ReadPreference.primary, ReadPreference.primary]);
    expect(client.sent).toEqual([]);
  });

  it('the expectedCount check of updateMany/deleteMany counts on the primary', async () => {
    const client = profileServer({ matching: 3 });
    await updateMany(client, {
      ...target,
      filter: '{}',
      update: '{"$set":{"b":1}}',
      expectedCount: 3,
    });
    await deleteMany(client, { ...target, filter: '{}', expectedCount: 3 });
    expect(readPreferences(client)).toEqual([ReadPreference.primary, ReadPreference.primary]);
    const refused = await rejection(
      deleteMany(client, { ...target, filter: '{}', expectedCount: 2 }),
    );
    expect(refused.code).toBe('CONFLICT');
  });
});

describe('write concern errors (MongoWriteConcernError)', () => {
  const wce = {
    code: 100,
    codeName: 'UnsatisfiableWriteConcern',
    errmsg: 'Not enough data-bearing nodes',
  };

  it('docs.insert answers SERVER_ERROR "applied but not acknowledged" with the server code', async () => {
    const client = profileServer({
      write: new MongoWriteConcernError({ n: 1, ok: 1, writeConcernError: wce }),
    });
    const error = await rejection(insertDocuments(client, { ...target, docs: ['{"_id":1}'] }));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toBe(
      'insert: the write was applied but not acknowledged by the requested write concern: Not enough data-bearing nodes',
    );
    expect(error.detail).toEqual({ serverCode: 100, codeName: 'UnsatisfiableWriteConcern' });
  });

  it('write errors in the same reply are reported first, with what was inserted', async () => {
    const client = profileServer({
      write: new MongoWriteConcernError({
        n: 1,
        ok: 1,
        writeErrors: [{ index: 1, code: 11000, codeName: 'DuplicateKey', errmsg: 'E11000 dup' }],
        writeConcernError: wce,
      }),
    });
    const error = await rejection(
      insertDocuments(client, { ...target, docs: ['{"_id":1}', '{"_id":1}'], ordered: false }),
    );
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toBe('1 of 2 documents inserted; insert failed: E11000 dup');
    expect(error.detail).toEqual({ serverCode: 11000, codeName: 'DuplicateKey' });
  });

  it('updateMany and deleteMany report an unacknowledged write the same way', async () => {
    const error = new MongoWriteConcernError({ n: 4, nModified: 4, ok: 1, writeConcernError: wce });
    const update = await rejection(
      updateMany(profileServer({ write: error }), {
        ...target,
        filter: '{}',
        update: '{"$set":{"b":1}}',
      }),
    );
    expect(update.code).toBe('SERVER_ERROR');
    expect(update.message).toMatch(/^updateMany: the write was applied but not acknowledged/);
    const del = await rejection(
      deleteMany(profileServer({ write: error }), { ...target, filter: '{}' }),
    );
    expect(del.message).toMatch(/^deleteMany: the write was applied but not acknowledged/);
  });
});
