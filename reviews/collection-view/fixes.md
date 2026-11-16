# Fix Report

Date: 2026-11-16

Task: collection-view - M1: Collection tab: query bar, pager and result views

Scope: findings CR-1..CR-6 of `reviews/collection-view/review.md` and TW-1, TW-2 of
`reviews/collection-view/tests.md`, at HEAD 6f59ccd. Production files:
`packages/renderer/src/app/collection/{collection-results.service.ts, collection-view.ts, collection-view.html}`;
docs: `docs/ARCHITECTURE.md` "Collection tab". Changes are uncommitted (the parent commits them).

## Fixed findings

### CR-1 / TW-1 — Previous and jumps after a last page of unknown position land on the wrong page

Files changed:
- `packages/renderer/src/app/collection/collection-results.service.ts`
- `packages/renderer/src/app/collection/collection-results.service.spec.ts`
- `packages/renderer/src/app/collection/collection-view.spec.ts`

Problem:
After Last without an exact count, `pageIndex` is a placeholder. `previous()` used paging-core's
`previousPage`, which turns index 1 into `firstPage` (page 1 shown instead of the page before the
last). `jump()` used `jumpToPage`'s neighbour shortcuts with the last page's edge rows.

Fix:
- While the position is unknown (`fromEndState !== null`) in range mode, `previous()` builds its own
  `before` request from `page.first`, with `pageIndex = max(1, pageIndex - 1)` as a placeholder. A
  short `before` answer becomes page 0 via `pageLoaded`, which makes the position known again.
- A page read from the end keeps a placeholder index of at least 1, so Previous stays enabled.
- While the position is unknown, `jump()` calls `jumpToPage` on a copy of the state with
  `page: null`, so it sends a plain skip request (or `firstPage` for page 1), never a neighbour
  shortcut. The exact-count re-read (`realign()`) uses the same rule. Before, it called `jumpToPage`
  with the placeholder index and could also hit a shortcut.
- Skip mode (a collation, or a sort that cannot be range-paged) has no `before` bound. There, Last
  without an exact count, or with only an estimate when the read would be `fromEnd`, first starts
  `docs.count`. When that count answers, the last page is read sized from the exact count. Cancel,
  a failed count, or any other page read in the meantime drops the pending Last
  (`lastAfterCount`, tied to the count generation). Skip mode with an estimate and an
  empty/opaque sort still skips from the estimate, as before.
- Next from "1 page before the last" reaches the last page and marks it `isLast`, so Next does not
  lead to an empty page.

Validation:
- TW-1 tests (service and component), previously failing — Pass
- New: `pages back by range all the way; a short page before a bound is page 1`,
  `next from one page before an unknown last page reaches the last page`,
  `jumps by number after an unknown last page with skip, not from its edge rows`,
  `last page in skip mode > counts exactly first, then reads the last page with its real size`,
  `... with an estimate that would read from the end, counts exactly first too`,
  `... cancelling the count, or paging meanwhile, does not read the last page`,
  `... a failed count reports the error and reads nothing`,
  component `in skip mode, Last counts exactly and then shows the last page by number` — Pass

### CR-2 — Last page read with an estimated count is labelled as an aligned page

Files changed:
- `packages/renderer/src/app/collection/collection-results.service.ts`
- `packages/renderer/src/app/collection/collection-view.ts`
- `packages/renderer/src/app/collection/collection-view.html`
- `packages/renderer/src/app/collection/collection-results.service.spec.ts`
- `packages/renderer/src/app/collection/collection-view.spec.ts`

Problem:
With only an estimated count, a `fromEnd` read of a full page was given index `pages - 1`. An
estimate arriving later also moved such a page to an index. Both gave wrong row numbers and
overlapping pages when the count is not a multiple of the page size.

Fix:
- `pageArrived` treats a `fromEnd` page as aligned only when the count is exact and the request was
  sized from it (`request.limit` equals the remainder, or the count is 0). Otherwise the position
  stays unknown (`fromEndState = 0`).
