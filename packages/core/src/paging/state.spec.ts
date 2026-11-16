import { describe, expect, it } from 'vitest';

import { valueAtPath, type Filter } from './range';
import { parseSort, type SortSpec } from './sort';
import {
  canNext,
  canPrevious,
  createPaging,
  findPlan,
  firstPage,
  jumpToPage,
  lastPage,
  nextPage,
  pageCount,
  pageLoaded,
  previousPage,
  resetPaging,
  setCount,
  setPageSize,
  setSort,
  type PageRequest,
  type PagingState,
} from './state';

// --- A tiny in-memory "server" that understands the filters this module produces. ---

type Doc = Record<string, unknown>;

/** BSON type order for the values used here: null < numbers < strings. */
function rank(v: unknown): number {
  if (v === null) return 1;
  if (typeof v === 'number') return 2;
  return 3;
}

function cmp(a: unknown, b: unknown): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (a === null) return 0;
  return (a as number | string) < (b as number | string)
    ? -1
    : (a as number | string) > (b as number | string)
      ? 1
      : 0;
}

function matchCond(value: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== 'object')
    return cmp(value, cond) === 0 && rank(value) === rank(cond);
  return Object.entries(cond as Record<string, unknown>).every(([op, arg]) => {
    const sameType = rank(value) === rank(arg);
    switch (op) {
      case '$eq':
        return sameType && cmp(value, arg) === 0;
      case '$ne':
        return !(sameType && cmp(value, arg) === 0);
      case '$gt':
        return sameType && cmp(value, arg) > 0;
      case '$gte':
        return sameType && cmp(value, arg) >= 0;
      case '$lt':
        return sameType && cmp(value, arg) < 0;
      case '$lte':
        return sameType && cmp(value, arg) <= 0;
      case '$type':
        return false; // no MinKey values in these tests
      case '$not':
        return !matchCond(value, arg);
      default:
        throw new Error(`unsupported operator ${op}`);
    }
  });
}

function matches(doc: Doc, filter: Filter): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$and') return (cond as Filter[]).every((f) => matches(doc, f));
    if (key === '$or') return (cond as Filter[]).some((f) => matches(doc, f));
    return matchCond(valueAtPath(doc, key), cond);
  });
}

function sortDocs(docs: Doc[], sort: SortSpec | null): Doc[] {
  if (sort === null || sort.length === 0) return [...docs];
  return [...docs].sort((a, b) => {
    for (const k of sort) {
      const c = cmp(valueAtPath(a, k.field), valueAtPath(b, k.field));
      if (c !== 0) return c * k.direction;
    }
    return 0;
  });
}

/** Runs a request like the backend would and returns rows in display order. */
function run(all: Doc[], req: PageRequest, filter: Filter = {}): Doc[] {
  const plan = findPlan(req, filter);
  const sorted = sortDocs(
    all.filter((d) => matches(d, plan.filter)),
    plan.sort,
  );
  const rows = sorted.slice(plan.skip ?? 0, (plan.skip ?? 0) + plan.limit);
  return plan.reverseResults ? rows.reverse() : rows;
}

function load(all: Doc[], state: PagingState, req: PageRequest, filter?: Filter) {
  const rows = run(all, req, filter);
  return { state: pageLoaded(state, req, rows), rows };
}

const ids = (rows: Doc[]) => rows.map((r) => r._id);
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

/** 23 docs, _id 0..22, group cycles 0..2, name repeats (not unique). */
const DOCS: Doc[] = range(0, 23).map((i) => ({ _id: i, group: i % 3, name: `n${i % 5}` }));

/** Expected page `p` (0-based) of `DOCS` in `sort` order with `size` rows per page. */
function expected(sort: SortSpec, p: number, size: number): unknown[] {
  return ids(sortDocs(DOCS, sort).slice(p * size, (p + 1) * size));
}

