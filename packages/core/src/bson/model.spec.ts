import { describe, expect, it } from 'vitest';

import { stringifyEJson } from './ejson';
import {
  arr,
  bool,
  BSON_TYPES,
  BsonModelError,
  DEPRECATED_TYPES,
  doc,
  double,
  int32,
  int64,
  INT32_MAX,
  INT32_MIN,
  INT64_MAX,
  INT64_MIN,
  nil,
  str,
} from './model';

describe('int32', () => {
  it('accepts the full signed 32-bit range', () => {
    expect(int32(INT32_MIN)).toEqual({ type: 'int', value: -2147483648 });
    expect(int32(INT32_MAX)).toEqual({ type: 'int', value: 2147483647 });
    expect(int32(42)).toEqual({ type: 'int', value: 42 });
  });

  it('normalizes -0 to 0 (Int32 has no negative zero)', () => {
    expect(Object.is(int32(-0).value, 0)).toBe(true);
    expect(stringifyEJson(int32(-0))).toBe('{"$numberInt":"0"}');
  });

  it.each([
    ['just above the range', INT32_MAX + 1],
    ['just below the range', INT32_MIN - 1],
    ['a fraction', 1.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ])('rejects %s', (_label, value) => {
    expect(() => int32(value)).toThrow(BsonModelError);
    expect(() => int32(value)).toThrow('is not a 32-bit integer');
  });
});

describe('int64', () => {
  it('accepts the full signed 64-bit range, including values beyond 2^53', () => {
    expect(int64(INT64_MIN)).toEqual({ type: 'long', value: -(2n ** 63n) });
    expect(int64(INT64_MAX)).toEqual({ type: 'long', value: 2n ** 63n - 1n });
    expect(stringifyEJson(int64(2n ** 53n + 1n))).toBe('{"$numberLong":"9007199254740993"}');
  });

  it('rejects values one past either end', () => {
    expect(() => int64(INT64_MAX + 1n)).toThrow('outside the 64-bit integer range');
    expect(() => int64(INT64_MIN - 1n)).toThrow(BsonModelError);
  });
});

describe('double', () => {
  it('keeps negative zero, NaN and infinities', () => {
    expect(Object.is(double(-0).value, -0)).toBe(true);
    expect(stringifyEJson(double(-0))).toBe('{"$numberDouble":"-0.0"}');
    expect(stringifyEJson(double(NaN))).toBe('{"$numberDouble":"NaN"}');
    expect(stringifyEJson(double(-Infinity))).toBe('{"$numberDouble":"-Infinity"}');
    expect(stringifyEJson(double(1))).toBe('{"$numberDouble":"1.0"}');
  });
});

describe('simple constructors', () => {
  it('build the documented shapes', () => {
    expect(str('x')).toEqual({ type: 'string', value: 'x' });
    expect(bool(false)).toEqual({ type: 'bool', value: false });
    expect(nil()).toEqual({ type: 'null' });
    expect(doc()).toEqual({ type: 'object', fields: [] });
    expect(arr()).toEqual({ type: 'array', items: [] });
  });

  it('compose into a document that keeps field order', () => {
    const d = doc([
      { key: 'z', value: int32(1) },
      { key: '1', value: arr([str('a'), nil()]) },
      { key: '$x', value: bool(true) },
    ]);
    expect(stringifyEJson(d)).toBe('{"z":{"$numberInt":"1"},"1":["a",null],"$x":true}');
  });
});

describe('type lists', () => {
  it('names every BSON type once, deprecated ones being a subset', () => {
    expect(BSON_TYPES).toHaveLength(21);
    expect(new Set(BSON_TYPES).size).toBe(BSON_TYPES.length);
    expect(DEPRECATED_TYPES).toEqual(['undefined', 'symbol', 'dbPointer', 'javascriptWithScope']);
    for (const t of DEPRECATED_TYPES) expect(BSON_TYPES).toContain(t);
  });

  it('BsonModelError is an Error with its own name', () => {
    const e = new BsonModelError('boom');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('BsonModelError');
    expect(e.message).toBe('boom');
  });
});
