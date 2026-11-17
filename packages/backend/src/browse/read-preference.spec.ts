import {
  BSON,
  MongoServerError,
  ReadPreference,
  WriteConcern,
  type Document,
  type RunCommandOptions,
  type RunCursorCommandOptions,
} from 'mongodb';
import { describe, expect, it } from 'vitest';

import type { ClientLike, CursorLike, DbLike } from '../connections/manager';
import {
  ReadCursor,
  collectionStats,
  createCollection,
  databaseStats,
  dropCollection,
  listCollections,
  listDatabases,
  readOptions,
  renameCollection,
  withWriteConcern,
} from './browse';

/** Task raw-cmd-read-pref: browse reads follow the profile's read preference. */

const SECONDARY = new ReadPreference('secondaryPreferred', [{ dc: 'b' }]);

interface Sent {
  db: string;
  command: Document;
  options: RunCommandOptions | undefined;
}

interface Opened {
  db: string;
  command: Document;
  options: RunCursorCommandOptions | undefined;
  /** Calls on the cursor, in order (`hasNext`, `close`, `setComment:…`, `setBatchSize:…`). */
  calls: string[];
}

/** A fake driver cursor serving `batches` (documents as BSON bytes, as with `raw: true`). */
function fakeCursor(batches: Document[][], calls: string[]): CursorLike {
  let next = 0;
  let buffered: Uint8Array[] = [];
  let id: BSON.Long | undefined;
  return {
    get id() {
      return id;
    },
    hasNext() {
      calls.push('hasNext');
      const batch = batches[next] ?? [];
      next++;
      buffered = batch.map((doc) => BSON.serialize(doc));
      id = next < batches.length ? BSON.Long.fromNumber(42) : BSON.Long.ZERO;
      return Promise.resolve(buffered.length > 0);
    },
    readBufferedDocuments() {
      const docs = buffered;
      buffered = [];
      return docs;
    },
    setComment(comment: unknown) {
      calls.push(`setComment:${String(comment)}`);
    },
    setBatchSize(size: number) {
      calls.push(`setBatchSize:${size}`);
    },
    close() {
      calls.push('close');
      return Promise.resolve();
    },
  };
}

/** A fake client whose databases carry a read preference and write concern. */
function fakeClient(
  answer: (db: string, command: Document) => Document,
  cursorBatches: (command: Document) => Document[][] = () => [],
  readPreference: ReadPreference | undefined = SECONDARY,
): ClientLike & { sent: Sent[]; opened: Opened[] } {
  const sent: Sent[] = [];
  const opened: Opened[] = [];
  return {
    sent,
    opened,
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: (db: string): DbLike => ({
      readPreference,
      writeConcern: new WriteConcern(2),
      command: (command: Document, options?: RunCommandOptions) => {
        sent.push({ db, command, options });
        return Promise.resolve(answer(db, command));
      },
      runCursorCommand: (command: Document, options?: RunCursorCommandOptions) => {
        const calls: string[] = [];
        opened.push({ db, command, options, calls });
        return fakeCursor(cursorBatches(command), calls);
      },
    }),
  };
}

