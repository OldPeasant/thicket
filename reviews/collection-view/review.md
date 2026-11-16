# Code Review

Date: 2026-11-16

Task: collection-view (M1: Collection tab: query bar, pager and result views)

Scope: `git diff 19f2c5a..1da2192` (task commits 025e217, c789350, 1da2192), committed changes only

Requirements:
- tasks/collection-view.md acceptance criteria and recorded assumptions
- SPEC.md M1 Browsing: "Collection view", "Paging", "Result views"
- docs/ARCHITECTURE.md "Collection tab" (added by this task) and the paging-core / docs.find contract
  (packages/core/src/paging/state.ts, packages/contract/src/docs.ts, packages/backend/src/docs/query/query.ts)
- docs/QUALITY.md (report contract), AGENTS.md (token-only colors, conventions)

Git range:
- Branch: main
- HEAD: 1da21922b6ced97184f4fa7de9333a3b8d92ba7a
- Base/start: 19f2c5aab0ec012f1abd0d0424ecb5eb0cab251e
- Commits reviewed: 3

Summary: 0 P0, 1 P1, 1 P2, 4 P3

Verified as correct (no finding): range bounds are taken from the canonical EJSON rows
(`JSON.parse` keeps `$oid`/`$numberInt` wrappers) and re-sent with `JSON.stringify`, so `after`/`before`
are canonical EJSON that the backend parses with `relaxed: false`; the paging sort (`{_id: 1}` by
default) is sent on every page, an opaque `$meta` sort is sent as typed; the backend widens the
projection with the sort keys, so user projections do not break range bounds; stale page/count answers
are dropped by `findGeneration`/`countGeneration`, and `run()` cancels both; Cancel unsubscribes the
stream (the fake bridge records the cancel) and aborts the count; every `var(--...)` in
collection-view.css is defined in app/theme/tokens.css and there are no literal colors; file naming,
standalone OnPush component, signals and `provideTabView` registration follow the existing layout and
sidebar code. Acceptance-criterion evidence is not yet recorded (`tasks.py verify collection-view`
shows all three unticked); the parent must record it before `done`.

## P0 Critical

None.

## P1 High

- [ ] **CR-1 | Previous/jump from a last page of unknown position use the guessed page index and land on the wrong page**
    - File: `packages/renderer/src/app/collection/collection-results.service.ts:120`
    - Category: Correctness
    - Problem: Without a count (every filtered query, per the recorded assumption) `lastPage()` sets
      `pageIndex = current + 1` as a placeholder, and `pageArrived` (lines 297-305) keeps that guessed
      index while `fromEndState` tracks the real position. `previous()` (line 120-121) still calls
      paging-core's `previousPage`, which turns index 1 into `firstPage` (state.ts:191-192). Example:
      filter `{ a: 1 }` matching 10 000 docs, page 1 shown, press Last (guessed index 1, rows
      9 951-10 000, "Last 50"), press Previous: the request is the unbounded first page and rows 1-50
      are shown, not 9 901-9 950. From page k the same happens after k Previous presses. `jump()`
      (line 133-136) has the same root cause: typing a page equal to guessed index +/- 1 makes
      `jumpToPage` take the `nextPage`/`previousPage` shortcut with the last page's edge rows (e.g.
      typing "3" after Last from page 1 sends `after` the final row and shows an empty page with
      "No documents match this query").
    - Why it matters: SPEC.md Paging requires first/previous/next/last/jump; Previous from the last
      page silently skips to the start of the result for the default filtered flow. The component test
      "counts pages paged back from an unknown last page" only goes back one page from guessed index
      3, so it does not hit this.
    - Suggested fix: while `fromEndState() !== null` (position unknown), build the `before` request
      from `paging().page.first` directly instead of `previousPage` (never fall through to
      `firstPage` because of the guessed index), and make `jump()` use a skip read (or `firstPage`
      for page 1) instead of the neighbour shortcuts. Add component tests: Last from page 1 then
      Previous sends `before`; jump after an unknown Last sends `skip`.

## P2 Medium

