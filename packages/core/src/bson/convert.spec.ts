import { describe, expect, it } from 'vitest';

import { convert, ConversionError, uuidOf, type ConversionTarget } from './convert';
import type { BsonValue } from './model';

const s = (value: string): BsonValue => ({ type: 'string', value });
const i32 = (value: number): BsonValue => ({ type: 'int', value });
const i64 = (value: bigint): BsonValue => ({ type: 'long', value });
const dbl = (value: number): BsonValue => ({ type: 'double', value });
const dec = (value: string): BsonValue => ({ type: 'decimal', value });
const bool = (value: boolean): BsonValue => ({ type: 'bool', value });
const date = (ms: bigint): BsonValue => ({ type: 'date', ms });
const oid = (hex: string): BsonValue => ({ type: 'objectId', hex });
const bin = (subtype: number, base64: string): BsonValue => ({ type: 'binary', subtype, base64 });
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const UUID_B64 = 'D4+tW9nLRp+hZXCGdyiVDg==';
const NULL: BsonValue = { type: 'null' };

function fails(value: BsonValue, to: ConversionTarget, message: string | RegExp): void {
  const run = (): BsonValue => convert(value, to);
  expect(run).toThrow(ConversionError);
  expect(run).toThrow(message);
}

describe('convert: table from the acceptance criteria', () => {
  it('String → ObjectId (valid / invalid)', () => {
    expect(convert(s('5F1D7A3E9C1B2A0012345678'), 'objectId')).toEqual(
      oid('5f1d7a3e9c1b2a0012345678'),
    );
    fails(s('5f1d7a3e9c1b2a001234567'), 'objectId', 'not 24 hex characters');
    fails(s('zzzzzzzzzzzzzzzzzzzzzzzz'), 'objectId', 'not 24 hex characters');
    fails(i32(1), 'objectId', 'only strings');
  });

  it('Int32 → Int64', () => {
    expect(convert(i32(-7), 'long')).toEqual(i64(-7n));
  });

  it('Int64 → Int32 fits, overflows with an error', () => {
    expect(convert(i64(2147483647n), 'int')).toEqual(i32(2147483647));
    expect(convert(i64(-2147483648n), 'int')).toEqual(i32(-2147483648));
    fails(i64(2147483648n), 'int', 'overflows Int32');
    fails(i64(-2147483649n), 'int', 'overflows Int32');
  });

  it('Double → Decimal128', () => {
    expect(convert(dbl(0.1), 'decimal')).toEqual(dec('0.1'));
    expect(convert(dbl(-0), 'decimal')).toEqual(dec('-0'));
    expect(convert(dbl(1e300), 'decimal')).toEqual(dec('1E+300'));
    expect(convert(dbl(NaN), 'decimal')).toEqual(dec('NaN'));
    expect(convert(dbl(-Infinity), 'decimal')).toEqual(dec('-Infinity'));
    expect(convert(dbl(5e-324), 'decimal')).toEqual(dec('5E-324'));
  });

  it('String ↔ Date (ISO)', () => {
    expect(convert(s('2024-05-01T12:30:00.123Z'), 'date')).toEqual(date(1714566600123n));
    expect(convert(s(' 2024-05-01T14:30:00.123+02:00 '), 'date')).toEqual(date(1714566600123n));
    expect(convert(s('2024-05-01'), 'date')).toEqual(date(1714521600000n));
    fails(s('2024-02-30T00:00:00Z'), 'date', 'not a valid date');
    fails(s('May 1st'), 'date', 'not an ISO-8601 date');
    expect(convert(date(1714566600123n), 'string')).toEqual(s('2024-05-01T12:30:00.123Z'));
    fails(date(2n ** 62n), 'string', 'outside the representable date range');
  });

  it('Binary(4) ↔ UUID', () => {
    expect(convert(s(UUID), 'uuid')).toEqual(bin(4, UUID_B64));
    expect(convert(s(UUID.toUpperCase().replace(/-/g, '')), 'uuid')).toEqual(bin(4, UUID_B64));
    expect(convert(bin(4, UUID_B64), 'string')).toEqual(s(UUID));
    expect(convert(bin(3, UUID_B64), 'uuid')).toEqual(bin(4, UUID_B64));
    expect(convert(bin(4, UUID_B64), 'uuid')).toEqual(bin(4, UUID_B64));
    fails(s('not-a-uuid'), 'uuid', 'is not a UUID');
    fails(bin(0, 'AQID'), 'uuid', '16 bytes');
    fails(i32(1), 'uuid', 'only strings and 16-byte binaries');
    fails(bin(0, UUID_B64), 'string', 'only UUID binaries');
    fails(bin(4, 'AQID'), 'string', 'only UUID binaries');
  });
});