describe('mode selection', () => {
  it('uses range paging on _id by default', () => {
    const s = createPaging();
    expect(s.mode).toBe('range');
    expect(s.sort).toEqual([{ field: '_id', direction: 1 }]);
    expect(s.pageSize).toBe(50);
  });

  it('uses range paging when the sort covers a unique index', () => {
    expect(createPaging({ sort: parseSort({ _id: -1 }) }).mode).toBe('range');
    expect(createPaging({ sort: parseSort({ group: 1, _id: 1 }) }).mode).toBe('range');
    expect(createPaging({ sort: parseSort({ email: 1 }), uniqueIndexes: [['email']] }).mode).toBe(
      'range',
    );
    expect(
      createPaging({ sort: parseSort({ b: -1, a: 1 }), uniqueIndexes: [['a', 'b']] }).mode,
    ).toBe('range');
  });

  it('falls back to skip for non-unique or opaque sorts', () => {
    expect(createPaging({ sort: parseSort({ name: 1 }) }).mode).toBe('skip');
    expect(createPaging({ sort: parseSort({ a: 1 }), uniqueIndexes: [['a', 'b']] }).mode).toBe(
      'skip',
    );
    const opaque = createPaging({ sort: parseSort({ s: { $meta: 'textScore' } }) });
    expect(opaque.mode).toBe('skip');
    expect(opaque.sort).toBeNull();
  });

  it('rejects invalid page sizes and counts', () => {
    expect(() => createPaging({ pageSize: 0 })).toThrow(RangeError);
    expect(() => setPageSize(createPaging(), 2.5)).toThrow(RangeError);
    expect(() => setCount(createPaging(), -1, true)).toThrow(RangeError);
  });
});

/** Walks next to the end, then previous back to the start, checking every page. */
function walk(sort: SortSpec, mode: 'range' | 'skip', size: number) {
  let s = createPaging({ sort, pageSize: size });
  expect(s.mode).toBe(mode);
  let r = load(DOCS, s, firstPage(s));
  s = r.state;
  expect(ids(r.rows)).toEqual(expected(s.sort ?? [], 0, size));
  const pages = Math.ceil(DOCS.length / size);
  for (let p = 1; p < pages; p++) {
    expect(canNext(s)).toBe(true);
    const req = nextPage(s);
    if (mode === 'range') {
      expect(req.after).toBeDefined();
      expect(req.skip).toBeUndefined();
    } else {
      expect(req.skip).toBe(p * size);
    }
    r = load(DOCS, s, req);
    s = r.state;
    expect(s.pageIndex).toBe(p);
    expect(ids(r.rows)).toEqual(expected(s.sort ?? [], p, size));
  }
  expect(canNext(s)).toBe(false);
  for (let p = pages - 2; p >= 0; p--) {
    expect(canPrevious(s)).toBe(true);
    const req = previousPage(s);
    if (mode === 'range' && p > 0) expect(req.before).toBeDefined();
    r = load(DOCS, s, req);
    s = r.state;
    expect(s.pageIndex).toBe(p);
    expect(ids(r.rows)).toEqual(expected(s.sort ?? [], p, size));
  }
  expect(canPrevious(s)).toBe(false);
}

describe('next / previous', () => {
  it('range mode, ascending _id', () => walk(parseSort({ _id: 1 }) ?? [], 'range', 5));
  it('range mode, descending _id', () => walk(parseSort({ _id: -1 }) ?? [], 'range', 5));
  it('range mode, compound sort with a descending key', () =>
    walk(parseSort({ group: -1, _id: 1 }) ?? [], 'range', 4));
  it('range mode, compound sort, both descending', () =>
    walk(parseSort({ group: -1, _id: -1 }) ?? [], 'range', 3));
  it('skip mode, non-unique sort', () => walk(parseSort({ name: 1 }) ?? [], 'skip', 5));

  it('skip mode combines with a user filter', () => {
    let s = createPaging({ sort: parseSort({ name: 1 }), pageSize: 2 });
    const filter = { group: { $eq: 1 } };
    s = load(DOCS, s, firstPage(s), filter).state;
    const r = load(DOCS, s, nextPage(s), filter);
    expect(r.rows.every((d) => d.group === 1)).toBe(true);
    expect(r.state.pageIndex).toBe(1);
  });

  it('range mode combines the bound with a user filter', () => {
    let s = createPaging({ pageSize: 3 });
    const filter = { group: { $eq: 2 } };
    s = load(DOCS, s, firstPage(s), filter).state;
    const req = nextPage(s);
    expect(findPlan(req, filter).filter).toEqual({ $and: [filter, { _id: { $gt: 8 } }] });
    expect(ids(load(DOCS, s, req, filter).rows)).toEqual([11, 14, 17]);
  });

  it('previous from page 2 reads page 1 without a bound', () => {
    let s = createPaging({ pageSize: 5 });
    s = load(DOCS, s, firstPage(s)).state;
    s = load(DOCS, s, nextPage(s)).state;
    expect(previousPage(s)).toEqual(firstPage(s));
  });

  it('a short "before" page means the start was reached', () => {
    const s: PagingState = {
      ...createPaging({ pageSize: 5 }),
      pageIndex: 3,
      page: { rows: 5, first: { _id: 2 }, last: { _id: 6 }, isLast: false },
    };
    const req = previousPage(s);
    const r = load(DOCS, s, req);
    expect(ids(r.rows)).toEqual([0, 1]);
    expect(r.state.pageIndex).toBe(0);
    expect(canPrevious(r.state)).toBe(false);
  });
});

