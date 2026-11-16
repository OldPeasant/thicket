# Test Report

Date: 2026-11-16

Task: paging-core - Core: collection paging strategy

Scope: base `cd1dd9a41a0767be0d4846e95bdd61763eecbcfa` .. HEAD `861507151e86b1ff2d5f27169e6c459f4bdc7ec8` on branch `main`, limited to `packages/core` (`git diff cd1dd9a..HEAD -- packages/core`). Task-owned code commit: `8615071` "Add core paging: range/skip page requests, range bounds for compound sorts" (the parent supplied this commit as 48dbb37; HEAD now holds it as 8615071 after a rebase). Commits 490428a, 4c56acf, 51750bd and ed95d7e only touch `tasks/` and were excluded. Production files: `packages/core/src/paging/{sort,range,state,index}.ts` (new) and `packages/core/src/index.ts` (adds `export * from './paging'`). Uncommitted inputs at measurement time: only the test-writer's own test changes listed below.

Requirements:
- `tasks/paging-core.md` acceptance criteria (1) next/previous/jump/last in range and skip mode, switching sort resets to page 1; (2) range bounds correct for compound sort keys and descending sorts
- `tasks/paging-core.md` recorded assumptions (range-pageable sorts, jump via skip once, last page via reversed sort, opaque sorts use skip)
- `SPEC.md` Browsing, Paging: page size, first/previous/next/last/jump-to; range paging on an indexed unique key, `skip`/`limit` otherwise; estimated count by default
- `docs/ARCHITECTURE.md` Coverage and Conventions (Vitest, `*.spec.ts` next to the code)

## Test files changed

- `packages/core/src/paging/sort.spec.ts` (new)
- `packages/core/src/paging/state.spec.ts` (tests appended; one import line extended, existing tests unchanged)

## Tests added or updated

Count: 40 (20 in `sort.spec.ts`; 20 in `state.spec.ts`, 6 of them from one `it.each` over six sorts). The existing tests were reviewed. They are meaningful: an in-memory fake server evaluates the generated filters. None were changed or weakened.

## Requirement coverage

All commands were run in `packages/core`.

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 next/previous in range mode | existing `next / previous > range mode, *`; new `pages a compound unique index (not _id) with a descending key in range mode` | `npx vitest run src/paging` | Pass |
| AC1 next/previous in skip mode | existing `skip mode, non-unique sort`, `skip mode combines with a user filter`; new `an opaque sort records no sort keys and keeps paging by skip` | `npx vitest run src/paging` | Pass |
| AC1 jump (range and skip) | existing `jump to page > *`; new `jump past the estimated page count is not clamped` | `npx vitest run src/paging` | Pass |
| AC1 last (range and skip) | existing `last page > *`; new `last page with an exact count that is a multiple of the page size reads a full page`, compound-unique-index walk (last then back) | `npx vitest run src/paging` | Pass |
| AC1 next after previous reached the start by range | `paging state after the start was reached by "before" > next stays available after a short "before" page became page 1` | `npx vitest run src/paging` | Fail (TW-1) |
| AC1 switching sort resets to page 1 | existing `switching sort resets to page 1 and re-picks the mode`; new `switching sort resets to page 1 > range -> range with the opposite direction ...`, `range -> opaque sort switches to skip mode on page 1`, `skip mode -> range mode on page 1`, `switching to the same sort also returns to page 1` | `npx vitest run src/paging` | Pass |
| AC2 range bounds for compound and descending sorts | existing `rangeFilter > *`; new `range bounds for compound and descending sorts (fake server) > [sort name]: after/before each row select exactly the rows beyond it` (6 sorts, every row used as a bound, both sides) | `npx vitest run src/paging` | Pass |
| AC2 range bounds when some documents lack a sort key (null) | `documents missing a sort key (sorted as null) > descending sort: paging forward reaches ...`, `ascending sort: paging back from the last page reaches ...`, `ascending sort: paging forward from the null rows works` | `npx vitest run src/paging` | 2 Fail (TW-2), 1 Pass |
| Sort parsing and range-pageability (supports mode choice) | `sort.spec.ts`: `parseSort`, `sortDocument`, `reverseSort`, `sameSort`, `isRangePageable` (20 tests) | `npx vitest run src/paging` | Pass |
| `findPlan` guard: a range bound without a sort | `page requests: remaining paths > findPlan rejects a range bound without a sort` | `npx vitest run src/paging` | Pass |

## Focused test execution

Command:

`cd packages/core && npx vitest run src/paging`

Result:

Fail: 3 test files, 77 tests, 74 passed, 3 failed. The 3 failures are the production defects TW-1 and TW-2 below. All other paging tests pass.

## Full test execution

Command:

`cd packages/core && npx vitest run`