describe('convert: every target', () => {
  it('returns the same value for the same type', () => {
    const v = s('x');
    expect(convert(v, 'string')).toBe(v);
  });

  it('refuses deprecated targets', () => {
    for (const to of ['undefined', 'symbol', 'dbPointer', 'javascriptWithScope'] as const) {
      fails(s('x'), to, 'deprecated types cannot be created');
    }
  });

  it('→ string', () => {
    expect(convert(oid('5f1d7a3e9c1b2a0012345678'), 'string')).toEqual(
      s('5f1d7a3e9c1b2a0012345678'),
    );
    expect(convert(i32(5), 'string')).toEqual(s('5'));
    expect(convert(i64(9007199254740993n), 'string')).toEqual(s('9007199254740993'));
    expect(convert(dec('1.10'), 'string')).toEqual(s('1.10'));
    expect(convert(dbl(1.5), 'string')).toEqual(s('1.5'));
    expect(convert(dbl(-0), 'string')).toEqual(s('-0'));
    expect(convert(bool(true), 'string')).toEqual(s('true'));
    expect(convert({ type: 'javascript', code: 'f()' }, 'string')).toEqual(s('f()'));
    expect(convert({ type: 'symbol', value: 'sym' }, 'string')).toEqual(s('sym'));
    expect(convert({ type: 'regex', pattern: 'a+', options: '' }, 'string')).toEqual(s('a+'));
    fails({ type: 'regex', pattern: 'a+', options: 'i' }, 'string', 'options "i" would be lost');
    fails(NULL, 'string', 'no text form');
  });

  it('→ int', () => {
    expect(convert(dbl(3), 'int')).toEqual(i32(3));
    expect(convert(bool(true), 'int')).toEqual(i32(1));
    expect(convert(bool(false), 'int')).toEqual(i32(0));
    expect(convert(s(' -12 '), 'int')).toEqual(i32(-12));
    expect(convert(dec('42'), 'int')).toEqual(i32(42));
    expect(convert(dec('1.0E+3'), 'int')).toEqual(i32(1000));
    expect(convert(dec('-1E+2'), 'int')).toEqual(i32(-100));
    expect(convert(dec('1.200E+3'), 'int')).toEqual(i32(1200));
    expect(convert(dec('12000E-1'), 'int')).toEqual(i32(1200));
    expect(convert(dec('-12000E-1'), 'int')).toEqual(i32(-1200));
    fails(dec('1.5'), 'int', 'not an integer');
    fails(dec('15E-1'), 'int', 'not an integer');
    fails(s('1.5'), 'int', 'not an integer');
    fails(s('1E+3'), 'int', 'not an integer');
    fails(dbl(1.5), 'int', 'not an integer');
    fails(dbl(NaN), 'int', 'not an integer');
    fails(dbl(3e9), 'int', 'overflows Int32');
    fails(NULL, 'int', 'not a number');
  });

  it('→ long', () => {
    expect(convert(dbl(2 ** 53), 'long')).toEqual(i64(9007199254740992n));
    expect(convert(s('9223372036854775807'), 'long')).toEqual(i64(2n ** 63n - 1n));
    expect(convert(date(-5n), 'long')).toEqual(i64(-5n));
    fails(s('9223372036854775808'), 'long', 'overflows Int64');
    fails(dbl(1e300), 'long', 'overflows Int64');
  });

  it('→ double', () => {
    expect(convert(i32(2), 'double')).toEqual(dbl(2));
    expect(convert(i64(2n ** 53n), 'double')).toEqual(dbl(2 ** 53));
    fails(i64(2n ** 53n + 1n), 'double', 'not exactly representable');
    expect(convert(bool(true), 'double')).toEqual(dbl(1));
    expect(convert(bool(false), 'double')).toEqual(dbl(0));
    expect(convert(dec('0.1'), 'double')).toEqual(dbl(0.1));
    expect(convert(dec('-Infinity'), 'double')).toEqual(dbl(-Infinity));
    expect(convert(dec('NaN'), 'double')).toEqual(dbl(NaN));
    fails(dec('1E+400'), 'double', 'overflows Double');
    expect(convert(s(' 1.5e3 '), 'double')).toEqual(dbl(1500));
    expect(convert(s('-Infinity'), 'double')).toEqual(dbl(-Infinity));
    expect(convert(s('NaN'), 'double')).toEqual(dbl(NaN));
    fails(s('1,5'), 'double', 'is not a number');
    fails(s(''), 'double', 'is not a number');
    fails(NULL, 'double', 'not a number');
  });

  it('→ decimal', () => {
    expect(convert(i32(-3), 'decimal')).toEqual(dec('-3'));
    expect(convert(i64(2n ** 63n - 1n), 'decimal')).toEqual(dec('9223372036854775807'));
    expect(convert(s(' 1.10 '), 'decimal')).toEqual(dec('1.10'));
    fails(s('abc'), 'decimal', 'not a decimal');
    fails(bool(true), 'decimal', 'not a number');
  });

  it('→ bool', () => {
    expect(convert(s('true'), 'bool')).toEqual(bool(true));
    expect(convert(s('false'), 'bool')).toEqual(bool(false));
    fails(s('yes'), 'bool', 'not true or false');
    expect(convert(i32(0), 'bool')).toEqual(bool(false));
    expect(convert(dbl(0.5), 'bool')).toEqual(bool(true));
    expect(convert(i64(0n), 'bool')).toEqual(bool(false));
    expect(convert(i64(2n), 'bool')).toEqual(bool(true));
    fails(NULL, 'bool', 'not a boolean');
  });

  it('→ date', () => {
    expect(convert(i64(-1n), 'date')).toEqual(date(-1n));
    expect(convert(i32(1000), 'date')).toEqual(date(1000n));
    expect(convert(oid('5f1d7a3e9c1b2a0012345678'), 'date')).toEqual(date(1595767358000n));
    fails(dbl(1), 'date', 'not a date');
  });

  it('→ other targets', () => {
    fails(s('x'), 'binary', 'use the uuid target');
    expect(convert(s('^a'), 'regex')).toEqual({ type: 'regex', pattern: '^a', options: '' });
    fails(i32(1), 'regex', 'only strings');
    expect(convert(s('f()'), 'javascript')).toEqual({ type: 'javascript', code: 'f()' });
    fails(i32(1), 'javascript', 'only strings');
    expect(convert({ type: 'array', items: [s('a'), i32(1)] }, 'object')).toEqual({
      type: 'object',
      fields: [
        { key: '0', value: s('a') },
        { key: '1', value: i32(1) },
      ],
    });
    fails(s('x'), 'object', 'only arrays');
    expect(convert({ type: 'object', fields: [{ key: 'k', value: s('v') }] }, 'array')).toEqual({
      type: 'array',
      items: [s('v')],
    });
    fails(s('x'), 'array', 'only documents');
    fails(i64(1n), 'timestamp', 'created by the server');
    expect(convert(s('x'), 'null')).toEqual(NULL);
    expect(convert(s('x'), 'minKey')).toEqual({ type: 'minKey' });
    expect(convert(s('x'), 'maxKey')).toEqual({ type: 'maxKey' });
  });

  it('ConversionError carries the source and target type', () => {
    try {
      convert(i64(2n ** 40n), 'int');
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ from: 'long', to: 'int', name: 'BsonModelError' });
    }
  });
});

