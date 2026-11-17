# Test Report

Date: 2026-11-17

Task: change-streams - M6 (Could): Watch changes

Scope: `git diff 18c5fd85..dc61e8d5b525d041af9aa334e8a2d5fd1b7f7bf1` on branch `main` (merge-base with
`origin/main` given by the parent worker). This is a re-run after the rebase onto main, which brought in
the gridfs task. The task's commits are 2572e941, 66626bf9, 04a4b6a3, 82f09c5f, 82524419, 1fb8afd1 and
dc61e8d5; the remaining commits in the range only touch `tasks/` files of other tasks. The parent
reported two resolved conflicts:
- `packages/renderer/src/app/layout/workspace.service.ts`: `TabKind` is now `| 'gridfs' | 'watch'`.
- `packages/renderer/src/app/sidebar/sidebar-tree.ts`: the database context menu keeps both 'GridFS files'
  and 'Watch changes', in that order.

This run focuses on how those two merged changes interact. It re-validates the rest, which is the same
code as in the previous report for revision 0fe60e1b. The backend source and test files have the same
sha256 hashes as in that report.

Requirements:
- `tasks/change-streams.md` acceptance criteria and recorded assumptions
- `reviews/change-streams/review.md`, `reviews/change-streams/fixes.md`
- `SPEC.md` M6, `docs/ARCHITECTURE.md` "Watch changes" and "Coverage"
- Parent worker instructions for this run

## Test files changed

- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts` (extended, uncommitted)

## Tests added or updated

Count: 1 new test. No existing test was changed or removed.

- `SidebarTree > watch changes > offers both GridFS files and Watch changes on a database; each opens its own tab`.
  This is a regression test for the merged database menu. It checks the following:
  - `menu-gridfs` and `menu-watch` each appear exactly once;
  - GridFS comes before Watch;
  - clicking one and then the other opens two separate tabs, `['gridfs:p1:shop','gridfs']` and `['watch:p1:shop','watch']`, so both `TabKind` members work side by side;
  - the watch tab is active at the end.

Merge-related checks that needed no new test:
- No spec lists all `TabKind` values or the full database menu. The union type is checked by `tsc` in
  `npm run check`.
- Both tab views stay registered in `app.config.ts` (`provideTabView('gridfs', ...)` and
  `provideTabView('watch', ...)`). `app.spec.ts` loads `appConfig.providers` and passes.
- The existing gridfs menu tests use `filter`/`toHaveLength(1)` rather than an exact item list, and the
  existing watch menu tests look items up by test id, so the merge did not break either.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: insert/update/delete events received in order (integration, real replica set) | `admin.watch on a replica set > receives insert, update and delete events of a collection in order`, plus the database/pipeline, deployment, invalidate, connection-close, invalid-params and cursor-cleanup tests (10 in total) | `npx vitest run --config test/integration/vitest.config.ts test/integration/change-streams.int.spec.ts` (repo root, Podman fixtures `mongo8rs`/`mongo8`) | Pass (10/10, 08:21:21-08:21:35) |
| AC1 (unit): batches delivered in order through the pinned driver cursor; cursor closed on every exit (CR-1, CR-2) | `watch.spec.ts`, `handlers.spec.ts` | `cd packages/backend && npx vitest run src/admin/watch` | Pass (2 files, 59 tests) |
| AC2: standalone server shows a clear 'needs replica set' message | integration `admin.watch on a standalone server > refuses with a clear 'needs replica set' message`; unit `assertWatchable > refuses a standalone ...`; renderer `WatchView > shows a clear 'needs replica set' message for a standalone server` | integration and backend commands above; renderer command below | Pass |
| Watch entries in the sidebar (connection, database, collection; disabled on views and while disconnected; available on read-only profiles) | `SidebarTree > watch changes > *` (6 existing + 1 new), `sidebar-tree.service.spec.ts` openWatch tests | `cd packages/renderer && npx ng test --include='src/app/watch/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts' --include='src/app/gridfs/**/*.spec.ts' --coverage ...` | Pass (6 files, 306 tests) |
| Merge: the database menu offers GridFS and Watch together, each opens its own tab kind | new `offers both GridFS files and Watch changes on a database; each opens its own tab`; gridfs `opens the GridFS tab of a database from its context menu` | renderer command above | Pass |
| Watch tab view and model | `watch-view.spec.ts`, `watch.model.spec.ts` | renderer command above | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/watch/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts' --include='src/app/gridfs/**/*.spec.ts'` (run with coverage, see below)

