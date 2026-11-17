import type { CsvType } from '@thicket/contract';
import {
  BSON,
  Binary,
  Decimal128,
  Double,
  Int32,
  Long,
  ObjectId,
  Timestamp,
  type Document,
} from 'mongodb';
import { describe, expect, it } from 'vitest';

import { RpcError } from '../../server/rpc';
import {
  CellError,
  cellText,
  collectPaths,
  convertCell,
  defaultMapping,
  isPlainDocument,
  recordToDocument,
  resolveMapping,
  valueAt,
  type CsvColumnMapping,
} from './convert';

const OID = '64b7f0c2a1b2c3d4e5f60718';
const canonical = (value: unknown) => BSON.EJSON.stringify(value, { relaxed: false });

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('isPlainDocument', () => {
  it('is true for plain objects and false for arrays, dates, bytes and BSON values', () => {
    expect(isPlainDocument({ a: 1 })).toBe(true);
    expect(isPlainDocument({})).toBe(true);
    for (const value of [
      [],
      null,
      undefined,
      'x',
      1,
      new Date(0),
      new Uint8Array(1),
      new ObjectId(OID),
      new Int32(1),
      Long.fromNumber(1),
      new Binary(new Uint8Array([1])),
    ]) {
      expect(isPlainDocument(value)).toBe(false);
    }
  });
});

describe('collectPaths', () => {
  it('flattens nested documents to dotted paths, in the order first seen', () => {
    const paths = new Set<string>();
    collectPaths({ _id: new ObjectId(OID), name: 'Widget', address: { city: 'X', zip: 1 } }, paths);
    collectPaths({ name: 'Gadget', extra: true, address: { street: 'Y', city: 'Z' } }, paths);
    expect([...paths]).toEqual([
      '_id',
      'name',
      'address.city',
      'address.zip',
      'extra',
      'address.street',
    ]);
  });

  it('keeps arrays, empty documents and BSON values as one column', () => {
    const paths = new Set<string>();
    collectPaths(
      {
        tags: ['a', { b: 1 }],
        empty: {},
        at: new Date(0),
        n: Long.fromNumber(1),
        deep: { a: { b: { c: 1 } } },
      },
      paths,
    );
    expect([...paths]).toEqual(['tags', 'empty', 'at', 'n', 'deep.a.b.c']);
  });

  it('adds nothing for an empty document', () => {
    const paths = new Set<string>();
    collectPaths({}, paths);
    expect(paths.size).toBe(0);
  });

  describe('field names with a dot', () => {
    it('makes a top-level dotted key its own column, read back with its value', () => {
      const docs: Document[] = [{ 'a.b': 1, c: 2 }, { a: { b: 3 } }];
      const paths = new Set<string>();
      for (const d of docs) collectPaths(d, paths);
      expect([...paths]).toEqual(['a.b', 'c']);
      expect(docs.map((d) => valueAt(d, 'a.b'))).toEqual([1, 3]);
    });

    it('does not flatten a document that collides with a dotted key of the same document', () => {
      const doc: Document = { 'a.b': 1, a: { b: 2, c: 3 } };
      const paths = new Set<string>();
      collectPaths(doc, paths);
      expect([...paths]).toEqual(['a.b', 'a']);
      expect(valueAt(doc, 'a.b')).toBe(1);
      expect(valueAt(doc, 'a')).toEqual({ b: 2, c: 3 });
    });

    it('does not flatten a nested document holding a dotted key', () => {
      const doc: Document = { x: { 'a.b': 1, c: 2 }, y: { z: 1 } };
      const paths = new Set<string>();
      collectPaths(doc, paths);
      expect([...paths]).toEqual(['x', 'y.z']);
      expect(cellText(valueAt(doc, 'x'), false)).toBe(
        canonical({ 'a.b': new Int32(1), c: new Int32(2) }),
      );
    });

    it('loses no value of any document on export', () => {
      const docs: Document[] = [
        { 'a.b': 'literal', a: { b: 'nested' } },
        { a: { b: 'only nested' } },
        { 'a.b.c': 'deep literal' },
        { x: { 'p.q': 'inner' } },
      ];
      const paths = new Set<string>();
      for (const d of docs) collectPaths(d, paths);
      const text = docs
        .map((d) => [...paths].map((p) => cellText(valueAt(d, p), true)).join('|'))
        .join('\n');
      for (const value of ['literal', 'nested', 'only nested', 'deep literal', 'inner']) {
        expect(text).toContain(value);
      }
    });
  });
});

