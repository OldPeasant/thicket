import { describe, expect, it } from 'vitest';

import {
  moveEntry,
  objectFromEntries,
  orderedEntries,
  orderedKeys,
  withEntry,
  withoutEntry,
} from './key-order.util';

describe('objectFromEntries', () => {
  it('keeps the given order for integer-like keys, which JS objects list first', () => {
    const obj = objectFromEntries([
      ['b', 1],
      ['10', 2],
      ['a', 3],
      ['2', 4],
    ]);
    expect(Object.keys(obj)).toEqual(['2', '10', 'b', 'a']);
    expect(orderedKeys(obj)).toEqual(['b', '10', 'a', '2']);
    expect(orderedEntries(obj)).toEqual([
      ['b', 1],
      ['10', 2],
      ['a', 3],
      ['2', 4],
    ]);
  });

  it('hides the order from JSON, Object.keys/entries and spreads', () => {
    const obj = objectFromEntries([
      ['b', 1],
      ['1', 2],
    ]);
    expect(JSON.stringify(obj)).toBe('{"1":2,"b":1}');
    expect(Object.entries(obj)).toEqual([
      ['1', 2],
      ['b', 1],
    ]);
    expect(obj).toEqual({ 1: 2, b: 1 });
    // A spread copy loses the hidden order (it falls back to Object.keys order).
    expect(orderedKeys({ ...obj })).toEqual(['1', 'b']);
  });

  it('adds no hidden order when the natural order is already right', () => {
    const obj = objectFromEntries([
      ['1', 1],
      ['a', 2],
    ]);
    expect(Object.getOwnPropertySymbols(obj)).toEqual([]);
    expect(Object.getOwnPropertySymbols(objectFromEntries([]))).toEqual([]);
  });

  it('a repeated key keeps its first position and takes the last value', () => {
    const obj = objectFromEntries([
      ['a', 1],
      ['b', 2],
      ['a', 3],
    ]);
    expect(orderedEntries(obj)).toEqual([
      ['a', 3],
      ['b', 2],
    ]);
  });

  it('a repeated integer-like key also keeps its first position', () => {
    const obj = objectFromEntries([
      ['x', 1],
      ['5', 2],
      ['y', 3],
      ['5', 4],
    ]);
    expect(orderedEntries(obj)).toEqual([
      ['x', 1],
      ['5', 4],
      ['y', 3],
    ]);
  });

  it('keeps "__proto__" an ordinary own key without changing the prototype', () => {
    const obj = objectFromEntries([
      ['__proto__', { polluted: true }],
      ['a', 1],
    ]);
    expect(Object.getPrototypeOf(obj)).toBe(Object.prototype);
    expect((obj as { polluted?: boolean }).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(obj, '__proto__')).toBe(true);
    expect(orderedKeys(obj)).toEqual(['__proto__', 'a']);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('makes writable, enumerable, configurable properties', () => {
    const obj = objectFromEntries([['a', 1]]);
    obj['a'] = 2;
    expect(obj['a']).toBe(2);
    delete obj['a'];
    expect(obj).toEqual({});
  });
});

describe('orderedKeys', () => {
  it('lists keys added later by assignment after the known ones', () => {
    const obj = objectFromEntries([
      ['b', 1],
      ['1', 2],
    ]);
    obj['0'] = 3;
    obj['c'] = 4;
    expect(orderedKeys(obj)).toEqual(['b', '1', '0', 'c']);
  });

  it('drops keys deleted later', () => {
    const obj = objectFromEntries([
      ['b', 1],
      ['1', 2],
      ['a', 3],
    ]);
    delete obj['1'];
    expect(orderedKeys(obj)).toEqual(['b', 'a']);
  });

  it('is Object.keys for plain objects and arrays', () => {
    expect(orderedKeys({ b: 1, 1: 2 })).toEqual(['1', 'b']);
    expect(orderedKeys(['x', 'y'])).toEqual(['0', '1']);
    expect(orderedKeys({})).toEqual([]);
  });
});

describe('withEntry', () => {
  const doc = () =>
    objectFromEntries([
      ['b', 1],
      ['10', 2],
      ['a', 3],
    ]);

  it('replaces an existing key in place', () => {
    expect(orderedEntries(withEntry(doc(), '10', 'x'))).toEqual([
      ['b', 1],
      ['10', 'x'],
      ['a', 3],
    ]);
  });

  it('adds a new key, integer-like or not, last', () => {
    expect(orderedKeys(withEntry(doc(), '0', 9))).toEqual(['b', '10', 'a', '0']);
    expect(orderedKeys(withEntry(doc(), 'c', 9))).toEqual(['b', '10', 'a', 'c']);
  });

  it('does not change the original', () => {
    const original = doc();
    withEntry(original, 'c', 9);
    expect(orderedKeys(original)).toEqual(['b', '10', 'a']);
    expect(original['c']).toBeUndefined();
  });

  it('works on plain objects', () => {
    expect(orderedKeys(withEntry({ a: 1 }, '3', 2))).toEqual(['a', '3']);
  });
});

describe('withoutEntry', () => {
  it('removes the key and keeps the others in their order', () => {
    const obj = objectFromEntries([
      ['b', 1],
      ['10', 2],
      ['a', 3],
      ['2', 4],
    ]);
    expect(orderedKeys(withoutEntry(obj, 'a'))).toEqual(['b', '10', '2']);
    expect(orderedKeys(obj)).toEqual(['b', '10', 'a', '2']);
  });

  it('removing an absent key gives an equal copy', () => {
    const obj = objectFromEntries([
      ['b', 1],
      ['1', 2],
    ]);
    expect(orderedEntries(withoutEntry(obj, 'zz'))).toEqual(orderedEntries(obj));
  });
});

describe('moveEntry', () => {
  const doc = () =>
    objectFromEntries([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);

  it('moves a key to a position, values travelling with it', () => {
    expect(orderedEntries(moveEntry(doc(), 'c', 0))).toEqual([
      ['c', 3],
      ['a', 1],
      ['b', 2],
    ]);
    expect(orderedKeys(moveEntry(doc(), 'a', 1))).toEqual(['b', 'a', 'c']);
    expect(orderedKeys(moveEntry(doc(), 'a', 2))).toEqual(['b', 'c', 'a']);
  });

  it('clamps positions before the start and past the end', () => {
    expect(orderedKeys(moveEntry(doc(), 'c', -5))).toEqual(['c', 'a', 'b']);
    expect(orderedKeys(moveEntry(doc(), 'a', 99))).toEqual(['b', 'c', 'a']);
  });

  it('returns the same object when the key is absent or does not move', () => {
    const obj = doc();
    expect(moveEntry(obj, 'zz', 0)).toBe(obj);
    expect(moveEntry(obj, 'b', 1)).toBe(obj);
    expect(moveEntry(obj, 'a', -1)).toBe(obj);
    expect(moveEntry(obj, 'c', 3)).toBe(obj);
  });

  it('moves integer-like keys past others and keeps that order', () => {
    const obj = objectFromEntries([
      ['x', 1],
      ['y', 2],
      ['7', 3],
    ]);
    const moved = moveEntry(obj, 'x', 2);
    expect(orderedKeys(moved)).toEqual(['y', '7', 'x']);
    // And back to the natural order: no hidden order is needed any more.
    const natural = moveEntry(moved, '7', 0);
    expect(orderedKeys(natural)).toEqual(['7', 'y', 'x']);
    expect(Object.getOwnPropertySymbols(natural)).toEqual([]);
  });

  it('a single-key object never moves', () => {
    const obj = { only: 1 };
    expect(moveEntry(obj, 'only', 5)).toBe(obj);
  });
});
