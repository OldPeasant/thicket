# Test Report

Date: 2026-11-17

Task: currentop - M6 (Should): currentOp and killOp

Scope: task base `98272ef3515b78fc7de570d45594efb536f9bac7` (`git merge-base HEAD origin/main`) .. HEAD `df1263e5914e9ee4ed15a37568a9fe42e69265cd` on branch `main`. `git log base..HEAD` lists exactly the 6 task-owned `currentop:` commits and nothing else: `d13c2708` backend handlers + integration test, `e8b13f62` current operations tab, `4615ce8d` e2e + architecture notes + filter alignment, `92f200f5` round-1 tests and report, `b8ded54d` code review report, `df1263e5` fixer commit for CR-1..CR-3. (The parent's fallback base `375764073310…` is older; the extra commits it adds belong to other tasks and are excluded.) This is round 2: it re-checks the tests against the final code, focusing on the fix commit. Uncommitted at measurement time: my two changed test files, plus `reviews/currentop/review.md`, which another helper (the code-reviewer re-run) was rewriting at the same time. I did not touch that file and it is not a measured input.

Requirements:
- `tasks/currentop.md` acceptance criteria (1: an integration test lists and kills a slow op; 2: e2e kills from the UI with confirm) and its three recorded assumptions (primary only; namespace prefix on name boundaries; tab kind `currentop`, refresh never/2/5/10 s default 5, kill only for active operations)
- `reviews/currentop/review.md` findings CR-1..CR-3 and `reviews/currentop/fixes.md` (behavior the fix commit introduces)
- `SPEC.md` M6 "Should" (currentOp with namespace/duration/op type filters, auto-refresh, killOp)
- `docs/ARCHITECTURE.md` "Current operations" (as updated by the fix: `currentOp` commands are left out, `$currentOp` aggregations stay listed), "Coverage", "Integration tests", "End-to-end tests"
- `AGENTS.md`, existing spec conventions (`FakeThicketBridge`, fake timers and deferred answers in the view spec, the fake `ClientLike` in `handlers.spec.ts`)

## Test files changed

Changed in this round (uncommitted):
- `packages/backend/src/admin/currentop/handlers.spec.ts`
- `packages/renderer/src/app/admin/currentop/currentop-view.spec.ts`

Task test files already committed (round 1 `92f200f5`, fixer `df1263e5`), reviewed again and unchanged in this round: `packages/renderer/src/app/admin/currentop/currentop.model.spec.ts`, `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts`, `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`, `packages/renderer/src/app/app.spec.ts`, `packages/backend/src/browse/browse.spec.ts`, `test/integration/currentop.int.spec.ts`, `test/e2e/currentop.e2e.ts`.

I removed, weakened or skipped no tests. The fixer changed one existing assertion in `handlers.spec.ts`: expected opids went from `[4, 3, 5, 1]` to `[4, 3, 2, 5, 1]`, and the test name changed with it. I checked this change. It follows from the documented behavior change in CR-2 (`$currentOp` aggregations stay listed), so the test was updated, not weakened.

## Tests added or updated

Count: 2 new tests in this round.

- `handlers.spec.ts`, `hides currentOp commands of other clients but lists and kills their $currentOp aggregation` (CR-2). A `currentOp` command sent by another client with `$all` and a `comment` is still left out. A `$currentOp` aggregation from another client (`allUsers: true`) is listed, and its canonical EJSON opid, as listed, goes back to `admin.killOp` and sends `{ killOp: 1, op: Int32(12) }`. So the aggregation can actually be killed, which was the point of the finding.
- `currentop-view.spec.ts`, `neither reads nor schedules after the tab closed, also on Refresh or a new interval` (CR-1). After `fixture.destroy()`, calling `view.refresh()` directly and changing the interval with `view.setRefresh('2')` sends no further `admin.currentOp` and arms no timer (checked with fake timers over 60 s). This covers the `destroyed` guards in both `refresh()` and `schedule()`, beyond the fixer's kill-in-flight test.

Fix-commit tests I reviewed and kept as they are:
- `currentop-view.spec.ts` `reads nothing more when the tab closes while a confirmed kill waits for the server` is a real regression test for CR-1. Without the `destroyed` flag, `kill()` would call `refresh()` after `answerKill` and send a second `admin.currentOp`.
- `browse.spec.ts` `isUnauthorizedBrowseError` tests (2) cover the shared CR-3 helper: code 13 or code name `Unauthorized` after `toBrowseError` count; other server errors, other `RpcError`s, raw driver errors and `null`/`undefined` do not.
- The CR-3 call site in `docs/query/query.ts` (`killOperations`) is still covered by the existing `query.spec.ts` tests `falls back to $ownOps when currentOp is unauthorized` and `gives up quietly when currentOp fails otherwise, or $ownOps fails too`, and by `read-preference.spec.ts` `sends currentOp, the $ownOps retry and killOp with the given read preference`. All of them pass on HEAD. The new `instanceof RpcError` check holds there because `command()` always throws `toBrowseError(error)`.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: an integration test lists and kills a slow op | `test/integration/currentop.int.spec.ts` (3 tests) | `npx vitest run --config test/integration/vitest.config.ts test/integration/currentop.int.spec.ts` (repo root, Podman MongoDB containers) | Pass (3 passed, on HEAD df1263e5) |
| AC2: e2e kills from the UI with confirm | `test/e2e/currentop.e2e.ts` "current operations: a slow query is listed and killed from the UI after confirming" | `npm run test:e2e -- test/e2e/currentop.e2e.ts` (builds renderer + desktop, Playwright Electron harness, MongoDB container, headless) | Pass (1 passed, on HEAD df1263e5) |
| CR-1: a closed tab never reads or schedules again (kill answering late, Refresh, interval change) | `reads nothing more when the tab closes while a confirmed kill waits for the server`, `neither reads nor schedules after the tab closed, also on Refresh or a new interval`, `gives up the pending read and stops refreshing when the tab closes` | `cd packages/renderer && npx ng test --include='src/app/admin/currentop/**/*.spec.ts'` | Pass (56 passed) |
| CR-2: `currentOp` commands hidden, `$currentOp` aggregations listed and killable | `keeps $currentOp aggregations of other clients and sorts operations without a running time last`, `hides currentOp commands of other clients but lists and kills their $currentOp aggregation`, `lists the operations longest running first, without its own currentOp` | `cd packages/backend && npx vitest run src/admin/currentop src/browse/browse.spec.ts src/docs/query` | Pass (285 passed, 5 files) |
| CR-3: shared Unauthorized detection; `$ownOps` retry in currentop and query cancel | `isUnauthorizedBrowseError` (2 tests), `falls back to $ownOps when the user may not see every operation`, `recognises Unauthorized by its code name alone…`, `passes the error of the $ownOps retry on`, `query.spec.ts` `falls back to $ownOps when currentOp is unauthorized`, `gives up quietly…`, `read-preference.spec.ts` `$ownOps` test | backend command above (plus the full backend suite in `npm run check`) | Pass |
| Kill only after confirm (`alwaysConfirm`), cancel sends nothing, failure shown | view kill/cancel/notice/confirm-detail/shard-opid/read-only tests | renderer command above | Pass |
| Filters: namespace (prefix on name boundaries), duration, type, idle/system | backend `currentOpCommand`/`escapeRegExp` tests; model `currentOpCall` tests; view filter tests | backend and renderer commands above | Pass |
| Auto-refresh (default 5 s; never/2/5/10; next read only after the previous answer); stale answers ignored | view interval, scheduling and out-of-order tests | renderer command above | Pass |
| killOp opid parsing (Int32/Int64/Double/"shard:opid", else INVALID_PARAMS) | backend `parseOpId` and killOp handler tests | backend command above | Pass |
| Tab opened from the connection's sidebar menu; tab kind `currentop` registered | sidebar service/tree tests, `app.spec.ts` registration test | `npm run check` (full renderer suite) | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/admin/currentop src/browse/browse.spec.ts src/docs/query`; `cd packages/renderer && npx ng test --include='src/app/admin/currentop/**/*.spec.ts'`; `npx prettier --check` on the two changed spec files

Result:

Pass (backend 5 files / 285 tests; renderer 2 files / 56 tests; Prettier clean)

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier --check, typecheck of all workspaces, backend/core `vitest run`, renderer `ng test`); also `npx vitest run --config test/integration/vitest.config.ts test/integration/currentop.int.spec.ts` and `npm run test:e2e -- test/e2e/currentop.e2e.ts`

