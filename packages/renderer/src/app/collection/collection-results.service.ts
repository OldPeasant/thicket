import { computed, inject, Injectable, type OnDestroy, signal } from '@angular/core';
import type { ParamsOf } from '@thicket/contract';
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
import type { ParsedQuery } from './query.util';

/** Page sizes offered by the pager (SPEC.md M1 Paging). */
export const PAGE_SIZES = [20, 50, 100, 500] as const;

/** The collection a tab shows. */
export interface CollectionTarget {
  profileId: string;
  db: string;
  coll: string;
}

/** A loaded page: documents as canonical EJSON text, in display order. */
export interface ResultPage {
  docs: readonly string[];
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
  /**
   * Pages between the shown page and the last one, while the shown page's index is not known: the
   * last page was read from the end without an exact count, and maybe paged back from there.
   * `null` when the index is known.
   */
  private readonly fromEndState = signal<number | null>(null);

  readonly query = this.queryState.asReadonly();
  readonly paging = this.pagingState.asReadonly();
  readonly page = this.pageState.asReadonly();
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
    if (this.canPrevious()) this.load(previousPage(this.pagingState()));
  }

  next(): void {
    if (this.canNext()) this.load(nextPage(this.pagingState()));
  }

  last(): void {
    this.load(lastPage(this.pagingState()));
  }

  /** Goes to page `pageNumber` (1-based). */
  jump(pageNumber: number): void {
    if (!Number.isInteger(pageNumber) || pageNumber < 1) return;
    this.load(jumpToPage(this.pagingState(), pageNumber - 1));
  }

  setPageSize(size: number): void {
    this.pagingState.update((state) => setPageSize(state, size));
    this.load(firstPage(this.pagingState()));
  }

  /** Counts the matching documents exactly (`docs.count`). */
  countExact(): void {
    const target = this.targetValue;
    if (target === null) return;
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
        this.applyCount(count, true);
      },
      (error: unknown) => {
        if (generation !== this.countGeneration) return;
        this.countAbort = null;
        this.countingState.set(false);
        this.reportFailure(error);
      },
    );
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
    if (report && wasBusy) {
      this.errorState.set(null);
      this.noticeState.set('Query cancelled.');
    }
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
    let state = setCount(this.pagingState(), clipped, exact);
    const pages = pageCount(state);
    // A page counted from the end before the count was known now gets its real index.
    const fromEnd = this.fromEndState();
    if (fromEnd !== null && pages !== null) {
      state = { ...state, pageIndex: Math.max(0, pages - 1 - fromEnd) };
      if (exact) this.fromEndState.set(null);
    }
    this.pagingState.set(state);
    this.updateFirstRow();
  }

  /** Reads one page; it replaces the shown one once it arrived completely. */
  private load(request: PageRequest): void {
    const target = this.targetValue;
    if (target === null) return;
    if (this.find !== null) this.find.unsubscribe();
    const generation = ++this.findGeneration;
    const query = this.queryState();
    const clipped = this.clipToLimit(request);
    this.errorState.set(null);
    this.noticeState.set(null);
    if (clipped === null) {
      this.find = null;
      this.loadingState.set(false);
      return;
    }
    this.loadingState.set(true);
    const docs: string[] = [];
    this.find = this.api.stream('docs.find', this.findParams(target, query, clipped)).subscribe({
      next: (batch) => {
        if (generation === this.findGeneration) docs.push(...batch.docs);
      },
      complete: () => {
        if (generation !== this.findGeneration) return;
        this.find = null;
        this.loadingState.set(false);
        this.pageArrived(clipped, docs);
      },
      error: (error: unknown) => {
        if (generation !== this.findGeneration) return;
        this.find = null;
        this.loadingState.set(false);
        this.reportFailure(error);
      },
    });
  }

  private pageArrived(request: PageRequest, docs: readonly string[]): void {
    const plain = docs.map((text) => JSON.parse(text) as unknown);
    let state = pageLoaded(this.pagingState(), request, plain);
    const limit = this.queryState().limit;
    if (
      limit !== undefined &&
      state.page !== null &&
      state.pageIndex * state.pageSize + state.page.rows >= limit
    ) {
      state = { ...state, page: { ...state.page, isLast: true } };
    }
    const pages = pageCount(state);
    const exact = state.count?.exact ?? false;
    const fromEnd = this.fromEndState();
    if (request.fromEnd) {
      this.fromEndState.set(exact ? null : 0);
      if (exact && pages !== null) state = { ...state, pageIndex: pages - 1 };
    } else if (fromEnd !== null && state.pageIndex > 0 && (request.after || request.before)) {
      // Paging by range away from a last page whose index is unknown: count from the end.
      this.fromEndState.set(Math.max(0, fromEnd + (request.before ? 1 : -1)));
    } else {
      this.fromEndState.set(null);
    }
    this.pagingState.set(state);
    this.pageState.set({ docs, firstRow: state.pageIndex * state.pageSize });
    this.updateFirstRow();
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
  private clipToLimit(request: PageRequest): PageRequest | null {
    const limit = this.queryState().limit;
    if (limit === undefined) return request;
    const pageSize = this.pagingState().pageSize;
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
