// Pure, Angular-free paging math for arrays and objects inside a document:
// a container with more than `size` entries shows one page of `size` entries
// at a time (SPEC "Paging inside a document"; `size` is the
// `nestedPageSize` setting, 100 by default).

/** Page size until the `nestedPageSize` setting arrives (SPEC default). */
export const DEFAULT_NESTED_PAGE_SIZE = 100;

/** The entries a container shows: `start` … `end - 1` of `length`. */
export interface PageWindow {
  /** 0-based page shown. */
  page: number;
  /** Number of pages (1 for a container that doesn't page). */
  pages: number;
  start: number;
  end: number;
  length: number;
  /** More entries than one page holds: the pager is shown. */
  paged: boolean;
}

/** Number of pages `length` entries take at `size` per page (at least 1). */
export function pageCount(length: number, size: number): number {
  return Math.max(1, Math.ceil(length / Math.max(1, size)));
}

/**
 * The window of page `page` (clamped to the existing pages, so a container
 * that shrank, e.g. under a search, shows its last page instead of nothing).
 */
export function pageWindow(length: number, size: number, page: number): PageWindow {
  const perPage = Math.max(1, Math.floor(size));
  const pages = pageCount(length, perPage);
  const p = Math.min(Math.max(0, Math.floor(page) || 0), pages - 1);
  const start = p * perPage;
  return {
    page: p,
    pages,
    start,
    end: Math.min(length, start + perPage),
    length,
    paged: length > perPage,
  };
}

/** The page that holds the entry at `position`. */
export function pageOf(position: number, size: number): number {
  return Math.floor(Math.max(0, position) / Math.max(1, Math.floor(size)));
}

// The form keeps its own page per object: the same node can be shown by the
// table and by the form, and the two shouldn't step on each other's page.
export function formPageKey(uid: string): string {
  return `form:${uid}`;
}