Result:

Fail: 4 files, 78 tests, 75 passed, 3 failed (the same 3 tests).

Other commands:
- `npx prettier --check packages/core/src` (repo root): Pass ("All matched files use Prettier code style!")
- `npm run lint` (repo root, `eslint . --max-warnings 0 && prettier --check .`): Pass

## .taskcheck

Result:

Fail. `.taskcheck` runs `npm run check`: lint passed, typecheck passed (all workspaces), and `vitest run` reported 8 files and 676 tests, 673 passed, 3 failed. The only failures are the 3 tests for TW-1 and TW-2. The check will pass once those production defects are fixed.

## Bugs found

### canNext is false after a short "before" page became page 1, though rows follow

Finding ID:

`TW-1`

Test:

`state.spec.ts > paging state after the start was reached by "before" > next stays available after a short "before" page became page 1`

Production source:

`packages/core/src/paging/state.ts:139` (`canNext`: `return state.page === null || state.page.rows >= state.pageSize;`), together with `state.ts:242` (`pageLoaded` turns a short `before` page into page 1 and keeps `isLast: false`)

Requirement:

AC1 next/previous in range mode; SPEC Paging (next must be reachable while rows follow).

Expected behavior:

`pageLoaded` correctly records `isLast: false` for a short `before` page, because rows follow it. `canNext` should then be true, and `nextPage` should continue after its last row.

Actual behavior:

`canNext` treats any short page as the end, so the next button is disabled and the user is stuck on page 1. Here is a realistic sequence. The estimated count is too high (30 for 23 docs, page size 5), so `lastPage` puts index 5 on rows 18..22. Previous by range goes back to index 1 and reads `before {_id: 3}`, which returns `[0, 1, 2]` (short), so the state is page 1. Then `canNext` is false, while `nextPage` would return `[3..7]`. The same happens after concurrent deletes. An empty `before` result becomes an empty page 1 with no next.

Severity:

Medium

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### Range bounds skip documents that lack a sort key (null) when null lies beyond the bound

Finding ID:

`TW-2`

Test:

`state.spec.ts > documents missing a sort key (sorted as null) > descending sort: paging forward reaches the documents without the field` and `... > ascending sort: paging back from the last page reaches the documents without the field`

Production source:

`packages/core/src/paging/range.ts:41-48` (`strictBeyond` emits a plain `$gt`/`$lt` for non-null values) and `range.ts` `rangeFilter` first-key prefix bound (`$gte`/`$lte` on the first key)

Requirement:

AC2 "Range bounds built correctly for compound sort keys and descending sorts". `valueAtPath` documents that missing fields are null "which is how MongoDB sorts them", and the recorded assumption says that "null bounds [are] handled specially". Any sort that includes `_id` (e.g. `{lastName: -1, _id: 1}`) is range paged, so documents missing `lastName` are common in schemaless collections.

Expected behavior:

Paging by range shows every document exactly once. Null/missing sorts below every other value, so it lies *beyond* a non-null bound whenever the comparison is "less than": for `after` on a descending key and for `before` on an ascending key. The filter should also accept `null` (e.g. `{$lt: v}` OR `{$eq: null}`) in those cases, both in the per-key clause and in the first-key prefix bound.

Actual behavior:

`$lt: v` and `$lte: v` don't match null or missing values because of type bracketing. With `{last: -1, _id: 1}`, paging forward never shows the 4 documents without `last`: rows shown `[2, 6, 9, 0, 4, 8]`, expected `[..., 1, 3, 5, 7]`. A short page then ends paging. With `{last: 1, _id: 1}`, paging back from the last page skips them as well: shown `[0, 4, 8, 9, 2, 6]`. The fake server models MongoDB type bracketing for `$lt`/`$lte` and `$eq: null`.

Note for the parent: the task assumption limits range bounds to "one BSON type per sort key". Mixed non-null types (numbers and strings) are clearly out of scope. Missing fields (null) are not, because the code and the assumption both claim to handle null specially. If the parent decides to exclude missing fields too, record that as an explicit assumption and decide how these two tests are dispositioned. Do not delete them silently.

Severity:

Medium

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### Observation (not a defect, no test failure)

In skip mode with a non-unique sort (e.g. `{name: 1}`), `lastPage` reads with the reversed sort while the other pages use forward `skip`. MongoDB does not guarantee a stable order among ties, so rows can repeat or go missing at the boundary of the last page. This matches the recorded assumption ("Last page uses the reversed sort") and is inherent to skip paging on non-unique sorts. Recorded for awareness only.

## Coverage

