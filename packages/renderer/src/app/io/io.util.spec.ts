import { describe, expect, it } from 'vitest';

import type { ParsedQuery } from '../collection/query.util';
import {
  NO_PROGRESS,
  describeExport,
  exportParams,
  formatBytes,
  formatNumber,
  printSample,
} from './io.util';

const TARGET = { profileId: 'p1', db: 'shop', coll: 'orders' };
const EMPTY: ParsedQuery = { filter: '{}', sortSpec: [], emptyFilter: true };
const FULL: ParsedQuery = {
  filter: '{"status":"open"}',
  projection: '{"name":{"$numberInt":"1"}}',
  sort: '{"total":{"$numberInt":"-1"}}',
  collation: '{"locale":"en"}',
  limit: 25,
  sortSpec: [{ field: 'total', direction: -1 }],
  emptyFilter: false,
};

describe('exportParams', () => {
  it('exports an empty query as a plain find of the namespace', () => {
    expect(exportParams(TARGET, EMPTY, 'json', 'relaxed')).toEqual({
      profileId: 'p1',
      db: 'shop',
      coll: 'orders',
      source: { kind: 'find', filter: '{}' },
      format: 'json',
      ejsonMode: 'relaxed',
    });
  });

  it('passes filter, projection, sort, collation and limit, and the chosen format and mode', () => {
    expect(exportParams(TARGET, FULL, 'jsonl', 'canonical')).toEqual({
      profileId: 'p1',
      db: 'shop',
      coll: 'orders',
      source: {
        kind: 'find',
        filter: '{"status":"open"}',
        projection: '{"name":{"$numberInt":"1"}}',
        sort: '{"total":{"$numberInt":"-1"}}',
        collation: '{"locale":"en"}',
        limit: 25,
      },
      format: 'jsonl',
      ejsonMode: 'canonical',
    });
  });

  it('never sends skip (every page is exported) or the paging-only fields', () => {
    const { source } = exportParams(TARGET, FULL, 'json', 'relaxed');
    expect(source).not.toHaveProperty('skip');
    expect(source).not.toHaveProperty('sortSpec');
    expect(source).not.toHaveProperty('emptyFilter');
  });

  it('treats a zero limit as no limit and keeps a limit of 1', () => {
    expect(
      exportParams(TARGET, { ...EMPTY, limit: 0 }, 'json', 'relaxed').source,
    ).not.toHaveProperty('limit');
    expect(exportParams(TARGET, { ...EMPTY, limit: 1 }, 'json', 'relaxed').source).toMatchObject({
      limit: 1,
    });
  });
});

describe('describeExport', () => {
  it('describes an empty query as find({})', () => {
    expect(describeExport('orders', EMPTY)).toBe('db.orders.find({})');
  });

  it('prints every part of the query in shell syntax, in mongosh call order', () => {
    expect(describeExport('orders', FULL)).toBe(
      'db.orders.find({ status: "open" }, { name: 1 }).sort({ total: -1 })' +
        '.collation({ locale: "en" }).limit(25)',
    );
  });

  it('omits a zero limit', () => {
    expect(describeExport('orders', { ...EMPTY, limit: 0 })).toBe('db.orders.find({})');
  });

  it('shows unreadable EJSON as it is instead of throwing', () => {
    expect(describeExport('orders', { ...EMPTY, filter: '{not json' })).toBe(
      'db.orders.find({not json)',
    );
  });
});

describe('formatBytes', () => {
  it('writes bytes below 1 KB as bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('uses one decimal below 10 units and whole numbers above', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10 * 1024)).toBe('10 KB');
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(5.5 * 1024 ** 3)).toBe('5.5 GB');
  });

  it('stops at TB for very large files', () => {
    expect(formatBytes(2048 * 1024 ** 4)).toBe('2048 TB');
  });
});

describe('formatNumber', () => {
  it('groups thousands like the locale', () => {
    expect(formatNumber(12431)).toBe(new Intl.NumberFormat().format(12431));
    expect(formatNumber(0)).toBe('0');
  });
});

describe('printSample', () => {
  it('prints a document in indented shell syntax', () => {
    const text = printSample('{"_id":{"$numberInt":"1"},"name":"Ada","tags":["a"]}');
    expect(text).toContain('_id: 1');
    expect(text).toContain('name: "Ada"');
    expect(text.split('\n').length).toBeGreaterThan(1);
  });

  it('keeps BSON types (dates, Int64) readable', () => {
    const text = printSample(
      '{"at":{"$date":{"$numberLong":"0"}},"n":{"$numberLong":"9007199254740993"}}',
    );
    expect(text).toContain('ISODate("1970-01-01T00:00:00');
    expect(text).toContain('NumberLong(');
  });

  it('shows a note for an unreadable document instead of throwing', () => {
    expect(printSample('{broken')).toBe('// unreadable document');
    expect(printSample('[1, 2]')).toBe('// unreadable document');
  });
});

describe('NO_PROGRESS', () => {
  it('is an empty progress', () => {
    expect(NO_PROGRESS).toEqual({ processed: 0, failed: 0, errors: [] });
  });
});
