# Test Report

Date: 2026-11-16

Task: paging-core - Core: collection paging strategy (final revision, after fixes CR-1..CR-5 / TW-1, TW-2)

Scope: task base `cd1dd9a41a0767be0d4846e95bdd61763eecbcfa` .. measured HEAD `6673d526ac91328c02d83e4fad45b716b76a3f41` on branch `main`, limited to `packages/core` (`git diff cd1dd9a..HEAD -- packages/core`: 10 files, 1643 insertions, all from the task). Task-owned code commits (by `felix/agent-2`, the only commits touching `packages/core` in the range): `9c92408` "Add core paging ...", `2889d04` "Add paging-core tests and review reports", `6673d52` "Fix paging-core review findings ...". The parent named the final revision `364355d`; that commit is no longer reachable from any branch (rewritten by a rebase) and `git diff --stat 364355d 6673d52 -- packages/core` is empty, so the measured code is identical. The branch was rebased onto newer main (current `git merge-base HEAD origin/main` = `ca32a84`); the other 33 commits in `cd1dd9a..HEAD` belong to other tasks (`tasks/`, `apps/desktop`, etc.) and were excluded. Production files in scope: `packages/core/src/paging/{sort,range,state,projection,index}.ts` (new) and `packages/core/src/index.ts` (adds `export * from './paging'`). Uncommitted inputs at measurement time: only the two test files changed by this run (listed below).

Requirements:
- `tasks/paging-core.md` acceptance criteria: (1) unit tests for next/previous/jump/last in range mode and skip mode, switching sort resets to page 1; (2) range bounds built correctly for compound sort keys and descending sorts (tests)
- `tasks/paging-core.md` recorded assumptions (range-pageable sorts, null-bound handling, jump via skip once, last page via reversed sort, opaque sorts and natural order use skip, `projectionWithSortKeys` required for range paging, collation forces skip mode, empty `before` page leaves an empty page 1)
- `reviews/paging-core/fixes.md` (fixed behavior for CR-1..CR-5)
- `SPEC.md` Browsing / Paging; `docs/ARCHITECTURE.md` Coverage and Conventions (Vitest, `*.spec.ts` beside the code)

## Test files changed

- `packages/core/src/paging/projection.spec.ts` (3 tests appended)
- `packages/core/src/paging/state.spec.ts` (3 tests appended in two new `describe` blocks)

No existing test was changed, weakened, skipped or removed.

## Tests added or updated

Count: 6 added in this run (suite in `packages/core`: 95 -> 101 tests).

The final-revision tests from the implementer, the earlier test-writer run and the fixer were re-checked against the fixed code. They run the generated filters through an in-memory fake server (type bracketing for `$gt`/`$lt`, null/missing semantics), so they check behavior, not just filter shape. The `range.spec.ts` expectations that the fixer updated encode the fixed CR-1 shape (`$lt` plus `$eq: null` split, no lower-side prefix bound), and the fake-server tests in `state.spec.ts` confirm that shape returns the right rows.

New tests:
- `projectionWithSortKeys > literal values (arrays, null) make an inclusion projection, so sort fields are added` (covers the previously uncovered `isNeutral` guard, `projection.ts:11`)
- `projectionWithSortKeys > a field sharing only a name prefix with a sort field is not treated as related` (`nameFull` vs `name`, inclusion and exclusion)
- `projectionWithSortKeys > inclusion: a sibling path under _id does not cover another _id path sort key`
- `range mode: previous after a far jump and on page 1 > previous after a skip jump continues by range with a "before" bound` (compound sort with a descending key)
- `range mode: previous after a far jump and on page 1 > previous on page 1 stays on page 1 without a bound`
- `switching sort from the last page > returns to page 1 with next available again`

## Requirement coverage