- [ ] **CR-2 | Last page read with an estimated count is labelled as an aligned page (wrong row numbers, overlapping pages)**
    - File: `packages/renderer/src/app/collection/collection-results.service.ts:297`
    - Category: Correctness
    - Problem: With an estimated count (the default for an unfiltered collection), paging-core reads
      the last page with `fromEnd` and a full `pageSize` (state.ts:223-227), i.e. the last 50 rows,
      not the remainder. `pageArrived` keeps `pageIndex = pages - 1` and `fromEndState = 0`, and
      `positionUnknown` (collection-view.ts:156-158) is false because a count exists, so the pager
      shows aligned numbers. Example: 1 234 documents, 50 per page: Last shows rows 1 185-1 234 as
      "1,201–1,250 of ~1,234 documents (estimated)"; each Previous (`before` bound) is mislabelled by
      the same 16 rows ("1,151–1,200" for rows 1 135-1 184), and the step from page 2 to page 1 shows
      rows 35-50 twice. The same mislabel happens when an estimate arrives after a Last read
      (`applyCount`, line 241) or an exact count arrives while a `fromEnd` read is in flight
      (line 299 sets the aligned index for a full-size page). Tests and e2e use 10 000 documents,
      which is divisible by every page size, so this is not covered.
    - Why it matters: the default view of any collection whose size is not a multiple of the page
      size shows row numbers beyond the count and duplicate rows across pages until "Count exactly".
    - Suggested fix: only treat a `fromEnd` page as aligned when its request was sized from an exact
      count; otherwise label it relative to the end (as for no count) or set `firstRow` to
      `max(0, count - rows)` and keep `fromEndState` driving the label. Add a test with a count that
      is not a multiple of the page size.

## P3 Low

- [ ] **CR-3 | Jumping past the end gives a misleading empty result or silently does nothing**
    - File: `packages/renderer/src/app/collection/collection-results.service.ts:257`
    - Category: Correctness
    - Problem: `jumpToPage` clamps only with an exact count. With an estimated count, typing e.g.
      1000 in the page field (no `max` on the input, collection-view.html:133-142) reads an empty page
      and shows "No documents match this query. Change the filter or press Reset…" with
      "Page 1000 of ~200". With a user limit, `clipToLimit` returns `null` and `load` returns without
      any feedback while the field keeps the typed number.
    - Why it matters: the empty-result text blames the filter; the no-op leaves the pager
      inconsistent with the page shown.
    - Suggested fix: clamp the jump to the known (estimated or limit-clipped) page count, or reset the
      field and show a notice when the page lies beyond the end.

- [ ] **CR-4 | Changing the page size updates paging state before the page arrives**
    - File: `packages/renderer/src/app/collection/collection-results.service.ts:138`
    - Category: Correctness
    - Problem: `setPageSize` writes the new size, `pageIndex: 0` and `page: null` into `pagingState`
      before `load`. If that read is cancelled or fails, the old page stays on screen but the pager
      says page 1, Previous/First are disabled and Next issues a skip read with the new size.
      Other navigation only changes state in `pageArrived`.
    - Why it matters: the documented rule "a cancelled or failed read keeps the previous page" holds
      for the rows but not for the pager state; the screen is recoverable (Run/First) but inconsistent.
    - Suggested fix: compute the new state locally and apply it in `pageArrived` (as the other moves
      do), or clear the shown page when the size changes.

- [ ] **CR-5 | Cancel button removes itself while focused**
    - File: `packages/renderer/src/app/collection/collection-view.html:82`
    - Category: Quality
    - Problem: the Cancel button exists only inside `@if (results.busy())`; activating it with the
      keyboard sets `busy` false and the focused element is removed, so focus drops to the document body.
    - Why it matters: keyboard and screen-reader users lose their place after cancelling.
    - Suggested fix: keep the button rendered and disable/hide it visually when idle, or move focus to
      the Run button after cancel.

- [ ] **CR-6 | Unrelated whitespace change in core package exports**
    - File: `packages/core/package.json:12`
    - Category: Quality
    - Problem: the diff rewrites the untouched `"./shellsyntax": "./src/shellsyntax/index.ts"` entry
      to `"./shellsyntax":"./src/shellsyntax/index.ts"` (space after the colon dropped), inconsistent
      with the other entries.
    - Why it matters: noise in a shared manifest touched by other tasks; risk of needless merge conflicts.
    - Suggested fix: restore the original formatting of that line.

## Review conclusion

Material issues found; fix before completing the task.
