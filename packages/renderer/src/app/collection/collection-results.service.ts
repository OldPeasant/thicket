import { computed, inject, Injectable, type OnDestroy, signal } from '@angular/core';
import type { ParamsOf, SlicedArray } from '@thicket/contract';
import {
  canNext,
  canPrevious,
  createPaging,
  firstPage,
  jumpToPage,
  lastPage,
  nextPage,
  pageCount,
  pageLoaded,
  type PageRequest,
  type PagingState,
  previousPage,
  setCount,
  setPageSize,
  sortDocument,
} from '@thicket/core/paging';
import type { Subscription } from 'rxjs';

import { ApiError, ApiService, describeError } from '../api';
import { NestedPageSizeService } from '../explorer/services/nested-page-size.service';
import type { ParsedQuery } from './query.util';

/** Page sizes offered by the pager (SPEC.md M1 Paging). */
export const PAGE_SIZES = [20, 50, 100, 500] as const;

/** The collection a tab shows. */
export interface CollectionTarget {
  profileId: string;
  db: string;
  coll: string;
}

/**
 * Documents bigger than this (BSON bytes) come with their long top-level arrays cut to one page
 * (`docs.find`'s `slice`); the other pages are read with `docs.getSlice` when shown.
 */
export const LARGE_DOC_BYTES = 1024 * 1024;

/** A loaded page: documents as canonical EJSON text, in display order. */
export interface ResultPage {
  docs: readonly string[];
  /**
   * The arrays a large document came with only partly, at the document's index (`undefined`
   * for a document loaded whole).
   */
  sliced?: readonly (readonly SlicedArray[] | undefined)[];
  /** 0-based index of the first row in the whole result, when known. */
  firstRow: number;
}

const EMPTY_QUERY: ParsedQuery = { filter: '{}', sortSpec: [], emptyFilter: true };

/**
 * Query state of one collection tab: the applied query, paging (paging-core), the page shown, the
 * count and the running operations. A page replaces the shown one only when it was read
 * completely; a cancelled or failed read keeps the previous page. Provided per collection view.
 */