Result:

Pass (6 files, 306 tests, 08:20:45-08:20:59). The new test passed on its first run.

Command:

`cd packages/backend && npx vitest run src/admin/watch`

Result:

Pass (2 files, 59 tests)

Command:

`npx vitest run --config test/integration/vitest.config.ts test/integration/change-streams.int.spec.ts` (repo root, Podman)

Result:

Pass (1 file, 10 tests)

`npx prettier --check` and `npx eslint` on `sidebar-tree.spec.ts`: Pass.

## Full test execution

Command:

`npm run check` (repo root: `eslint . --max-warnings 0 && prettier --check . && typecheck && vitest run && npm run test -w packages/renderer`)

Result:

Pass, 08:21:38-08:23:49:
- root vitest: 96 files / 5012 tests passed;
- renderer: 115 files / 3851 tests passed.

The renderer suite is the last step of the `&&` chain, so the lint, prettier and typecheck steps before
it passed. The output had no error or FAIL lines. The run included the new test file.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` when `package.json` exists, and the run above passed.

## Bugs found

None. No production defect found; no test fails.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured with a separate tool.
- `watch.ts` and `handlers.ts` are new in this task, so their whole-file numbers are their changed-line
  numbers.
- In the merged renderer files, I mapped the task's added lines from `git diff 18c5fd85..HEAD` to the
  provider's `coverage-final.json` by hand:
  - `sidebar-tree.ts`: connection item lines 424-429, database item lines 472-476, collection item lines 501-506;
  - `sidebar-tree.service.ts`: `openWatch`, lines 452-469.
  None of these lines is in the uncovered statement or branch list below. Their statement hit counts
  are greater than 0. Example: `openWatch` statements at lines 454/455/460/461 have 14 hits each.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `change-streams`;
  base `18c5fd85` (merge-base with `origin/main`, given by the parent); HEAD
  `dc61e8d5b525d041af9aa334e8a2d5fd1b7f7bf1`. The commit list is from `git log 18c5fd85..HEAD`; its
  task commits match the task's `touches` and the parent's description.
- Source/test snapshot identifier (sha256 of the scoped files; identical before and after all runs):
  - `watch.ts` 8133e9ea8a13...
  - `handlers.ts` a25a437f4f72...
  - `watch-view.ts` 79af91a37d35...
  - `watch.model.ts` af2b84eb5267...
  - `sidebar-tree.ts` 3f58fc11ed45...
  - `sidebar-tree.service.ts` 037b93db8af1...
  - `workspace.service.ts` 0675f9611fce...
  - `sidebar-tree.spec.ts` (uncommitted) 4a1c149891c1...
  - `watch.spec.ts` b8a23ffcd7ad...
  - `change-streams.int.spec.ts` 301ec7b805cf...

  `git status`: only `sidebar-tree.spec.ts` is modified, plus an unrelated untracked `__pycache__/`.
- Exact included files:
  - `packages/backend/src/admin/watch/watch.ts`
  - `packages/backend/src/admin/watch/handlers.ts`
  - `packages/renderer/src/app/watch/watch-view.ts`
  - `packages/renderer/src/app/watch/watch.model.ts`
  - `packages/renderer/src/app/sidebar/sidebar-tree.ts`
  - `packages/renderer/src/app/sidebar/sidebar-tree.service.ts`
- Excluded files and reasons:
  - `connections/manager.ts`: optional interface members only;
  - the `index.ts` barrels: re-exports only;
  - `backend.ts` and `app.config.ts`: one registration line each; exercised by the integration test and `app.spec.ts`;
  - `workspace.service.ts`: one type-union member, the merged conflict; checked by `tsc`, nothing to execute;
  - `watch-view.html`/`.css`: template and styles;
  - docs and tests.
  - No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with v8 coverage.
  - Backend, in `packages/backend`: `npx vitest run src/admin/watch --coverage --coverage.include='src/admin/watch/watch.ts' --coverage.include='src/admin/watch/handlers.ts' --coverage.reportsDirectory=coverage/change-streams-r4 --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text`
  - Renderer, in `packages/renderer`: `npx ng test --include='src/app/watch/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts' --include='src/app/gridfs/**/*.spec.ts' --coverage --coverage-include='src/app/watch/watch-view.ts' --coverage-include='src/app/watch/watch.model.ts' --coverage-include='src/app/sidebar/sidebar-tree.ts' --coverage-include='src/app/sidebar/sidebar-tree.service.ts' --coverage-reporters=json-summary --coverage-reporters=json`
  - Only unit runs are instrumented; the integration run is not.
- Run start/completion time and exit status:
  - backend 08:21:13-08:21:15 +01:00, pass;
  - renderer 08:20:36-08:20:59 +01:00, 306 tests pass, exit 0 (the `&& echo RUN-OK` guard printed).
- Generated report paths and report hashes (git-ignored):
  - `packages/backend/coverage/change-streams-r4/coverage-summary.json` 8e9dce694925...
  - `packages/backend/coverage/change-streams-r4/coverage-final.json` afdad53886dd...
  - `packages/renderer/coverage/renderer/coverage-summary.json` 7ba0c416574c...
  - `packages/renderer/coverage/renderer/coverage-final.json` c50559228aa6...

  The backend reports are byte-identical to the previous r3 run, as expected for unchanged code and tests.
- Evidence outputs are fresh and inputs stayed unchanged:
  - The backend report went into a new directory created by this run.
  - The renderer report directory was recreated by this run (08:20:45) and its files were written at 08:20:59.
  - The input hashes were the same before and after.
- Final run after latest test additions and production fixes: yes. These runs came after the rebase and
  the new test, and there were no production changes.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/admin/watch/watch.ts` | 90/90 (100%) | 47/48 (97.9%) | 18/18 (100%) | 77/77 (100%) |
