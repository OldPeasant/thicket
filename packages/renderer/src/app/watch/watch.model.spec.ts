import { describe, expect, it } from 'vitest';

import {
  eventKind,
  formatEventTime,
  toWatchEntry,
  watchCall,
  watchTabId,
  watchTitle,
} from './watch.model';

describe('watch model', () => {
  it('names tabs per deployment, database and collection', () => {
    expect(watchTabId('p')).toBe('watch:p');
    expect(watchTabId('p', 'shop')).toBe('watch:p:shop');
    expect(watchTabId('p', 'shop', 'orders')).toBe('watch:p:shop.orders');
    expect(watchTitle({ profileId: 'p' })).toBe('Watch deployment');
    expect(watchTitle({ profileId: 'p', db: 'shop' })).toBe('Watch shop');
    expect(watchTitle({ profileId: 'p', db: 'shop', coll: 'orders' })).toBe('Watch shop.orders');
  });

  it('prints the matching mongosh call', () => {
    expect(watchCall({ profileId: 'p' }, 'default')).toBe('db.getMongo().watch()');
    expect(watchCall({ profileId: 'p', db: 'shop' }, 'default')).toBe(
      'db.getSiblingDB("shop").watch()',
    );
    expect(watchCall({ profileId: 'p', db: 'shop', coll: 'my-orders' }, 'updateLookup')).toBe(
      `db.getSiblingDB("shop").getCollection("my-orders").watch([], { fullDocument: 'updateLookup' })`,
    );
  });

  it('classifies operation types', () => {
    expect(['insert', 'update', 'replace', 'delete', 'drop', 'invalidate'].map(eventKind)).toEqual([
      'insert',
      'update',
      'update',
      'delete',
      'other',
      'other',
    ]);
  });

  it('reduces an event', () => {
    const entry = toWatchEntry(
      JSON.stringify({
        operationType: 'update',
        ns: { db: 'shop', coll: 'orders' },
        documentKey: { _id: { $numberInt: '7' } },
        wallTime: { $date: { $numberLong: '1700000000250' } },
        updateDescription: {
          updatedFields: { a: 1, 'b.c': 2 },
          removedFields: ['d'],
          truncatedArrays: [{ field: 'e', newSize: 1 }],
        },
      }),
      3,
    );
    expect(entry).toMatchObject({
      seq: 3,
      op: 'update',
      kind: 'update',
      db: 'shop',
      coll: 'orders',
      id: '{"$numberInt":"7"}',
      idLabel: '7',
      summary: 'set a, b.c; unset d; truncated arrays',
      openable: true,
    });
    expect(entry.time?.getTime()).toBe(1_700_000_000_250);
    expect(entry.text).toContain('operationType: "update"');
  });

  it('falls back to the cluster time and handles events without a document', () => {
    const entry = toWatchEntry(
      JSON.stringify({
        operationType: 'dropDatabase',
        ns: { db: 'shop' },
        clusterTime: { $timestamp: { t: 1_700_000_000, i: 1 } },
      }),
      1,
    );
    expect(entry).toMatchObject({ kind: 'other', id: null, idLabel: '', openable: false });
    expect(entry.time?.getTime()).toBe(1_700_000_000_000);
  });

  it('keeps an unreadable event as a row', () => {
    const entry = toWatchEntry('not json', 1);
    expect(entry).toMatchObject({ op: 'unknown', openable: false, text: 'not json', time: null });
  });

  it('reads a relaxed ISO wallTime; an unreadable one falls back to the cluster time, else null', () => {
    const iso = toWatchEntry(
      JSON.stringify({ operationType: 'insert', wallTime: { $date: '2023-11-14T22:13:20.250Z' } }),
      1,
    );
    expect(iso.time?.getTime()).toBe(1_700_000_000_250);

    const unreadable = toWatchEntry(
      JSON.stringify({
        operationType: 'insert',
        wallTime: { $date: 'not a date' },
        clusterTime: { $timestamp: { t: 1_700_000_000, i: 1 } },
      }),
      2,
    );
    expect(unreadable.time?.getTime()).toBe(1_700_000_000_000);

    const none = toWatchEntry(
      JSON.stringify({ operationType: 'insert', wallTime: { $date: 'not a date' } }),
      3,
    );
    expect(none.time).toBeNull();
  });

  it('labels an _id that is not valid EJSON with its JSON text instead of failing', () => {
    const entry = toWatchEntry(
      JSON.stringify({
        operationType: 'delete',
        ns: { db: 'shop', coll: 'orders' },
        documentKey: { _id: { $oid: 'not-an-object-id' } },
      }),
      1,
    );
    expect(entry.id).toBe('{"$oid":"not-an-object-id"}');
    expect(entry.idLabel).toBe('{"$oid":"not-an-object-id"}');
    expect(entry.openable).toBe(true);
  });

  it('summarises odd update descriptions without failing', () => {
    const summary = (updateDescription: unknown) =>
      toWatchEntry(JSON.stringify({ operationType: 'update', updateDescription }), 1).summary;
    expect(summary({ removedFields: 'd', truncatedArrays: [] })).toBe('');
    expect(summary({ updatedFields: { a: 1 }, removedFields: [7, 'b'] })).toBe('set a; unset b');
    const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`field${i}`, i]));
    const long = summary({ updatedFields: many });
    expect(long).toHaveLength(200);
    expect(long.endsWith('…')).toBe(true);
  });

  it('an event with an _id but no collection cannot be opened', () => {
    const entry = toWatchEntry(
      JSON.stringify({ operationType: 'insert', ns: { db: 'shop' }, documentKey: { _id: 1 } }),
      1,
    );
    expect(entry).toMatchObject({ id: '1', idLabel: '1', openable: false });
  });

  it('formats event times with milliseconds', () => {
    expect(formatEventTime(null)).toBe('');
    expect(formatEventTime(new Date(2026, 0, 2, 3, 4, 5, 6))).toBe('03:04:05.006');
  });
});
