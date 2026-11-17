# Test Report

Date: 2026-11-17

Task: server-stats - M6 (Could): Server stats dashboard

Scope: task-owned commits 37c36437, b7a21293, 458bcd41 on top of d8fd865d (main). The parent rebased
during this run: the commits were 69817aba, 859b2637, e807c1c4 on base
3df54d9b046e2e54cbf07f8e97bc8190f81acf86. `git patch-id` of the code diff (packages/, test/, docs/)
is identical before and after the rebase (e4ae0b900603c3e3a723d649b8d0c3723eabdeaf), so the task
code did not change. Measured HEAD 458bcd411b365af4990050c9cee2eaa4032d044d, branch main, plus
the uncommitted test changes listed below (no uncommitted production changes).

Requirements:
- tasks/server-stats.md acceptance criteria and recorded assumptions
- SPEC.md M6 "Could" (server stats), docs/ARCHITECTURE.md "Server stats" and "Coverage"
- Parent instructions (gaps: sidebar menu item / openServerStats, StatsChart.indexAt, loadDatabases abort on destroy)

## Test files changed

- `packages/renderer/src/app/admin/stats/stats-chart.spec.ts` (new)
- `packages/renderer/src/app/admin/stats/server-stats-view.spec.ts`
- `packages/renderer/src/app/admin/stats/server-stats.model.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`
- `packages/backend/src/admin/stats/handlers.spec.ts`

## Tests added or updated

Count: 34 (all new; no existing test changed)

- stats-chart.spec.ts (11): `indexAt` is null without points; maps right edge / empty left part;
  clamps outside the plot; more points than slots; series of different lengths; waiting text and no
  tooltip without points; hover tooltip (time, values, gap dash, flip on the right, hidden on
  mouseleave); no tooltip with a zero-width plot; legend and aria-label dash for a trailing gap;
  no time row without times.
- server-stats-view.spec.ts (14): non-document serverStatus answer shows the error; replSetStatus
  without members counts as "not a member"; Refresh button samples again; a refresh supersedes a
  pending one (old request cancelled, its late answer never charted, no error); invalid interval
  turns auto-refresh off and the select's change event sets it; empty database list; at most four
  dbStats at a time and all pending ones cancelled when the tab closes; Reload while the listing is
  pending (the older listing never overwrites the newer); secondary and mongos role labels; tab
  without a profile sends nothing; backend CANCELLED shows no error; Refresh/Reload after close
  send nothing.
- server-stats.model.spec.ts (2): `ejsonNumber` rejects non-finite numbers and non-EJSON objects;
  `pointBetween` is null when uptime advanced but one counter went back.
- sidebar-tree.service.spec.ts (3): `openServerStats` opens the tab with the production flag;
  selects an existing tab, another connection gets its own; unknown profile falls back to its id.
- sidebar-tree.spec.ts (3): "Server stats" menu item disabled while disconnected; opens the tab from
  the connection menu and closes the menu; enabled on read-only profiles.
- handlers.spec.ts (1): `admin.replSetStatus` with a failure that has no server code (socket error)
  is answered as an error, not as `null` ("not a replica set member").

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: Integration test for the data methods | `test/integration/server-stats.int.spec.ts` (7 tests: serverStatus fields, counters grow, replSetStatus null on standalone, members on mongo8rs, repl section, db.stats, NOT_CONNECTED) | `npm run test:int -- server-stats` (Podman/testcontainers fixtures mongo8, mongo8rs) | Pass (7 passed) |
| AC1 (unit level): backend data methods | `packages/backend/src/admin/stats/handlers.spec.ts` (10 tests incl. the new non-server-failure test) | `cd packages/backend && npx vitest run --coverage ...` (full backend suite) | Pass (2153 passed) |
| AC2: Component tests with recorded serverStatus fixtures | `server-stats-view.spec.ts` (28 tests on fixtures `server-status-1/2/rs-8.2.json`, `repl-set-status-8.2.json`), `server-stats.model.spec.ts`, `stats-chart.spec.ts` | `cd packages/renderer && npx ng test --include='src/app/admin/stats/**/*.spec.ts'` | Pass (52 passed before the last 2 model tests; the final full renderer run below includes all) |
| Dashboard opened from the connection menu (task assumption) | sidebar-tree.spec.ts "server stats" (3), sidebar-tree.service.spec.ts `openServerStats` (3) | `cd packages/renderer && npx ng test --include='src/app/admin/stats/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts'` | Pass (257 passed) |
| Contract `admin.replSetStatus` | existing contract index.spec / methods.spec samples | `cd packages/contract && npx vitest run --coverage --coverage.include='src/admin.ts'` | Pass (849 passed) |
| E2E dashboard (`test/e2e/server-stats.e2e.ts`) | existing e2e | Not run: not named by the acceptance criteria; the parent owns that evidence | Not run |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/admin/stats/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts'`

