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

  it('formats event times with milliseconds', () => {
    expect(formatEventTime(null)).toBe('');
    expect(formatEventTime(new Date(2026, 0, 2, 3, 4, 5, 6))).toBe('03:04:05.006');
  });
});