@Injectable()
export class CollectionResults implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly nestedPageSize = inject(NestedPageSizeService);

  private targetValue: CollectionTarget | null = null;
  private readonly queryState = signal<ParsedQuery>(EMPTY_QUERY);
  private readonly pagingState = signal<PagingState>(createPaging());
  private readonly pageState = signal<ResultPage | null>(null);
  private readonly loadingState = signal(false);
  private readonly countingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly noticeState = signal<string | null>(null);

  /** The running page read and count. */
  private find: Subscription | null = null;
  private countAbort: AbortController | null = null;
  /** Bumped for every new read/count, so late answers of older ones are dropped. */
  private findGeneration = 0;
  private countGeneration = 0;
  /** Count generation of the exact count that Last waits for (skip mode), else `null`. */
  private lastAfterCount: number | null = null;
  /**
   * Pages between the shown page and the last one, while the shown page's index is not known: the
   * last page was read from the end without an exact count (none, or only an estimate), and maybe
   * paged by range from there. `null` when the index is known. While it is set, `pageIndex` is
   * only a placeholder (at least 1 on a last page, so Previous stays possible).
   */
  private readonly fromEndState = signal<number | null>(null);
  private readonly pageLoadsState = signal(0);

  readonly query = this.queryState.asReadonly();
  readonly paging = this.pagingState.asReadonly();
  readonly page = this.pageState.asReadonly();
  /** Bumped whenever a page read arrives (not when `patchDocument` changes the page shown). */
  readonly pageLoads = this.pageLoadsState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly counting = this.countingState.asReadonly();
  /** Something is running that Cancel stops. */
  readonly busy = computed(() => this.loadingState() || this.countingState());
  /** The last read or count failed with this message. */
  readonly error = this.errorState.asReadonly();
  /** A neutral note, e.g. "Query cancelled". */
  readonly notice = this.noticeState.asReadonly();

  readonly pageCount = computed(() => pageCount(this.pagingState()));
  readonly canPrevious = computed(() => canPrevious(this.pagingState()));
  readonly canNext = computed(() => canNext(this.pagingState()));
  readonly count = computed(() => this.pagingState().count);
  /** See `fromEndState`; the pager then shows "last page" instead of a guessed number. */
  readonly pagesFromEnd = this.fromEndState.asReadonly();

  /** Sets the collection. Call once before `run`. */
  setTarget(target: CollectionTarget): void {
    this.targetValue = target;
  }

  /** Applies `query` and reads page 1 (with the estimated count when the filter is empty). */
  run(query: ParsedQuery, pageSize = this.pagingState().pageSize): void {
    this.cancel(false);
    this.queryState.set(query);
    this.pagingState.set(
      createPaging({
        sort: query.sortSpec,
        pageSize,
        collation: query.collation !== undefined,
      }),
    );
    this.pageState.set(null);
    this.fromEndState.set(null);
    this.load(firstPage(this.pagingState()));
    if (query.emptyFilter) this.estimateCount();
  }

  first(): void {
    this.load(firstPage(this.pagingState()));
  }

  previous(): void {
    if (!this.canPrevious()) return;
    const state = this.pagingState();
    const first = state.page?.first;
    if (this.fromEndState() !== null && state.mode === 'range' && first) {
      // The index is a placeholder, so paging-core's previousPage could fall back to page 1:
      // read the rows before the shown page instead. A short answer reached the start; page 1 is
      // then read again from the start (pageArrived).
      this.load({
        pageIndex: Math.max(1, state.pageIndex - 1),
        sort: state.sort,
        limit: state.pageSize,
        before: first,
        fromEnd: false,
      });
      return;
    }
    this.load(previousPage(state));
  }

  next(): void {
    if (this.canNext()) this.load(nextPage(this.pagingState()));
  }

  last(): void {
    const state = this.pagingState();
    const limited = this.queryState().limit !== undefined;
    if (
      !state.count?.exact &&
      ((state.mode === 'skip' && (state.count === null || lastPage(state).fromEnd)) || limited)
    ) {
      // Skip mode has no `before` bound to page back from a page read from the end, and without
      // a count there is no last page to skip to: count exactly first, then read the last page.
      // With a user limit the last page is a skip read too, and the count stops at the limit.
      this.lastAfterCount = this.startExactCount();
      return;
    }
    this.load(lastPage(state));
  }

  /**
   * Goes to page `pageNumber` (1-based). Returns false when nothing is read (an invalid number or
   * a page beyond the user's limit).
   */
  jump(pageNumber: number): boolean {
    if (!Number.isInteger(pageNumber) || pageNumber < 1) return false;
    const state = this.pagingState();
    // While the shown page's index is a placeholder, the pages next to that index are not its
    // neighbours: read the page by number (skip), not from the shown page's edge rows.
    const base = this.fromEndState() === null ? state : { ...state, page: null };
    return this.load(jumpToPage(base, pageNumber - 1));
  }

  /** Reads page 1 with `size` rows; the new size applies once that page arrived. */
  setPageSize(size: number): void {
    this.load(firstPage(setPageSize(this.pagingState(), size)), size);
  }

  /** Counts the matching documents exactly (`docs.count`). */
  countExact(): void {
    this.startExactCount();
  }

  /** Starts `docs.count`; returns its count generation (`null` without a target). */
  private startExactCount(): number | null {
    const target = this.targetValue;
    if (target === null) return null;
    this.lastAfterCount = null;
    const query = this.queryState();
    this.countAbort?.abort();
    const abort = new AbortController();
    this.countAbort = abort;
    const generation = ++this.countGeneration;
    this.countingState.set(true);
    this.errorState.set(null);
    this.noticeState.set(null);
    const params: ParamsOf<'docs.count'> = { ...target, filter: query.filter };
    if (query.collation !== undefined) params.collation = query.collation;
    if (query.limit !== undefined) params.limit = query.limit;
    this.api.request('docs.count', params, { signal: abort.signal }).then(
      ({ count }) => {
        if (generation !== this.countGeneration) return;
        this.countAbort = null;
        this.countingState.set(false);
        const thenLast = this.lastAfterCount === generation;
        this.lastAfterCount = null;
        this.applyCount(count, true);
        if (thenLast) this.load(lastPage(this.pagingState()));
      },
      (error: unknown) => {
        if (generation !== this.countGeneration) return;
        this.countAbort = null;
        this.countingState.set(false);
        this.lastAfterCount = null;
        this.reportFailure(error);
      },
    );
    return generation;
  }

  /**
   * Stops the running page read and count. The page shown stays. With `report` a notice says so.
   */
  cancel(report = true): void {
    const wasBusy = this.busy();
    if (this.find !== null) {
      this.find.unsubscribe();
      this.find = null;
    }
    this.findGeneration++;
    this.loadingState.set(false);
    if (this.countAbort !== null) {
      this.countAbort.abort();
      this.countAbort = null;
    }
    this.countGeneration++;
    this.countingState.set(false);
    this.lastAfterCount = null;
    if (report && wasBusy) {
      this.errorState.set(null);
      this.noticeState.set('Query cancelled.');
    }
  }

  /**
   * A shown document changed on the server (saved or deleted from this tab): replaces the
   * document at `index` of the shown page with `doc` (canonical EJSON), or removes it for `null`.
   * `docSliced`: the arrays `doc` has only partly (a large document read back cut); without it
   * `doc` is whole. The page is not read again; paging and counts stay as they are.
   */
  patchDocument(index: number, doc: string | null, docSliced?: readonly SlicedArray[]): void {
    const page = this.pageState();
    if (page === null || index < 0 || index >= page.docs.length) return;
    const docs = page.docs.slice();
    let sliced = page.sliced?.slice();
    if (doc === null) {
      docs.splice(index, 1);
      sliced?.splice(index, 1);
    } else {
      docs[index] = doc;
      if (docSliced !== undefined && docSliced.length > 0) {
        sliced ??= new Array<readonly SlicedArray[] | undefined>(docs.length).fill(undefined);
        sliced[index] = docSliced;
      } else if (sliced) {
        sliced[index] = undefined;
      }
    }
    if (sliced && !sliced.some(Boolean)) sliced = undefined;
    this.pageState.set(sliced ? { ...page, docs, sliced } : { docs, firstRow: page.firstRow });
  }

  /** Arrays above this many items are cut in large documents (`docs.find`'s `slice.above`). */
  sliceAbove(): number {
    return this.nestedPageSize.size();
  }

  ngOnDestroy(): void {
    this.cancel(false);
  }

  private estimateCount(): void {
    const target = this.targetValue;
    if (target === null) return;
    const generation = ++this.countGeneration;
    const abort = new AbortController();
    this.countAbort = abort;
    this.countingState.set(true);
    this.api.request('docs.estimatedCount', target, { signal: abort.signal }).then(
      ({ count }) => {
        if (generation !== this.countGeneration) return;
        this.countAbort = null;
        this.countingState.set(false);
        this.applyCount(count, false);
      },
      () => {
        // Without an estimate the pager just shows no total; the page itself still loads.
        if (generation !== this.countGeneration) return;
        this.countAbort = null;
        this.countingState.set(false);
      },
    );
  }

  private applyCount(value: number, exact: boolean): void {
    const limit = this.queryState().limit;
    const clipped = limit === undefined ? value : Math.min(value, limit);
    this.pagingState.set(setCount(this.pagingState(), clipped, exact));
    // An estimate does not place a page read from the end (a full page, not the remainder, and
    // the estimate may be off): it keeps its "from the end" name. Only an exact count does.
    // While a page read runs (e.g. Previous from the last page), that page is placed once it
    // arrived (pageArrived realigns), so the user's navigation is not replaced.
    if (exact && this.find === null) this.realign();
    else this.updateFirstRow();
  }

  /**
   * With an exact count, a page whose index is unknown (counted from the end) is read again by its
   * real index, aligned to the page boundaries (the last page holds the remainder). The shown page
   * keeps its "from the end" name until that page arrived.
   */
  private realign(): void {
    const state = this.pagingState();
    const pages = pageCount(state);
    const fromEnd = this.fromEndState();
    if (fromEnd === null || pages === null || !state.count?.exact) return;
    const index = Math.max(0, pages - 1 - fromEnd);
    // By number, not as a neighbour of the shown page (its index is a placeholder).
    this.load(jumpToPage({ ...state, page: null }, index));
  }

  /**
   * Reads one page; it replaces the shown one once it arrived completely. `pageSize`: a new page
   * size that applies together with this page. Returns false when nothing is read.
   */
  private load(request: PageRequest, pageSize?: number): boolean {
    const target = this.targetValue;
    if (target === null) return false;
    if (this.find !== null) this.find.unsubscribe();
    const generation = ++this.findGeneration;
    this.lastAfterCount = null;
    const query = this.queryState();
    const clipped = this.clipToLimit(request, pageSize ?? this.pagingState().pageSize);
    this.errorState.set(null);
    this.noticeState.set(null);
    if (clipped === null) {
      this.find = null;
      this.loadingState.set(false);
      this.noticeState.set(
        `That page is past the end of the result (limit ${query.limit ?? 0} documents).`,
      );
      return false;
    }
    this.loadingState.set(true);
    const docs: string[] = [];
    const sliced: (SlicedArray[] | undefined)[] = [];
    this.find = this.api.stream('docs.find', this.findParams(target, query, clipped)).subscribe({
      next: (batch) => {
        if (generation !== this.findGeneration) return;
        for (const s of batch.sliced ?? []) sliced[docs.length + s.index] = s.arrays;
        docs.push(...batch.docs);
      },
      complete: () => {
        if (generation !== this.findGeneration) return;
        this.find = null;
        this.loadingState.set(false);
        sliced.length = docs.length;
        this.pageArrived(clipped, docs, pageSize, sliced.some(Boolean) ? sliced : undefined);
      },
      error: (error: unknown) => {
        if (generation !== this.findGeneration) return;
        this.find = null;
        this.loadingState.set(false);
        this.reportFailure(error);
      },
    });
    return true;
  }

  private pageArrived(
    request: PageRequest,
    docs: readonly string[],
    pageSize?: number,
    sliced?: readonly (readonly SlicedArray[] | undefined)[],
  ): void {
    if (request.before && this.fromEndState() !== null && docs.length < request.limit) {
      // Paging back by range from a page of unknown position reached the start. The short (or
      // empty) answer is not an aligned page 1 (the count need not be a multiple of the page
      // size): read page 1 from the start instead; the shown page stays until it arrived.
      this.load(firstPage(this.pagingState()), pageSize);
      return;
    }
    const plain = docs.map((text) => JSON.parse(text) as unknown);
    const base = this.pagingState();
    let state = pageLoaded(
      pageSize === undefined ? base : setPageSize(base, pageSize),
      request,
      plain,
    );
    const limit = this.queryState().limit;
    if (
      limit !== undefined &&
      state.page !== null &&
      state.pageIndex * state.pageSize + state.page.rows >= limit
    ) {
      state = { ...state, page: { ...state.page, isLast: true } };
    }
    const pages = pageCount(state);
    const fromEnd = this.fromEndState();
    let nextFromEnd: number | null = null;
    if (request.fromEnd) {
      // Aligned only when the read was sized from an exact count (the remainder). A full page
      // read without one (no count, an estimate, or a count that arrived meanwhile) is not.
      const count = state.count;
      const remainder =
        count?.exact && pages !== null ? count.value - (pages - 1) * state.pageSize : null;
      if (pages !== null && remainder !== null && (remainder <= 0 || request.limit === remainder)) {
        state = { ...state, pageIndex: pages - 1 };
      } else {
        nextFromEnd = 0;
        state = { ...state, pageIndex: Math.max(1, state.pageIndex) };
      }
    } else if (fromEnd !== null && state.pageIndex > 0 && (request.after || request.before)) {
      // Paging by range away from a last page whose index is unknown: count from the end.
      nextFromEnd = Math.max(0, fromEnd + (request.before ? 1 : -1));
      // The page after "1 page before the last" is the last page again.
      if (request.after && nextFromEnd === 0 && state.page !== null) {
        state = { ...state, page: { ...state.page, isLast: true } };
      }
    }
    this.fromEndState.set(nextFromEnd);
    this.pagingState.set(state);
    const firstRow = state.pageIndex * state.pageSize;
    this.pageState.set(sliced ? { docs, sliced, firstRow } : { docs, firstRow });
    this.pageLoadsState.update((n) => n + 1);
    this.realign();
  }

  private updateFirstRow(): void {
    const page = this.pageState();
    const state = this.pagingState();
    if (page !== null) this.pageState.set({ ...page, firstRow: state.pageIndex * state.pageSize });
  }

  /**
   * Applies the user's limit (the whole result has at most `limit` rows): pages end at the limit,
   * and the last page is read with skip from the clipped count instead of from the end of the
   * unlimited result. `null`: the page lies beyond the limit.
   */
  private clipToLimit(request: PageRequest, pageSize: number): PageRequest | null {
    const limit = this.queryState().limit;
    if (limit === undefined) return request;
    const start = request.pageIndex * pageSize;
    let clipped = request;
    if (request.fromEnd) {
      clipped = {
        pageIndex: request.pageIndex,
        sort: request.sort,
        limit: pageSize,
        ...(start > 0 ? { skip: start } : {}),
        fromEnd: false,
      };
    }
    const remaining = limit - start;
    if (remaining <= 0) return null;
    return { ...clipped, limit: Math.min(clipped.limit, remaining) };
  }

  private findParams(
    target: CollectionTarget,
    query: ParsedQuery,
    request: PageRequest,
  ): ParamsOf<'docs.find'> {
    const params: ParamsOf<'docs.find'> = { ...target, filter: query.filter, limit: request.limit };
    if (query.projection !== undefined) params.projection = query.projection;
    if (query.collation !== undefined) params.collation = query.collation;
    // The paging sort (e.g. the implied `{_id: 1}`) for every page, so pages follow one order;
    // an opaque sort goes as typed.
    if (request.sort !== null && request.sort.length > 0) {
      params.sort = JSON.stringify(sortDocument(request.sort));
    } else if (request.sort === null && query.sort !== undefined) {
      params.sort = query.sort;
    }
    if (request.skip !== undefined && request.skip > 0) params.skip = request.skip;
    if (request.after !== undefined) params.after = JSON.stringify(request.after);
    if (request.before !== undefined) params.before = JSON.stringify(request.before);
    if (request.fromEnd) params.fromEnd = true;
    params.slice = { above: this.nestedPageSize.size(), docBytes: LARGE_DOC_BYTES };
    return params;
  }

  private reportFailure(error: unknown): void {
    if (error instanceof ApiError && error.code === 'CANCELLED') {
      this.noticeState.set('Query cancelled.');
      return;
    }
    this.errorState.set(describeError(error));
  }
}
