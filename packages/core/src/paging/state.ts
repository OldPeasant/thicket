import { andFilter, rangeQuery, sortKeyValues, type Filter, type SortKeyValues } from './range';
import {
  DEFAULT_SORT,
  isRangePageable,
  reverseSort,
  type SortSpec,
  type UniqueIndexKeys,
} from './sort';

/** Default rows per page (SPEC.md: 50 per page). */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * `range`: pages continue after/before the sort-key values of the current page's edge rows
 * (cheap at any depth). `skip`: pages are read with `skip`/`limit`.
 */
export type PagingMode = 'range' | 'skip';

/** Number of matching documents; `exact: false` for the (default) estimated count. */
export interface CountInfo {
  readonly value: number;
  readonly exact: boolean;
}

/** What is known about the page currently shown. */
export interface LoadedPage {
  readonly rows: number;
  /** Sort-key values of the first and last row (`null` for an empty page or an opaque sort). */
  readonly first: SortKeyValues | null;
  readonly last: SortKeyValues | null;
  /** No rows follow this page. */
  readonly isLast: boolean;
}

/** Paging state of one result view. Immutable; every function returns a new state. */
export interface PagingState {
  readonly pageSize: number;
  /**
   * Display sort. In range mode an empty user sort becomes `{_id: 1}`. `null` means a sort this
   * module can't interpret (e.g. `$meta`): the caller keeps sending its own sort document and
   * paging uses skip/limit.
   */
  readonly sort: SortSpec | null;
  readonly mode: PagingMode;
  /** 0-based index of the page shown (or being requested before the first load). */
  readonly pageIndex: number;
  readonly count: CountInfo | null;
  readonly page: LoadedPage | null;
}

/**
 * One page to read. `after`/`before` are sort-key values relative to the display `sort`;
 * `fromEnd` reads the last `limit` rows of the sorted result. {@link findPlan} turns this into
 * what the server runs.
 */
export interface PageRequest {
  readonly pageIndex: number;
  readonly sort: SortSpec | null;
  readonly limit: number;
  readonly skip?: number;
  readonly after?: SortKeyValues;
  readonly before?: SortKeyValues;
  readonly fromEnd: boolean;
}

export interface PagingOptions {
  /** Parsed user sort (`parseSort`); `null` for an opaque sort, empty or omitted for none. */
  readonly sort?: SortSpec | null;
  /** Unique indexes of the collection (plain, not sparse/partial); `_id` is implied. */
  readonly uniqueIndexes?: readonly UniqueIndexKeys[];
  readonly pageSize?: number;
  readonly count?: CountInfo | null;
}

function checkPageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError(`page size must be a positive integer, got ${pageSize}`);
  }
  return pageSize;
}

/** Initial state on page 1 (index 0). Chooses range mode when the sort allows it. */
export function createPaging(options: PagingOptions = {}): PagingState {
  const userSort = options.sort === undefined ? [] : options.sort;
  const mode: PagingMode = isRangePageable(userSort, options.uniqueIndexes) ? 'range' : 'skip';
  const sort = mode === 'range' && userSort?.length === 0 ? DEFAULT_SORT : userSort;
  return {
    pageSize: checkPageSize(options.pageSize ?? DEFAULT_PAGE_SIZE),
    sort,
    mode,
    pageIndex: 0,
    count: options.count ?? null,
    page: null,
  };
}

/** Changes the sort: picks the mode again and goes back to page 1. The count is kept. */
export function setSort(
  state: PagingState,
  sort: SortSpec | null,
  uniqueIndexes: readonly UniqueIndexKeys[] = [],
): PagingState {
  return createPaging({ sort, uniqueIndexes, pageSize: state.pageSize, count: state.count });
}

/** Changes the page size and goes back to page 1. */
export function setPageSize(state: PagingState, pageSize: number): PagingState {
  return { ...state, pageSize: checkPageSize(pageSize), pageIndex: 0, page: null };
}

/** Back to page 1 with no count, e.g. after the filter changed. */
export function resetPaging(state: PagingState): PagingState {
  return { ...state, pageIndex: 0, count: null, page: null };
}

/** Records an estimated or exact count. */
export function setCount(state: PagingState, value: number, exact: boolean): PagingState {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`count must be a non-negative integer, got ${value}`);
  }
  return { ...state, count: { value, exact } };
}

/** Number of pages for the known count (at least 1), or `null` without a count. */
export function pageCount(state: PagingState): number | null {
  if (state.count === null) return null;
  return Math.max(1, Math.ceil(state.count.value / state.pageSize));
}

export function canPrevious(state: PagingState): boolean {
  return state.pageIndex > 0;
}

export function canNext(state: PagingState): boolean {
  if (state.page?.isLast) return false;
  const pages = pageCount(state);
  if (state.count?.exact && pages !== null && state.pageIndex >= pages - 1) return false;
  // A short page means the end even when the count is only estimated.
  return state.page === null || state.page.rows >= state.pageSize;
}

/** Request for page 1. */
export function firstPage(state: PagingState): PageRequest {
  return { pageIndex: 0, sort: state.sort, limit: state.pageSize, fromEnd: false };
}

