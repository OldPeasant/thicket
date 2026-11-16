import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BSON_TYPES,
  parseEJsonDocument,
  type BsonDocument,
  type BsonValue,
} from '@thicket/core/bson';
import { ALL_TYPES_EJSON } from '@thicket/core/testing';
import { describe, expect, it } from 'vitest';
import { ProblemIndex } from '../schema';
import {
  BsonLeaf,
  badgeColorVar,
  badgeOf,
  bsonTypeOf,
  displayText,
  formatDate,
  fromExplorerValue,
  isBsonLeaf,
  isContainer,
  isDeprecatedValue,
  toExplorerValue,
} from './bson-value.util';
import { defaultForType, typeOf } from './json-edit.util';
import { shapeOf } from './json-lines.util';
import { defaultLayout } from './layout.util';
import { outlineRows } from './outline/outline.util';

const leaf = (v: BsonValue) => new BsonLeaf(v as never);
const long = (v: bigint) => leaf({ type: 'long', value: v });
const date = (ms: bigint) => leaf({ type: 'date', ms });
const bin = (subtype: number, base64: string) => leaf({ type: 'binary', subtype, base64 });
const doc = (...fields: [string, BsonValue][]): BsonDocument => ({
  type: 'object',
  fields: fields.map(([key, value]) => ({ key, value })),
});
const str = (value: string): BsonValue => ({ type: 'string', value });
const int = (value: number): BsonValue => ({ type: 'int', value });

// 16 bytes; subtype 4 makes it the UUID 0f8fad5b-d9cb-469f-a165-70867728950e.
const UUID_B64 = 'D4+tW9nLRp+hZXCGdyiVDg==';