describe('browse reads honour the profile read preference', () => {
  it('listDatabases sends the read preference', async () => {
    const client = fakeClient(() => ({ databases: [{ name: 'shop' }], ok: 1 }));
    await listDatabases(client, false);
    expect(client.sent[0]?.command).toMatchObject({ listDatabases: 1 });
    expect(client.sent[0]?.options?.readPreference).toBe(SECONDARY);
  });

  it('db.stats sends the read preference', async () => {
    const client = fakeClient(() => ({ db: 'shop', collections: 1, ok: 1 }));
    await databaseStats(client, 'shop');
    expect(client.sent[0]?.command).toMatchObject({ dbStats: 1 });
    expect(client.sent[0]?.options?.readPreference).toBe(SECONDARY);
  });

  it('a failing db.stats read is a SERVER_ERROR with the server code', async () => {
    const client = fakeClient(() => {
      throw new MongoServerError({ ok: 0, code: 13, codeName: 'Unauthorized', errmsg: 'denied' });
    });
    const error = await databaseStats(client, 'shop').catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: 'SERVER_ERROR',
      detail: { serverCode: 13, codeName: 'Unauthorized' },
    });
    expect(client.sent[0]?.options?.readPreference).toBe(SECONDARY);
  });

  it('listCollections runs as a driver cursor with the read preference and reads every batch from it', async () => {
    const client = fakeClient(
      () => {
        throw new Error('no plain command expected');
      },
      () => [[{ name: 'b', type: 'collection' }], [{ name: 'a', type: 'collection' }]],
    );
    const { collections } = await listCollections(client, 'shop');
    expect(collections.map((c) => c.name)).toEqual(['a', 'b']);
    expect(client.sent).toEqual([]);
    expect(client.opened).toHaveLength(1);
    const [open] = client.opened;
    expect(open?.command).toEqual({ listCollections: 1, cursor: {} });
    expect(open?.options).toEqual({ raw: true, readPreference: SECONDARY });
    // Both batches come through the same cursor (getMore pinned to its server), then it is closed.
    expect(open?.calls).toEqual(['hasNext', 'hasNext', 'close']);
  });

  it('coll.stats ($collStats) runs as a driver cursor with the read preference', async () => {
    const client = fakeClient(
      () => {
        throw new Error('no plain command expected');
      },
      () => [[{ storageStats: { count: 3, size: 30, storageSize: 4096, nindexes: 1 } }]],
    );
    const stats = await collectionStats(client, 'shop', 'orders');
    expect(stats.count).toBe(3);
    const [open] = client.opened;
    expect(open?.command).toMatchObject({ aggregate: 'orders' });
    expect(open?.options).toEqual({ raw: true, readPreference: SECONDARY });
  });

  it('decodes raw cursor documents losslessly (Int64 stays Int64)', async () => {
    const client = fakeClient(
      () => ({ ok: 1 }),
      () => [[{ name: 'c', type: 'collection', options: { size: BSON.Long.fromNumber(5) } }]],
    );
    const { collections } = await listCollections(client, 'shop');
    expect(collections[0]?.raw).toContain('"$numberLong":"5"');
  });

  it('commands that change something stay on the primary (no read preference)', async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    await createCollection(client, 'shop', 'c', undefined);
    await dropCollection(client, 'shop', 'c');
    await renameCollection(client, 'shop', 'a', 'b', false);
    expect(client.sent.map((s) => s.options?.readPreference)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('readOptions / withWriteConcern', () => {
  const db = (readPreference?: ReadPreference, writeConcern?: WriteConcern): DbLike => ({
    command: () => Promise.resolve({}),
    ...(readPreference ? { readPreference } : {}),
    ...(writeConcern ? { writeConcern } : {}),
  });

  it('readOptions adds the database read preference to the raw options', () => {
    expect(readOptions(db(SECONDARY)).readPreference).toBe(SECONDARY);
    expect(readOptions(db()).readPreference).toBeUndefined();
    expect(readOptions(db()).fieldsAsRaw).toEqual({ firstBatch: true, nextBatch: true });
  });

  it('withWriteConcern maps w / journal / wtimeoutMS to the command field', () => {
    const cmd = { insert: 'c', documents: [] };
    expect(withWriteConcern(db(undefined, new WriteConcern('majority', 500, true)), cmd)).toEqual({
      ...cmd,
      writeConcern: { w: 'majority', j: true, wtimeout: 500 },
    });
    expect(withWriteConcern(db(undefined, new WriteConcern(3)), cmd)).toEqual({
      ...cmd,
      writeConcern: { w: 3 },
    });
  });

  it('withWriteConcern sends only the parts the profile sets (journal only; nothing set)', () => {
    const cmd = { insert: 'c', documents: [] };
    expect(
      withWriteConcern(db(undefined, new WriteConcern(undefined, undefined, true)), cmd),
    ).toEqual({ ...cmd, writeConcern: { j: true } });
    expect(withWriteConcern(db(undefined, new WriteConcern()), cmd)).toBe(cmd);
  });

  it('withWriteConcern leaves the command alone without a write concern or with its own', () => {
    const cmd = { insert: 'c', documents: [] };
    expect(withWriteConcern(db(), cmd)).toBe(cmd);
    const own = { ...cmd, writeConcern: { w: 1 } };
    expect(withWriteConcern(db(undefined, new WriteConcern(3)), own)).toBe(own);
  });
});

describe('ReadCursor', () => {
  it('sends the comment with the command and every getMore, and the batch size', async () => {
    const client = fakeClient(
      () => ({ ok: 1 }),
      () => [[{ _id: 1 }], [{ _id: 2 }]],
    );
    const cursor = new ReadCursor(client.db('shop'), 'orders', 'thicket:abc');
    expect(await cursor.first({ find: 'orders' })).toEqual([{ _id: new BSON.Int32(1) }]);
    expect(cursor.hasMore).toBe(true);
    expect(await cursor.next(10)).toEqual([{ _id: new BSON.Int32(2) }]);
    expect(cursor.hasMore).toBe(false);
    await cursor.close();
    const [open] = client.opened;
    expect(open?.command).toEqual({ find: 'orders', comment: 'thicket:abc' });
    expect(open?.calls).toEqual([
      'setComment:thicket:abc',
      'hasNext',
      'setBatchSize:10',
      'hasNext',
      'close',
    ]);
  });

  it('an explicit read preference overrides the database one', async () => {
    const client = fakeClient(
      () => ({ ok: 1 }),
      () => [[{ _id: 1 }]],
    );
    await new ReadCursor(client.db('shop'), 'orders', undefined, 'primary').first({
      find: 'orders',
    });
    expect(client.opened[0]?.options).toEqual({ raw: true, readPreference: 'primary' });
  });

  it('without a read preference the driver cursor gets none (client default: primary)', async () => {
    const calls: string[] = [];
    const opened: (RunCursorCommandOptions | undefined)[] = [];
    const target: DbLike = {
      command: () => Promise.resolve({ ok: 1 }),
      runCursorCommand: (_command, options) => {
        opened.push(options);
        return fakeCursor([[{ _id: 1 }]], calls);
      },
    };
    const cursor = new ReadCursor(target, 'orders');
    await cursor.first({ find: 'orders' });
    expect(opened).toEqual([{ raw: true }]);
    // Exhausted: next() answers nothing without another hasNext.
    expect(await cursor.next()).toEqual([]);
    expect(calls).toEqual(['hasNext']);
  });

  it('close() ignores a failing driver cursor close', async () => {
    const calls: string[] = [];
    const failing: CursorLike = {
      ...fakeCursor([[{ _id: 1 }], [{ _id: 2 }]], calls),
      id: BSON.Long.fromNumber(42),
      close: () => Promise.reject(new Error('connection gone')),
    };
    const target: DbLike = {
      command: () => Promise.resolve({ ok: 1 }),
      runCursorCommand: () => failing,
    };
    const cursor = new ReadCursor(target, 'orders');
    await cursor.first({ find: 'orders' });
    await expect(cursor.close()).resolves.toBeUndefined();
  });

  it('without runCursorCommand: plain commands carry the read preference, getMore included', async () => {
    const sent: Sent[] = [];
    const replies: Document[] = [
      { cursor: { id: BSON.Long.fromNumber(7), firstBatch: [{ _id: 1 }] }, ok: 1 },
      { cursor: { id: BSON.Long.ZERO, nextBatch: [{ _id: 2 }] }, ok: 1 },
    ];
    const target: DbLike = {
      readPreference: SECONDARY,
      command: (command, options) => {
        sent.push({ db: 'shop', command, options });
        return Promise.resolve(replies.shift() ?? { ok: 1 });
      },
    };
    const cursor = new ReadCursor(target, 'orders');
    expect(await cursor.first({ find: 'orders' })).toEqual([{ _id: 1 }]);
    expect(await cursor.next()).toEqual([{ _id: 2 }]);
    await cursor.close();
    expect(sent.map((s) => Object.keys(s.command)[0])).toEqual(['find', 'getMore']);
    expect(sent.every((s) => s.options?.readPreference === SECONDARY)).toBe(true);
  });
});