describe('last page', () => {
  it('range mode reads the remainder with the reversed sort (exact count)', () => {
    let s = setCount(createPaging({ pageSize: 5 }), DOCS.length, true);
    expect(pageCount(s)).toBe(5);
    s = load(DOCS, s, firstPage(s)).state;
    const req = lastPage(s);
    expect(req).toMatchObject({ pageIndex: 4, limit: 3, fromEnd: true });
    expect(req.skip).toBeUndefined();
    const plan = findPlan(req);
    expect(plan.sort).toEqual([{ field: '_id', direction: -1 }]);
    expect(plan.reverseResults).toBe(true);
    const r = load(DOCS, s, req);
    s = r.state;
    expect(ids(r.rows)).toEqual([20, 21, 22]);
    expect(canNext(s)).toBe(false);
    // Previous from the last page continues by range.
    const prev = previousPage(s);
    expect(prev.before).toEqual({ _id: 20 });
    const p = load(DOCS, s, prev);
    expect(ids(p.rows)).toEqual(expected(s.sort ?? [], 3, 5));
    expect(p.state.pageIndex).toBe(3);
  });

  it('range mode, descending compound sort', () => {
    const sort = parseSort({ group: -1, _id: -1 }) ?? [];
    let s = setCount(createPaging({ sort, pageSize: 4 }), DOCS.length, true);
    const r = load(DOCS, s, lastPage(s));
    s = r.state;
    expect(s.pageIndex).toBe(5);
    expect(ids(r.rows)).toEqual(expected(sort, 5, 4));
    const p = load(DOCS, s, previousPage(s));
    expect(ids(p.rows)).toEqual(expected(sort, 4, 4));
  });

  it('estimated count reads a full page from the end', () => {
    const s = setCount(createPaging({ pageSize: 5 }), 21, false);
    const req = lastPage(s);
    expect(req).toMatchObject({ pageIndex: 4, limit: 5, fromEnd: true });
    const r = load(DOCS, s, req);
    expect(ids(r.rows)).toEqual([18, 19, 20, 21, 22]);
    expect(r.state.page?.isLast).toBe(true);
    expect(canNext(r.state)).toBe(false);
  });

  it('skip mode with a sort also reads from the end', () => {
    const sort = parseSort({ name: 1 }) ?? [];
    let s = setCount(createPaging({ sort, pageSize: 5 }), DOCS.length, true);
    const r = load(DOCS, s, lastPage(s));
    s = r.state;
    expect(s.pageIndex).toBe(4);
    expect(r.rows.map((d) => d.name)).toEqual(
      sortDocs(DOCS, sort)
        .slice(20)
        .map((d) => d.name),
    );
    const prev = previousPage(s);
    expect(prev.skip).toBe(15);
  });

  it('opaque sort skips to the last page by count', () => {
    const s = setCount(createPaging({ sort: null, pageSize: 5 }), DOCS.length, true);
    expect(lastPage(s)).toMatchObject({ pageIndex: 4, skip: 20, fromEnd: false });
    expect(findPlan(lastPage(s))).toMatchObject({ sort: null, skip: 20, limit: 5 });
  });

  it('empty collection', () => {
    const s = setCount(createPaging({ pageSize: 5 }), 0, true);
    expect(lastPage(s)).toMatchObject({ pageIndex: 0, limit: 5 });
    const r = load([], s, lastPage(s));
    expect(r.state.page).toEqual({ rows: 0, first: null, last: null, isLast: true });
  });

  it('without a count the index is one past the current page', () => {
    expect(lastPage(createPaging()).pageIndex).toBe(1);
  });
});

