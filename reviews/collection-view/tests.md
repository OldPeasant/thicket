# Test Report

Date: 2026-11-16

Task: collection-view - M1: Collection tab: query bar, pager and result views (round 2, after the fixer commit)

Scope: `git diff 71cae27070db670e50570be2d61c938826b9016f..4a2a79ae7189c8599727c5ad33402d81f4dbb693` on branch `main`.
The parent named task commits 78bdc38, 8ae7102, 1468cf5, 49ebcad, 73768c0, 43c756d (fixer). The work was rebased afterwards. HEAD 4a2a79a is the rebased 43c756d: `git diff 43c756d HEAD` touches only `tasks/collection-view.md` and `tasks/docs-write-backend.md`, so the code is identical. `git log 71cae27..HEAD` shows the six rebased task commits (152a8c6, cff8792, 49f01f0, 233cea5, 213c021, 4a2a79a).
Round-2 focus: the fixer commit's changed behavior. That covers paging after a last page of unknown position, estimates, page size, Cancel focus, the jump field, and count-first Last (skip mode and any query with a user limit, `last()` in `collection-results.service.ts:146-160`).
Production files: `packages/renderer/src/app/collection/{collection-results.service.ts, collection-view.ts, collection-view.html, collection-view.css, query.util.ts, index.ts}`, `packages/renderer/src/app/app.config.ts`, `packages/core/package.json`.
Uncommitted inputs: only the two spec files below. `reviews/collection-view/review.md` also shows as modified in the working tree. The test-writer did not change it (it was probably the concurrent code-reviewer).

Requirements:
- `tasks/collection-view.md` acceptance criteria and recorded assumptions
- `docs/ARCHITECTURE.md` "Collection tab" (updated by the fixer: count-first Last, position unknown with an estimate, page size applies on arrival, Cancel focus, empty-page and beyond-limit messages) and "Coverage"
- `SPEC.md` (through the task), `AGENTS.md`, previous reports `reviews/collection-view/{tests,review,fixes}.md`
- `@thicket/core/paging` (`packages/core/src/paging/state.ts`) for paging semantics

## Test files changed

- `packages/renderer/src/app/collection/collection-results.service.spec.ts` (9 tests added)
- `packages/renderer/src/app/collection/collection-view.spec.ts` (3 tests added)

No existing test was changed, weakened, skipped or removed.

## Tests added or updated

Count: 12 (93 tests in the 3 collection spec files, up from 81)

Service (`CollectionResults`, fake bridge, the test settles every stream/count itself):
- `limit > last with a limit and an exact count reads the last page at once, without counting again`
- `limit > last with a limit, counted to fewer rows than the limit, reads the real last page`
- `limit > a pending Last is dropped when a new query runs before its count answers`
- `limit > pressing Last again while its count runs reads the last page once`
- `last page without a count > first, jump to page 1 and a page-size change leave the unknown position`
- `last page without a count > a cancelled read from an unknown last page keeps it named from the end`
- `last page without a count > previous from rows that are really page 1 shows page 1, not an empty result` (**fails: TW-3**)
- `last page with an estimated count > an estimate arriving on a page before the unknown last page keeps its name`
- `last page with an estimated count > an exact count answering while Previous runs from an unknown last page keeps Previous` (**fails: TW-4**)

