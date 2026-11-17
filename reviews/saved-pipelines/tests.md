# Test Report

Date: 2026-11-17

Task: saved-pipelines - M3: Save and reopen aggregation pipelines (pipelines.json)

Scope: c65b0cd7a672b9f6acd3866fa41e45c460221e6d..73e3511ef868fa5bc5b82d2567f9b1b985bf23fa on `main`
(task commits a2aa12c contract, 1788862 store/handlers, d216dfb renderer panel, 73e3511 docs), plus
the uncommitted test additions listed below. No other uncommitted changes.

Requirements:
- `tasks/saved-pipelines.md` acceptance criteria and the three recorded assumptions
- `SPEC.md` (M3 "save pipelines", section 4/5), `docs/ARCHITECTURE.md` "Coverage"
- `AGENTS.md`, parent instructions (add tests only for real gaps)

## Test files changed

- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`

## Tests added or updated

Count: 5 (added to the `AggregationView > saved pipelines` describe; no existing test changed)

- `a list answer for the previous collection is ignored once the tab points elsewhere`
  (ordering: an older `pipelines.list` success and an older failure answering after the tab moved
  to another collection, controlled with deferred promises)
- `a failed save shows the error and keeps the builder and the list as they were` (UNSUPPORTED from
  a read-only, newer `pipelines.json`)
- `saving in full-text mode with a syntax error is refused and sends nothing`
- `a saved pipeline with an unreadable stage is not opened; the builder is unchanged` (`{}` passes
  the contract's EJSON-document check but holds no stage)
- `a rename to a blank name is refused; a failed delete shows the error and keeps the item`

Existing tests reviewed and judged sufficient: 34 in `apps/desktop/src/pipelines/store.spec.ts`
(missing file, 10 corrupt-file variants, EACCES, newer version read-only, atomic write order, failed
rename keeps the previous file, stale temp removal, serialized concurrent saves, handler error
mapping), contract samples in `packages/contract/src/index.spec.ts` / `methods.spec.ts`, and 9
component tests (including the acceptance round trip).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: store unit tests, missing file | `PipelinesStore: missing file` (2 tests) | `npx vitest run apps/desktop/src/pipelines packages/contract` | Pass |
| AC1: store unit tests, corrupt file | `PipelinesStore: corrupt file` (10 `it.each` cases, valid file, EACCES, newer version) | same | Pass |
| AC1: store unit tests, atomic write | `PipelinesStore: atomic writes` (flushed temp + rename, failed rename keeps file and state, stale temp removed) | same | Pass |
| AC1: contract samples | `index.spec.ts` SAMPLES/route for `pipelines.*`, `methods.spec.ts` RESULTS for `pipelines.*` | same | Pass |
| AC2: save with a disabled stage, reopen in a new builder tab, same stages and enabled flags | `saves a pipeline with a disabled stage and reopens it in a new builder tab` | `npx ng test --include src/app/aggregation` (in `packages/renderer`) | Pass |
| Assumption: per collection, names unique ignoring case, save replaces, rename CONFLICT | store: `lists only the pipelines of the collection...`, `saving under a taken name...`, `refuses to rename...`, handler `maps not found to NOT_FOUND and a taken name to CONFLICT`; component: `saving under a taken name replaces...`, `renames a saved pipeline; a taken name shows the error`, `lists the pipelines of this collection only` | both commands above | Pass |
| Assumption: stage errors (disabled too) block saving | `refuses to save without a name or with a stage that has an error (disabled too)`, `saving in full-text mode with a syntax error is refused and sends nothing` (new) | `npx ng test --include src/app/aggregation` | Pass |
| Assumption: newer file is read-only | store `a file from a newer version is read but never written`, handler `a newer file answers UNSUPPORTED on changes`, component `a failed save shows the error and keeps the builder...` (new) | both commands above | Pass |
| Panel list is per collection: stale answers after switching collection are ignored | `a list answer for the previous collection is ignored once the tab points elsewhere` (new) | `npx ng test --include src/app/aggregation` | Pass |
| Unreadable stored stage is not opened | `a saved pipeline with an unreadable stage is not opened; the builder is unchanged` (new) | same | Pass |
| Rename/delete error paths | `a rename to a blank name is refused; a failed delete shows the error and keeps the item` (new), `deletes a saved pipeline after a second click`, `a failed list shows its error` | same | Pass |

## Focused test execution

Command:

`npx vitest run apps/desktop/src/pipelines packages/contract` (repo root)

Result:

Pass (5 files, 808 tests)

Command:

`npx ng test --include src/app/aggregation` (in `packages/renderer`)

Result:

Pass (2 files, 124 tests; 119 before the additions)

## Full test execution

Command:

`sh .taskcheck` (runs `npm run check`: lint, Prettier, type check of every workspace incl. renderer specs, root Vitest and renderer `ng test`)

Result:

Pass (root Vitest 77 files / 4198 tests, renderer 98 files / 3232 tests; lint, format and type check clean). Also `npx eslint` and `npx prettier --check` on the changed spec: clean.

## .taskcheck

Result:

Pass (output reviewed in full; npm stops on the first failing script and all stages printed and passed)

## Bugs found

None. No production defect was found.

## Coverage

Status: verified (whole-file, for every executable task-changed file except the Electron bootstrap, see exclusions)

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (no changed-line tooling configured).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `saved-pipelines`, base c65b0cd7a672b9f6acd3866fa41e45c460221e6d (from the parent, `git merge-base`), HEAD 73e3511ef868fa5bc5b82d2567f9b1b985bf23fa; task commits a2aa12c, 1788862, d216dfb, 73e3511 (all commits in base..HEAD, all prefixed `saved-pipelines:`), matching the task's `touches`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 73e3511 plus uncommitted `aggregation-view.spec.ts` sha256 1c53ee1e94cd10ea9f38b799b70fb52a8fa6503e299f784aeda53429c4d7dcbd (same hash before and after the final renderer coverage run). Production hashes: `aggregation-view.ts` 8629db2f…c72b8, `store.ts` 06b3d6fc…84003, `pipelines/handlers.ts` 17036a64…2d8 (unchanged by this work).
- Exact included files: `packages/contract/src/pipelines.ts`, `apps/desktop/src/pipelines/store.ts`, `apps/desktop/src/pipelines/handlers.ts`, `apps/desktop/src/main/handlers.ts`, `packages/renderer/src/app/aggregation/aggregation-view.ts`. Excluded: `apps/desktop/src/main/index.ts` (Electron main bootstrap, needs the Electron runtime; the task adds only the lazy `pipelinesStore()` wiring, not unit-tested in this project), `apps/desktop/src/pipelines/index.ts` and `packages/contract/src/index.ts` (re-exports / method-table spread; `pipelines/index.ts` has 0 statements), `.html`/`.css` (templates exercised through the component tests, not instrumented), `SPEC.md`/`docs/ARCHITECTURE.md` (docs). No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8`, Node 24.21.0.
  - `apps/desktop`: `npx vitest run --coverage --coverage.include='src/pipelines/store.ts' --coverage.include='src/pipelines/handlers.ts' --coverage.include='src/main/handlers.ts' --coverage.reporter=json --coverage.reporter=json-summary --coverage.reporter=text` (whole desktop suite, 16 files / 481 tests).
  - `packages/contract`: `npx vitest run --coverage --coverage.include='src/pipelines.ts' --coverage.reporter=text --coverage.reporter=json-summary` (whole contract suite, 774 tests).
  - `packages/renderer`: `npx ng test --include src/app/aggregation --coverage --coverage-include='src/app/aggregation/aggregation-view.ts' --coverage-reporters=json --coverage-reporters=json-summary --coverage-reporters=text-summary` (124 tests).
