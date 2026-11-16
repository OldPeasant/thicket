import { describe, expect, it } from 'vitest';

import { parseEJson, stringifyEJson } from './ejson';
import type { BsonValue } from './model';
import { formatPath, getAt, insertAt, moveAt, removeAt, renameAt, setAt } from './path';

const ROOT = parseEJson('{"a":{"b":[10,{"c":"x"}]},"d":"y","e":true}');
const text = (v: BsonValue): string => stringifyEJson(v);
const plain = (v: BsonValue): unknown => JSON.parse(text(parseEJson(text(v))));
const int = (value: number): BsonValue => ({ type: 'int', value });
const str = (value: string): BsonValue => ({ type: 'string', value });

describe('getAt', () => {
  it('walks documents and arrays', () => {
    expect(getAt(ROOT, [])).toBe(ROOT);
    expect(getAt(ROOT, ['a', 'b', 1, 'c'])).toEqual(str('x'));
    expect(getAt(ROOT, ['a', 'b', 0])).toEqual(int(10));
  });

  it('returns undefined for missing or mistyped segments', () => {
    expect(getAt(ROOT, ['nope'])).toBeUndefined();
    expect(getAt(ROOT, ['a', 'b', 5])).toBeUndefined();
    expect(getAt(ROOT, ['a', 'b', '0'])).toBeUndefined();
    expect(getAt(ROOT, [0])).toBeUndefined();
    expect(getAt(ROOT, ['d', 'x'])).toBeUndefined();
  });

  it('addresses the first of repeated keys', () => {
    expect(getAt(parseEJson('{"k":"1","k":"2"}'), ['k'])).toEqual(str('1'));
  });
});

describe('setAt', () => {
  it('replaces in place without touching the input', () => {
    const before = text(ROOT);
    const next = setAt(ROOT, ['a', 'b', 1, 'c'], str('z'));
    expect(text(next)).toBe('{"a":{"b":[{"$numberInt":"10"},{"c":"z"}]},"d":"y","e":true}');
    expect(text(ROOT)).toBe(before);
    expect(getAt(next, ['d'])).toBe(getAt(ROOT, ['d']));
  });

  it('keeps the position of an existing field and appends a new one', () => {
    const next = setAt(setAt(ROOT, ['d'], int(1)), ['new'], int(2));
    expect(Object.keys(plain(next) as object)).toEqual(['a', 'd', 'e', 'new']);
  });

  it('appends to an array at index = length and rejects gaps', () => {
    expect(getAt(setAt(ROOT, ['a', 'b', 2], int(3)), ['a', 'b', 2])).toEqual(int(3));
    expect(() => setAt(ROOT, ['a', 'b', 4], int(3))).toThrow('a.b.4: index out of range');
  });

  it('replaces the root for an empty path', () => {
    expect(setAt(ROOT, [], int(1))).toEqual(int(1));
  });

  it('fails on missing parents and non-containers', () => {
    expect(() => setAt(ROOT, ['x', 'y'], int(1))).toThrow('x: does not exist');
    expect(() => setAt(ROOT, ['d', 'y'], int(1))).toThrow('d: is a string');
    expect(() => setAt(ROOT, ['a', 'b', 'k'], int(1))).toThrow('non-negative integer');
    expect(() => setAt(ROOT, ['a', 'b', -1], int(1))).toThrow('non-negative integer');
    expect(() => setAt(ROOT, ['a', 'b', 1.5], int(1))).toThrow('non-negative integer');
    expect(() => setAt(ROOT, [0], int(1))).toThrow('document fields are named');
  });
});

describe('insertAt', () => {
  it('inserts a field at a position or at the end', () => {
    expect(Object.keys(plain(insertAt(ROOT, ['n'], int(1), 1)) as object)).toEqual([
      'a',
      'n',
      'd',
      'e',
    ]);
    expect(Object.keys(plain(insertAt(ROOT, ['n'], int(1))) as object)).toEqual([
      'a',
      'd',
      'e',
      'n',
    ]);
  });

  it('rejects existing keys and bad positions', () => {
    expect(() => insertAt(ROOT, ['d'], int(1))).toThrow('field already exists');
    expect(() => insertAt(ROOT, ['n'], int(1), 4)).toThrow('position 4 out of range');
    expect(() => insertAt(ROOT, ['n'], int(1), -1)).toThrow('out of range');
    expect(() => insertAt(ROOT, [], int(1))).toThrow('The root has no parent');
  });

  it('inserts array items, shifting the rest', () => {
    const next = insertAt(ROOT, ['a', 'b', 0], str('first'));
    expect(text(getAt(next, ['a', 'b']) as BsonValue)).toBe(
      '["first",{"$numberInt":"10"},{"c":"x"}]',
    );
    expect(() => insertAt(ROOT, ['a', 'b', 3], int(1))).toThrow('index out of range');
    expect(() => insertAt(ROOT, ['a', 'b', 'x'], int(1))).toThrow('index out of range');
  });
});

describe('removeAt', () => {
  it('removes fields and array items', () => {
    expect(Object.keys(plain(removeAt(ROOT, ['d'])) as object)).toEqual(['a', 'e']);
    expect(text(getAt(removeAt(ROOT, ['a', 'b', 0]), ['a', 'b']) as BsonValue)).toBe('[{"c":"x"}]');
  });

  it('fails on missing targets', () => {
    expect(() => removeAt(ROOT, ['zz'])).toThrow('zz: does not exist');
    expect(() => removeAt(ROOT, ['a', 'b', 9])).toThrow('does not exist');
  });
});

describe('moveAt', () => {
  it('reorders fields', () => {
    expect(Object.keys(plain(moveAt(ROOT, ['e'], 0)) as object)).toEqual(['e', 'a', 'd']);
    expect(Object.keys(plain(moveAt(ROOT, ['a'], 2)) as object)).toEqual(['d', 'e', 'a']);
  });

  it('reorders array items', () => {
    expect(text(getAt(moveAt(ROOT, ['a', 'b', 0], 1), ['a', 'b']) as BsonValue)).toBe(
      '[{"c":"x"},{"$numberInt":"10"}]',
    );
  });

  it('rejects missing sources and out-of-range targets', () => {
    expect(() => moveAt(ROOT, ['zz'], 0)).toThrow('does not exist');
    expect(() => moveAt(ROOT, ['a'], 3)).toThrow('position 3 out of range');
    expect(() => moveAt(ROOT, ['a'], -1)).toThrow('out of range');
  });
});

describe('renameAt', () => {
  it('renames in place', () => {
    expect(Object.keys(plain(renameAt(ROOT, ['d'], 'dd')) as object)).toEqual(['a', 'dd', 'e']);
    expect(renameAt(ROOT, ['d'], 'd')).toEqual(ROOT);
  });

  it('rejects clashes, missing fields and array items', () => {
    expect(() => renameAt(ROOT, ['d'], 'e')).toThrow('field "e" already exists');
    expect(() => renameAt(ROOT, ['zz'], 'y')).toThrow('does not exist');
    expect(() => renameAt(ROOT, ['a', 'b', 0], 'y')).toThrow('array items have no name');
  });
});

describe('formatPath', () => {
  it('dots segments and names the root', () => {
    expect(formatPath([])).toBe('(root)');
    expect(formatPath(['a', 0, 'b'])).toBe('a.0.b');
  });
});
