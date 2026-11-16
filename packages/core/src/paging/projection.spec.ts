import { describe, expect, it } from 'vitest';

import { projectionWithSortKeys } from './projection';
import { DEFAULT_SORT, type SortSpec } from './sort';

const asc = (field: string) => ({ field, direction: 1 as const });
const desc = (field: string) => ({ field, direction: -1 as const });

describe('projectionWithSortKeys', () => {
  it('returns undefined, empty projections and opaque or empty sorts unchanged', () => {
    expect(projectionWithSortKeys(undefined, DEFAULT_SORT)).toBeUndefined();
    const empty = {};
    expect(projectionWithSortKeys(empty, DEFAULT_SORT)).toBe(empty);
    const p = { _id: 0, name: 1 };
    expect(projectionWithSortKeys(p, null)).toBe(p);
    expect(projectionWithSortKeys(p, [])).toBe(p);
  });

  it('inclusion: adds missing sort fields and does not modify the input', () => {
    const p = { name: 1 };
    const sort: SortSpec = [desc('last'), asc('_id')];
    expect(projectionWithSortKeys(p, sort)).toEqual({ name: 1, last: 1 });
    expect(p).toEqual({ name: 1 });
  });

  it('inclusion: `_id: 0` is removed when sorting on _id (or a path under it)', () => {
    expect(projectionWithSortKeys({ _id: 0, name: 1 }, DEFAULT_SORT)).toEqual({ name: 1 });
    expect(projectionWithSortKeys({ _id: 0, name: 1 }, [asc('_id.k')])).toEqual({ name: 1 });
  });

  it('inclusion: a field or parent path already included is kept as is', () => {
    expect(projectionWithSortKeys({ last: 1, _id: 1 }, [asc('last'), asc('_id')])).toEqual({
      last: 1,
      _id: 1,
    });
    expect(projectionWithSortKeys({ customer: true }, [asc('customer.name'), asc('_id')])).toEqual({
      customer: true,
    });
  });

  it('inclusion: included child paths are replaced by the sort field', () => {
    expect(
      projectionWithSortKeys({ 'customer.name': 1, 'customer.city': 1, total: 1 }, [
        asc('customer'),
        asc('_id'),
      ]),
    ).toEqual({ total: 1, customer: 1 });
  });

  it('inclusion: operators on other fields are kept; on a sort field they are replaced', () => {
    const p = { tags: { $slice: 2 }, items: { $elemMatch: { qty: 1 } }, name: 1 };
    expect(projectionWithSortKeys(p, [asc('name'), asc('_id')])).toEqual(p);
    expect(projectionWithSortKeys({ label: { $toUpper: '$name' } }, [asc('label')])).toEqual({
      label: 1,
    });
  });

  it('inclusion: `{_id: 1}` alone is an inclusion projection', () => {
    expect(projectionWithSortKeys({ _id: 1 }, [asc('a'), asc('_id')])).toEqual({ _id: 1, a: 1 });
  });

  it('exclusion: removes exclusions of sort fields, their parents and children', () => {
    expect(projectionWithSortKeys({ _id: 0 }, DEFAULT_SORT)).toEqual({});
    expect(projectionWithSortKeys({ last: 0, big: 0 }, [desc('last'), asc('_id')])).toEqual({
      big: 0,
    });
    expect(projectionWithSortKeys({ customer: 0, big: false }, [asc('customer.name')])).toEqual({
      big: false,
    });
    expect(projectionWithSortKeys({ 'customer.name': 0 }, [asc('customer'), asc('_id')])).toEqual(
      {},
    );
    expect(projectionWithSortKeys({ _id: 1, last: 0 }, [asc('last'), asc('_id')])).toEqual({
      _id: 1,
    });
  });

  it('exclusion and neutral operators: kept on other fields, removed on sort fields', () => {
    expect(
      projectionWithSortKeys({ tags: { $slice: 2 }, big: 0 }, [asc('name'), asc('_id')]),
    ).toEqual({ tags: { $slice: 2 }, big: 0 });
    expect(
      projectionWithSortKeys({ score: { $meta: 'textScore' } }, [desc('score'), asc('_id')]),
    ).toEqual({});
    const neutral = { s: { $meta: 'textScore' } };
    expect(projectionWithSortKeys(neutral, DEFAULT_SORT)).toEqual(neutral);
  });

  // --- Added by the test-writer (final revision). ---

  it('literal values (arrays, null) make an inclusion projection, so sort fields are added', () => {
    const sort: SortSpec = [asc('name'), asc('_id')];
    expect(projectionWithSortKeys({ copy: [1, 2] }, sort)).toEqual({ copy: [1, 2], name: 1 });
    expect(projectionWithSortKeys({ flag: null }, sort)).toEqual({ flag: null, name: 1 });
  });

  it('a field sharing only a name prefix with a sort field is not treated as related', () => {
    const sort: SortSpec = [asc('name'), asc('_id')];
    // Exclusion: `nameFull` is neither `name`, nor a parent or child path of it.
    expect(projectionWithSortKeys({ nameFull: 0 }, sort)).toEqual({ nameFull: 0 });
    // Inclusion: `nameFull: 1` does not cover `name`, so `name` is still added.
    expect(projectionWithSortKeys({ nameFull: 1 }, sort)).toEqual({ nameFull: 1, name: 1 });
  });

  it('inclusion: a sibling path under _id does not cover another _id path sort key', () => {
    expect(projectionWithSortKeys({ '_id.a': 1, name: 1 }, [asc('_id.b')])).toEqual({
      '_id.a': 1,
      name: 1,
      '_id.b': 1,
    });
  });
});