Result:

Pass. Vitest 88 files / 4488 tests; renderer 105 files / 3494 tests; exit status confirmed by a second run (`npm --prefix /home/felix/work/thicket-agents/agent-1 run check && echo CHECK-PASS`, which printed `CHECK-PASS`). Integration 3 passed; e2e 1 passed.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; see above)

## Bugs found

None. No test shows behavior that contradicts the acceptance criteria, SPEC, the recorded assumptions or the documented CR-1..CR-3 fixes.

Observation carried over from round 1 (not a requirement violation, no failing test kept, no fix required): `formatDuration` rounds before it picks the unit, so 59.96 s shows `60.0 s` instead of `1 min 00 s`, and 0.9996 s shows `1000 ms`. It is cosmetic.

## Coverage

Status: verified. Both runs were fresh, on the final test snapshot, with all tests passing.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured separately. I intersected each provider lcov `DA` line with the lines added in `git diff -U0 98272ef3…df1263e5` for that file, and counted `BRDA` entries on those lines as "branches on changed lines". Results: backend `currentop.ts` lines 37/37, branches 42/44; `handlers.ts` 4/4, 0/0; `browse.ts` 3/3, 4/4 (the new `isUnauthorizedBrowseError`); `query.ts` 1/1, 2/2 (the changed call site). Renderer `currentop-view.ts` lines 88/88, branches 71/75; `currentop.model.ts` 49/49, 75/75; `sidebar-tree.service.ts` 3/3, 2/2; `sidebar-tree.ts` 1/1, 0/0. The changed lines of `backend.ts`, backend `src/index.ts`, `app.config.ts`, `workspace.service.ts` and both `currentop/index.ts` barrels have no executable lcov line (imports, a spread inside an object literal, a type union): N/A.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `currentop`; base `98272ef3515b78fc7de570d45594efb536f9bac7` (merge-base with `origin/main`); HEAD `df1263e5914e9ee4ed15a37568a9fe42e69265cd`; commits `d13c2708`, `e8b13f62`, `4615ce8d`, `92f200f5`, `b8ded54d`, `df1263e5` (all `currentop:` commits, as the parent stated, and the only commits in `base..HEAD`). File scope: `git diff --stat base HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD above plus the uncommitted test files `handlers.spec.ts` (sha256 04074a1b…a9b110) and `currentop-view.spec.ts` (a670c4a1…b7bd7b86). Production sha256 matching HEAD: backend `currentop.ts` 61f84d8f…1a67459, `handlers.ts` 6ac32743…6b9b110, `browse.ts` 530867d8…b4d19, `query.ts` c8252390…286f; renderer `currentop-view.ts` 6fe9b76d…263436, `currentop.model.ts` 98438c17…f51ae0.
- Exact included files, and renamed/deleted/excluded files with reasons:
  - Backend: `src/admin/currentop/currentop.ts`, `src/admin/currentop/handlers.ts`, `src/admin/currentop/index.ts`, `src/browse/browse.ts` (new in scope through the fix commit), `src/docs/query/query.ts` (new in scope through the fix commit), `src/server/backend.ts`, `src/index.ts`.
  - Renderer: `src/app/admin/currentop/currentop.model.ts`, `src/app/admin/currentop/currentop-view.ts`, `src/app/admin/currentop/index.ts`, `src/app/app.config.ts`, `src/app/layout/workspace.service.ts`, `src/app/sidebar/sidebar-tree.ts`, `src/app/sidebar/sidebar-tree.service.ts`.
  - Excluded: `currentop-view.html` and `.css` (template and styles, which the provider does not instrument as separate files; the view specs and the e2e test exercise the template), spec files, `test/integration/*`, `test/e2e/*`, `docs/ARCHITECTURE.md`, `reviews/*`.
  - There are no renames or deletions, and no scoped file is missing from the reports.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8`, Node 24.22.1.
  - Backend, in `packages/backend`: `npx vitest run --coverage --coverage.include='src/admin/currentop/currentop.ts' --coverage.include='src/admin/currentop/handlers.ts' --coverage.include='src/admin/currentop/index.ts' --coverage.include='src/browse/browse.ts' --coverage.include='src/docs/query/query.ts' --coverage.include='src/server/backend.ts' --coverage.include='src/index.ts' --coverage.reportsDirectory=coverage/currentop-task-r2 --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=lcovonly` (whole backend suite).
  - Renderer, in `packages/renderer`: `npx ng test --coverage` with one `--coverage-include` per renderer file listed above, and `--coverage-reporters=text-summary --coverage-reporters=json-summary --coverage-reporters=lcovonly` (whole renderer suite, 105 files / 3494 tests).
- Run start/completion time and exit status: the backend run wrote its reports at 2026-11-17 07:06:42 +01:00, and all test files passed. The renderer run started at 07:07:11 +01:00 and wrote its reports at 07:08:11; all 105 files passed.
- Generated report paths and report hashes/run identifier:
  - Backend: `packages/backend/coverage/currentop-task-r2/coverage-summary.json` (sha256 c0d68c74…8ecc338f), `lcov.info` (cb9dc1dd…b587765f). This is a new directory created by this run.
  - Renderer: `packages/renderer/coverage/renderer/coverage-summary.json` (17b6614a…d841be), `lcov.info` (2ab8b9bb…c83f5d), regenerated by this run.
  - All of these paths are git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The sha256 of every scoped production file and both changed spec files was identical before the coverage runs and after the full check, integration and e2e runs. The report file timestamps fall within these runs.
- Final run after latest test additions and production fixes: yes. Both runs come after the fixer commit `df1263e5` and include the two new tests. This round made no production changes.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/admin/currentop/currentop.ts` | 46/47 (97.9%) | 42/44 (95.5%) | 9/9 (100%) | 37/37 (100%) |
| `packages/backend/src/admin/currentop/handlers.ts` | 4/4 (100%) | N/A (0/0) | 3/3 (100%) | 4/4 (100%) |
| `packages/backend/src/admin/currentop/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/browse/browse.ts` | 239/239 (100%) | 174/177 (98.3%) | 49/49 (100%) | 195/195 (100%) |
| `packages/backend/src/docs/query/query.ts` | 275/275 (100%) | 223/224 (99.6%) | 50/50 (100%) | 231/231 (100%) |
| `packages/backend/src/server/backend.ts` | 58/62 (93.5%) | 16/18 (88.9%) | 19/23 (82.6%) | 55/57 (96.5%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| `packages/renderer/src/app/admin/currentop/currentop.model.ts` | 64/64 (100%) | 75/75 (100%) | 13/13 (100%) | 49/49 (100%) |
| `packages/renderer/src/app/admin/currentop/currentop-view.ts` | 102/103 (99.0%) | 71/75 (94.7%) | 23/23 (100%) | 88/88 (100%) |
| `packages/renderer/src/app/admin/currentop/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.4%) | 16/16 (100%) | 38/38 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 402/411 (97.8%) | 238/272 (87.5%) | 94/94 (100%) | 344/345 (99.7%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 241/241 (100%) | 107/107 (100%) | 69/69 (100%) | 194/194 (100%) |

Aggregates (summed provider counters):
- Backend scope: 623/628 statements (99.2%), 455/463 branches (98.3%), 130/134 functions (97.0%), 523/525 lines (99.6%).
- Renderer scope: 865/875 statements (98.9%), 528/567 branches (93.1%), 215/215 functions (100%), 714/715 lines (99.9%).
- No scoped file is unmeasured. The `.html` and `.css` files are excluded as stated above.
- The large shared files (`browse.ts`, `query.ts`, `backend.ts`, `sidebar-tree.ts`, `sidebar-tree.service.ts`, `workspace.service.ts`) are mostly pre-existing code and dominate these aggregates; the changed-line figures above are the task-specific view.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/admin/currentop/currentop.ts:102` (plain `number` opid, both branch arms) | Defensive: `EJSON.parse(..., { relaxed: false })` returns `Int32`/`Long`/`Double`, never a JS number | Justified gap; every reachable opid form is tested |
| `packages/backend/src/browse/browse.ts:380,454,467`; `packages/backend/src/docs/query/query.ts:63` | Pre-existing code outside the task diff; the task's changed lines in both files are fully covered (lines and branches) | Out of task scope |
| `packages/backend/src/server/backend.ts:81,87` and its uncovered functions | Pre-existing code; the task's added lines are an import and a spread with no executable lcov line | Out of task scope |
| `packages/renderer/src/app/admin/currentop/currentop-view.ts:176` (`aborted` after a successful answer) | Defensive: `ApiService.request` rejects with `CANCELLED` on abort, so the success path never sees an aborted signal; the out-of-order tests cover the stale-answer behavior itself | Justified gap |
| `currentop-view.ts:182` (else arm: the request was replaced) | Defensive: a replaced request is aborted and returns earlier | Justified gap |
| `currentop-view.ts:93` (`?? []` arm), `:97` (`null` arm) | The template reads `longest`/`updatedAt` only inside the loaded branch | Justified gap |
| `packages/renderer/src/app/layout/workspace.service.ts:93`, `sidebar-tree.ts` (various) | Pre-existing code; the task's changed lines are covered | Out of task scope |

The new `destroyed` guards (`currentop-view.ts:158` and `:222`) are covered on both arms, and so is the new `isUnauthorizedBrowseError` (`browse.ts`).

## Unable to test

- Visual presentation (amber/red colors of the duration bar, layout of the aligned filter controls in `currentop-view.css`) has no unit tests. The specs assert the `data-level` attributes and bar widths, and the e2e test runs the real UI but does not check colors. The criteria require no follow-up.
- The e2e test ran headless (the harness default, no `xvfb-run` here), against the real backend and a MongoDB container.
- Kill on a sharded cluster (mongos `"shard:opid"`) is covered by unit tests only, because the integration harness has no mongos fixture. The task's criteria do not require it.
- A `$currentOp` aggregation from another client that stays killable (CR-2) is covered at handler level with a fake client only. Neither the integration test nor the e2e test runs a concurrent `$currentOp` aggregation. The criteria do not require this, so there is no follow-up.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The fix commit `df1263e5` is covered: its CR-1 regression test is real, and I added a test for the `refresh()`/`schedule()` guards after destroy. For CR-2 I added a test that another client's `$currentOp` aggregation is listed and killed by its listed opid while `currentOp` commands stay hidden. The CR-3 helper has direct tests and its two call sites still pass their `$ownOps` tests. `npm run check` (= `.taskcheck`), the currentop integration test (3 passed) and the currentop e2e test (1 passed) all pass on HEAD `df1263e5`.
