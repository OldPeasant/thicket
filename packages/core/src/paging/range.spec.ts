import { describe, expect, it } from 'vitest';

import { andFilter, rangeFilter, rangeQuery, sortKeyValues, valueAtPath } from './range';
import type { SortSpec } from './sort';

const asc = (field: string) => ({ field, direction: 1 as const });
const desc = (field: string) => ({ field, direction: -1 as const });

describe('valueAtPath / sortKeyValues', () => {
  it('reads dotted paths and maps missing fields to null', () => {
    const doc = { _id: 1, a: { b: { c: 'x' } }, n: undefined };
    expect(valueAtPath(doc, 'a.b.c')).toBe('x');
    expect(valueAtPath(doc, 'a.z')).toBeNull();
    expect(valueAtPath(doc, 'a.b.c.d')).toBeNull();
    expect(valueAtPath(doc, 'n')).toBeNull();
    expect(sortKeyValues(doc, [asc('a.b.c'), desc('_id')])).toEqual({ 'a.b.c': 'x', _id: 1 });
  });
});

describe('rangeFilter', () => {
  it('single ascending key: after -> $gt, before -> $lt', () => {
    expect(rangeFilter([asc('_id')], { _id: 5 }, 'after')).toEqual({ _id: { $gt: 5 } });
    expect(rangeFilter([asc('_id')], { _id: 5 }, 'before')).toEqual({ _id: { $lt: 5 } });
  });

  it('single descending key: after -> $lt, before -> $gt', () => {
    expect(rangeFilter([desc('_id')], { _id: 5 }, 'after')).toEqual({ _id: { $lt: 5 } });
    expect(rangeFilter([desc('_id')], { _id: 5 }, 'before')).toEqual({ _id: { $gt: 5 } });
  });

  it('compound key builds the lexicographic $or with a first-key prefix bound', () => {
    const sort: SortSpec = [asc('last'), desc('age'), asc('_id')];
    const bound = { last: 'Lee', age: 40, _id: 7 };
    expect(rangeFilter(sort, bound, 'after')).toEqual({
      last: { $gte: 'Lee' },
      $or: [
        { last: { $gt: 'Lee' } },
        { last: { $eq: 'Lee' }, age: { $lt: 40 } },
        { last: { $eq: 'Lee' }, age: { $eq: 40 }, _id: { $gt: 7 } },
      ],
    });
    expect(rangeFilter(sort, bound, 'before')).toEqual({
      last: { $lte: 'Lee' },
      $or: [
        { last: { $lt: 'Lee' } },
        { last: { $eq: 'Lee' }, age: { $gt: 40 } },
        { last: { $eq: 'Lee' }, age: { $eq: 40 }, _id: { $lt: 7 } },
      ],
    });
  });

  it('compound key with a descending first key', () => {
    expect(rangeFilter([desc('d'), asc('_id')], { d: 3, _id: 1 }, 'after')).toEqual({
      d: { $lte: 3 },
      $or: [{ d: { $lt: 3 } }, { d: { $eq: 3 }, _id: { $gt: 1 } }],
    });
  });

  it('null bounds avoid type bracketing', () => {
    expect(rangeFilter([asc('a')], { a: null }, 'after')).toEqual({
      a: { $ne: null, $not: { $type: 'minKey' } },
    });
    expect(rangeFilter([asc('a')], { a: null }, 'before')).toEqual({ a: { $type: 'minKey' } });
    // No prefix bound on a null first key.
    expect(rangeFilter([asc('a'), asc('_id')], { a: null, _id: 2 }, 'after')).toEqual({
      $or: [{ a: { $ne: null, $not: { $type: 'minKey' } } }, { a: { $eq: null }, _id: { $gt: 2 } }],
    });
  });

  it('rejects an empty sort and a bound missing a key', () => {
    expect(() => rangeFilter([], {}, 'after')).toThrow(/at least one/);
    expect(() => rangeFilter([asc('a'), asc('_id')], { a: 1 }, 'after')).toThrow(/"_id"/);
  });
});

describe('rangeQuery / andFilter', () => {
  it('before runs the reversed sort and reverses the results', () => {
    const sort: SortSpec = [desc('d'), asc('_id')];
    expect(rangeQuery(sort, { d: 1, _id: 2 }, 'after')).toMatchObject({
      sort,
      reverseResults: false,
    });
    expect(rangeQuery(sort, { d: 1, _id: 2 }, 'before')).toMatchObject({
      sort: [asc('d'), desc('_id')],
      reverseResults: true,
    });
  });

  it('combines with the user filter', () => {
    const range = { _id: { $gt: 1 } };
    expect(andFilter(undefined, range)).toBe(range);
    expect(andFilter({}, range)).toBe(range);
    expect(andFilter({ s: 'open' }, range)).toEqual({ $and: [{ s: 'open' }, range] });
  });
});