- `applyCount` with an estimate no longer moves a page whose position is unknown. An exact count
  calls `realign()`, which reads that page again by its real index (existing behaviour, now
  shortcut-free).
- When an exact count arrived while a `fromEnd` read was still running, the full-page answer is
  read again aligned after it arrives.
- `fromEndState` stays set until the aligned page arrives, so the shown rows keep their "Last N"
  name during that read.
- In the view, `positionUnknown` is now `pagesFromEnd() !== null`. This differs slightly from the
  parent's suggested `pagesFromEnd !== null && !count?.exact`. The service now keeps the invariant
  that `pagesFromEnd` is non-null exactly while the position is unknown. That includes an aligning
  read that is still running, or was cancelled, after an exact count. In those states the
  suggested formula would show placeholder row numbers.
- The document list's `<ol start>` is not set while the position is unknown. Before, its numbering
  came from the placeholder.

Validation:
- New: `last page with an estimated count > is named from the end, and pages back from it by range`
  (count 1 234, not a multiple of 50), `an exact count arriving during a last-page read reads it
  again aligned` — Pass
- Changed (see "Tests changed" below): service `an estimate arriving after the last page was read
  from the end does not place it`; component `pages with range bounds, jumps with skip, reads the
  last page from the end` — Pass

### CR-3 — Jumping past the end gives a misleading empty result or silently does nothing

Files changed:
- `packages/renderer/src/app/collection/collection-results.service.ts`
- `packages/renderer/src/app/collection/collection-view.ts`
- `packages/renderer/src/app/collection/collection-view.html`
- `packages/renderer/src/app/collection/collection-view.spec.ts`
- `packages/renderer/src/app/collection/collection-results.service.spec.ts`

Problem:
An empty page beyond page 1 said "No documents match this query…". A jump beyond the user's limit
read nothing and gave no feedback.

Fix:
- An empty page with `pageIndex > 0`, or one whose position is unknown, now says "No documents on
  this page. The result ends before it: go to the first or the previous page." First and Previous
  stay enabled. Page 1 keeps the "No documents match this query" text.
- A page beyond the limit is still not read. `load()` returns `false`, sets the notice "That page
  is past the end of the result (limit N documents).", and the view resets the field (TW-2).

Validation:
- New: component `an empty page past the end does not blame the filter, and the pager stays
  usable`, `a page number beyond the limit says the result ends at the limit`; service `a jump
  beyond the limit reads nothing and says why` — Pass

### CR-4 — Changing the page size updates paging state before the page arrives

Files changed:
- `packages/renderer/src/app/collection/collection-results.service.ts`
- `packages/renderer/src/app/collection/collection-view.ts`
- `packages/renderer/src/app/collection/collection-view.html`
- `packages/renderer/src/app/collection/collection-results.service.spec.ts`
- `packages/renderer/src/app/collection/collection-view.spec.ts`

Problem:
`setPageSize` wrote the new size, page 1 and `page: null` into the state before the read, so a
cancelled or failed read left the pager inconsistent with the rows shown.

Fix:
- `setPageSize` reads `firstPage` of a locally computed state and passes the new size to
  `load(request, pageSize)`. `clipToLimit` uses that size, and `pageArrived` applies
  `setPageSize` only when the page arrives.
- In the view, the page-size select is synced back to the actual size whenever a read ends (see
  the TW-2 effect), so it does not keep showing a cancelled size.

Validation:
- New: service `a cancelled page-size read keeps the old size and position`, `a failed page-size
  read keeps the old size`, `with a limit, the new size clips the page`; component `a cancelled
  page-size change keeps the old size and page` — Pass

### CR-5 — Cancel button removes itself while focused

Files changed:
- `packages/renderer/src/app/collection/collection-view.ts`
- `packages/renderer/src/app/collection/collection-view.html`
- `packages/renderer/src/app/collection/collection-view.spec.ts`

