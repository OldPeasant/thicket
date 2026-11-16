import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SORT,
  isRangePageable,
  parseSort,
  reverseSort,
  sameSort,
  sortDocument,
  type SortSpec,
} from './sort';

const asc = (field: string) => ({ field, direction: 1 as const });
const desc = (field: string) => ({ field, direction: -1 as const });

describe('parseSort', () => {
  it('returns an empty spec for no sort and for an empty document', () => {
    expect(parseSort(undefined)).toEqual([]);
    expect(parseSort({})).toEqual([]);
  });

  it('keeps key order and reads numeric directions', () => {
    expect(parseSort({ b: -1, a: 1, _id: -1 })).toEqual([desc('b'), asc('a'), desc('_id')]);
    expect(parseSort({ a: '1', b: '-1' })).toEqual([asc('a'), desc('b')]);
  });

  it('reads asc/desc words case-insensitively', () => {
    expect(parseSort({ a: 'asc', b: 'DESC', c: 'Ascending', d: 'descending' })).toEqual([
      asc('a'),
      desc('b'),
      asc('c'),
      desc('d'),
    ]);
  });

  it('returns null for a $meta sort or any other direction value', () => {
    expect(parseSort({ score: { $meta: 'textScore' } })).toBeNull();
    expect(parseSort({ a: 1, score: { $meta: 'textScore' } })).toBeNull();
    for (const bad of [0, 2, -2, 1.5, true, null, 'up', '', ' asc', []]) {
      expect(parseSort({ a: bad })).toBeNull();
    }
  });

  it('returns null for an empty field name', () => {
    expect(parseSort({ '': 1 })).toBeNull();
  });
});

describe('sortDocument', () => {
  it('converts back to a sort document with key order preserved', () => {
    const doc = sortDocument([desc('b'), asc('a')]);
    expect(doc).toEqual({ b: -1, a: 1 });
    expect(Object.keys(doc)).toEqual(['b', 'a']);
    expect(sortDocument([])).toEqual({});
  });

  it('round-trips with parseSort', () => {
    const doc = { last: 1, age: -1, _id: 1 };
    expect(sortDocument(parseSort(doc) ?? [])).toEqual(doc);
  });
});

describe('reverseSort', () => {
  it('flips every direction and keeps the key order', () => {
    expect(reverseSort([asc('a'), desc('b'), asc('_id')])).toEqual([
      desc('a'),
      asc('b'),
      desc('_id'),
    ]);
    expect(reverseSort([])).toEqual([]);
  });

  it('does not modify its input and reversing twice gives the original', () => {
    const sort: SortSpec = [asc('a'), desc('b')];
    const copy = structuredClone(sort);
    expect(reverseSort(reverseSort(sort))).toEqual(sort);
    expect(sort).toEqual(copy);
  });
});

describe('sameSort', () => {
  it('is true for equal keys, order and directions', () => {
    expect(sameSort([asc('a'), desc('b')], [asc('a'), desc('b')])).toBe(true);
    expect(sameSort([], [])).toBe(true);
  });

  it('is false when a direction, the key order or the length differs', () => {
    expect(sameSort([asc('a')], [desc('a')])).toBe(false);
    expect(sameSort([asc('a'), asc('b')], [asc('b'), asc('a')])).toBe(false);
    expect(sameSort([asc('a')], [asc('a'), asc('b')])).toBe(false);
    expect(sameSort([asc('a'), asc('b')], [asc('a')])).toBe(false);
    expect(sameSort([asc('a')], [asc('b')])).toBe(false);
  });
});

describe('isRangePageable', () => {
  it('is false for an opaque sort', () => {
    expect(isRangePageable(null)).toBe(false);
    expect(isRangePageable(null, [['a']])).toBe(false);
  });

  it('treats an empty sort as the default _id sort', () => {
    expect(DEFAULT_SORT).toEqual([asc('_id')]);
    expect(isRangePageable([])).toBe(true);
  });

  it('accepts any sort that includes _id, in either direction and position', () => {
    expect(isRangePageable([desc('_id')])).toBe(true);
    expect(isRangePageable([asc('name'), desc('_id')])).toBe(true);
    expect(isRangePageable([desc('_id'), asc('name')])).toBe(true);
  });

  it('is false for a non-unique sort', () => {
    expect(isRangePageable([asc('name')])).toBe(false);
    expect(isRangePageable([asc('name'), asc('age')], [['email']])).toBe(false);
  });

  it('accepts a sort covering all fields of a unique index, in any order', () => {
    expect(isRangePageable([asc('email')], [['email']])).toBe(true);
    expect(isRangePageable([desc('b'), asc('a')], [['a', 'b']])).toBe(true);
    expect(isRangePageable([asc('x'), asc('a'), asc('b')], [['zz'], ['a', 'b']])).toBe(true);
  });

  it('is false when only part of a compound unique index is covered', () => {
    expect(isRangePageable([asc('a')], [['a', 'b']])).toBe(false);
  });

  it('ignores an empty unique index entry', () => {
    expect(isRangePageable([asc('name')], [[]])).toBe(false);
  });

  it('is false when a field appears twice', () => {
    expect(isRangePageable([asc('_id'), desc('_id')])).toBe(false);
  });

  it('does not treat a dotted sub-field of _id as _id', () => {
    expect(isRangePageable([asc('_id.a')])).toBe(false);
  });
});