describe('valueAt', () => {
  const doc: Document = {
    name: 'Widget',
    address: { city: 'Springfield', geo: { lat: 1.5 } },
    tags: ['red', 'blue', { code: 7 }],
    nil: null,
  };

  it('reads top-level and nested paths', () => {
    expect(valueAt(doc, 'name')).toBe('Widget');
    expect(valueAt(doc, 'address.city')).toBe('Springfield');
    expect(valueAt(doc, 'address.geo.lat')).toBe(1.5);
    expect(valueAt(doc, 'address')).toEqual({ city: 'Springfield', geo: { lat: 1.5 } });
    expect(valueAt(doc, 'nil')).toBeNull();
  });

  it('indexes arrays by numeric segments', () => {
    expect(valueAt(doc, 'tags.0')).toBe('red');
    expect(valueAt(doc, 'tags.2.code')).toBe(7);
    expect(valueAt(doc, 'tags.9')).toBeUndefined();
    expect(valueAt(doc, 'tags.first')).toBeUndefined();
    expect(valueAt(doc, 'tags.-1')).toBeUndefined();
  });

  it('is undefined for missing paths and paths through scalars', () => {
    expect(valueAt(doc, 'missing')).toBeUndefined();
    expect(valueAt(doc, 'address.missing.x')).toBeUndefined();
    expect(valueAt(doc, 'name.length')).toBeUndefined();
    expect(valueAt(doc, 'nil.x')).toBeUndefined();
    expect(valueAt({ id: new ObjectId(OID) }, 'id.id')).toBeUndefined();
  });

  it('never reads inherited properties', () => {
    expect(valueAt(doc, 'constructor')).toBeUndefined();
    expect(valueAt(doc, '__proto__')).toBeUndefined();
    expect(valueAt(doc, 'address.toString')).toBeUndefined();
  });
});

describe('cellText', () => {
  it('writes blank cells for null and missing values', () => {
    expect(cellText(undefined, true)).toBe('');
    expect(cellText(null, true)).toBe('');
  });

  it('writes strings, booleans and numbers as they are', () => {
    expect(cellText('a, "b"', true)).toBe('a, "b"');
    expect(cellText('', true)).toBe('');
    expect(cellText(true, true)).toBe('true');
    expect(cellText(false, true)).toBe('false');
    expect(cellText(1.5, true)).toBe('1.5');
    expect(cellText(-3, true)).toBe('-3');
    expect(cellText(12345678901234567890n, true)).toBe('12345678901234567890');
  });

  it('writes Int32, Double, Long and Decimal128 exactly in decimal', () => {
    expect(cellText(new Int32(-7), true)).toBe('-7');
    expect(cellText(new Double(2.25), true)).toBe('2.25');
    expect(cellText(Long.fromString('9223372036854775807'), true)).toBe('9223372036854775807');
    expect(cellText(Decimal128.fromString('1.10'), true)).toBe('1.10');
  });

  it('writes ObjectIds as hex and dates as ISO 8601', () => {
    expect(cellText(new ObjectId(OID), true)).toBe(OID);
    expect(cellText(new Date(Date.UTC(2024, 1, 3, 4, 5, 6, 7)), true)).toBe(
      '2024-02-03T04:05:06.007Z',
    );
  });

  it('writes arrays, documents and other types as relaxed or canonical Extended JSON', () => {
    const tags = ['a', new Int32(1)];
    expect(cellText(tags, true)).toBe('["a",1]');
    expect(cellText(tags, false)).toBe('["a",{"$numberInt":"1"}]');
    expect(cellText({ x: new Int32(2) }, false)).toBe('{"x":{"$numberInt":"2"}}');
    expect(cellText(new Binary(new Uint8Array([1, 2])), false)).toBe(
      '{"$binary":{"base64":"AQI=","subType":"00"}}',
    );
  });

  it('writes a Timestamp as Extended JSON, not as the 64-bit number it is built on', () => {
    // Timestamp is a subclass of Long in the driver; it is no number, so it is "another type".
    expect(cellText(new Timestamp({ t: 5, i: 1 }), true)).toBe('{"$timestamp":{"t":5,"i":1}}');
    expect(cellText(new Timestamp({ t: 5, i: 1 }), false)).toBe('{"$timestamp":{"t":5,"i":1}}');
  });

  it('writes an invalid date as Extended JSON instead of throwing', () => {
    expect(() => cellText(new Date(Number.NaN), false)).not.toThrow();
  });
});