Status: partial-failed. The test command exited nonzero because of the 3 failing defect tests (TW-1, TW-2). The numbers below come from a fresh run that reported coverage despite the failures (`--coverage.reportOnFailure`) and are diagnostic only. The same command without that flag produced no report: Vitest cleaned `coverage/` and wrote nothing because tests failed. The run before the new tests (all passing) measured 141/155 statements, 162/179 branches, 33/36 functions and 120/129 lines.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately. All files in scope are new in this task except `src/index.ts`, so whole-file coverage of the `paging/` files equals their changed-line coverage.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `paging-core`; base `cd1dd9a41a0767be0d4846e95bdd61763eecbcfa` (from the parent); HEAD `861507151e86b1ff2d5f27169e6c459f4bdc7ec8`; task-owned commit `8615071`; file scope from `git diff --stat cd1dd9a..HEAD`, checked against the task's `touches: [packages/core/src/paging]`
- Source/test snapshot identifier (including uncommitted inputs): production files equal HEAD (sha256 `state.ts` bdfa5ce9..., `range.ts` ac2893b6..., `sort.ts` 3701ab9e..., `index.ts` 1947dc1b...). Uncommitted tests: `state.spec.ts` f9842d59..., `sort.spec.ts` 2e9f7d5b... (new), `range.spec.ts` 5fcb17fd... (unchanged). The hashes were identical before and after the run.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/paging/index.ts`, `src/paging/range.ts`, `src/paging/sort.ts`, `src/paging/state.ts`. Excluded `src/index.ts`: its only change is a one-line re-export, it has no executable task behavior, and it is outside the `--coverage.include` the parent specified. No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` with vitest/5.1.0 on node v24.22.1. Command `npx vitest run --coverage --coverage.include='src/paging/*.ts' --coverage.reportOnFailure`, run in `packages/core`, on all `src/**/*.spec.ts` (4 files, 78 tests)
- Run start/completion time and exit status: 2026-11-16 19:35 (+01:00), finished 19:35:34. Nonzero exit, with 3 failed tests (TW-1, TW-2).
- Generated report paths and report hashes/run identifier: `packages/core/coverage/coverage-summary.json` (sha256 1e8d5cbc...7324a), `packages/core/coverage/lcov.info` (sha256 6ef8f09b...ef67), `packages/core/coverage/lcov-report/`. All have mtime 19:35:34 and are git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The preceding command without `reportOnFailure` left no `coverage/` directory, so these files come from this run. The source hashes were unchanged.
- Final run after latest test additions and production fixes: yes for the latest test additions. No production fixes exist yet. After the fixer changes code, a fresh run is required.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/core/src/paging/sort.ts` | 39/39 (100%) | 39/39 (100%) | 11/11 (100%) | 27/27 (100%) |
| `packages/core/src/paging/range.ts` | 38/38 (100%) | 29/29 (100%) | 7/7 (100%) | 33/33 (100%) |
| `packages/core/src/paging/state.ts` | 78/78 (100%) | 111/111 (100%) | 18/18 (100%) | 69/69 (100%) |
| `packages/core/src/paging/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| Aggregate (summed counters; excludes `src/index.ts`, see above) | 155/155 (100%) | 179/179 (100%) | 36/36 (100%) | 129/129 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `sort.ts` `sortDocument`, `sameSort` (no hits in the baseline run) | sort document round trip; sort comparison | `sort.spec.ts` `sortDocument > *`, `sameSort > *` |
| `sort.ts` `parseDirection` string branches (baseline) | "asc"/"desc"/"ascending"/"descending" from the query bar | `parseSort > reads asc/desc words case-insensitively`, `returns null for a $meta sort or any other direction value` |
| `sort.ts` `isRangePageable` duplicate-field branch (baseline) | mode choice | `isRangePageable > is false when a field appears twice` |
| `state.ts` `findPlan` "range paging needs a sort" throw (baseline) | guard against an inconsistent request | `findPlan rejects a range bound without a sort` |
| `state.ts` `pageLoaded` opaque-sort `keysOf` branch (baseline) | opaque sorts keep skip paging | `an opaque sort records no sort keys and keeps paging by skip` |
| none remaining | line and branch coverage is complete, but the TW-1 and TW-2 behavior is still wrong | covered lines do not mean correct behavior, see Bugs found |

## Unable to test

- Behavior against a real MongoDB server (type bracketing, `$type: 'minKey'`, index use of the prefix bound) is not tested. This task is a pure-function unit task, and the in-memory fake server models only null, numbers and strings, so MinKey and other BSON types are not exercised. Follow-up belongs to the backend or integration tasks that run `docs.find`.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion (TW-1 `canNext` after a short "before" page; TW-2 range bounds skip documents with a missing sort key). The 3 failing tests express required behavior and must not be weakened, skipped or deleted. After the fix, run `npx vitest run` and the coverage command again.