All commands were run in `packages/core` unless stated otherwise.

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 next/previous, range mode | `next / previous > range mode, *` (asc/desc `_id`, compound with descending key, both descending); `pages a compound unique index (not _id) with a descending key in range mode`; `documents missing a sort key (sorted as null) > *`; `paging state after the start was reached by "before" > *`; new `previous after a skip jump continues by range ...`, `previous on page 1 stays on page 1 ...` | `npx vitest run --coverage --coverage.include='src/paging/*.ts'` | Pass |
| AC1 next/previous, skip mode | `next / previous > skip mode, non-unique sort`, `skip mode combines with a user filter`; `an opaque sort records no sort keys and keeps paging by skip`; `collation (CR-4) > pages by skip with a collation` | same | Pass |
| AC1 jump, range and skip mode | `jump to page > *` (far jump via skip then range, neighbours/first/last use cheap requests, clamping, skip mode, invalid indexes); `jump past the estimated page count is not clamped`; new `previous after a skip jump continues by range ...` | same | Pass |
| AC1 last, range and skip mode | `last page > *` (exact remainder via reversed sort, descending compound, estimated count, skip mode with sort, opaque sort by count, empty collection, no count); `last page with an exact count that is a multiple of the page size ...`; `last page in natural order or with an opaque sort (CR-5) > *` | same | Pass |
| AC1 switching sort resets to page 1 | `resets > switching sort resets to page 1 and re-picks the mode`; `switching sort resets to page 1 > *` (range->range reversed, range->opaque, skip->range, same sort); `collation (CR-4) > setSort keeps the collation flag`; new `switching sort from the last page > returns to page 1 with next available again` | same | Pass |
| AC2 range bounds for compound and descending sorts | `rangeFilter > *` (single asc/desc, compound lexicographic `$or` with null split, descending first key, null bounds, errors); `rangeQuery / andFilter > *`; fake-server `it.each` over six compound/descending/nested sorts (after/before every row selects exactly the rows beyond it); `documents missing a sort key (sorted as null) > *` | same | Pass |
| Fix CR-3: sort keys kept in projections | `projectionWithSortKeys > *` (12 tests, 3 new); `range paging with a projection (CR-3) > *` | same | Pass |
| Fix CR-2: canNext after a short/empty `before` page | `canNext after "before" reads (CR-2) > *`; `next stays available after a short "before" page became page 1` | same | Pass |

## Focused test execution

Command:

`cd packages/core && npx vitest run src/paging`

Result:

Pass: 4 files, 100 tests (the fifth core spec file is outside `src/paging`).

## Full test execution

Commands:

- `cd packages/core && npx vitest run --coverage --coverage.include='src/paging/*.ts' --coverage.reporter=text --coverage.reporter=json-summary` -> Pass: 5 files, 101 tests
- `npm run check` (repo root) -> **Fail, not caused by this task**: `lint` passed; `typecheck` failed only in workspace `@thicket/desktop` (`apps/desktop`): `TS2307: Cannot find module 'electron'` and `Cannot find module 'playwright-core'` plus follow-on `TS7006` implicit-any errors. `node_modules/electron` and `node_modules/playwright-core` do not exist in this clone: the `electron-shell` task (commits `8fb2c49`, `6a9bfbf`, `9ffe9b8`, merged into main after the task base and brought in by the rebase) added these dependencies to `apps/desktop/package.json`, and `npm install` was not re-run here. The test-writer may not install dependencies. `test` did not run in that invocation because `&&` stopped at typecheck.
- Remaining steps run individually (repo root): `npx tsc -p tsconfig.json` -> Pass; `npm run typecheck` in `packages/core` -> Pass; `npm run typecheck -w packages/core -w packages/contract -w apps/backend -w packages/renderer` -> contract and renderer typecheck output without errors; `npm run test` -> Pass: root vitest 16 files, 838 tests; renderer `ng test` 5 files, 181 tests.

Result:

Pass for every step except the `apps/desktop` typecheck, which fails for a missing local install unrelated to `packages/core`.

## .taskcheck

Result:

Fail (environment): `.taskcheck` runs `npm run check`, which fails at the `apps/desktop` typecheck as described above. Running `npm install` in the clone (parent worker) should restore it; the parent must re-run `.taskcheck` before `done`.

## Bugs found

None. No test failed on the final revision.

Observations (not defects against the acceptance criteria, no test failing, for the parent to decide):