- Run start/completion time and exit status: desktop 05:41:06 (1.64 s), contract 05:41:21 (0.37 s), renderer final run 05:44:29 (8.2 s), 2026-11-17 local time; all passed (all tests green, coverage summary printed).
- Generated report paths and report hashes/run identifier: `apps/desktop/coverage/coverage-final.json` sha256 5f65194f…184f3; `packages/contract/coverage/coverage-summary.json` sha256 abb41edc…85d; `packages/renderer/coverage/renderer/coverage-final.json` sha256 ce41c9cc…97389, `coverage-summary.json` sha256 8ca1d82d…c637b5 (all Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: each report was regenerated by the run above (the coverage tool cleans its directory); the renderer report was regenerated after the last test edit and the spec hash matched before and after. Desktop and contract inputs were not changed by this work.
- Final run after latest test additions and production fixes: yes (no production fixes were made; the renderer run follows the last test edit).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/contract/src/pipelines.ts` | 6/6 (100%) | N/A (0/0) | N/A (0/0) | 6/6 (100%) |
| `apps/desktop/src/pipelines/store.ts` | 120/124 (96.77%) | 54/60 (90.00%) | 35/38 (92.11%) | 108/109 (99.08%) |
| `apps/desktop/src/pipelines/handlers.ts` | 18/19 (94.74%) | 5/6 (83.33%) | 9/9 (100%) | 14/15 (93.33%) |
| `apps/desktop/src/main/handlers.ts` | 18/18 (100%) | 18/18 (100%) | 6/6 (100%) | 15/15 (100%) |
| `packages/renderer/src/app/aggregation/aggregation-view.ts` | 426/438 (97.26%) | 184/202 (91.09%) | 92/92 (100%) | 373/375 (99.47%) |
| Aggregate (summed counters, the 5 files above; excludes `main/index.ts`, index re-exports, templates) | 588/605 (97.19%) | 261/286 (91.26%) | 142/145 (97.93%) | 516/520 (99.23%) |

`aggregation-view.ts` before the added tests: 415/438 statements, 177/202 branches, 365/375 lines.
Its remaining uncovered code outside the saved-pipelines lines (L155, 230, 249, 291, 324, 359, 444,
467, 568, 643, 670) belongs to the earlier agg-ui task, not this one.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `aggregation-view.ts:740,744` (stale list success/failure after a collection change) | List per collection; ordering | Covered by the new test `a list answer for the previous collection is ignored...` |
| `aggregation-view.ts:782` (full-text save with a syntax error) | Stage errors block saving | Covered by the new test `saving in full-text mode with a syntax error...` |
| `aggregation-view.ts:807` (failed save) | Read-only file / IO errors surface | Covered by the new test `a failed save shows the error...` |
| `aggregation-view.ts:821-826` (unreadable stored stage) | Hand-edited/odd `pipelines.json` | Covered by the new test `a saved pipeline with an unreadable stage...` |
| `aggregation-view.ts:850-851, 873` (blank rename, failed delete) | Error paths | Covered by the new test `a rename to a blank name is refused; a failed delete...` |
| `aggregation-view.ts:737` (tab without a profile id) | Defensive guard; a builder tab always has a profile | Left uncovered: not reachable from a real aggregation tab |
| `aggregation-view.ts:819` (stored stage that is not parseable EJSON) | Same outcome as the tested `{}` case (the catch maps it to an empty document) | Left uncovered: same message path as L821-826, already tested |
| `aggregation-view.ts:791` (`savedList()` still `null` when saving) | Replaced/Saved wording before the list has loaded | Left uncovered: cosmetic wording only |
| `aggregation-view.ts:847` (rename submitted with no rename in progress) | Defensive guard; the form only exists while renaming | Left uncovered: not reachable from the UI |
| `store.ts:71` (error object without a string `code`) | Defensive | Left uncovered: non-material |
| `store.ts:124-126` (default `log`/`now`/`newId`) | Production defaults | Left uncovered: exercised only in the Electron app; tests inject deterministic ones |
| `store.ts:140` (sort tie-break for names equal ignoring case) | Only possible in a read-only newer file | Left uncovered: non-material ordering of an edge case |
| `store.ts:225` (temp-file unlink after a failed write also fails) | Best-effort cleanup | Left uncovered: swallowed by design; previous file stays intact (tested) |
| `store.ts:290-291` (stale temp file cannot be removed, e.g. EACCES) | Logged, load continues | Left uncovered: logging only, low risk |
| `pipelines/handlers.ts:18` (unknown error rethrown unchanged) | IO error reaches the dispatcher as INTERNAL | Left uncovered: the store-level EACCES test covers the store side; the mapping is a plain rethrow |

## Unable to test

- `apps/desktop/src/main/index.ts` `pipelinesStore()` wiring (`userData/pipelines.json` path) needs the
  Electron runtime; not covered by unit tests. `mainHandlers` serving `pipelines.*` when given the
  store is tested. Follow-up: an Electron e2e run if a later task names one; not required by this
  task's criteria.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production
defects found.