describe('convert: edge cases', () => {
  it('String → ObjectId does not trim and rejects empty text', () => {
    fails(s(''), 'objectId', 'not 24 hex characters');
    fails(s(' 5f1d7a3e9c1b2a0012345678'), 'objectId', 'not 24 hex characters');
  });

  it('Int32 → Int64 → Int32 round-trips the Int32 boundaries', () => {
    for (const n of [-2147483648, -1, 0, 2147483647]) {
      expect(convert(convert(i32(n), 'long'), 'int')).toEqual(i32(n));
    }
  });

  it('Int64 → Int32 overflow at the Int64 extremes', () => {
    fails(i64(2n ** 63n - 1n), 'int', 'overflows Int32');
    fails(i64(-(2n ** 63n)), 'int', 'overflows Int32');
  });

  it('Double → Int32 accepts -0 and rejects infinities', () => {
    expect(convert(dbl(-0), 'int')).toEqual(i32(0));
    fails(dbl(Infinity), 'int', 'not an integer');
  });

  it('Double → Decimal128 → Double keeps the value', () => {
    for (const d of [0.1, -2.5, 1e-7, 123456789.125, 2 ** 53, -0]) {
      const back = convert(convert(dbl(d), 'decimal'), 'double');
      expect(Object.is((back as { value: number }).value, d), String(d)).toBe(true);
    }
    expect(convert(dbl(Infinity), 'decimal')).toEqual(dec('Infinity'));
    expect(convert(dbl(1.7976931348623157e308), 'decimal')).toEqual(dec('1.7976931348623157E+308'));
  });

  it('Decimal128 with an exact integral value converts to Int32 and Int64', () => {
    // The model stores bson's canonical Decimal128 string; "1200.0" is the canonical form of
    // 12000E-1 (accepted above) and has the exact integer value 1200.
    expect(convert(dec('1200.0'), 'int')).toEqual(i32(1200));
    expect(convert(dec('-7.00'), 'long')).toEqual(i64(-7n));
    expect(convert(dec('100.00'), 'int')).toEqual(i32(100));
    expect(convert(dec('2.0'), 'long')).toEqual(i64(2n));
    fails(dec('7.50'), 'int', 'not an integer');
    fails(dec('-0.5'), 'long', 'not an integer');
  });

  it('Decimal128 integers beyond Int64 overflow; specials are not integers', () => {
    fails(dec('1E+19'), 'long', 'overflows Int64');
    fails(dec('NaN'), 'int', 'not an integer');
    fails(dec('Infinity'), 'long', 'not an integer');
  });

  it('String → Int64 accepts a leading plus and the Int64 minimum', () => {
    expect(convert(s('+5'), 'long')).toEqual(i64(5n));
    expect(convert(s('-9223372036854775808'), 'long')).toEqual(i64(-(2n ** 63n)));
    fails(s('-9223372036854775809'), 'long', 'overflows Int64');
    fails(s(''), 'long', 'not an integer');
  });

  it('Date → String → Date round-trips within the ISO year range 0000-9999', () => {
    for (const ms of [0n, -1n, 1714566600123n, -62135596800000n, 253402300799999n]) {
      expect(convert(convert(date(ms), 'string'), 'date'), String(ms)).toEqual(date(ms));
    }
  });

  it('Date → String → Date round-trips outside the ISO year range 0000-9999', () => {
    const cases: [bigint, string][] = [
      [253402300800000n, '+010000-01-01T00:00:00.000Z'],
      [-62167219200001n, '-000001-12-31T23:59:59.999Z'],
      [8_640_000_000_000_000n, '+275760-09-13T00:00:00.000Z'],
      [-8_640_000_000_000_000n, '-271821-04-20T00:00:00.000Z'],
    ];
    for (const [ms, text] of cases) {
      expect(convert(date(ms), 'string')).toEqual(s(text));
      expect(convert(s(text), 'date'), text).toEqual(date(ms));
    }
  });

  it('String → Double fails when a finite-looking number overflows', () => {
    fails(s('1e400'), 'double', '"1e400" overflows Double');
    fails(s('-1e400'), 'double', 'overflows Double');
    expect(convert(s('Infinity'), 'double')).toEqual(dbl(Infinity));
    expect(convert(s('NaN'), 'double')).toEqual(dbl(NaN));
    expect(convert(s('1.7976931348623157e308'), 'double')).toEqual(dbl(1.7976931348623157e308));
  });

  it('Binary subtype 4 → UUID requires 16 bytes', () => {
    fails(bin(4, 'AQID'), 'uuid', 'a UUID has 16 bytes');
  });

  it('String → Date accepts the documented forms and rejects zone-less date-times', () => {
    expect(convert(s('1970-01-01T00:00:00-01:30'), 'date')).toEqual(date(5400000n));
    fails(s('2024-05-01T12:30:00'), 'date', 'not an ISO-8601 date');
    fails(s(''), 'date', 'not an ISO-8601 date');
  });

  it('Binary(4) → String → UUID round-trips and normalizes case', () => {
    const upper = s(UUID.toUpperCase());
    const asUuid = convert(upper, 'uuid');
    expect(asUuid).toEqual(bin(4, UUID_B64));
    expect(convert(asUuid, 'string')).toEqual(s(UUID));
    expect(convert(s(` ${UUID} `), 'uuid')).toEqual(bin(4, UUID_B64));
    fails(s(UUID.slice(0, -1)), 'uuid', 'is not a UUID');
    fails(bin(5, UUID_B64.slice(0, -4)), 'uuid', '16 bytes');
  });

  it('never creates deprecated types from deprecated sources either', () => {
    fails({ type: 'symbol', value: 'x' }, 'undefined', 'deprecated types cannot be created');
  });

  it('does not modify its input', () => {
    const source = { type: 'array', items: [s('a')] } as const;
    const snapshot = JSON.stringify(source);
    convert(source, 'object');
    expect(JSON.stringify(source)).toBe(snapshot);
  });
});

describe('uuidOf', () => {
  it('formats subtype 4 binaries and returns null otherwise', () => {
    expect(uuidOf(bin(4, UUID_B64))).toBe(UUID);
    expect(uuidOf(bin(3, UUID_B64))).toBeNull();
    expect(uuidOf(bin(4, 'AQID'))).toBeNull();
    expect(uuidOf(s(UUID))).toBeNull();
  });
});