Result:

Pass (5 files, 257 tests). Later `--include='src/app/admin/stats/**/*.spec.ts'` alone: Pass (3 files, 52 tests).

## Full test execution

Command:

`npm run check` (lint, Prettier check, typecheck, root vitest projects, renderer ng test); also
`npm run test:int -- server-stats`.

Result:

Pass. Root vitest: 93 files, 4875 tests passed; renderer: 114 files, 3801 tests passed.
Integration: 1 file, 7 tests passed.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; result above, run 2026-11-17 08:03-08:04 +0100).

## Bugs found

No production defects found. One low-severity maintainability observation (not a failing test):
`packages/renderer/src/app/admin/stats/server-stats-view.ts:180` `formatRate` is never used by the
template or class (dead code; the ops chart uses its own format). Left for the parent/reviewer to
decide; no fix required for the acceptance criteria.

## Coverage

Status: verified (renderer, backend, contract runs all exited 0 with fresh reports).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling does not report it).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: server-stats;
  base 3df54d9b046e2e54cbf07f8e97bc8190f81acf86 (parent-supplied), after the parent's rebase
  d8fd865d; HEAD 458bcd411b365af4990050c9cee2eaa4032d044d; task commits 37c36437, b7a21293, 458bcd41
  (were 69817aba, 859b2637, e807c1c4); scope from `git diff --name-only d8fd865d..HEAD`, identical
  patch-id to the parent-supplied range.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 458bcd41 (no uncommitted
  production changes) plus test file sha256:
  server-stats.model.spec.ts 15a5864097b911dfdb1710934090fb8f61436f2955958cd9efed1f8d5d57d46f,
  server-stats-view.spec.ts 764c391a1ee6757fd7238af4aa1cb02975dc25e320d4b5738970b7abf82c6095,
  stats-chart.spec.ts 61b434b4a4b8ad2e6a46b7d10b5db6cc189d996fe9af06ec683ce88c80e648e5,
  sidebar-tree.service.spec.ts a3a0d47c4aa816cb733d4af65e6ad113e1a7df32dc2463b0aa2cf6b239e5bca0,
  sidebar-tree.spec.ts e6ac32518b130acab87eb455b3a35edf96cb94ce21a4f1152b9c14c298121b87,
  handlers.spec.ts 847c274ccf23df0b7ee84d97a06ffd206fe16827dfe83a67ca6242e2a37acd10
  (unchanged between the final coverage runs and `npm run check`).
- Exact included files; renamed/deleted/excluded files and reasons:
  included: backend `src/admin/stats/{stats,handlers,index}.ts`, `src/index.ts`,
  `src/server/backend.ts`; contract `src/admin.ts`; renderer `src/app/admin/stats/{stats-chart,
  server-stats-view,server-stats.model,index}.ts`, `src/app/app.config.ts`,
  `src/app/layout/workspace.service.ts`, `src/app/sidebar/sidebar-tree.service.ts`,
  `src/app/sidebar/sidebar-tree.ts`. Excluded: `*.css`, `server-stats-view.html` (template; exercised
  by the component tests but not instrumented by v8 as a source file), `fixtures/*.json` (data),
  `fixtures/capture.mjs` (dev script that needs a live server; not part of any test project),
  `test/e2e/server-stats.e2e.ts` and `test/integration/server-stats.int.spec.ts` (tests),
  `docs/ARCHITECTURE.md` (docs). No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with v8 provider.
  Renderer (packages/renderer): `npx ng test --coverage --coverage-reporters=json-summary
  --coverage-reporters=lcovonly --coverage-reporters=text-summary` with one `--coverage-include='src/...'`
  per renderer file listed above, full renderer suite. Backend (packages/backend): `npx vitest run
  --coverage --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=lcovonly`
  with one `--coverage.include='src/...'` per backend file listed above, full backend suite. Contract (packages/contract):
  `npx vitest run --coverage --coverage.reporter=text --coverage.reporter=json-summary
  --coverage.include='src/admin.ts'`, full contract suite.
- Run start/completion time and exit status: renderer final run 2026-11-17 08:02:34-08:02:57 +0100,
  exit 0 (3801 passed); backend 08:00:30-08:00:43 +0100, exit 0 (2153 passed); contract 08:00:51
  +0100, exit 0 (849 passed).
- Generated report paths and report hashes/run identifier:
  `packages/renderer/coverage/renderer/coverage-summary.json` sha256
  2529508047b45a1448b62fbbe5bbc219ca41cd64e49771251825cf9448a8775e,
  `packages/renderer/coverage/renderer/lcov.info` sha256
  7e5be773c42db549192d3516878c7d9cb5506ffb6d5d0265cf6c2e9de4003ec2;
  `packages/backend/coverage/coverage-summary.json` sha256
  81ffd798a668049a832911557e567e26a1dd50675d4ec3f8b7accf7ea8afecaf,
  `packages/backend/coverage/lcov.info` sha256
  50f0060fa1d134bd3946e30b9a5696bcb730e6e0fcbfa597f63b6504744ec5f7;
  contract: text summary (1/1 statements, 1/1 lines) and json-summary in `packages/contract/coverage/`.