Component (`CollectionView`):
- `with a filter and a limit, Last counts first and then shows the last page by number`
- `cancelling the count that Last waits for reads no page and keeps the shown one`
- `previous from a last page that is really page 1 shows its documents, not an empty result` (**fails: TW-3**)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: invalid filter shows the parse error and does not run (fake API) | `shows the parse error of an invalid filter and does not run the query`, `reports errors of every invalid field at once` | `npm run test -w packages/renderer -- --include='src/app/collection/**/*.spec.ts'` | Pass |
| AC2: e2e, 10 000 docs: filter + sort, page 3, jump to last, exact count | `test/e2e/collection.e2e.ts` › `filter and sort 10 000 documents, page, jump to the last page, count exactly` | `npm run test:e2e -- test/e2e/collection.e2e.ts` (MongoDB container through Podman, built Electron app) | Pass (1 passed, 5.9 s) |
| AC3: Cancel stops a slow query (component test, fake stream) | `cancels a slow page read...`, `cancels a slow new query`, `cancels a slow exact count`, `cancel moves the focus to the Run button`, new `cancelling the count that Last waits for reads no page and keeps the shown one` | focused command above | Pass |
| Count-first Last with a user limit (range mode): count sent with the limit, then a skip read of the last page, page numbered | existing `last with a filter and a limit but no count counts first...`, `reads the last page with skip at a page boundary...`; new `with a filter and a limit, Last counts first...` (component), `last with a limit and an exact count ... without counting again`, `... counted to fewer rows than the limit...` | focused | Pass |
| A pending Last is dropped by cancel, a failed count, other paging, a new run, or a second Last | existing skip-mode `cancelling the count, or paging meanwhile...`, `a failed count reports the error...`; new `a pending Last is dropped when a new query runs...`, `pressing Last again while its count runs...`, component cancel test above | focused | Pass |
| Count-first Last in skip mode (collation / non-range sort) | existing `last page in skip mode > *`, component `in skip mode, Last counts exactly...` | focused | Pass |
| Paging after a last page of unknown position: Previous by range, Next back to the last page, jumps by number, First / page 1 / page size give a known position again, cancel keeps the name | existing TW-1 tests and fixer tests; new `first, jump to page 1 and a page-size change leave the unknown position`, `a cancelled read from an unknown last page keeps it named from the end` | focused | Pass |
| Previous from an unknown last page whose rows are page 1 | new service + component `... really page 1 ...` | focused | **Fail (TW-3)** |
| Estimates do not place a page of unknown position | existing `an estimate arriving after the last page was read from the end does not place it`, `is named from the end, and pages back from it by range`; new `an estimate arriving on a page before the unknown last page keeps its name` | focused | Pass |
| An exact count re-reads an unknown page aligned, without undoing a navigation that is running | existing `an exact count arriving during a last-page read reads it again aligned`; new `an exact count answering while Previous runs ... keeps Previous` | focused | **Fail (TW-4)** |
| Page size applies when its page arrives (cancel/failure keep the old size) | existing fixer tests (service + component) | focused | Pass |
| Jump field shows the shown page after invalid / beyond-limit / clamped / same-page input | existing TW-2 and fixer tests | focused | Pass |
| Empty page past page 1 / beyond-limit notice | existing `an empty page past the end does not blame the filter...`, `a page number beyond the limit says...`, `a jump beyond the limit reads nothing and says why` | focused | Pass |
| Visual direction (frontend-design, Business/Tron tokens, no hard-coded colors) | none | n/a | Not testable by unit tests (review item) |

## Focused test execution

Command:

`npm run test -w packages/renderer -- --include='src/app/collection/**/*.spec.ts'` (repo root)

Result:

Fail: 90 passed, 3 failed (93 tests, 3 files). The 3 failures are the new TW-3/TW-4 tests, and production behavior causes them. `npx prettier --write` left the specs unchanged, and `npx eslint packages/renderer/src/app/collection/` passed.

## Full test execution

Command:

`npm run check` (repo root: lint, Prettier check, type check, root Vitest, renderer `ng test`)

Result:

Fail, only because of the 3 TW-3/TW-4 tests. Lint, Prettier ("All matched files use Prettier code style!") and the type check passed. Root Vitest: 46 files, 2829 tests passed. Renderer (`npm run test -w packages/renderer`): 53 of 55 files passed, 1320 of 1323 tests passed. The 3 failures are exactly the TW tests.

`npm run test:e2e -- test/e2e/collection.e2e.ts`: Pass (1 passed). Podman ran the MongoDB fixture, and the app was built through the e2e script.

## .taskcheck