describe('convertCell', () => {
  it('string keeps the text exactly, also blank and edge spaces', () => {
    expect(convertCell('  Widget ', 'string')).toBe('  Widget ');
    expect(convertCell('', 'string')).toBe('');
    expect(convertCell('42', 'string')).toBe('42');
  });

  it.each(CSV_TYPES_BUT_STRING())('%s leaves a blank or whitespace-only cell out', (type) => {
    expect(convertCell('', type)).toBeUndefined();
    expect(convertCell('   ', type)).toBeUndefined();
  });

  describe('auto', () => {
    it('reads integers as Int32, larger ones as Int64, beyond that as Double', () => {
      const small = convertCell('42', 'auto');
      expect(small).toBeInstanceOf(Int32);
      expect(canonical(small)).toBe('{"$numberInt":"42"}');
      expect(canonical(convertCell('2147483647', 'auto'))).toBe('{"$numberInt":"2147483647"}');
      expect(canonical(convertCell('-2147483648', 'auto'))).toBe('{"$numberInt":"-2147483648"}');
      expect(canonical(convertCell('2147483648', 'auto'))).toBe('{"$numberLong":"2147483648"}');
      expect(canonical(convertCell('-2147483649', 'auto'))).toBe('{"$numberLong":"-2147483649"}');
      expect(canonical(convertCell('9223372036854775807', 'auto'))).toBe(
        '{"$numberLong":"9223372036854775807"}',
      );
      const huge = convertCell('9223372036854775808', 'auto');
      expect(huge).toBeInstanceOf(Double);
      expect((huge as Double).value).toBe(9223372036854775808);
      expect(canonical(convertCell('+7', 'auto'))).toBe('{"$numberInt":"7"}');
    });

    it('reads other numbers as Double', () => {
      for (const [text, value] of [
        ['1.5', 1.5],
        ['-0.25', -0.25],
        ['.5', 0.5],
        ['3.', 3],
        ['1e3', 1000],
        ['2.5E-2', 0.025],
      ] as const) {
        const result = convertCell(text, 'auto');
        expect(result, text).toBeInstanceOf(Double);
        expect((result as Double).value, text).toBe(value);
      }
    });

    it('reads true and false as Boolean (lower case only)', () => {
      expect(convertCell('true', 'auto')).toBe(true);
      expect(convertCell(' false ', 'auto')).toBe(false);
      expect(convertCell('TRUE', 'auto')).toBe('TRUE');
      expect(convertCell('yes', 'auto')).toBe('yes');
    });

    it('keeps everything else as the string written, untrimmed', () => {
      expect(convertCell(' Widget ', 'auto')).toBe(' Widget ');
      expect(convertCell('1,5', 'auto')).toBe('1,5');
      expect(convertCell('0x10', 'auto')).toBe('0x10');
      expect(convertCell('NaN', 'auto')).toBe('NaN');
      expect(convertCell('1e', 'auto')).toBe('1e');
      expect(convertCell(OID, 'auto')).toBe(OID);
    });
  });

  describe('int', () => {
    it('reads 32-bit integers up to the range edges', () => {
      expect(canonical(convertCell(' 7 ', 'int'))).toBe('{"$numberInt":"7"}');
      expect(canonical(convertCell('2147483647', 'int'))).toBe('{"$numberInt":"2147483647"}');
      expect(canonical(convertCell('-2147483648', 'int'))).toBe('{"$numberInt":"-2147483648"}');
    });

    it('refuses values just outside the range and non-integers', () => {
      expect(() => convertCell('2147483648', 'int')).toThrow(
        new CellError('is out of range for a 32-bit integer'),
      );
      expect(() => convertCell('-2147483649', 'int')).toThrow(/out of range/);
      for (const text of ['1.5', '1e3', 'abc', '1 2', '0x1']) {
        expect(() => convertCell(text, 'int'), text).toThrow(
          new CellError('is not a 32-bit integer'),
        );
      }
    });
  });

  describe('long', () => {
    it('reads 64-bit integers exactly, also small ones, up to the range edges', () => {
      expect(canonical(convertCell('5', 'long'))).toBe('{"$numberLong":"5"}');
      expect(canonical(convertCell('9223372036854775807', 'long'))).toBe(
        '{"$numberLong":"9223372036854775807"}',
      );
      expect(canonical(convertCell('-9223372036854775808', 'long'))).toBe(
        '{"$numberLong":"-9223372036854775808"}',
      );
    });

    it('refuses values just outside the range and non-integers', () => {
      expect(() => convertCell('9223372036854775808', 'long')).toThrow(
        new CellError('is out of range for a 64-bit integer'),
      );
      expect(() => convertCell('-9223372036854775809', 'long')).toThrow(/out of range/);
      expect(() => convertCell('2.0', 'long')).toThrow(new CellError('is not a 64-bit integer'));
    });
  });

  describe('double', () => {
    it('reads integers and decimals as Double', () => {
      expect(canonical(convertCell('3', 'double'))).toBe('{"$numberDouble":"3.0"}');
      expect(canonical(convertCell('-1.25e2', 'double'))).toBe('{"$numberDouble":"-125.0"}');
    });

    it('reads NaN and the infinities', () => {
      expect(canonical(convertCell('NaN', 'double'))).toBe('{"$numberDouble":"NaN"}');
      expect(canonical(convertCell('Infinity', 'double'))).toBe('{"$numberDouble":"Infinity"}');
      expect(canonical(convertCell('+Infinity', 'double'))).toBe('{"$numberDouble":"Infinity"}');
      expect(canonical(convertCell('-Infinity', 'double'))).toBe('{"$numberDouble":"-Infinity"}');
    });

    it('refuses text that is not a number', () => {
      for (const text of ['abc', '1,5', '0x10', 'inf', '--1']) {
        expect(() => convertCell(text, 'double'), text).toThrow(new CellError('is not a number'));
      }
    });
  });

  describe('decimal', () => {
    it('reads decimals exactly, keeping trailing zeros', () => {
      expect(canonical(convertCell('1.10', 'decimal'))).toBe('{"$numberDecimal":"1.10"}');
      expect(canonical(convertCell(' -0.000001 ', 'decimal'))).toBe(
        '{"$numberDecimal":"-0.000001"}',
      );
    });

    it('refuses text that is not a decimal number', () => {
      expect(() => convertCell('abc', 'decimal')).toThrow(new CellError('is not a decimal number'));
    });
  });

  describe('bool', () => {
    it.each(['true', 'TRUE', 'Yes', 'yes', '1', ' true '])('reads %j as true', (text) => {
      expect(convertCell(text, 'bool')).toBe(true);
    });
    it.each(['false', 'False', 'NO', 'no', '0'])('reads %j as false', (text) => {
      expect(convertCell(text, 'bool')).toBe(false);
    });
    it.each(['y', '2', 'on', 'truthy'])('refuses %j', (text) => {
      expect(() => convertCell(text, 'bool')).toThrow(
        new CellError('is not a boolean (true/false)'),
      );
    });
  });

  describe('date', () => {
    it('reads ISO 8601 with a time zone', () => {
      expect(convertCell('2024-02-03T04:05:06.007Z', 'date')).toEqual(
        new Date(Date.UTC(2024, 1, 3, 4, 5, 6, 7)),
      );
      expect(convertCell('2024-02-03T05:05:06+01:00', 'date')).toEqual(
        new Date(Date.UTC(2024, 1, 3, 4, 5, 6)),
      );
      expect(convertCell('2024-02-03', 'date')).toEqual(new Date(Date.UTC(2024, 1, 3)));
    });

    it('reads digits as milliseconds since 1970, negative ones before it', () => {
      expect(convertCell('1706918400000', 'date')).toEqual(new Date(1706918400000));
      expect(convertCell('0', 'date')).toEqual(new Date(0));
      expect(convertCell('-86400000', 'date')).toEqual(new Date(-86400000));
    });

    it('refuses text that is not a date', () => {
      for (const text of ['not a date', '2024-13-45', '99999999999999999']) {
        expect(() => convertCell(text, 'date'), text).toThrow(new CellError('is not a date'));
      }
    });

    it('reads an ISO 8601 date-time without an offset as UTC, whatever the host time zone', () => {
      expect(convertCell('2026-03-01T10:00', 'date')).toEqual(
        new Date(Date.UTC(2026, 2, 1, 10, 0)),
      );
      expect(convertCell('2026-03-01T10:00:30.5', 'date')).toEqual(
        new Date(Date.UTC(2026, 2, 1, 10, 0, 30, 500)),
      );
      expect(convertCell('2026-03-01T10:00:30.123456', 'date')).toEqual(
        new Date(Date.UTC(2026, 2, 1, 10, 0, 30, 123)),
      );
    });

    it.each([
      ['year 10000', Date.UTC(10000, 0, 1)],
      ['year -1', Date.UTC(-1, 11, 31, 23, 59, 59, 999)],
      ['year 0', Date.UTC(0, 5, 15, 12)],
      ['the latest date', 8.64e15],
      ['the earliest date', -8.64e15],
      ['year 9999', Date.UTC(9999, 11, 31, 23, 59, 59, 999)],
    ])('reads back the export text of a date in %s', (_what, millis) => {
      const at = new Date(millis);
      const text = cellText(at, true);
      expect(convertCell(text, 'date'), text).toEqual(at);
    });

    it('reads the extended year form ±YYYYYY', () => {
      expect(convertCell('+010000-01-01T00:00:00.000Z', 'date')).toEqual(
        new Date(Date.UTC(10000, 0, 1)),
      );
      expect(convertCell('-000001-12-31', 'date')).toEqual(new Date(Date.UTC(-1, 11, 31)));
      expect(convertCell('+002026-03-01', 'date')).toEqual(new Date(Date.UTC(2026, 2, 1)));
    });

    it.each([
      '-000000-01-01',
      '010000-01-01',
      '+10000-01-01',
      '+0100000-01-01',
      '+275761-01-01',
      '+275760-09-13T00:00-01:00',
    ])(
      'refuses the year form %j',
      (text) => {
        expect(() => convertCell(text, 'date')).toThrow(new CellError('is not a date'));
      },
    );

    it('reads the offset forms Z, +hh:mm, -hh:mm and +hhmm', () => {
      const at = new Date(Date.UTC(2026, 2, 1, 10, 0));
      expect(convertCell('2026-03-01T10:00:00Z', 'date')).toEqual(at);
      expect(convertCell('2026-03-01T11:30:00+01:30', 'date')).toEqual(at);
      expect(convertCell('2026-03-01T05:00:00-05:00', 'date')).toEqual(at);
      expect(convertCell('2026-03-01T11:00+0100', 'date')).toEqual(at);
    });

    it.each([
      '03/01/2026',
      '2026-03-01 10:00',
      'March 1, 2026',
      'Sun, 01 Mar 2026 10:00:00 GMT',
      '2026-3-1',
      '2026-02-30',
      '2026-03-01T24:00',
      '2026-03-01T10:60',
      '2026-03-01T10:00:60',
      '2026-03-01T10:00+24:00',
      '2026-03-01T10',
      '2026-03-01Z',
      '1.5',
    ])('refuses %j, which is neither ISO 8601 nor epoch millis', (text) => {
      expect(() => convertCell(text, 'date')).toThrow(new CellError('is not a date'));
    });

    it('accepts February 29 in a leap year only', () => {
      expect(convertCell('2024-02-29', 'date')).toEqual(new Date(Date.UTC(2024, 1, 29)));
      expect(convertCell('2000-02-29T12:00Z', 'date')).toEqual(new Date(Date.UTC(2000, 1, 29, 12)));
      for (const text of ['2025-02-29', '1900-02-29', '2026-04-31', '2026-00-10', '2026-01-00']) {
        expect(() => convertCell(text, 'date'), text).toThrow(new CellError('is not a date'));
      }
    });

    it('accepts the last valid time parts and refuses an offset minute of 60', () => {
      expect(convertCell('2026-12-31T23:59:59.999Z', 'date')).toEqual(
        new Date(Date.UTC(2026, 11, 31, 23, 59, 59, 999)),
      );
      expect(convertCell('2026-03-01T10:00+23:59', 'date')).toEqual(
        new Date(Date.UTC(2026, 2, 1, 10, 0) - (23 * 60 + 59) * 60_000),
      );
      for (const text of ['2026-03-01T10:00+01:60', '2026-03-01T10:00-0060']) {
        expect(() => convertCell(text, 'date'), text).toThrow(new CellError('is not a date'));
      }
    });

    it('an offset may move the instant to another UTC day or year', () => {
      expect(convertCell('2026-01-01T00:30+01:00', 'date')).toEqual(
        new Date(Date.UTC(2025, 11, 31, 23, 30)),
      );
      expect(convertCell('2025-12-31T22:00-0300', 'date')).toEqual(
        new Date(Date.UTC(2026, 0, 1, 1, 0)),
      );
    });

    it('reads a comma as the decimal sign of the seconds fraction', () => {
      expect(convertCell('2026-03-01T10:00:30,25Z', 'date')).toEqual(
        new Date(Date.UTC(2026, 2, 1, 10, 0, 30, 250)),
      );
    });

    it('reads years below 100 as written (no 19xx shift)', () => {
      const expected = new Date(0);
      expected.setUTCFullYear(99, 0, 1);
      expect(convertCell('0099-01-01', 'date')).toEqual(expected);
      expect((convertCell('0001-06-15T00:00Z', 'date') as Date).getUTCFullYear()).toBe(1);
    });

    it('trims spaces around a date cell', () => {
      expect(convertCell('  2026-03-01T10:00Z \t', 'date')).toEqual(
        new Date(Date.UTC(2026, 2, 1, 10, 0)),
      );
    });

    it('accepts epoch millis up to the largest JavaScript date and refuses one beyond', () => {
      expect(convertCell('8640000000000000', 'date')).toEqual(new Date(8.64e15));
      expect(convertCell('-8640000000000000', 'date')).toEqual(new Date(-8.64e15));
      expect(() => convertCell('8640000000000001', 'date')).toThrow(new CellError('is not a date'));
    });

    it('gives the same instant whatever the host time zone says', () => {
      // The parser only uses UTC methods; a local-time parse would differ by the host offset.
      const original = process.env['TZ'];
      try {
        const results = ['UTC', 'America/New_York', 'Asia/Kolkata'].map((tz) => {
          process.env['TZ'] = tz;
          return (convertCell('2026-07-01T08:00', 'date') as Date).getTime();
        });
        expect(new Set(results).size).toBe(1);
        expect(results[0]).toBe(Date.UTC(2026, 6, 1, 8));
      } finally {
        if (original === undefined) delete process.env['TZ'];
        else process.env['TZ'] = original;
      }
    });
  });

  describe('objectId', () => {
    it('reads 24 hex digits in either case', () => {
      expect(convertCell(` ${OID} `, 'objectId')).toEqual(new ObjectId(OID));
      expect(convertCell(OID.toUpperCase(), 'objectId')).toEqual(new ObjectId(OID));
    });

    it('refuses other lengths and non-hex text', () => {
      for (const text of [
        OID.slice(1),
        `${OID}0`,
        `${OID.slice(1)}g`,
        'abcdefabcdefabcdefabcdeZ',
      ]) {
        expect(() => convertCell(text, 'objectId'), text).toThrow(
          new CellError('is not an ObjectId (24 hex digits)'),
        );
      }
    });
  });

  describe('json', () => {
    it('reads canonical and relaxed Extended JSON values of any type', () => {
      expect(canonical(convertCell('[1,"a",{"$oid":"' + OID + '"}]', 'json'))).toBe(
        `[{"$numberInt":"1"},"a",{"$oid":"${OID}"}]`,
      );
      expect(canonical(convertCell('{"a":{"$numberLong":"5"}}', 'json'))).toBe(
        '{"a":{"$numberLong":"5"}}',
      );
      expect(convertCell('"text"', 'json')).toBe('text');
      expect(convertCell('null', 'json')).toBeNull();
    });

    it('refuses text that is not valid Extended JSON', () => {
      for (const text of ['{a:1}', "'x'", '{"$oid":"nope"}', '[1,']) {
        expect(() => convertCell(text, 'json'), text).toThrow(
          new CellError('is not valid Extended JSON'),
        );
      }
    });
  });
});

