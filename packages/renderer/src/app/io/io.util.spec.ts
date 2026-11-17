import { CSV_TYPES, EXPORT_FORMATS, IMPORT_FORMATS } from '@thicket/contract';
import { describe, expect, it } from 'vitest';

import type { ParsedQuery } from '../collection/query.util';
import {
  CSV_TYPE_OPTIONS,
  type CsvColumnRow,
  FILE_FORMATS,
  NO_PROGRESS,
  collRef,
  csvFieldsOf,
  csvMapping,
  csvMappingProblem,
  defaultCsvRows,
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

  it('sends csvFields for CSV only, and only when some are chosen', () => {
    const fields = ['name', 'address.city'];
    const csv = exportParams(TARGET, EMPTY, 'csv', 'relaxed', fields);
    expect(csv).toMatchObject({ format: 'csv', csvFields: ['name', 'address.city'] });
    // A copy: later edits of the panel's list do not change a sent request.
    expect(csv.csvFields).not.toBe(fields);
    expect(exportParams(TARGET, EMPTY, 'csv', 'relaxed', [])).not.toHaveProperty('csvFields');
    expect(exportParams(TARGET, EMPTY, 'csv', 'relaxed')).not.toHaveProperty('csvFields');
    expect(exportParams(TARGET, EMPTY, 'json', 'relaxed', fields)).not.toHaveProperty('csvFields');
    expect(exportParams(TARGET, EMPTY, 'bson', 'canonical', fields)).toEqual({
      ...TARGET,
      source: { kind: 'find', filter: '{}' },
      format: 'bson',
      ejsonMode: 'canonical',
    });
  });
});

describe('FILE_FORMATS and CSV_TYPE_OPTIONS', () => {
  it('offers every import and export format of the contract, in order', () => {
    expect(FILE_FORMATS.map((f) => f.value)).toEqual([...EXPORT_FORMATS]);
    expect(FILE_FORMATS.map((f) => f.value)).toEqual([...IMPORT_FORMATS]);
    expect(FILE_FORMATS.map((f) => f.label)).toEqual(['JSON', 'JSON Lines', 'CSV', 'BSON dump']);
  });

  it('offers every CSV type of the contract exactly once, auto first, each with a color token', () => {
    expect(CSV_TYPE_OPTIONS.map((t) => t.value)).toEqual([...CSV_TYPES]);
    expect(CSV_TYPE_OPTIONS[0]?.value).toBe('auto');
    for (const option of CSV_TYPE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.token).toMatch(/^--[a-z-]+$/);
    }
  });
});

const row = (column: string, change: Partial<CsvColumnRow> = {}): CsvColumnRow => ({
  column,
  include: true,
  path: column,
  type: 'auto',
  example: '',
  ...change,
});