/** Request for the page after the current one (the current page must be loaded in range mode). */
export function nextPage(state: PagingState): PageRequest {
  const index = state.pageIndex + 1;
  const last = state.page?.last;
  if (state.mode === 'range' && last) {
    return {
      pageIndex: index,
      sort: state.sort,
      limit: state.pageSize,
      after: last,
      fromEnd: false,
    };
  }
  return skipRequest(state, index);
}

/** Request for the page before the current one; page 1 is read without a bound. */
export function previousPage(state: PagingState): PageRequest {
  const index = Math.max(0, state.pageIndex - 1);
  if (index === 0) return firstPage(state);
  const first = state.page?.first;
  if (state.mode === 'range' && first) {
    return {
      pageIndex: index,
      sort: state.sort,
      limit: state.pageSize,
      before: first,
      fromEnd: false,
    };
  }
  return skipRequest(state, index);
}

/**
 * Request for the last page. With a sort that can be reversed, reads the final rows with the
 * reversed sort (no deep skip); its size is the remainder of an exact count, else a full page.
 * Without a count the page index can't be known and stays one past the current page.
 */
export function lastPage(state: PagingState): PageRequest {
  const pages = pageCount(state);
  const index = pages === null ? state.pageIndex + 1 : pages - 1;
  if (state.sort === null || state.sort.length === 0) {
    // Opaque sort or natural order: nothing to reverse, so skip to the last page.
    return skipRequest(state, index);
  }
  let limit = state.pageSize;
  if (state.count?.exact && state.count.value > 0) {
    limit = state.count.value - index * state.pageSize;
  }
  return { pageIndex: index, sort: state.sort, limit, fromEnd: true };
}

/**
 * Request for page `pageIndex` (0-based). Neighbours of the current page, page 1 and the last
 * page (exact count) use the cheap requests above; other pages in range mode are read once with
 * skip/limit, and paging continues by range from there.
 */
export function jumpToPage(state: PagingState, pageIndex: number): PageRequest {
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    throw new RangeError(`page index must be a non-negative integer, got ${pageIndex}`);
  }
  const pages = pageCount(state);
  const target = pages !== null && state.count?.exact ? Math.min(pageIndex, pages - 1) : pageIndex;
  if (target === 0) return firstPage(state);
  if (state.count?.exact && pages !== null && target === pages - 1) return lastPage(state);
  if (state.page !== null && target === state.pageIndex + 1) return nextPage(state);
  if (state.page !== null && target === state.pageIndex - 1) return previousPage(state);
  return skipRequest(state, target);
}

function skipRequest(state: PagingState, pageIndex: number): PageRequest {
  return {
    pageIndex,
    sort: state.sort,
    limit: state.pageSize,
    skip: pageIndex * state.pageSize,
    fromEnd: false,
  };
}

/**
 * Records a loaded page. `docs` are in display order (after `findPlan`'s `reverseResults`).
 * A `before` request that returns fewer rows than asked has reached the start: it becomes page 1.
 */
export function pageLoaded(
  state: PagingState,
  request: PageRequest,
  docs: readonly unknown[],
): PagingState {
  const rows = docs.length;
  const keySort = state.sort !== null && state.sort.length > 0 ? state.sort : null;
  const keysOf = (doc: unknown): SortKeyValues | null =>
    keySort === null || doc === undefined ? null : sortKeyValues(doc, keySort);
  const short = rows < request.limit;
  let pageIndex = request.pageIndex;
  if (request.before !== undefined && short) pageIndex = 0;
  const isLast = request.fromEnd || (short && request.before === undefined);
  return {
    ...state,
    pageIndex,
    page: { rows, first: keysOf(docs[0]), last: keysOf(docs[rows - 1]), isLast },
  };
}

/** What the server runs for a {@link PageRequest}. */
export interface FindPlan {
  readonly filter: Filter;
  /** Sort to send; `null`: send the caller's own (opaque) sort; empty: no sort. */
  readonly sort: SortSpec | null;
  readonly skip?: number;
  readonly limit: number;
  /** Reverse the returned rows to get display order. */
  readonly reverseResults: boolean;
}

/** Turns a request into the server query, combining `filter` with any range bound. */
export function findPlan(request: PageRequest, filter: Filter = {}): FindPlan {
  const bound = request.after ?? request.before;
  if (bound !== undefined) {
    if (request.sort === null || request.sort.length === 0) {
      throw new Error('range paging needs a sort');
    }
    const q = rangeQuery(request.sort, bound, request.after !== undefined ? 'after' : 'before');
    return {
      filter: andFilter(filter, q.filter),
      sort: q.sort,
      limit: request.limit,
      reverseResults: q.reverseResults,
    };
  }
  if (request.fromEnd && request.sort !== null && request.sort.length > 0) {
    return {
      filter,
      sort: reverseSort(request.sort),
      limit: request.limit,
      reverseResults: true,
    };
  }
  return {
    filter,
    sort: request.sort,
    ...(request.skip !== undefined && request.skip > 0 ? { skip: request.skip } : {}),
    limit: request.limit,
    reverseResults: false,
  };
}