Result:

Fail. `.taskcheck` runs `npm run check` (result above). The only failures are the 3 new tests that expose TW-3 and TW-4.

## Bugs found

### Previous from a "last page" that is really page 1 shows an empty result that blames the filter

Finding ID:

`TW-3`

Test:

`CollectionResults > last page without a count > previous from rows that are really page 1 shows page 1, not an empty result` (collection-results.service.spec.ts); `CollectionView > previous from a last page that is really page 1 shows its documents, not an empty result` (collection-view.spec.ts)

Production source:

`packages/renderer/src/app/collection/collection-results.service.ts:123-138` (`previous()` while the position is unknown) and `:342-385` (`pageArrived`), together with paging-core `pageLoaded` (a short `before` answer becomes page index 0) and `collection-view.html:245-256` (`emptyPastStart`).

Requirement:

Task goal: pager first/prev/next/last. ARCHITECTURE "Collection tab": Previous pages by range from the edge rows of a last page with an unknown position. "No documents match this query" is reserved for a result that is really empty (CR-3 fix).

Expected behavior:

A filter matches exactly 50 documents (any multiple of the page size up to one page works the same: page 1 is full, so Next/Last are offered without a count). The user presses Last (rows "Last 50", the same documents read from the end), then Previous, which stays enabled because of the placeholder index. Nothing lies before the first row, so the user should see page 1 with its 50 documents, numbered "1–50", page field "1". For example: re-read `firstPage` when a `before` read comes back empty, or treat the shown rows as page 1.

Actual behavior:

The `before` read returns 0 rows. `pageLoaded` makes it page index 0 with 0 rows, and `fromEndState` becomes `null`. The view then shows "No documents match this query. Change the filter or press Reset to see the whole collection." with pager rows "No documents" and First/Previous disabled, although the query matches 50 documents. The user has to press Run or Next to get the documents back.

Severity:

Medium (a wrong message that blames the filter, after a normal First → Last → Previous sequence on a one-page result)

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### An exact count arriving while Previous runs from an unknown last page undoes the Previous

Finding ID:

`TW-4`

Test:

`CollectionResults > last page with an estimated count > an exact count answering while Previous runs from an unknown last page keeps Previous` (collection-results.service.spec.ts)

Production source:

`packages/renderer/src/app/collection/collection-results.service.ts:273-296`. `applyCount(…, true)` calls `realign()`, and `realign()` calls `load()`, which unsubscribes the running user-initiated read.

Requirement:

Task goal: the pager (prev, exact count on request). ARCHITECTURE "Collection tab": once counted exactly, the unknown page is read again aligned. The count should place the page the user navigates to, not replace that navigation.

Expected behavior:

The collection has 1 234 documents and only an estimate. The user is on the last page (position unknown) and presses "Count exactly". While it counts, the user presses Previous, then the count answers (1 234). The user should end on the page before the last: page 24 of 25, rows 1 151–1 200. Either let the `before` read finish and then realign it, or realign to the page Previous targets.

Actual behavior:

When the count answers, `realign()` sees `fromEndState === 0` (the Previous read has not arrived yet). It cancels the running `before` read and reads the last page again (`fromEnd`, limit 34). The view ends on page 25, rows 1 201–1 234, so the Previous click is silently lost. The same applies to any page read that runs (Next, jump) while such a count answers.

Severity:

