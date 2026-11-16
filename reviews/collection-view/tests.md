# Test Report

Date: 2026-11-16

Task: collection-view - M1: Collection tab: query bar, pager and result views

Scope: `git diff 19f2c5aab0ec012f1abd0d0424ecb5eb0cab251e..1da21922b6ced97184f4fa7de9333a3b8d92ba7a` on branch `main`.
Task commits: 025e217, c789350, 1da2192. The parent named them. They match `git log 19f2c5a..HEAD`, and every changed path is one the task `touches` or a registration that `docs/ARCHITECTURE.md` "Collection tab" describes.
Production files: `packages/renderer/src/app/collection/{collection-results.service.ts, collection-view.ts, collection-view.html, collection-view.css, query.util.ts, index.ts}`, `packages/renderer/src/app/app.config.ts` (tab view registration), `packages/core/package.json` (`./paging` export).
Uncommitted inputs: only the test files listed below. No production file changed while testing: the hashes before and after are identical.

Requirements:
- `tasks/collection-view.md` acceptance criteria and its recorded assumptions
- `SPEC.md` (via the task) and `docs/ARCHITECTURE.md` "Collection tab"
- `docs/QUALITY.md`, `AGENTS.md`
- Parent's list of gaps to look for: stale answers, limit edge cases, opaque `$meta` sort, collation skip mode, page-size change, raw view with an unreadable document, `ngOnDestroy` cancelling streams
- `@thicket/core/paging` (`state.ts`) and the `docs.find` contract (`packages/contract/src/docs.ts`) for the paging semantics

## Test files changed

- `packages/renderer/src/app/collection/collection-results.service.spec.ts` (new)
- `packages/renderer/src/app/collection/collection-view.spec.ts` (8 tests added; none of the existing tests changed)

## Tests added or updated

Count: 37 (29 in the new service spec, 8 in the component spec)