| `packages/backend/src/admin/watch/handlers.ts` | 12/12 (100%) | 2/2 (100%) | 5/5 (100%) | 10/10 (100%) |
| `packages/renderer/src/app/watch/watch-view.ts` | 109/113 (96.5%) | 61/70 (87.1%) | 29/29 (100%) | 93/93 (100%) |
| `packages/renderer/src/app/watch/watch.model.ts` | 61/62 (98.4%) | 73/81 (90.1%) | 12/12 (100%) | 48/49 (98.0%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 406/415 (97.8%) | 236/272 (86.8%) | 98/98 (100%) | 348/349 (99.7%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 248/248 (100%) | 119/119 (100%) | 71/71 (100%) | 201/201 (100%) |
| **Aggregate (summed counters, 6 measured files; exclusions listed above)** | 926/940 (98.5%) | 538/592 (90.9%) | 233/233 (100%) | 777/779 (99.7%) |

Backend totals from the provider are 102/102 statements, 49/50 branches, 23/23 functions and 87/87
lines. The per-file values above come from the provider's summary.

The sidebar files now also contain the merged gridfs code, which explains the small rise in counters
compared with the previous report.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `watch.ts:130` (false arm of `hasNext()` in the fallback for cursors without `tryNext`) | None for the product: the real driver cursor always has `tryNext`, and unit and integration tests cover that path | Left uncovered: this code only serves test fakes, not production behaviour. |
| `watch-view.ts:94,98,102,137,143,148,154,189,200`; `watch.model.ts:73` and branches 87-116 | Defensive stale-subscription guards, a synchronous settle that cannot be reached, empty-string fallbacks, display fallbacks for malformed events | Unchanged since earlier reports, which already justified them. The component tests cover the observable behaviour. Left uncovered. |
| `sidebar-tree.ts`: statements 307, 335, 341, 597, 603, 614, 646, 687, 734; branches in 164-371 and 549-815 | Pre-existing sidebar code (line numbers moved after the gridfs merge) | Outside this task's change. None is on the task's added watch lines (424-429, 472-476, 501-506). |

## Unable to test

- Pinning on a sharded cluster with several mongos, or in load-balanced mode: there is no such fixture.
  This is unchanged from the previous report. The integration test checks the mechanism on the replica
  set. Follow-up is only needed if such a fixture is added.
- Browser/Electron end-to-end run of the watch tab: neither criterion names one.
- Automatic resume after failover: deliberately not implemented (recorded assumption).

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found.