/** Every CSV type except `string`, for it.each. */
function CSV_TYPES_BUT_STRING(): CsvType[] {
  return ['auto', 'int', 'long', 'double', 'decimal', 'bool', 'date', 'objectId', 'json'];
}

describe('resolveMapping', () => {
  const header = ['name', 'qty', '', 'city', 'note'];

  it('without a mapping imports every named column under its name as auto', () => {
    expect(resolveMapping(['name', 'qty', '', '  ', 'city'], undefined)).toEqual([
      { index: 0, column: 'name', path: ['name'], type: 'auto' },
      { index: 1, column: 'qty', path: ['qty'], type: 'auto' },
      { index: 4, column: 'city', path: ['city'], type: 'auto' },
    ]);
  });

  it('without a mapping leaves out repeated, overlapping and invalid names (never throws)', () => {
    expect(
      resolveMapping(['a', 'a', 'a.b', 'x.', '.y', 'c.d', 'c', 'cd', 'n'], undefined).map((c) => [
        c.index,
        c.column,
      ]),
    ).toEqual([
      [0, 'a'],
      [5, 'c.d'],
      [7, 'cd'],
      [8, 'n'],
    ]);
    expect(defaultMapping(['a', 'a', 'a.b'])).toEqual([
      { index: 0, column: 'a', path: ['a'], type: 'auto' },
    ]);
  });

  it('the default skips a parent name after its nested names, and takes a name after an invalid one', () => {
    expect(defaultMapping(['a.b', 'a.c', 'a', 'a.b.c']).map((c) => c.column)).toEqual([
      'a.b',
      'a.c',
    ]);
    // `x.` is left out, so it takes nothing away from `x`.
    expect(defaultMapping(['x.', 'x', 'x.y'])).toEqual([
      { index: 1, column: 'x', path: ['x'], type: 'auto' },
    ]);
    expect(defaultMapping([])).toEqual([]);
  });

  it('a unique name may be given with its index, and an unnamed column by its index', () => {
    expect(
      resolveMapping(header, [
        { column: 'qty', index: 1, path: 'qty', bsonType: 'int' },
        { column: '', index: 2, path: 'unnamed', bsonType: 'string' },
      ]),
    ).toEqual([
      { index: 1, column: 'qty', path: ['qty'], type: 'int' },
      { index: 2, column: '', path: ['unnamed'], type: 'string' },
    ]);
  });

  it('both columns of a repeated name can be imported, each by its index', () => {
    const repeated = ['name', 'qty', 'name'];
    const columns = resolveMapping(repeated, [
      { column: 'name', index: 0, path: 'first', bsonType: 'string' },
      { column: 'name', index: 2, path: 'second', bsonType: 'string' },
    ]);
    expect(recordToDocument(['Ann', '3', 'Bob'], 2, repeated, columns)).toEqual({
      first: 'Ann',
      second: 'Bob',
    });
  });

  it('a repeated header name is chosen by its index, and refused by its name alone', () => {
    const repeated = ['name', 'qty', 'name'];
    expect(
      resolveMapping(repeated, [{ column: 'name', index: 2, path: 'alias', bsonType: 'string' }]),
    ).toEqual([{ index: 2, column: 'name', path: ['alias'], type: 'string' }]);
    expect(
      rpcError(() => resolveMapping(repeated, [{ column: 'name', path: 'n', bsonType: 'auto' }]))
        .message,
    ).toBe('The file has more than one column "name": choose one by its index');
  });

  it('refuses an index that does not hold the named column', () => {
    expect(
      rpcError(() =>
        resolveMapping(header, [{ column: 'name', index: 1, path: 'n', bsonType: 'auto' }]),
      ).message,
    ).toBe('The file has no column "name" at index 1');
    expect(
      rpcError(() =>
        resolveMapping(header, [{ column: 'name', index: 9, path: 'n', bsonType: 'auto' }]),
      ).message,
    ).toBe('The file has no column "name" at index 9');
  });

  it('maps named columns to dotted paths and types, in the mapping order', () => {
    expect(
      resolveMapping(header, [
        { column: 'city', path: 'address.city', bsonType: 'string' },
        { column: 'qty', path: 'stock.qty', bsonType: 'int' },
      ]),
    ).toEqual([
      { index: 3, column: 'city', path: ['address', 'city'], type: 'string' },
      { index: 1, column: 'qty', path: ['stock', 'qty'], type: 'int' },
    ]);
  });

  it('an empty name can be mapped', () => {
    expect(
      resolveMapping(header, [
        { column: 'name', path: 'title', bsonType: 'auto' },
        { column: '', path: 'unnamed', bsonType: 'auto' },
      ]),
    ).toEqual([
      { index: 0, column: 'name', path: ['title'], type: 'auto' },
      { index: 2, column: '', path: ['unnamed'], type: 'auto' },
    ]);
  });

  function rpcError(fn: () => unknown): RpcError {
    const error = thrown(fn);
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: 'INVALID_PARAMS' });
    return error as RpcError;
  }

  it('refuses a column the file does not have', () => {
    expect(
      rpcError(() => resolveMapping(header, [{ column: 'price', path: 'p', bsonType: 'auto' }]))
        .message,
    ).toBe('The file has no column "price"');
  });

  it.each(['a.', '.a', 'a..b', '.'])('refuses the path %j with an empty segment', (path) => {
    expect(
      rpcError(() => resolveMapping(header, [{ column: 'name', path, bsonType: 'auto' }])).message,
    ).toBe(`Field path ${JSON.stringify(path)} is not valid`);
  });

  it('refuses a path used twice', () => {
    expect(
      rpcError(() =>
        resolveMapping(header, [
          { column: 'name', path: 'x', bsonType: 'auto' },
          { column: 'qty', path: 'x', bsonType: 'int' },
        ]),
      ).message,
    ).toBe('Field path "x" is used twice');
  });

  it('refuses a path that is the prefix of another, in either order', () => {
    const overlap = (first: string, second: string) =>
      rpcError(() =>
        resolveMapping(header, [
          { column: 'name', path: first, bsonType: 'auto' },
          { column: 'qty', path: second, bsonType: 'auto' },
        ]),
      ).message;
    expect(overlap('a', 'a.b')).toBe('Field paths "a" and "a.b" overlap');
    expect(overlap('a.b.c', 'a.b')).toBe('Field paths "a.b" and "a.b.c" overlap');
  });

  it('does not take a shared name start for an overlap', () => {
    expect(
      resolveMapping(header, [
        { column: 'name', path: 'a.b', bsonType: 'auto' },
        { column: 'qty', path: 'a.bc', bsonType: 'auto' },
        { column: 'city', path: 'ab', bsonType: 'auto' },
      ]),
    ).toHaveLength(3);
  });

  it('the same column may be imported under two paths', () => {
    expect(
      resolveMapping(header, [
        { column: 'qty', path: 'asText', bsonType: 'string' },
        { column: 'qty', path: 'asInt', bsonType: 'int' },
      ]).map((c) => c.index),
    ).toEqual([1, 1]);
  });
});