Problem:
The Cancel button exists only while busy, so activating it dropped focus to the document body.

Fix:
The button calls the view's `cancel()`, which cancels and then focuses the Run button
(`#runButton`).

Validation:
- New: component `cancel moves the focus to the Run button` — Pass

### TW-2 — Page jump field keeps an out-of-range number that was not shown

Files changed:
- `packages/renderer/src/app/collection/collection-view.ts`
- `packages/renderer/src/app/collection/collection-results.service.ts`
- `packages/renderer/src/app/collection/collection-view.spec.ts`

Problem:
`[value]="pageNumber()"` only writes when the signal changes, so a typed number stayed in the field
when the page shown kept the same number (clamped jump) or nothing was read (beyond the limit).

Fix:
- `CollectionResults.jump()` returns whether a read started. The view resets the field when nothing
  was read.
- A view effect writes `pageNumber()` into the field, and the actual page size into the select,
  every time a read ends (page arrived, cancelled or failed). While the position is unknown that
  value is empty, so the placeholder "last" shows.

Validation:
- TW-2 tests `a page number beyond the limit is not read and the field shows the current page
  again`, `a page number past the last page (exact count) shows the last page number`, previously
  failing — Pass
- New: `a jump to the page already shown still shows its number` — Pass

### Docs

`docs/ARCHITECTURE.md` "Collection tab" now covers:
- a new page size applies when its page arrives;
- Cancel moves focus to Run;
- "position unknown" also covers an estimated count, with range paging and skip jumps from such a
  page;
- skip mode counts exactly before Last;
- the empty-page and beyond-the-limit messages.

## Tests changed (not weakened)

- Service `an estimate arriving after the last page was read from the end gives it a number`, now
  `... does not place it`. The old test asserted the CR-2 defect: it expected an estimate to give
  index 199 to a full page read from the end. This only looked right because 10 000 is a multiple
  of 50. The parent's guidance and CR-2 require that an estimate does not place such a page. The
  test now asserts that the position stays unknown, the count is recorded, and there is no
  re-read.
- Component `pages with range bounds, jumps with skip, reads the last page from the end`: same
  reason. With only the estimate (~10 000), the page field is now empty and the rows read
  "Last 50 of ~10,000". The `fromEnd` request and the disabled Next are still asserted.

## Not fixed

### CR-6 — Unrelated whitespace change in core package exports

Status:
Invalid (already fixed)

Reason:
Fixed before this run in commit 595cc83 ("collection-view: format core package.json"). The parent
said to skip it.

## Observations outside the findings (not changed)

- Range mode with a user `.limit(n)` and no count: Last still reads the next page with skip,
  because `clipToLimit` turns a `fromEnd` request into skip from the placeholder index. The
  test-writer noted this. It matches paging-core's documented behaviour and the recorded
  assumption, and no finding asks to change it. A count-first Last (as now done in skip mode)
  would also fit here, but that is a product call for the parent.

## Validation summary

Focused tests:
- `npm run test -w packages/renderer -- --include='src/app/collection/**/*.spec.ts'` — Pass, 80
  passed (3 files). The 4 previously failing TW-1/TW-2 tests pass, and 19 tests are new.

Full test suite:
- `npm run check` (repo root) — Pass. Lint, Prettier and type check passed. Root Vitest: 46 files,
  2829 tests passed. Renderer: 49 files, 1097 tests passed.
- `npm run test:e2e -- test/e2e/collection.e2e.ts` (MongoDB container through Podman) — Pass, 1
  passed (7.1s).

Lint/type-check/build:
- Included in `npm run check` — Pass. `prettier --write` reformatted `collection-view.html` once
  (the Cancel button attributes now fit on one line).

`.taskcheck`:
- Pass. `.taskcheck` runs `npm run check`, which passed (above).

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