Low (a race that needs a slow exact count and a click during it, but the user's navigation is dropped without notice)

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: partial-failed. The coverage command with all tests exits 1 because of the 3 TW-3/TW-4 tests, and then writes no report (`packages/renderer/coverage/renderer` did not exist after that run). The numbers below come from a fresh **diagnostic** run of the same command with `--filter` excluding only those 3 tests (90 passed, 3 skipped). Treat them as diagnostic, not as sign-off coverage. Rerun without `--filter` after TW-3/TW-4 are fixed.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately. All four `.ts` files in scope were added by this task (`git diff 71cae27..HEAD`), so whole-file coverage equals coverage of their changed lines.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `collection-view`; base `71cae27070db670e50570be2d61c938826b9016f`; measured HEAD `4a2a79ae7189c8599727c5ad33402d81f4dbb693` (rebased 43c756d, code-identical; see Scope); the commits and base come from the parent, checked against `git log 71cae27..HEAD` and `git diff --stat 71cae27 HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 4a2a79a plus sha256: `collection-results.service.ts` `0a1430c3de50d04aaddc991c1a4a10544817dad693e1ed9f06787ee01332beaf`; `collection-view.ts` `56afb87942fb08a5b89a4964433ae75240e1d8c9c3335107f51ec0bdcca7c53d`; `collection-view.html` `086264f688fe2de916136fd6482694a251bf901b41bbb75a2894c120fb934955`; `query.util.ts` `e604ac8b74ee24b3716aea36dbf6ddeded925c4c888ff7b365cf59952ab3ae82`; `index.ts` `f7702be3e8bdc6d36daca34dceb36d6ba28186d39ff83f1cf18cfbf588043d7a`. Tests (uncommitted): `collection-results.service.spec.ts` `473a03f3d786080af22390d9e5a48b0ee751cedf45c034e33f3f743929a97050`; `collection-view.spec.ts` `99608eb91f65931d58037c6d889d5996e89581d8b804bc1a8535ba04394c0658`; `query.util.spec.ts` `e80178dabffe08a9d23c58da2619298fd1b38e4614cabe3d2ad4aebd6787ca25`. The hashes were identical before and after the coverage runs.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/app/collection/collection-results.service.ts`, `collection-view.ts`, `query.util.ts`, `index.ts` (re-exports only: 0 statements, N/A). Excluded: `collection-view.html`/`.css` (template/styles; V8 does not instrument them, and the component tests exercise the template), `app.config.ts` (a one-line provider registration that the e2e exercises), `packages/core/package.json` (config), `test/e2e/collection.e2e.ts` (test), `docs/ARCHITECTURE.md`, `reviews/*`. No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0, Vitest 5.1.0 through the `@angular/build` 22.2.7 unit-test builder. Run in `packages/renderer`: `npx ng test --coverage --include='src/app/collection/**/*.spec.ts' --coverage-include='src/app/collection/collection-results.service.ts' --coverage-include='src/app/collection/collection-view.ts' --coverage-include='src/app/collection/query.util.ts' --coverage-include='src/app/collection/index.ts' --coverage-reporters=text-summary --coverage-reporters=json-summary --coverage-reporters=lcovonly --filter='^(?!.*(really page 1|keeps Previous)).*$'`
- Run start/completion time and exit status: the unfiltered run started 2026-11-16 23:46:40 +0100 and exited 1 (3 failed, no report). The diagnostic run started 23:46:55 +0100, wrote its report at 23:47:02 +0100 and exited 0 (90 passed, 3 skipped).
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 `3386e46fafffb285279142a326d9303d341be89b53ca5df6fc5c449d59c5c774`; `packages/renderer/coverage/renderer/lcov.info` sha256 `20d30abc9c515b2f93d606130c0f83b979375cc1443247b5581e068f87d9f1dd` (Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: yes. The preceding failed run left no `coverage/renderer` directory, so the report files come from this run (timestamps 23:47:02). Source and test hashes match before and after.
- Final run after latest test additions and production fixes: yes for the latest test additions on the fixer's code (4a2a79a). After TW-3/TW-4 are fixed, the code changes and this evidence becomes stale.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/collection/collection-results.service.ts` | 241/245 (98.37%) | 145/152 (95.39%) | 34/34 (100%) | 208/208 (100%) |
| `packages/renderer/src/app/collection/collection-view.ts` | 122/125 (97.60%) | 67/77 (87.01%) | 32/33 (96.97%) | 102/102 (100%) |
| `packages/renderer/src/app/collection/query.util.ts` | 56/56 (100%) | 40/41 (97.56%) | 7/7 (100%) | 44/44 (100%) |
| `packages/renderer/src/app/collection/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| **Aggregate (summed counters over the 3 measured files; `index.ts` N/A; `.html`/`.css`/`app.config.ts`/`package.json` not instrumented, see above)** | 419/426 (98.36%) | 252/270 (93.33%) | 73/74 (98.65%) | 354/354 (100%) |

Round 1 (diagnostic, pre-fix code at 1da2192) measured 374/381 statements, 217/233 branches, 69/70 functions and 313/313 lines. Those numbers describe an earlier revision. They are listed for comparison only.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `collection-results.service.ts:203`, `:259` (stale-generation return on a *resolved* count/estimate) | Late count answers | Late answers are covered by tests, but abort rejects the promise first, so the resolve path runs only if the answer is already in flight. Defensive; left. |
| `collection-results.service.ts:324`, `:327`, `:333` (stale-generation guards in the stream callbacks) | Late stream data | `load()`/`cancel()` unsubscribe the old stream, and RxJS delivers nothing after that. The behavior is tested (`drops a slow page read superseded...`). Defensive; left. |
| `collection-results.service.ts:316` (`query.limit ?? 0` in the beyond-limit notice) | none | `clipToLimit` returns `null` only when a limit is set. Unreachable; left. |
| `collection-results.service.ts:408` (`start > 0` false in `clipToLimit` for `fromEnd` on page 1) | Last with a limit when the last page is page 1 | With a limit, Last now counts first. An exact count that leaves one page disables Last (`canNext` false). Practically unreachable; left. |
| `collection-view.ts:118-120` (`??` fallbacks when tab `data` is missing) | A tab without `CollectionTabData` | The sidebar always sets `data`. Defensive; left. |
| `collection-view.ts:130`, `:143`, `:169` (`?? []`, `page === null` in `rawText`, `?? 0`) | none | The raw view and the row text render only with a page, and `?? 0` sits under `positionUnknown()`. Defensive; left. |
| `collection-view.ts:212`, `:213`, `:262` (`jumpInput`/`sizeSelect` undefined) and the uncovered function (the compiler-generated `viewChild` arrow) | none | The template always renders both elements. Compiler artifact; left. |
| `collection-view.ts:228` (root table already horizontal) | none | A fresh per-view `TableOrientationService` always starts vertical. Left. |
| `query.util.ts:52` (non-`Error` thrown by the parser) | none | The parsers throw `ShellSyntaxError`/`Error` only. Defensive; left. |

No meaningful task behavior is left uncovered by line coverage. TW-3 and TW-4 were found through behavior tests of already-covered lines, not through coverage gaps.

## Unable to test

- Visual direction (frontend-design skill, Business/Tron tokens, no hard-coded colors): a review item, not unit-testable.
- AC2 was run by the test-writer this round (`npm run test:e2e -- test/e2e/collection.e2e.ts`, Pass). The e2e does not exercise the round-2 edge cases (count-first Last with a limit, one-page results). Component and service tests cover those.
- Observation (not a defect, unchanged from round 1 and accepted by paging-core): a short, non-empty `before` answer becomes page 1 holding fewer rows than a page (`pages back by range all the way; a short page before a bound is page 1`). Pages after it are then offset from the page boundaries until a jump or a count. Only the empty case (TW-3) shows wrong content.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion. TW-3 (Medium): Last → Previous on a one-page result shows an empty page 1 with "No documents match this query". TW-4 (Low): an exact count answering while Previous/Next/jump runs from a page of unknown position cancels that navigation and shows the last page again. Everything else in the fixer's changes passes: count-first Last in skip mode and with a limit, its cancel/supersede paths, estimates, page size on arrival, Cancel focus and the jump field. AC1 and AC3 pass in the component tests, and AC2 passes in the e2e. Coverage is diagnostic only (partial-failed) until the 3 failing tests pass.
