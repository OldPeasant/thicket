# Test Report

Date: 2026-11-16

Task: collection-view - M1: Collection tab: query bar, pager and result views (round 3, after fixer commit 50ca032)

Scope: task base `37861d5742a384e7ee1663a4e76509cbb87c0a91` (`git merge-base HEAD origin/main`) to HEAD `50ca032c06c69fe907f83292f9f2807afa487043` on branch `main`. Task commits are the 8 commits with "collection-view:" in `git log 37861d5..HEAD` (09f23c6, d7261c4, 2ad3606, 9931111, 3e0c46f, ffc1990, aebff7d, 50ca032). There are no other commits in that range.
Round-3 focus: the fixer commit 50ca032. It changes `packages/renderer/src/app/collection/collection-results.service.ts` in two places. `pageArrived` (lines 346-352): a short or empty `before` read made while the position is unknown is not shown, and page 1 is read again from the start (CR-1/TW-3). `applyCount` (line 282): an exact count re-reads (`realign`) only when no page read runs (TW-4).
Production files of the task: `packages/renderer/src/app/collection/{collection-results.service.ts, collection-view.ts, collection-view.html, collection-view.css, query.util.ts, index.ts}`, `packages/renderer/src/app/app.config.ts`, `packages/core/package.json`.
Uncommitted inputs: only the two spec files below. The working tree also shows `reviews/collection-view/review.md` as modified. The test-writer did not change it; it was probably changed by the concurrent code-reviewer.

Requirements:
- `tasks/collection-view.md` acceptance criteria and recorded assumptions
- `docs/ARCHITECTURE.md` "Collection tab" and "Coverage"
- `SPEC.md` (through the task), `AGENTS.md`, `reviews/collection-view/fixes.md` (round 2: CR-1, TW-3, TW-4 and the documented known limit), earlier `tests.md`/`review.md`
- `@thicket/core/paging` (`packages/core/src/paging/state.ts`) for paging semantics (`pageLoaded`, `jumpToPage`, `lastPage`)

## Test files changed

- `packages/renderer/src/app/collection/collection-results.service.spec.ts` (15 tests added, in 2 new `describe` blocks)
- `packages/renderer/src/app/collection/collection-view.spec.ts` (2 tests added, plus a local `collectionOf(n)` fake that answers `docs.find` like a collection with ids 1..n, honouring `fromEnd`/`before`/`after`/`skip`/`limit`)

No existing test was changed, weakened, skipped or removed.

## Tests added or updated

Count: 17 (111 tests in the 3 collection spec files, up from 94)