- `TW-3` (Low, documented assumption): after an empty `before` result turned the view into an empty page 1 (only after an estimated-count last-page misalignment), the page has no `last` bound and `nextPage` falls back to `skip = pageSize`, skipping the first `pageSize` rows. This is the residual noted in `fixes.md` and is covered by the recorded assumption "the UI layer should reload firstPage then". No failing test was written because the assumption defines the behavior.
- `TW-4` (Low, informational): in skip mode with a non-unique sort, `lastPage` reads with the reversed sort; MongoDB does not guarantee a consistent order of ties, so rows tied across the last page boundary may differ from what paging forward by skip would show. Skip paging on non-unique sorts has the same MongoDB limitation, so this is not a regression; the existing test `skip mode with a sort also reads from the end` encodes the intended request.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files (all of them are new files of this task, so whole-file equals task code here, except `src/index.ts`, see below).
Changed-line coverage: not measured separately (Vitest v8 has no changed-line mode; since the five paging files are entirely new and fully covered, every changed executable line in them is covered).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `paging-core`; base `cd1dd9a41a0767be0d4846e95bdd61763eecbcfa` (supplied by the parent); HEAD `6673d526ac91328c02d83e4fad45b716b76a3f41`; task-owned commits `9c92408`, `2889d04`, `6673d52` (only commits touching `packages/core` in `cd1dd9a..HEAD`, all by `felix/agent-2`, matching `touches: [packages/core/src/paging]`)
- Source/test snapshot identifier (including uncommitted inputs): SHA-256 before and after the run, identical: `paging/index.ts` 5187516f..., `projection.ts` 3a75645d..., `range.ts` a9d79afc..., `sort.ts` 3701ab9e..., `state.ts` 8338c0fc..., `src/index.ts` 80d0deb9...; uncommitted tests `projection.spec.ts` 58e40b69..., `state.spec.ts` ea7b0f5b...; unchanged committed tests `range.spec.ts` a1b3709d..., `sort.spec.ts` 2e9f7d5b...
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/core/src/paging/{index,projection,range,sort,state}.ts`. Excluded: `packages/core/src/index.ts` (the task only adds the re-export line `export * from './paging'`, no branch or logic; not in the `src/paging/*.ts` include); `*.spec.ts` (tests). No renames or deletions. `paging/index.ts` is a re-export barrel with 0 executable statements (reported by v8 as "1 empty file skipped", counters 0/0).
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` with Vitest v5.1.0; `npx vitest run --coverage --coverage.include='src/paging/*.ts' --coverage.reporter=text --coverage.reporter=json-summary` in `packages/core`; all 5 spec files of the core workspace
- Run start/completion time and exit status: started 2026-11-16 19:44:45 +01:00 (Vitest "Start at 19:44:45"), duration 250 ms; exit status 0
- Generated report paths and report hashes/run identifier: `packages/core/coverage/coverage-summary.json` (git-ignored), SHA-256 `7db4ec87a8fe4e47fb357535545f30e1c7f625453df62f07baf6a1d26b63daad`
- Evidence outputs are fresh and inputs stayed unchanged: yes; the run reported 101 tests (including the 6 added in this run, earlier runs had 95), and input hashes after the run equal those taken at 19:44:40
- Final run after latest test additions and production fixes: yes (production code at `6673d52` includes all fixes; no test changes after the run)

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/core/src/paging/projection.ts` | 40/40 (100%) | 47/47 (100%) | 15/15 (100%) | 25/25 (100%) |
| `packages/core/src/paging/range.ts` | 40/40 (100%) | 33/33 (100%) | 7/7 (100%) | 34/34 (100%) |
| `packages/core/src/paging/sort.ts` | 39/39 (100%) | 39/39 (100%) | 11/11 (100%) | 27/27 (100%) |
| `packages/core/src/paging/state.ts` | 77/77 (100%) | 111/111 (100%) | 18/18 (100%) | 69/69 (100%) |
| `packages/core/src/paging/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| **Aggregate (summed counters)** | 196/196 (100%) | 230/230 (100%) | 51/51 (100%) | 155/155 (100%) |

Aggregate scope: the five `src/paging` files above; `packages/core/src/index.ts` excluded (one re-export line, reason above). No scoped file is missing from the report.

Before this run the only gap was one branch in `projection.ts` (195/196 statements, 229/230 branches).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/core/src/paging/projection.ts:11` (`v === null` / `Array.isArray(v)` in `isNeutral`), now covered | Literal projection values (arrays, null) must count as inclusion so sort keys get added (CR-3) | Added `literal values (arrays, null) make an inclusion projection, so sort fields are added` |
| none remaining | - | - |

## Unable to test

- Behavior against a real MongoDB server (index use, real BSON type order including MinKey, collation semantics): not in scope for these pure-function unit criteria; the fake server models the relevant operators. Integration belongs to the backend tasks that call this module.
- `.taskcheck` passing: blocked in this clone by the missing `apps/desktop` dependencies (see above); needs `npm install` by the parent and a re-run.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. 6 tests added (101 in `packages/core`, all passing); task-scoped coverage 100% on all metrics. `npm run check` / `.taskcheck` currently fail only at the `apps/desktop` typecheck because `electron` and `playwright-core` are not installed in this clone, which is unrelated to `paging-core`; the parent must run `npm install` and re-run `.taskcheck` before `done`.