The service spec drives `CollectionResults` with `FakeThicketBridge`. The test answers every `docs.find` stream and every `docs.estimatedCount`/`docs.count` promise itself, so the order of late answers is controlled exactly, without timers or delays.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: invalid filter shows the parse error and does not run (fake API) | existing `shows the parse error of an invalid filter and does not run the query`, `reports errors of every invalid field at once` | `npm run test -w packages/renderer -- --include='src/app/collection/**/*.spec.ts'` | Pass |
| AC2: e2e against 10 000 docs: filter + sort, page 3, jump to last, exact count | existing `test/e2e/collection.e2e.ts` | Parent ran `npm run test:e2e -- test/e2e/collection.e2e.ts`. Not rerun here because the e2e file was not changed | Not run by test-writer (parent's earlier run) |
| AC3: Cancel stops a slow query (component test with fake stream) | existing `cancels a slow page read...`, `cancels a slow new query`, `cancels a slow exact count`; new `CollectionResults > failures and cancel > cancel with nothing running gives no notice`, `a stream ending with CANCELLED is a notice, not an error` | same as above | Pass |
| A slow page read superseded by a newer one is dropped, and its stream is cancelled | `late answers > drops a slow page read superseded by a newer one, and cancels its stream`, `ignores the failure of a superseded page read`, `keeps loading until the newest read arrives...` | same | Pass |
| A count from an older query arriving after a new run is dropped | `drops an exact count of an older query that arrives after a new run`, `drops an older estimate answering after the newer one`, `drops an older estimate failing after a new run...`, `a second exact count supersedes the first one`, `an exact count requested while the estimate runs wins over the estimate` | same | Pass |
| Limit caps the whole result (smaller than the page size, exactly at a page boundary, the last page read with skip, the count clipped and sent with the limit) | `limit > a limit smaller than the page size...`, `a limit exactly at a page boundary...`, `reads the last page with skip at a page boundary...`, `sends the limit with the exact count...`, `a result shorter than the limit...` | same | Pass |
| Opaque `$meta` sort is sent as typed and pages with skip | `opaque sort > sends a $meta sort as typed and pages with skip`, `reads the last page of an opaque sort with skip from the count` | same | Pass |
| Collation means skip mode (no after/before/fromEnd) | `collation > pages with skip, never with after/before bounds`, `sends the collation with the exact count` | same | Pass |
| Page-size change | `page size > a new run keeps the chosen page size`, `a page-size change supersedes a running page read` | same | Pass |
| Failures: a mid-stream error keeps the page, a count failure is shown, a failed estimate is silent | `a page read failing mid-stream...`, `a failed exact count...`, `a failed estimate is silent...` | same | Pass |
| Tab close / `ngOnDestroy` cancels the running read and count | service `destroying the service stops the running page read and count`; component `closing the tab cancels a running page read and count` | same | Pass |
| Raw / list / table views with an unreadable document | `shows a document that cannot be read in every view without dropping the others` | same | Pass |
| The last page without a count, then the count (unknown position) | `an estimate arriving after the last page was read from the end gives it a number`, `names a page several pages before an unknown last page` | same | Pass |
| Previous from a last page reached straight from page 1 (no count) | service `previous from a last page read right after page 1 reads the page before the last`; component `previous on a last page read straight from page 1 shows the page before the last` | same | **Fail (TW-1)** |
| Page jump field: invalid / out-of-range input | `an invalid page number is not read...` (Pass); `a page number beyond the limit is not read and the field shows the current page again` (**Fail**), `a page number past the last page (exact count) shows the last page number` (**Fail**) | same | **Fail (TW-2)** |
| Pager guards (prev on page 1, next on the last page, invalid jump numbers) | `pager guards > previous on page 1, next on the last page and invalid page numbers read nothing` | same | Pass |
| No target means no requests | `sends nothing before a target is set` | same | Pass |

## Focused test execution

Command:

`npm run test -w packages/renderer -- --include='src/app/collection/**/*.spec.ts'` (repo root)

Result:

Fail: 57 passed, 4 failed (61 tests, 3 files). The 4 failures are the new tests behind TW-1 and TW-2, and they fail because of production behavior. `npx eslint packages/renderer/src/app/collection/` passed, `prettier --write` left the specs unchanged, and `npm run typecheck -w packages/renderer` passed.

## Full test execution

Command:

`npm run check` (repo root: lint, Prettier check, type check, root Vitest, renderer `ng test`)

Result:

Fail, only because of the 4 TW tests. Lint, Prettier and the type check passed. Root Vitest: 46 files, 2829 tests passed. Renderer: 47 of 49 files passed, 1074 of 1078 tests passed. The 4 failures are exactly the TW-1/TW-2 tests. e2e and integration were not run (see AC2).

## .taskcheck

Result:

Fail. `.taskcheck` runs `npm run check` (result above). The only failures are the 4 new tests that expose TW-1 and TW-2. It will pass once those defects are fixed.

## Bugs found

### Previous on a last page with unknown position jumps to page 1

Finding ID:

`TW-1`

Test:

`CollectionResults > last page without a count > previous from a last page read right after page 1 reads the page before the last` (collection-results.service.spec.ts); `CollectionView > previous on a last page read straight from page 1 shows the page before the last` (collection-view.spec.ts)

Production source:

`packages/renderer/src/app/collection/collection-results.service.ts:120-122` (`previous()`). It interacts with `lastPage()` in `packages/core/src/paging/state.ts`: without a count, the last page gets the placeholder index `pageIndex + 1`.

Requirement:

Pager first/prev/next/last (task goal). ARCHITECTURE "Collection tab": a last page read without a count is named "Last N", and pages before it are named "N pages before the last".

Expected behavior:

With a filter (so no count), the user opens the tab on page 1 and presses Last, then Previous. The view should read the page before the last one (a `before` bound at the first row of the shown last page) and show "50, 1 page before the last".

Actual behavior:

The last page gets placeholder index 1, so Previous computes index 0 and `previousPage` returns `firstPage`. The view reads and shows documents 1-50 (page 1) instead of documents 9 901-9 950. The same happens from page 2 after two Previous clicks: the unknown position always uses a placeholder index that is too small, and Previous falls through to page 1. This only works when the user paged forward at least as many pages as they later page back (the existing test pages forward twice).

Severity:

Medium

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### Page jump field keeps an out-of-range number that was not shown

Finding ID:

`TW-2`

Test:

`CollectionView > a page number beyond the limit is not read and the field shows the current page again`; `CollectionView > a page number past the last page (exact count) shows the last page number`

Production source:

`packages/renderer/src/app/collection/collection-view.ts:241-247` (`jump()`), together with `[value]="pageNumber()"` in `collection-view.html` and `collection-results.service.ts:257-261` (the read is dropped beyond the limit).

Requirement:

Pager jump (task goal). The field should show the page that is displayed (`pageNumber()`).

Expected behavior:

1. Filter `{ a: 1 }` with `.limit(120)`, no count, and the user types page 10: nothing is read (correct). The field should go back to "1".
2. Exact count of 9 990 (200 pages), on page 200, and the user types 999: the last page is shown (correct). The field should read "200".

Actual behavior:

The field keeps "10" (or "999") while page 1 (or 200) is shown. The `pageNumber()` signal does not change, so Angular does not rewrite the input. `jump()` resets the field only for non-integer or < 1 input.

Severity:

Low

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: partial-failed. The coverage command with all tests exits 1 because of the 4 TW-1/TW-2 tests. Vitest then writes no report: `coverage/` was cleaned and left empty, so that run has no numbers. The numbers below come from a fresh **diagnostic** run of the same command with `--filter` excluding only those 4 tests (57 passed, 4 skipped). Treat them as diagnostic, not as verified sign-off coverage.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured. All four `.ts` files in scope were added by this task, so whole-file coverage is the coverage of the changed lines in them.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `collection-view`; base `19f2c5aab0ec012f1abd0d0424ecb5eb0cab251e`; HEAD `1da21922b6ced97184f4fa7de9333a3b8d92ba7a`; commits 025e217, c789350, 1da2192 (from the parent, checked against `git log 19f2c5a..HEAD` and `git diff --stat`).
- Source/test snapshot identifier (including uncommitted inputs): HEAD 1da2192 plus sha256 `collection-results.service.ts` dc3a382e…2fc3, `collection-view.ts` 7e21f663…82cb, `query.util.ts` e604ac8b…ae82, `index.ts` f7702be3…a25, `collection-view.html` 63604bd7…ecf (production: unchanged and identical before and after the runs); tests `collection-results.service.spec.ts` 825130fd…1fb6, `collection-view.spec.ts` 8dcc4778…b3cc4, `query.util.spec.ts` e80178da…82fc3.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/app/collection/collection-results.service.ts`, `collection-view.ts`, `query.util.ts`, `index.ts` (re-exports only: 0 statements, so N/A). Excluded: `collection-view.html`/`.css` (template/styles; template behavior is exercised by the component tests but V8 does not instrument them), `app.config.ts` (a one-line provider registration, exercised by the e2e), `packages/core/package.json` (config), `test/e2e/collection.e2e.ts` (test). No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0, Vitest 5.1.0 via `@angular/build` 22.2.7 unit-test builder. Run in `packages/renderer`: `npx ng test --coverage --include='src/app/collection/**/*.spec.ts' --coverage-include='src/app/collection/collection-results.service.ts' --coverage-include='src/app/collection/collection-view.ts' --coverage-include='src/app/collection/query.util.ts' --coverage-include='src/app/collection/index.ts' --coverage-reporters=text-summary --coverage-reporters=json-summary --coverage-reporters=lcovonly --filter='^(?!.*(previous on a last page read straight|previous from a last page read right|page number beyond the limit|page number past the last page)).*$'`
- Run start/completion time and exit status: started 2026-11-16T22:28:35Z, report written 22:28:40Z, exit 0 (57 passed, 4 skipped). The same command without `--filter` (22:27:11Z) exited 1 with 4 failures and wrote no report.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 3c63cbae20be548b45e440bf479fb4a7fdbf4d93991de4999f5eb1f613a82c0f; `packages/renderer/coverage/renderer/lcov.info` sha256 9d94d96703562e6d1fe743a0505d9c61617ef72097ef68c7b61ed5e9be9dd4ad (Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: yes. Vitest cleaned `coverage/` at the start of the run, the files are timestamped by this run, and the source/test hashes match before and after.
- Final run after latest test additions and production fixes: yes for the latest test additions. No production fixes have been made yet. After TW-1/TW-2 are fixed, rerun without `--filter`.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/collection/collection-results.service.ts` | 214/218 (98.16%) | 115/122 (94.26%) | 33/33 (100%) | 182/182 (100%) |
| `packages/renderer/src/app/collection/collection-view.ts` | 104/107 (97.19%) | 62/70 (88.57%) | 29/30 (96.67%) | 87/87 (100%) |
| `packages/renderer/src/app/collection/query.util.ts` | 56/56 (100%) | 40/41 (97.56%) | 7/7 (100%) | 44/44 (100%) |
| `packages/renderer/src/app/collection/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| **Aggregate (summed counters, 3 measured files; index.ts N/A; .html/.css/app.config.ts/package.json not instrumented, see above)** | 374/381 (98.16%) | 217/233 (93.13%) | 69/70 (98.57%) | 313/313 (100%) |

Before the second round of added tests the same diagnostic command measured 371/381 statements, 211/233 branches and 311/313 lines.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `collection-results.service.ts:160`, `:210` (the "stale generation" return on a resolved count/estimate) | Late count answers | Covered behaviorally by the late-answer tests. In practice the abort rejects the promise first (line 166/218 path), so the resolve path only runs if the answer is already in flight. Defensive; left. |
| `collection-results.service.ts:266`, `:269`, `:275` (stale-generation guards in the stream callbacks) | Late stream data | Defensive: `load()`/`cancel()` unsubscribe the old stream, and RxJS delivers nothing after unsubscribe. Late data is still tested (`drops a slow page read superseded...`, the existing cancel test). Left. |
| `collection-results.service.ts:302` (`state.page !== null` false branch in the limit check) | none | `pageLoaded` always sets `page`. Unreachable; left. |
| `collection-results.service.ts:333` (`start > 0` false in `clipToLimit` for `fromEnd` on page 1) | The last page with a limit when it is page 1 | Last is disabled when page 1 is the only page (`canNext` false). Practically unreachable; left. |
| `collection-view.ts:118-120` (`??` fallbacks when tab `data` is missing) | A tab opened without `CollectionTabData` | The sidebar always sets `data`. Defensive; left. |
| `collection-view.ts:130`, `:143`, `:166` (`?? []`, `page === null` in `rawText`, `?? 0`) | none | The raw view and row text render only with a page. Defensive; left. |
| `collection-view.ts:209` (root table already horizontal) | none | A fresh per-view `TableOrientationService` always starts vertical. Left. |
| `collection-view.ts:243` (`jumpInput` undefined) / function at `:193` (`viewChild` compiler-generated arrow) | none | The template always renders the input. Compiler artifact; left. |
| `query.util.ts:52` (non-`Error` thrown by the parser) | none | The parsers throw `ShellSyntaxError`/`Error` only. Defensive; left. |

## Unable to test

- AC2 (e2e, 10 000 documents): not rerun by the test-writer because the e2e file was not changed. The parent reported a passing run (`npm run test:e2e -- test/e2e/collection.e2e.ts`, podman). The parent should record its own evidence.
- Visual direction (frontend-design, Business/Tron tokens, no hard-coded colors): not covered by unit tests. This is a review item.
- Observation, not a defect (documented in paging-core `lastPage`): with a filter and a `.limit(n)` but no count, "Last" reads only the next page (skip), because the end of a limited result is unknown without a count. This matches the recorded assumption and paging-core's documentation. The parent may want to note it in the UI or the assumptions.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion. TW-1 (Medium): Previous on a last page with unknown position goes to page 1. TW-2 (Low): the page jump field keeps an out-of-range number. Every other gap requested (stale answers, limits, `$meta` sort, collation skip mode, page size, unreadable documents, destroy/cancel) is covered by passing tests. Coverage is diagnostic only (partial-failed) until the 4 failing tests pass.
