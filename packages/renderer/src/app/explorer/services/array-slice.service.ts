import { Injectable, signal } from '@angular/core';

/**
 * Where the rest of an array comes from that a large document brought only
 * the first items of (`docs.find` with `slice`; the rest via `docs.getSlice`).
 */
export interface SliceSource {
  /** Length of the whole array on the server. */
  readonly total: number;
  /** Items `skip` … `skip + limit - 1` as explorer values. */
  load(skip: number, limit: number): Promise<unknown[]>;
}

/** One page of a sliced array: its items, or why they aren't there (yet). */
export interface SlicePage {
  /** `null` while the page is loading or after it failed. */
  items: readonly unknown[] | null;
  error: string | null;
}

interface Entry {
  source: SliceSource;
  /** Pages read so far, by `start:end`. */
  pages: Map<string, SlicePage>;
}

/**
 * The arrays of the shown documents that were loaded only partly, and the
 * pages read of them. An array is known by its identity in the explorer
 * tree; its pages are kept per document version (`owner`: the loaded
 * document), so a tree rebuilt after an edit elsewhere in the document keeps
 * the pages already read, while a reloaded document starts over.
 */
@Injectable({ providedIn: 'root' })
export class ArraySliceService {
  private readonly byArray = new WeakMap<object, Entry>();
  private readonly byOwner = new WeakMap<object, Map<string, Entry>>();
  /** Pages within the loaded items of a registered array, by `start:end`. */
  private readonly inMemory = new WeakMap<object, Map<string, SlicePage>>();
  /** Bumped when a page arrives or fails: the views asking for it read it again. */
  private readonly version = signal(0);

  /** `arr` (the loaded first items) is the array at `path` of the document `owner`. */
  register(arr: readonly unknown[], owner: object, path: string, source: SliceSource): void {
    let entries = this.byOwner.get(owner);
    if (!entries) {
      entries = new Map();
      this.byOwner.set(owner, entries);
    }
    let entry = entries.get(path);
    if (!entry || entry.source.total !== source.total) {
      entry = { source, pages: new Map() };
      entries.set(path, entry);
    }
    this.byArray.set(arr, entry);
  }

  /** The source of `value` when it is a partly loaded array. */
  sourceOf(value: unknown): SliceSource | undefined {
    return typeof value === 'object' && value !== null
      ? this.byArray.get(value)?.source
      : undefined;
  }

  /**
   * Items `start` … `end - 1` of the partly loaded array `arr`: from `arr`
   * itself while they are among its loaded items, else read from the source
   * (started on the first ask; `items` is `null` until they arrive).
   */
  page(arr: readonly unknown[], start: number, end: number): SlicePage {
    this.version();
    const entry = this.byArray.get(arr);
    if (!entry) return { items: arr.slice(start, end), error: null };
    const key = `${start}:${end}`;
    if (end <= arr.length) {
      // Kept per array: the same window gives the same page object, so views
      // memoising on it (the table's sparse array) don't rebuild it.
      let pages = this.inMemory.get(arr);
      if (!pages) {
        pages = new Map();
        this.inMemory.set(arr, pages);
      }
      let page = pages.get(key);
      if (!page) {
        page = { items: arr.slice(start, end), error: null };
        pages.set(key, page);
      }
      return page;
    }
    const known = entry.pages.get(key);
    if (known) return known;
    const loading: SlicePage = { items: null, error: null };
    entry.pages.set(key, loading);
    void this.load(entry, key, start, end);
    return loading;
  }

  /** Forgets a failed page, so the next ask reads it again. */
  retry(arr: readonly unknown[], start: number, end: number): void {
    const entry = this.byArray.get(arr);
    if (entry?.pages.get(`${start}:${end}`)?.error) {
      entry.pages.delete(`${start}:${end}`);
      this.version.update((v) => v + 1);
    }
  }

  private async load(entry: Entry, key: string, start: number, end: number): Promise<void> {
    let page: SlicePage;
    try {
      const items = await entry.source.load(start, end - start);
      page = { items, error: null };
    } catch (error) {
      page = { items: null, error: error instanceof Error ? error.message : String(error) };
    }
    entry.pages.set(key, page);
    this.version.update((v) => v + 1);
  }
}