describe('recordToDocument', () => {
  const header = ['name', 'qty', 'city', 'zip', 'tags'];
  const columns: CsvColumnMapping[] = resolveMapping(header, [
    { column: 'name', path: 'name', bsonType: 'string' },
    { column: 'qty', path: 'qty', bsonType: 'int' },
    { column: 'city', path: 'address.city', bsonType: 'auto' },
    { column: 'zip', path: 'address.zip', bsonType: 'string' },
    { column: 'tags', path: 'tags', bsonType: 'json' },
  ]);

  it('builds nested documents with the typed values in mapping order', () => {
    const doc = recordToDocument(
      ['Widget', '3', 'Springfield', '01234', '["a"]'],
      2,
      header,
      columns,
    );
    expect(canonical(doc)).toBe(
      '{"name":"Widget","qty":{"$numberInt":"3"},' +
        '"address":{"city":"Springfield","zip":"01234"},"tags":["a"]}',
    );
  });

  it('leaves blank cells out (but string keeps them) and fills a short record with blanks', () => {
    const doc = recordToDocument(['', ' ', ''], 5, header, columns);
    // name is a string column: kept as ""; qty and city are blank; zip and tags are missing.
    expect(canonical(doc)).toBe('{"name":"","address":{"zip":""}}');
  });

  it('a record of no named values gives an empty document', () => {
    const only = resolveMapping(header, [{ column: 'qty', path: 'qty', bsonType: 'int' }]);
    expect(recordToDocument([], 9, header, only)).toEqual({});
  });

  it('refuses a record with more cells than the header, naming the line', () => {
    const error = thrown(() =>
      recordToDocument(['a', '1', 'c', 'z', '[]', 'extra'], 7, header, columns),
    );
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({
      code: 'INVALID_PARAMS',
      message: 'Line 7: 6 cells, the header has 5',
    });
  });

  it('accepts a record with exactly as many cells as the header', () => {
    expect(() => recordToDocument(['a', '1', 'c', 'z', '[]'], 7, header, columns)).not.toThrow();
  });

  it('refuses a cell that is no value of its type, naming line, column and cell', () => {
    const error = thrown(() => recordToDocument(['Widget', 'many'], 4, header, columns));
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({
      code: 'INVALID_PARAMS',
      message: 'Line 4: column "qty": "many" is not a 32-bit integer',
    });
  });

  it('shortens a long bad cell in the message to 40 characters', () => {
    const long = 'x'.repeat(41);
    const error = thrown(() => recordToDocument(['Widget', long], 4, header, columns));
    expect((error as Error).message).toBe(
      `Line 4: column "qty": ${JSON.stringify(`${'x'.repeat(40)}…`)} is not a 32-bit integer`,
    );
    const exact = 'y'.repeat(40);
    const error40 = thrown(() => recordToDocument(['Widget', exact], 4, header, columns));
    expect((error40 as Error).message).toContain(JSON.stringify(exact));
  });

  it('sets a field named __proto__ as an own field, never the prototype', () => {
    const h = ['p', 'q'];
    const cols = resolveMapping(h, [
      { column: 'p', path: '__proto__.polluted', bsonType: 'string' },
      { column: 'q', path: 'constructor', bsonType: 'string' },
    ]);
    const doc = recordToDocument(['yes', 'c'], 2, h, cols);
    expect(Object.hasOwn(doc, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(doc)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.keys(doc)).toEqual(['__proto__', 'constructor']);
    expect(Object.hasOwn(doc['__proto__'] as Document, 'polluted')).toBe(true);
    // The BSON serializer writes it as an ordinary field.
    expect(BSON.deserialize(BSON.serialize(doc))).toMatchObject({ constructor: 'c' });
    expect(canonical(BSON.deserialize(BSON.serialize(doc)))).toBe(
      '{"__proto__":{"polluted":"yes"},"constructor":"c"}',
    );
  });

  it('a top-level __proto__ field holds the value', () => {
    const h = ['p'];
    const cols = resolveMapping(h, [{ column: 'p', path: '__proto__', bsonType: 'int' }]);
    const doc = recordToDocument(['1'], 2, h, cols);
    expect(Object.hasOwn(doc, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(doc)).toBe(Object.prototype);
  });
});