Service (`CollectionResults`; the test settles every stream and count itself, with no timers):
- `an exact count arriving while a page read runs from an unknown position >`
  - `keeps Next back to the last page, then reads it again with the remainder` (count answers while Next runs from 1 page before the last; Next is not cancelled; it arrives, then is re-read `fromEnd` with limit 34, ending on page 25, row 1 201)
  - `keeps a jump by number and reads nothing more once it arrived` (jump to page 3 while the count runs; no realign read)
  - `then Previous is cancelled: no read starts, the next Previous is placed by the count` (the fixer's documented known limit, plus recovery: the next Previous gives page 24 via `skip 1150`)
  - `then Previous fails: the error shows, the page stays and nothing more is read`
  - `a failed exact count leaves the running Previous alone`
- `a short backward read from an unknown position reads page 1 aligned >`
  - `page size 50, 1 row(s) before the last page`
  - `page size 50, 49 row(s) before the last page`
  - `page size 20, 7 row(s) before the last page`
  - `page size 20, 0 row(s) before the last page` (empty answer)
  - `page size 100, 30 row(s) before the last page`

    Each case checks the following. The re-read has the full page size and no `before`/`after`/`skip`/`fromEnd`. The shown page and its "from the end" name stay while the re-read runs. The result is page index 0 at firstRow 0, with the new page size kept. Next then sends `after` the last id of page 1 and is numbered from `pageSize`.
  - `an exact count answering during the short read: page 1 is read once, aligned`
  - `an exact count answering during the page-1 re-read reads nothing more`
  - `a cancelled page-1 re-read keeps the shown page and its name from the end` (a late answer of the cancelled re-read changes nothing)
  - `a failed page-1 re-read reports the error and keeps the shown page`
  - `a short answer to Previous from a page of known position is page 1 as paging-core says` (control: no `before` read, no extra re-read)

Component (`CollectionView`):
- `paging back from Last to the start numbers page 1 and the pages after it aligned` (120 documents; the reviewer's CR-1(a) case through the UI: "1–50", page field "1", Previous disabled, then Next "51–100", page "2")
- `an exact count answering while Previous runs from an unknown last page shows the page before the last` (1 234 documents. The Previous stream is held open until the count answers and is not cancelled. The view ends on page "24", rows "1,151–1,200 of 1,234 documents")

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: invalid filter shows the parse error and does not run (fake API) | `shows the parse error of an invalid filter and does not run the query`, `reports errors of every invalid field at once` | `npm run test -w packages/renderer -- --include='src/app/collection/**/*.spec.ts'` | Pass |
| AC2: e2e, 10 000 docs: filter + sort, page 3, jump to last, exact count | `test/e2e/collection.e2e.ts` › `filter and sort 10 000 documents, page, jump to the last page, count exactly` | `npm run test:e2e -- test/e2e/collection.e2e.ts` (MongoDB fixture through Podman, built Electron app) | Pass (1 passed, 4.3 s test / 6.9 s total) |
| AC3: Cancel stops a slow query (component test, fake stream) | existing `cancels a slow page read...`, `cancels a slow new query`, `cancels a slow exact count`, `cancel moves the focus to the Run button`, `cancelling the count that Last waits for...`; new service `a cancelled page-1 re-read keeps the shown page...`, `then Previous is cancelled...` | focused command above | Pass |
| CR-1/TW-3: a short or empty backward read from an unknown position gives an aligned page 1, never an empty "No documents match" page, and later pages are numbered aligned | fixer's `pages back by range all the way; a short page before a bound reads page 1 aligned`, `paging back from Last over a multiple of the page size never shows an empty page`; round-2 `previous from rows that are really page 1...` (service + component); new 5 parameterised short-read cases, the component `paging back from Last to the start numbers page 1...`, cancel/failure of the re-read, count during the short read / the re-read, known-position control | focused | Pass |
| TW-4: an exact count arriving while Previous/Next/jump runs keeps that navigation and places it once it arrived | round-2 `an exact count answering while Previous runs ... keeps Previous`; new `keeps Next back to the last page...`, `keeps a jump by number...`, `a failed exact count leaves the running Previous alone`, component `an exact count answering while Previous runs ... shows the page before the last` | focused | Pass |
| Known limit (fixes.md): a read cancelled or failed after the count arrived leaves the page named "from the end" with the count known; no read starts; the next navigation places it | new `then Previous is cancelled...`, `then Previous fails...` | focused | Pass |
| An exact count with no read running still re-reads an unknown page aligned | existing `is named from the end, and pages back from it by range`, `gives the last page read before the count its index...`, `counts pages paged back from an unknown last page from the end` | focused | Pass |
| Earlier rounds (count-first Last, limit, skip mode, estimates, page size on arrival, jump field, late answers) | existing tests, unchanged | focused | Pass |
| Visual direction (frontend-design, Business/Tron tokens, no hard-coded colors) | none | n/a | Not testable by unit tests (review item) |

## Focused test execution

Command:

`npm run test -w packages/renderer -- --include='src/app/collection/**/*.spec.ts'` (repo root)

Result:

Pass: 3 files, 111 tests. Also `npx prettier --check packages/renderer/src/app/collection/*.spec.ts`: "All matched files use Prettier code style!". `npx eslint packages/renderer/src/app/collection/`: no findings.

## Full test execution

Command:

`npm run check` (repo root: lint, Prettier check, type check including `tsc -p tsconfig.spec.json`, root Vitest, renderer `ng test`)

Result:

Pass. Root Vitest: 46 files, 2829 tests passed. Renderer: 55 files, 1341 tests passed.

`npm run test:e2e -- test/e2e/collection.e2e.ts`: Pass (1 passed). Podman ran the MongoDB fixture, and the app was built through the e2e script.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` (result above). It was not run as a separate invocation.

## Bugs found

None. Every new test passes against HEAD 50ca032. The fixer's documented known limit is tested as described and was not reported as a bug: after a read is cancelled or fails, the shown page stays named "from the end" even though the exact count is known, until the next navigation or count.

## Coverage

Status: verified. The run had a fresh output, all 111 tests passed, and the run exited 0.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately. All four `.ts` files in scope were added by this task (`git diff --stat 37861d5..HEAD`), so whole-file coverage equals coverage of the task's lines. The round-3 changed lines (`collection-results.service.ts` 282 and 346-352) are fully covered, both lines and branches: lcov has no uncovered BRDA entry on those lines.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `collection-view`; base `37861d5742a384e7ee1663a4e76509cbb87c0a91` (from the parent: `git merge-base HEAD origin/main`); measured HEAD `50ca032c06c69fe907f83292f9f2807afa487043`; task commits: the 8 "collection-view:" commits in `git log 37861d5..HEAD`; file scope from `git diff --stat 37861d5..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 50ca032 plus these sha256 values, identical before and after the coverage run. Production files: `collection-results.service.ts` `faf7085d1221316ec1fc388759f678e056ea69a4cad899ed4c1e7d4dd408b0c7`; `collection-view.ts` `56afb87942fb08a5b89a4964433ae75240e1d8c9c3335107f51ec0bdcca7c53d`; `collection-view.html` `086264f688fe2de916136fd6482694a251bf901b41bbb75a2894c120fb934955`; `query.util.ts` `e604ac8b74ee24b3716aea36dbf6ddeded925c4c888ff7b365cf59952ab3ae82`; `index.ts` `f7702be3e8bdc6d36daca34dceb36d6ba28186d39ff83f1cf18cfbf588043d7a`. Uncommitted tests: `collection-results.service.spec.ts` `557b88dbe458a6b720714232f4cd96f2b80857e56393d15ec7a2c4015ed738b8`; `collection-view.spec.ts` `46b9dfb8d5a4c54d12a1251bdc6c1ebb3bf7671eedbf9805611f5798928a01f2`. Unchanged test: `query.util.spec.ts` `e80178dabffe08a9d23c58da2619298fd1b38e4614cabe3d2ad4aebd6787ca25`.
- Exact included files; renamed/deleted/excluded files and reasons: Included: `src/app/collection/collection-results.service.ts`, `collection-view.ts`, `query.util.ts`, and `index.ts` (re-exports only: 0 statements, so N/A). Excluded:
  - `collection-view.html` and `.css`: template and styles; V8 does not instrument them, and the component tests exercise the template.
  - `app.config.ts`: a one-line provider registration, exercised by the e2e.
  - `packages/core/package.json`: config.
  - `test/e2e/collection.e2e.ts`: a test.
  - `docs/ARCHITECTURE.md` and `reviews/*`: documentation and reports.

  No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0, Vitest 5.1.0 through the `@angular/build` 22.2.7 unit-test builder. Run in `packages/renderer`: `npx ng test --coverage --include='src/app/collection/**/*.spec.ts' --coverage-include='src/app/collection/collection-results.service.ts' --coverage-include='src/app/collection/collection-view.ts' --coverage-include='src/app/collection/query.util.ts' --coverage-include='src/app/collection/index.ts' --coverage-reporters=text-summary --coverage-reporters=json-summary --coverage-reporters=lcovonly --coverage-reporters=text`. Selection: all 3 collection spec files, 111 tests, with no `--filter`.
- Run start/completion time and exit status: started 2026-11-16 23:57:51 +0100, reports written 23:57:58 +0100, exit 0 (3 files, 111 tests passed).
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 `9fbbffabade3431e33b67376bbb2e6f7f1a343ed12a781c8a5d73632d172da53`; `packages/renderer/coverage/renderer/lcov.info` sha256 `b20ffa1db654a110b9c9fcce0c54094fc18cbbbf5ea0a5eb040f3daf43503a89` (Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: yes. The round-2 report directory (23:47) was replaced, and the directory and both files have mtimes from this run (23:57:51-23:57:58). The report's totals (429 statements, 277 branches) differ from round 2 (426/270), as expected for the changed service. Source and test hashes match before and after.
- Final run after latest test additions and production fixes: yes. The run used HEAD 50ca032 (the fixer's latest code) with all round-3 test additions.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/collection/collection-results.service.ts` | 244/248 (98.39%) | 152/159 (95.60%) | 34/34 (100%) | 211/211 (100%) |
| `packages/renderer/src/app/collection/collection-view.ts` | 122/125 (97.60%) | 67/77 (87.01%) | 32/33 (96.97%) | 102/102 (100%) |
| `packages/renderer/src/app/collection/query.util.ts` | 56/56 (100%) | 40/41 (97.56%) | 7/7 (100%) | 44/44 (100%) |
| `packages/renderer/src/app/collection/index.ts` | N/A (0/0) | N/A | N/A | N/A |

**Aggregate:** summed counters over the 3 measured files: statements 422/429 (98.37%), branches 259/277 (93.50%), functions 73/74 (98.65%), lines 357/357 (100%). `index.ts` is N/A. The `.html`/`.css` files, `app.config.ts` and `package.json` are not instrumented (see above).

Round 2 (diagnostic, pre-fix code at 4a2a79a) measured 419/426 statements, 252/270 branches, 73/74 functions and 354/354 lines. Those numbers describe an earlier revision and are listed for comparison only.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `collection-results.service.ts:204`, `:260` (stale-generation return on a *resolved* count/estimate) | Late count answers | Late answers are tested, but abort rejects the promise first. The resolve path runs only for an answer already in flight. Defensive; left. |
| `collection-results.service.ts:327`, `:330`, `:336` (stale-generation guards in the stream callbacks) | Late stream data | `load()`/`cancel()` unsubscribe the old stream, and RxJS delivers nothing after that. The behavior is tested (`drops a slow page read superseded...`, new `a cancelled page-1 re-read ...` late answer). Defensive; left. |
| `collection-results.service.ts:319` (`query.limit ?? 0` in the beyond-limit notice) | none | `clipToLimit` returns `null` only when a limit is set. Unreachable; left. |
| `collection-results.service.ts:418` (`start > 0` false in `clipToLimit` for `fromEnd` on page 1) | Last with a limit when the last page is page 1 | With a limit, Last counts first, and a single page disables Last. Practically unreachable; left. |
| `collection-view.ts:118-120` (`??` fallbacks when tab `data` is missing) | A tab without `CollectionTabData` | The sidebar always sets `data`. Defensive; left. |
| `collection-view.ts:130`, `:143`, `:169` (`?? []`, `page === null` in `rawText`, `?? 0`) | none | The raw view and the row text render only with a page, and `?? 0` sits under `positionUnknown()`. Defensive; left. |
| `collection-view.ts:212`, `:213`, `:262` (`jumpInput`/`sizeSelect` undefined) and the uncovered function (the compiler-generated `viewChild` arrow) | none | The template always renders both elements. Compiler artifact; left. |
| `collection-view.ts:228` (root table already horizontal) | none | A fresh per-view `TableOrientationService` always starts vertical. Left. |
| `query.util.ts:52` (non-`Error` thrown by the parser) | none | The parsers throw `ShellSyntaxError`/`Error` only. Defensive; left. |

No meaningful task behavior is left uncovered. The round-3 production changes (the `applyCount` condition and the `pageArrived` short-`before` branch) are covered on every branch.

## Unable to test

- Visual direction (frontend-design skill, Business/Tron tokens, no hard-coded colors): a review item, not unit-testable.
- The AC2 e2e does not exercise the round-3 edge cases. Those are races with a slow count, and a short backward read needs a result size that is not a multiple of the page size, reached through Last and then Previous. Service and component tests with controlled stream and count ordering cover them instead.
- Observation (not a defect; documented as a known limit in fixes.md): when the page read that a count arrived during is cancelled or fails, the pager keeps "Last N" / "N pages before the last" with an exact total shown until the next navigation. Tests pin this behaviour. A human may want to revisit it: a later Count or any navigation corrects it.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found. The round-3 fixes for CR-1/TW-3 (short or empty backward read, so page 1 is read aligned) and TW-4 (an exact count no longer cancels a running Previous/Next/jump) hold. They were checked with page sizes 20/50/100, short answers of 0/1/7/30/49 rows, a count arriving during the short read and during the re-read, and cancel or failure of either read. The checks also include Next and a jump racing a count, a failing count, and two component-level flows. Focused tests (111), `npm run check` (2829 + 1341 tests) and the collection e2e (Podman) pass. Coverage of the task files: statements 422/429, branches 259/277, functions 73/74, lines 357/357. The only uncovered branches are defensive ones.