describe('defaultCsvRows', () => {
  it('maps every column under its own name as auto, with the first row as example', () => {
    expect(
      defaultCsvRows(
        ['sku', 'qty'],
        [
          ['A-1', '3'],
          ['A-2', '5'],
        ],
      ),
    ).toEqual([
      { column: 'sku', include: true, path: 'sku', type: 'auto', example: 'A-1' },
      { column: 'qty', include: true, path: 'qty', type: 'auto', example: '3' },
    ]);
  });

  it('leaves out overlapping names and names that are no valid path, like the backend', () => {
    const rows = defaultCsvRows(['a', 'a.b', 'x.', '.y', 'c.d', 'c', 'cd'], []);
    expect(rows.map((r) => r.include)).toEqual([true, false, false, false, true, false, true]);
    expect(csvMappingProblem(rows)).toBeNull();
  });

  it('leaves out unnamed and repeated columns (the first of a repeated name is taken)', () => {
    const rows = defaultCsvRows(['name', '', ' ', 'name', 'qty'], [['a', 'b', 'c', 'd', 'e']]);
    expect(rows.map((r) => r.include)).toEqual([true, false, false, false, true]);
    expect(rows.map((r) => r.example)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(csvMappingProblem(rows)).toBeNull();
  });

  it('includes the same columns as the backend default mapping for the same header', () => {
    // Backend defaultMapping(['a','a','a.b','x.','.y','c.d','c','cd','n']) takes indexes 0,5,7,8.
    const rows = defaultCsvRows(['a', 'a', 'a.b', 'x.', '.y', 'c.d', 'c', 'cd', 'n'], []);
    expect(csvMapping(rows).map((m) => [m.index, m.column])).toEqual([
      [0, 'a'],
      [5, 'c.d'],
      [7, 'cd'],
      [8, 'n'],
    ]);
  });

  it('leaves out a parent name after its nested names, and takes a name after an invalid one', () => {
    expect(defaultCsvRows(['a.b', 'a.c', 'a'], []).map((r) => r.include)).toEqual([
      true,
      true,
      false,
    ]);
    expect(defaultCsvRows(['x.', 'x', 'x.y'], []).map((r) => r.include)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('has empty examples without rows or for a short first row', () => {
    expect(defaultCsvRows(['a', 'b'], []).map((r) => r.example)).toEqual(['', '']);
    expect(defaultCsvRows(['a', 'b'], [['1']]).map((r) => r.example)).toEqual(['1', '']);
  });

  it('no columns give no rows', () => {
    expect(defaultCsvRows([], [])).toEqual([]);
  });
});

describe('csvMappingProblem', () => {
  it('accepts distinct paths, nested ones included, and ignores excluded columns', () => {
    expect(
      csvMappingProblem([
        row('city', { path: 'address.city' }),
        row('zip', { path: 'address.zip' }),
        row('a', { path: 'ab' }),
        row('skip', { include: false, path: '' }),
        row('dup', { include: false, path: 'ab' }),
      ]),
    ).toBeNull();
  });

  it('needs at least one included column', () => {
    expect(csvMappingProblem([])).toBe('Choose at least one column to import.');
    expect(csvMappingProblem([row('a', { include: false })])).toBe(
      'Choose at least one column to import.',
    );
  });

  it.each(['', '   ', 'a.', '.a', 'a..b'])('refuses the path %j', (path) => {
    expect(csvMappingProblem([row('city', { path })])).toBe(
      'Column "city" needs a field path such as name or address.city.',
    );
  });

  it('refuses a path used by two columns, also after trimming', () => {
    expect(csvMappingProblem([row('a', { path: 'x' }), row('b', { path: ' x ' })])).toBe(
      'Field "x" is used by two columns.',
    );
  });

  it('refuses overlapping paths in either order', () => {
    const message =
      'Fields "address" and "address.city" overlap: address would be both a value and a document.';
    expect(
      csvMappingProblem([row('a', { path: 'address' }), row('b', { path: 'address.city' })]),
    ).toBe(message);
    expect(
      csvMappingProblem([row('b', { path: 'address.city' }), row('a', { path: 'address' })]),
    ).toBe(message);
  });
});

describe('csvMapping', () => {
  it('sends the included columns with trimmed paths and their types, in column order', () => {
    expect(
      csvMapping([
        row('sku', { path: ' _id ', type: 'string' }),
        row('note', { include: false }),
        row('qty', { path: 'stock.qty', type: 'int' }),
      ]),
    ).toEqual([
      { column: 'sku', index: 0, path: '_id', bsonType: 'string' },
      { column: 'qty', index: 2, path: 'stock.qty', bsonType: 'int' },
    ]);
  });

  it('names a repeated header column by its index, so the chosen one is imported', () => {
    const rows = defaultCsvRows(['name', 'qty', 'name'], [['a', '1', 'b']]);
    const chosen = rows.map((r, i) =>
      i === 0 ? { ...r, include: false } : i === 2 ? { ...r, include: true, path: 'alias' } : r,
    );
    expect(csvMappingProblem(chosen)).toBeNull();
    expect(csvMapping(chosen)).toEqual([
      { column: 'qty', index: 1, path: 'qty', bsonType: 'auto' },
      { column: 'name', index: 2, path: 'alias', bsonType: 'auto' },
    ]);
  });
});

describe('csvFieldsOf', () => {
  it('lists the field paths in the order first seen, nested documents flattened', () => {
    expect(
      csvFieldsOf([
        '{"_id":{"$oid":"64b7f0c2a1b2c3d4e5f60718"},"name":"Widget","address":{"city":"X","geo":{"lat":{"$numberDouble":"1.5"}}}}',
        '{"_id":{"$numberInt":"2"},"extra":true,"address":{"zip":"01234","city":"Y"}}',
      ]),
    ).toEqual(['_id', 'name', 'address.city', 'address.geo.lat', 'extra', 'address.zip']);
  });

  it('keeps arrays, empty documents, null and type wrappers as one column', () => {
    expect(
      csvFieldsOf([
        '{"tags":["a",{"b":1}],"empty":{},"nil":null,"at":{"$date":{"$numberLong":"0"}},' +
          '"n":{"$numberLong":"5"}}',
      ]),
    ).toEqual(['tags', 'empty', 'nil', 'at', 'n']);
  });

  it('skips unreadable texts and values that are not documents', () => {
    expect(csvFieldsOf(['{broken', '[1,2]', '5', 'null', '{"a":1}'])).toEqual(['a']);
    expect(csvFieldsOf([])).toEqual([]);
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

  it('quotes a collection name that is not an identifier', () => {
    expect(describeExport('my-orders', EMPTY)).toBe('db.getCollection("my-orders").find({})');
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

describe('collRef', () => {
  it('uses db.<name> for JavaScript identifiers', () => {
    expect(collRef('orders')).toBe('db.orders');
    expect(collRef('_tmp$1')).toBe('db._tmp$1');
  });

  it('uses db.getCollection("…") for any other name, quoted as a JS string', () => {
    expect(collRef('my-orders')).toBe('db.getCollection("my-orders")');
    expect(collRef('2024 sales')).toBe('db.getCollection("2024 sales")');
    expect(collRef('a.b')).toBe('db.getCollection("a.b")');
    expect(collRef('say "hi"\\')).toBe('db.getCollection("say \\"hi\\"\\\\")');
    expect(collRef('ä')).toBe('db.getCollection("ä")');
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