describe('toExplorerValue / fromExplorerValue', () => {
  it('round-trips the all-types fixture unchanged', () => {
    const model = parseEJsonDocument(ALL_TYPES_EJSON);
    expect(fromExplorerValue(toExplorerValue(model))).toEqual(model);
  });

  it('turns documents, arrays, strings, booleans and null into plain JS values', () => {
    const tree = toExplorerValue(
      doc(
        ['s', str('x')],
        ['b', { type: 'bool', value: false }],
        ['n', { type: 'null' }],
        ['a', { type: 'array', items: [str('y'), doc()] }],
      ),
    );
    expect(tree).toEqual({ s: 'x', b: false, n: null, a: ['y', {}] });
    expect(Object.getPrototypeOf(tree)).toBe(Object.prototype);
  });

  it('wraps every other BSON value in a frozen leaf holding the model value itself', () => {
    const value: BsonValue = { type: 'long', value: 9007199254740993n };
    const out = toExplorerValue(value);
    expect(isBsonLeaf(out)).toBe(true);
    expect((out as BsonLeaf).bson).toBe(value);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('keeps a "__proto__" key as an own key and round-trips it', () => {
    const model = doc(['__proto__', doc(['polluted', str('yes')])], ['x', int(1)]);
    const tree = toExplorerValue(model) as Record<string, unknown>;
    expect(Object.getPrototypeOf(tree)).toBe(Object.prototype);
    expect(Object.keys(tree)).toEqual(['__proto__', 'x']);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(fromExplorerValue(tree)).toEqual(model);
  });

  it('lists integer-like keys first and keeps the last value of a repeated key', () => {
    const tree = toExplorerValue(doc(['b', int(1)], ['2', int(2)], ['b', int(3)]));
    expect(Object.keys(tree as object)).toEqual(['2', 'b']);
    expect(displayText((tree as Record<string, unknown>)['b'])).toBe('3');
  });

  it('maps typed-in JS numbers to Int32 when they fit, Double otherwise', () => {
    expect(fromExplorerValue(42)).toEqual({ type: 'int', value: 42 });
    expect(fromExplorerValue(-2147483648)).toEqual({ type: 'int', value: -2147483648 });
    expect(fromExplorerValue(2147483647)).toEqual({ type: 'int', value: 2147483647 });
    expect(fromExplorerValue(2147483648)).toEqual({ type: 'double', value: 2147483648 });
    expect(fromExplorerValue(-2147483649)).toEqual({ type: 'double', value: -2147483649 });
    expect(fromExplorerValue(1.5)).toEqual({ type: 'double', value: 1.5 });
    expect(Object.is((fromExplorerValue(-0) as { value: number }).value, -0)).toBe(true);
    expect(fromExplorerValue(-0).type).toBe('double');
    expect(fromExplorerValue(Number.NaN).type).toBe('double');
  });

  // CR-3: plain numbers (unedited schema seeds) follow the defaultIntegerType setting.
  it('maps plain JS numbers by the integer default it is given, also when nested', () => {
    expect(fromExplorerValue(5, 'int32')).toEqual({ type: 'int', value: 5 });
    expect(fromExplorerValue(5, 'int64')).toEqual({ type: 'long', value: 5n });
    expect(fromExplorerValue(5, 'double')).toEqual({ type: 'double', value: 5 });
    expect(fromExplorerValue(2 ** 40, 'int64')).toEqual({ type: 'long', value: 2n ** 40n });
    expect(fromExplorerValue(1.5, 'int64')).toEqual({ type: 'double', value: 1.5 });
    expect(fromExplorerValue({ a: [7] }, 'double')).toEqual({
      type: 'object',
      fields: [{ key: 'a', value: { type: 'array', items: [{ type: 'double', value: 7 }] } }],
    });
    const kept = new BsonLeaf({ type: 'int', value: 3 });
    expect(fromExplorerValue([kept], 'double')).toEqual({
      type: 'array',
      items: [{ type: 'int', value: 3 }],
    });
  });

  // Round 2: the edges of the integer default.
  it('maps unsafe, -0 and non-finite numbers to Double under every integer default', () => {
    for (const integers of ['int32', 'int64', 'double'] as const) {
      expect(fromExplorerValue(2 ** 53 + 2, integers).type).toBe('double');
      expect(fromExplorerValue(-0, integers).type).toBe('double');
      expect(fromExplorerValue(Infinity, integers).type).toBe('double');
    }
    expect(fromExplorerValue(2 ** 31, 'int32')).toEqual({ type: 'double', value: 2 ** 31 });
    expect(fromExplorerValue(-(2 ** 31), 'int64')).toEqual({
      type: 'long',
      value: -(2n ** 31n),
    });
  });

  it('maps undefined to null and rejects values that are not explorer values', () => {
    expect(fromExplorerValue(undefined)).toEqual({ type: 'null' });
    expect(() => fromExplorerValue(() => 1)).toThrow(TypeError);
    expect(() => fromExplorerValue(Symbol('s'))).toThrow(TypeError);
    expect(() => fromExplorerValue(1n)).toThrow(TypeError);
  });
});

describe('BsonLeaf#toJSON', () => {
  it('serializes as canonical EJSON v2, exact for Int64, Decimal128 and Date', () => {
    const tree = toExplorerValue(
      parseEJsonDocument(
        '{"l":{"$numberLong":"9007199254740993"},' +
          '"d":{"$numberDecimal":"1234567890123456789012345678901234"},' +
          '"t":{"$date":{"$numberLong":"9223372036854775807"}},"s":"x"}',
      ),
    );
    expect(JSON.parse(JSON.stringify(tree))).toEqual({
      l: { $numberLong: '9007199254740993' },
      d: { $numberDecimal: '1234567890123456789012345678901234' },
      t: { $date: { $numberLong: '9223372036854775807' } },
      s: 'x',
    });
  });
});

describe('bsonTypeOf / isContainer / isDeprecatedValue', () => {
  it('names the BSON type of plain JS values and leaves', () => {
    expect(bsonTypeOf(null)).toBe('null');
    expect(bsonTypeOf(undefined)).toBe('null');
    expect(bsonTypeOf('s')).toBe('string');
    expect(bsonTypeOf(true)).toBe('bool');
    expect(bsonTypeOf(7)).toBe('int');
    expect(bsonTypeOf(2 ** 31)).toBe('double');
    expect(bsonTypeOf(0.5)).toBe('double');
    expect(bsonTypeOf([])).toBe('array');
    expect(bsonTypeOf({})).toBe('object');
    expect(bsonTypeOf(long(1n))).toBe('long');
  });

  it('treats leaves as scalars, plain objects and arrays as containers', () => {
    expect(isContainer({})).toBe(true);
    expect(isContainer([])).toBe(true);
    expect(isContainer(long(1n))).toBe(false);
    expect(isContainer(null)).toBe(false);
    expect(isContainer('x')).toBe(false);
  });

  it('flags only Undefined, Symbol, DBPointer and Code with scope as deprecated', () => {
    const tree = toExplorerValue(parseEJsonDocument(ALL_TYPES_EJSON)) as Record<string, unknown>;
    const deprecated = Object.keys(tree).filter((k) => isDeprecatedValue(tree[k]));
    expect(deprecated.sort()).toEqual(['codeWithScope', 'dbPointer', 'symbol', 'undefined']);
    expect(isDeprecatedValue(undefined)).toBe(false);
  });
});

describe('badgeOf', () => {
  it('shows the Binary subtype in hex', () => {
    expect(badgeOf(bin(0, 'AQID'))).toEqual({
      type: 'binary',
      label: 'Binary 0x00',
      title: 'Binary subtype 0x00',
    });
    expect(badgeOf(bin(3, UUID_B64)).label).toBe('Binary 0x03');
    expect(badgeOf(bin(0x80, '/w==')).label).toBe('Binary 0x80');
    expect(badgeOf(bin(255, '')).label).toBe('Binary 0xff');
  });

  it('shows UUID for subtype 4 with 16 bytes, Binary 0x04 for other lengths', () => {
    expect(badgeOf(bin(4, UUID_B64))).toEqual({
      type: 'binary',
      label: 'UUID',
      title: 'Binary subtype 0x04 (UUID)',
    });
    expect(badgeOf(bin(4, 'AQID')).label).toBe('Binary 0x04');
    expect(badgeOf(bin(4, '')).label).toBe('Binary 0x04');
  });

  it('labels plain JS values by their BSON type', () => {
    expect(badgeOf('s').label).toBe('String');
    expect(badgeOf(1).label).toBe('Int32');
    expect(badgeOf(1.5).label).toBe('Double');
    expect(badgeOf(null).label).toBe('Null');
    expect(badgeOf(false).label).toBe('Boolean');
    expect(badgeOf({}).label).toBe('Object');
    expect(badgeOf([]).label).toBe('Array');
  });

  it('marks deprecated types read-only in the tooltip', () => {
    expect(badgeOf(leaf({ type: 'symbol', value: 's' })).title).toBe(
      'Symbol (deprecated BSON type, read-only)',
    );
    expect(badgeOf(long(1n)).title).toBe('Int64');
  });
});

describe('badgeColorVar', () => {
  it('names the kebab-case --bson token, bin-data for Binary', () => {
    expect(badgeColorVar('objectId')).toBe('var(--bson-object-id)');
    expect(badgeColorVar('binary')).toBe('var(--bson-bin-data)');
    expect(badgeColorVar('minKey')).toBe('var(--bson-min-key)');
    expect(badgeColorVar('long')).toBe('var(--bson-long)');
  });

  it('colors Code with scope with the Code token', () => {
    expect(badgeColorVar('javascriptWithScope')).toBe('var(--bson-javascript)');
    expect(badgeColorVar('javascript')).toBe('var(--bson-javascript)');
  });

  it('only names tokens every theme defines', () => {
    // `ng test` runs from the workspace folder (packages/renderer).
    const css = readFileSync(join(process.cwd(), 'src', 'app', 'theme', 'tokens.css'), 'utf8');
    const defined = new Set([...css.matchAll(/(--bson-[a-z-]+)\s*:/g)].map((m) => m[1]));
    const missing = BSON_TYPES.map((t) => [t, /var\((.*)\)/.exec(badgeColorVar(t))?.[1]])
      .filter(([, token]) => !defined.has(token))
      .map(([t, token]) => `${t} -> ${token}`);
    expect(missing).toEqual([]);
  });
});

describe('displayText', () => {
  const text = (ejson: string) =>
    displayText(
      (toExplorerValue(parseEJsonDocument(`{"v":${ejson}}`)) as Record<string, unknown>)['v'],
      { utc: true },
    );

  it('shows Int64 and Decimal128 exactly', () => {
    expect(text('{"$numberLong":"9007199254740993"}')).toBe('9007199254740993');
    expect(text('{"$numberLong":"-9223372036854775808"}')).toBe('-9223372036854775808');
    expect(text('{"$numberDecimal":"1234567890123456789012345678901234"}')).toBe(
      '1234567890123456789012345678901234',
    );
    expect(text('{"$numberDecimal":"-0.1234567890123456789012345678901234"}')).toBe(
      '-0.1234567890123456789012345678901234',
    );
    expect(text('{"$numberDecimal":"0.00100"}')).toBe('0.00100');
  });

  it('shows Double edge values', () => {
    expect(text('{"$numberDouble":"-0.0"}')).toBe('-0');
    expect(text('{"$numberDouble":"Infinity"}')).toBe('Infinity');
    expect(text('{"$numberDouble":"5e-324"}')).toBe('5e-324');
    expect(displayText(-0)).toBe('-0');
    expect(displayText(1.5)).toBe('1.5');
  });

  it('shows every other type', () => {
    expect(text('{"$numberInt":"-2147483648"}')).toBe('-2147483648');
    expect(text('{"$oid":"5f1d7a3e9c1b2a0012345678"}')).toBe('5f1d7a3e9c1b2a0012345678');
    expect(text(`{"$binary":{"base64":"${UUID_B64}","subType":"04"}}`)).toBe(
      '0f8fad5b-d9cb-469f-a165-70867728950e',
    );
    expect(text('{"$binary":{"base64":"AQID","subType":"04"}}')).toBe('AQID');
    expect(text('{"$binary":{"base64":"","subType":"00"}}')).toBe('');
    expect(text('{"$regularExpression":{"pattern":"a/b","options":"i"}}')).toBe('/a/b/i');
    expect(text('{"$timestamp":{"t":0,"i":0}}')).toBe('Timestamp(0, 0)');
    expect(text('{"$code":"x()"}')).toBe('x()');
    expect(text('{"$code":"x + 1","$scope":{"x":{"$numberInt":"1"}}}')).toBe(
      'x + 1 with scope {"x":{"$numberInt":"1"}}',
    );
    expect(text('{"$symbol":"sym"}')).toBe('sym');
    expect(
      text('{"$dbPointer":{"$ref":"db.coll","$id":{"$oid":"5f1d7a3e9c1b2a0012345679"}}}'),
    ).toBe('DBPointer(db.coll, 5f1d7a3e9c1b2a0012345679)');
    expect(text('{"$undefined":true}')).toBe('undefined');
    expect(text('{"$minKey":1}')).toBe('MinKey');
    expect(text('{"$maxKey":1}')).toBe('MaxKey');
    expect(text('{"$date":{"$numberLong":"0"}}')).toBe('1970-01-01T00:00:00.000Z');
  });

  it('shows plain JS scalars and null', () => {
    expect(displayText('a b')).toBe('a b');
    expect(displayText(true)).toBe('true');
    expect(displayText(null)).toBe('null');
    expect(displayText(undefined)).toBe('null');
  });

  it('formats string, bool and null leaves, should a caller wrap them', () => {
    expect(displayText(leaf({ type: 'string', value: 's' }))).toBe('s');
    expect(displayText(leaf({ type: 'bool', value: true }))).toBe('true');
    expect(displayText(leaf({ type: 'null' }))).toBe('null');
  });

  it('formats dates in local time by default', () => {
    expect(displayText(date(1700000000000n), { utc: false, timeZone: 'Asia/Tokyo' })).toBe(
      '2023-11-15T07:13:20.000+09:00 Asia/Tokyo',
    );
  });
});

describe('formatDate', () => {
  const local = (ms: bigint, timeZone: string) => formatDate(ms, { utc: false, timeZone });
  const utc = (ms: bigint) => formatDate(ms, { utc: true });

  it('shows UTC as ISO-8601 with Z', () => {
    expect(utc(1700000000000n)).toBe('2023-11-14T22:13:20.000Z');
    expect(utc(-1n)).toBe('1969-12-31T23:59:59.999Z');
  });

  it('shows local time with the offset and zone, standard and summer time', () => {
    expect(local(1700000000000n, 'Europe/Zurich')).toBe(
      '2023-11-14T23:13:20.000+01:00 Europe/Zurich',
    );
    expect(local(1690000000123n, 'Europe/Zurich')).toBe(
      '2023-07-22T06:26:40.123+02:00 Europe/Zurich',
    );
  });

  it('shows negative and fractional-hour offsets', () => {
    expect(local(1700000000000n, 'America/New_York')).toBe(
      '2023-11-14T17:13:20.000-05:00 America/New_York',
    );
    expect(local(0n, 'America/St_Johns')).toBe('1969-12-31T20:30:00.000-03:30 America/St_Johns');
    expect(local(0n, 'Asia/Kathmandu')).toBe('1970-01-01T05:30:00.000+05:30 Asia/Kathmandu');
    expect(local(0n, 'UTC')).toBe('1970-01-01T00:00:00.000+00:00 UTC');
  });

  it('keeps the milliseconds of dates before 1970', () => {
    expect(local(-1n, 'Europe/Zurich')).toBe('1970-01-01T00:59:59.999+01:00 Europe/Zurich');
    expect(local(-1n, 'America/New_York')).toBe('1969-12-31T18:59:59.999-05:00 America/New_York');
  });

  it('shows local mean time offsets with seconds (year 0001)', () => {
    // 0001-01-01T00:00:00Z: before standard time zones, Zurich was 0:34:08 ahead of UTC.
    expect(local(-62135596800000n, 'Europe/Zurich')).toBe(
      '0001-01-01T00:34:08.000+00:34:08 Europe/Zurich',
    );
    // New York LMT is -4:56:02, which puts the wall clock in year 0 (1 BC).
    expect(local(-62135596800000n, 'America/New_York')).toBe(
      '0000-12-31T19:03:58.000-04:56:02 America/New_York',
    );
  });

  it('uses the system time zone when none is given', () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(formatDate(0n, { utc: false })).toBe(local(0n, zone));
  });

  it('shows milliseconds since 1970 for dates beyond the JS date range', () => {
    expect(utc(9223372036854775807n)).toBe('9223372036854775807 ms since 1970 (out of date range)');
    expect(local(-9223372036854775808n, 'Europe/Zurich')).toBe(
      '-9223372036854775808 ms since 1970 (out of date range)',
    );
    expect(utc(8640000000000001n)).toBe('8640000000000001 ms since 1970 (out of date range)');
    expect(utc(-8640000000000001n)).toBe('-8640000000000001 ms since 1970 (out of date range)');
  });

  it('shows the JS date range limits in UTC', () => {
    expect(utc(8640000000000000n)).toBe('+275760-09-13T00:00:00.000Z');
    expect(utc(-8640000000000000n)).toBe('-271821-04-20T00:00:00.000Z');
  });

  // The local wall clock of a date near the JS limits can lie outside the JS
  // range (e.g. +02:00 at the upper limit); the date must still be shown, not
  // throw while the explorer renders it.
  it('shows the upper JS date limit in a zone ahead of UTC without throwing', () => {
    expect(() => local(8640000000000000n, 'Europe/Zurich')).not.toThrow();
  });

  it('shows the lower JS date limit in a zone behind UTC without throwing', () => {
    expect(() => local(-8640000000000000n, 'America/New_York')).not.toThrow();
  });

  it('falls back to UTC when the local wall clock lies outside the JS date range', () => {
    expect(local(8640000000000000n, 'Europe/Zurich')).toBe('+275760-09-13T00:00:00.000Z');
    expect(local(-8640000000000000n, 'America/New_York')).toBe('-271821-04-20T00:00:00.000Z');
    // One second below the limit: any zone ahead of UTC still passes the limit.
    expect(local(8639999999999000n, 'Asia/Tokyo')).toBe('+275760-09-12T23:59:59.000Z');
    // Behind UTC at the upper limit, the wall clock is in range: local time is shown.
    expect(local(8640000000000000n, 'America/New_York')).toMatch(
      /^\+275760-09-12T\d\d:\d\d:\d\d\.000-\d\d:\d\d(:\d\d)? America\/New_York$/,
    );
  });

  it('gives the same text when zones and the UTC mode alternate between calls', () => {
    // Formatters are cached per zone; reusing them must not leak one zone into another.
    const zones = ['Europe/Zurich', 'America/New_York', 'Asia/Kathmandu', 'Europe/Zurich'];
    const dates = [1700000000000n, 1690000000123n, -1n, 0n];
    const first = zones.flatMap((z) => dates.map((d) => local(d, z)));
    const utcTexts = dates.map(utc);
    const second = zones.flatMap((z) => dates.map((d) => local(d, z)));
    expect(second).toEqual(first);
    expect(dates.map(utc)).toEqual(utcTexts);
    expect(first[0]).toBe('2023-11-14T23:13:20.000+01:00 Europe/Zurich');
    expect(first[4]).toBe('2023-11-14T17:13:20.000-05:00 America/New_York');
    expect(first[1]).toBe('2023-07-22T06:26:40.123+02:00 Europe/Zurich');
    expect(first[12]).toBe(first[0]);
    // The same zone with and without a time zone option resolves to the same output.
    const system = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(formatDate(1700000000000n, { utc: false })).toBe(local(1700000000000n, system));
    expect(local(1700000000000n, 'Asia/Tokyo')).toBe('2023-11-15T07:13:20.000+09:00 Asia/Tokyo');
    expect(formatDate(1700000000000n, { utc: false })).toBe(local(1700000000000n, system));
  });

  it('shows dates near the JS limits whose wall clock stays in range', () => {
    expect(local(-8640000000000000n, 'Asia/Tokyo')).toBe(
      '-271821-04-20T09:18:59.000+09:18:59 Asia/Tokyo',
    );
  });
});

describe('explorer utilities treat BSON leaves as scalars', () => {
  const tree = toExplorerValue(
    parseEJsonDocument(
      '{"id":{"$oid":"5f1d7a3e9c1b2a0012345678"},"n":{"$numberLong":"1"},' +
        '"sub":{"at":{"$date":{"$numberLong":"0"}}}}',
    ),
  );

  it('typeOf is "bson" for leaves and the default for that type is null', () => {
    expect(typeOf(long(1n))).toBe('bson');
    expect(typeOf(null)).toBe('null');
    expect(defaultForType('bson')).toBeNull();
  });

  it('json-lines shapes do not walk into leaves', () => {
    expect([...shapeOf(tree)].sort()).toEqual(['.id', '.n', '.sub', '.sub.at', ':object']);
  });

  it('the outline lists only real containers', () => {
    expect(outlineRows(tree, new ProblemIndex([], tree)).map((r) => r.label)).toEqual(['sub']);
  });

  it('layout detection does not count leaves as records', () => {
    expect(defaultLayout({ items: [long(1n), long(2n)] }, true)).toBe(
      defaultLayout({ items: [1, 2] }, true),
    );
  });
});