describe('jump to page', () => {
  it('range mode: far jumps use skip once, then paging continues by range', () => {
    let s = setCount(createPaging({ pageSize: 4 }), DOCS.length, true);
    s = load(DOCS, s, firstPage(s)).state;
    const req = jumpToPage(s, 3);
    expect(req).toMatchObject({ pageIndex: 3, skip: 12 });
    let r = load(DOCS, s, req);
    s = r.state;
    expect(ids(r.rows)).toEqual(expected(s.sort ?? [], 3, 4));
    const next = nextPage(s);
    expect(next.after).toEqual({ _id: 15 });
    r = load(DOCS, s, next);
    expect(ids(r.rows)).toEqual(expected(s.sort ?? [], 4, 4));
  });

  it('range mode: neighbours, first and last use the cheap requests', () => {
    let s = setCount(createPaging({ pageSize: 4 }), DOCS.length, true);
    s = load(DOCS, s, jumpToPage(s, 2)).state;
    expect(jumpToPage(s, 3)).toEqual(nextPage(s));
    expect(jumpToPage(s, 1)).toEqual(previousPage(s));
    expect(jumpToPage(s, 0)).toEqual(firstPage(s));
    expect(jumpToPage(s, 5)).toEqual(lastPage(s));
    expect(jumpToPage(s, 99)).toEqual(lastPage(s)); // clamped with an exact count
  });

  it('skip mode', () => {
    const sort = parseSort({ name: -1 }) ?? [];
    let s = createPaging({ sort, pageSize: 5 });
    const req = jumpToPage(s, 2);
    expect(req).toMatchObject({ pageIndex: 2, skip: 10, limit: 5 });
    const r = load(DOCS, s, req);
    s = r.state;
    expect(r.rows.map((d) => d.name)).toEqual(
      sortDocs(DOCS, sort)
        .slice(10, 15)
        .map((d) => d.name),
    );
    expect(jumpToPage(s, 3).skip).toBe(15);
  });

  it('rejects invalid indexes', () => {
    expect(() => jumpToPage(createPaging(), -1)).toThrow(RangeError);
    expect(() => jumpToPage(createPaging(), 1.5)).toThrow(RangeError);
  });
});

describe('resets', () => {
  function onPage3(): PagingState {
    let s = setCount(createPaging({ pageSize: 4 }), DOCS.length, false);
    s = load(DOCS, s, jumpToPage(s, 2)).state;
    expect(s.pageIndex).toBe(2);
    return s;
  }

  it('switching sort resets to page 1 and re-picks the mode', () => {
    const s = setSort(onPage3(), parseSort({ name: 1 }));
    expect(s).toMatchObject({ pageIndex: 0, page: null, mode: 'skip', pageSize: 4 });
    expect(s.count).toEqual({ value: DOCS.length, exact: false });
    expect(firstPage(s)).toMatchObject({ pageIndex: 0, sort: [{ field: 'name', direction: 1 }] });
    const back = setSort(s, parseSort({ email: -1 }), [['email']]);
    expect(back).toMatchObject({ pageIndex: 0, mode: 'range' });
    expect(setSort(onPage3(), [])).toMatchObject({
      pageIndex: 0,
      sort: [{ field: '_id', direction: 1 }],
    });
  });

  it('changing the page size resets to page 1', () => {
    expect(setPageSize(onPage3(), 100)).toMatchObject({ pageIndex: 0, page: null, pageSize: 100 });
  });

  it('resetPaging drops the count', () => {
    expect(resetPaging(onPage3())).toMatchObject({ pageIndex: 0, page: null, count: null });
  });
});

describe('counts', () => {
  it('estimated count does not stop next; a short page does', () => {
    let s = setCount(createPaging({ pageSize: 5 }), 10, false);
    s = load(DOCS, s, jumpToPage(s, 1)).state;
    expect(canNext(s)).toBe(true); // estimate says 2 pages, but rows keep coming
    s = setCount(s, 10, true);
    expect(canNext(s)).toBe(false);
    expect(pageCount(createPaging())).toBeNull();
    expect(pageCount(setCount(createPaging(), 0, true))).toBe(1);
  });
});