- Evidence outputs are fresh and inputs stayed unchanged: report files were rewritten by each run
  (mtimes 08:01:17 / 08:02:57 renderer, 08:00:11 / 08:00:43 backend, matching the run times); the
  test files were not edited after the final renderer and backend runs.
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/admin/stats/stats.ts` | 29/29 (100%) | 22/22 (100%) | 6/6 (100%) | 23/23 (100%) |
| `packages/backend/src/admin/stats/handlers.ts` | 3/3 (100%) | N/A (0/0) | 3/3 (100%) | 3/3 (100%) |
| `packages/backend/src/admin/stats/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/backend/src/server/backend.ts` | 58/62 (93.5%) | 16/18 (88.9%) | 19/23 (82.6%) | 55/57 (96.5%) |
| `packages/contract/src/admin.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/renderer/src/app/admin/stats/server-stats-view.ts` | 176/179 (98.3%) | 73/83 (88.0%) | 44/45 (97.8%) | 145/146 (99.3%) |
| `packages/renderer/src/app/admin/stats/server-stats.model.ts` | 143/144 (99.3%) | 158/162 (97.5%) | 28/28 (100%) | 116/117 (99.1%) |
| `packages/renderer/src/app/admin/stats/stats-chart.ts` | 132/132 (100%) | 43/44 (97.7%) | 19/19 (100%) | 94/94 (100%) |
| `packages/renderer/src/app/admin/stats/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.4%) | 16/16 (100%) | 38/38 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 244/244 (100%) | 109/109 (100%) | 70/70 (100%) | 197/197 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 403/412 (97.8%) | 238/272 (87.5%) | 95/95 (100%) | 345/346 (99.7%) |

Aggregate (summed counters over all files above; the excluded .html/.css/.json/.mjs are not in it):
statements 1246/1263 (98.7%), branches 696/748 (93.0%), functions 300/305 (98.4%),
lines 1019/1024 (99.5%). Renderer subset alone: statements 1154/1167, branches 658/708, functions
272/273, lines 936/939; backend subset: 91/95, 38/40, 28/32, 82/84; contract 1/1 statements and lines.
backend.ts, sidebar-tree.ts, sidebar-tree.service.ts and workspace.service.ts are large
pre-existing files where the task added 1-15 lines; their whole-file numbers are dominated by old code.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `server-stats-view.ts:180` (`formatRate`) | none: unused member | Dead code; reported above, no test |
| `server-stats-view.ts:147,151,155,159` fallback arms of `replView`/`replError`/`dbRows`/`dbError`; `:168` `role` with no sample | none observable: the template reads them only inside the matching `@switch`/`@if` arm | Justified gap |
| `server-stats-view.ts:247,296` `this.request === request` / `this.dbRequest === request` false arms | superseded requests return earlier on `signal.aborted`, so not reachable | Justified gap; superseding itself is tested ("a refresh supersedes a pending one", "Reload while the listing is pending") |
| `server-stats-view.ts:304` `memberTitle` arms (no message, healthy) | tooltip text of a member without a heartbeat message | Low-value presentation detail; left uncovered |
| `server-stats.model.ts:112` uptime absent entirely, `:226` no PRIMARY member, `:232` `optimeDate` absent, `:281` `formatMebibytes(null)`, `:327` loop fall-through of `niceMax` (unreachable) | defensive defaults for partial server output | Justified gap; partial status and lag cases are covered elsewhere |
| `stats-chart.ts:158` `times()[index]` defined arm vs undefined | covered both ways by tests; v8 reports one arm of the `?:` in the template-bound computed | Justified gap |
| `workspace.service.ts:94` | pre-existing code, not touched by the task | Out of task responsibility |
| `sidebar-tree.ts` 34 branches, line 341 | pre-existing menu code; the task's 6 added lines (the "Server stats" item) are covered by the new tests | Out of task responsibility |
| `backend.ts:82,88` | pre-existing log callbacks; the task's line 147 (`statsHandlers` registration) is covered | Out of task responsibility |

## Unable to test

- `fixtures/capture.mjs`: a manual script that records fixtures from a live server; not part of any
  test project. No follow-up needed (its output is exercised by the component tests).
- E2E `test/e2e/server-stats.e2e.ts`: not run by this helper (not named by the acceptance criteria).
  The parent should run it if it wants e2e evidence.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. 34 tests were added
(sidebar entry point, StatsChart hover/indexAt, request ordering and cancellation on close/Reload,
role labels, backend error mapping). Focused tests, the integration test for criterion 1,
`npm run check` and coverage all pass.
