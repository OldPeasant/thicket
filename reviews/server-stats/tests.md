# Test Report

Date: 2026-11-17

Task: server-stats - M6 (Could): Server stats dashboard

Scope: re-run on the final code. Base 27adc3abd4885ca9a8f0496a7abc21d3a21853d1 (parent-supplied);
task commits 5564d1da, ba0fd12e, ae53d546, 06eda52b, b23468b3; measured HEAD
b23468b382a7dbe5d2dd34297c182f2e684ed0c7 (branch main) plus one uncommitted test change from this
run (`server-stats.model.spec.ts`). No uncommitted production changes. The working tree also shows
`reviews/server-stats/review.md` modified; that was not changed by this helper (the code-reviewer's
report) and is not a test input. Changes since the previous test report are the fixer's commit
b23468b3 (`reviews/server-stats/fixes.md`): `fixtures/capture.mjs` (strips `$`-named fields),
`fixtures/repl-set-status-8.2.json` (`$clusterTime` removed), a doc comment in `stats-chart.ts`,
and the unused `formatRate` removed from `server-stats-view.ts`.

Requirements:
- tasks/server-stats.md acceptance criteria and recorded assumptions
- SPEC.md M6 "Could" (server stats), docs/ARCHITECTURE.md "Server stats" and "Coverage"
- reviews/server-stats/review.md CR-1 / CR-2 and reviews/server-stats/fixes.md (what the fix changed)
- Parent instructions for this re-run

## Test files changed

In this run:
- `packages/renderer/src/app/admin/stats/server-stats.model.spec.ts`

Earlier in the task (committed in 06eda52b, unchanged since): `stats-chart.spec.ts` (new),
`server-stats-view.spec.ts`, `server-stats.model.spec.ts`, `sidebar/sidebar-tree.service.spec.ts`,
`sidebar/sidebar-tree.spec.ts`, `packages/backend/src/admin/stats/handlers.spec.ts`.

## Tests added or updated

Count: 2 in this run (both new, describe `recorded fixtures`; no existing test changed). 34 tests were
added in the earlier run (listed in the previous report revision, commit 06eda52b).

- `recorded fixtures > have no $-named fields, like the backend answers (withoutDollarFields)`:
  regression test for CR-1. Walks all four recorded fixtures and fails on any `$`-named field that
  is not a canonical EJSON type wrapper (`{ $numberInt }`, `{ $date }`, `{ $timestamp }`, `{ $binary }`,
  `{ $code, $scope }`, ...). Also asserts `repl-set-status-8.2.json` has no `$clusterTime` but keeps
  `operationTime` (not `$`-named, the backend keeps it too). The component tests use these fixtures
  as stand-ins for `admin.serverStatus` / `admin.replSetStatus` answers, so they must not contain
  fields the backend never sends.
- `recorded fixtures > the check finds a $-named field next to normal fields, but not EJSON wrappers`:
  proves the detector is not vacuous: a document shaped like the pre-fix fixture (top-level
  `$clusterTime` next to `ok`) and a nested `{ $regex }` operator counter are reported; EJSON
  wrappers (`$numberInt`, `$timestamp`, nested `$date`/`$numberLong`) are not.

No other test changes were needed for the fixes: no spec read `$clusterTime` or `formatRate`; the
`stats-chart.ts` change is a comment only. `capture.mjs` is a manual recording script that needs
live servers and is not part of any test project (see "Unable to test"); the new fixture test
checks its output contract instead.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: Integration test for the data methods | `test/integration/server-stats.int.spec.ts` (7 tests) | `npm run test:int -- server-stats` | Not run in this re-run: the fix commit changed no backend/contract code or integration test (renderer fixture, script, comment, dead member only). Previous run on the same backend code: Pass (7 passed) |
| AC1 (unit level): backend data methods | `packages/backend/src/admin/stats/handlers.spec.ts` (10 tests) | `cd packages/backend && npx vitest run --coverage ...` (full backend suite) | Pass (2153 passed) |
| AC2: Component tests with recorded serverStatus fixtures | `server-stats-view.spec.ts`, `server-stats.model.spec.ts` (incl. the 2 new `recorded fixtures` tests), `stats-chart.spec.ts` | `cd packages/renderer && npx ng test --include='src/app/admin/stats/**/*.spec.ts'` | Pass (3 files, 56 tests) |
| AC2: fixtures match what the backend returns (CR-1) | `recorded fixtures` (2) | same as above | Pass |
| Dashboard opened from the connection menu (task assumption) | sidebar-tree.spec.ts "server stats" (3), sidebar-tree.service.spec.ts `openServerStats` (3) | full renderer suite in `npm run check` and the coverage run | Pass |
| Contract `admin.replSetStatus` | existing contract index.spec / methods.spec samples | `cd packages/contract && npx vitest run --coverage --coverage.include='src/admin.ts'` | Pass |
| E2E dashboard (`test/e2e/server-stats.e2e.ts`) | existing e2e | Not run: the parent owns that evidence | Not run |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/admin/stats/**/*.spec.ts'`

Result:

Pass (3 files, 56 tests; 2026-11-17 08:11:49 +0100).

## Full test execution

Command:

`npm run check` (repo root: eslint `--max-warnings 0`, `prettier --check`, type checks, root vitest
projects, renderer `ng test`)

Result:

Pass. Root vitest: 93 files, 4875 tests passed; renderer: 114 files, 3803 tests passed. Lint,
Prettier and type checks ran first in the `&&` chain and passed (the new spec is formatted and
type-checks). Integration and e2e were not run in this re-run (see the table).

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; result above, after the new tests were added).

## Bugs found

No production defects found. The earlier maintainability observation (unused `formatRate`, TW-1)
was fixed in b23468b3; `grep formatRate` finds nothing and the coverage below confirms
`server-stats-view.ts` functions are now 44/44.

## Coverage

Status: verified (renderer, backend and contract runs all exited 0 and wrote fresh reports on the
final code plus the new test).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling does not report it).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: server-stats;
  base 27adc3abd4885ca9a8f0496a7abc21d3a21853d1 (parent-supplied); HEAD
  b23468b382a7dbe5d2dd34297c182f2e684ed0c7; task commits 5564d1da, ba0fd12e, ae53d546, 06eda52b,
  b23468b3; file scope from `git diff --name-only 27adc3ab..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD b23468b3 plus
  `server-stats.model.spec.ts` sha256
  c62247742a316a41b7fd8347381dc0636a62472876ec32a926f388492c6466de (unchanged between the
  focused run, the coverage runs and `npm run check`); production file `server-stats-view.ts`
  sha256 dbe05c7b25020944cc6eb21e3c023d98fac4255b359888ce4292d7c3866e46a1 (as committed).
- Exact included files; renamed/deleted/excluded files and reasons:
  included: backend `src/admin/stats/{stats,handlers,index}.ts`, `src/index.ts`,
  `src/server/backend.ts`; contract `src/admin.ts`; renderer `src/app/admin/stats/{stats-chart,
  server-stats-view,server-stats.model,index}.ts`, `src/app/app.config.ts`,
  `src/app/layout/workspace.service.ts`, `src/app/sidebar/sidebar-tree.service.ts`,
  `src/app/sidebar/sidebar-tree.ts`. Excluded: `*.css`, `server-stats-view.html` (template; exercised
  by the component tests but not instrumented by v8 as a source file), `fixtures/*.json` (data;
  checked by the new `recorded fixtures` tests), `fixtures/capture.mjs` (manual dev script that
  needs live servers; not part of any test project), `test/e2e/server-stats.e2e.ts` and
  `test/integration/server-stats.int.spec.ts` (tests), `docs/ARCHITECTURE.md` (docs), `reviews/`.
  No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with v8 provider.
  Renderer (packages/renderer): `npx ng test --coverage --coverage-reporters=json-summary
  --coverage-reporters=lcovonly --coverage-reporters=text` with one `--coverage-include='src/...'`
  per renderer file listed above, full renderer suite. Backend (packages/backend): `npx vitest run
  --coverage --coverage.reporter=json-summary --coverage.reporter=text-summary` with one
  `--coverage.include='src/...'` per backend file listed above, full backend suite. Contract
  (packages/contract): `npx vitest run --coverage --coverage.reporter=text-summary
  --coverage.include='src/admin.ts'`, full contract suite.
- Run start/completion time and exit status: renderer 2026-11-17 08:12:05-08:12:22 +0100, exit 0
  (114 files, 3803 passed); backend 08:12:40-08:12:53 +0100, exit 0 (2153 passed); contract
  immediately after, exit 0.
- Generated report paths and report hashes/run identifier:
  `packages/renderer/coverage/renderer/coverage-summary.json` sha256
  a33d29b59a390bce03aa69af61424c5413c7720354a73c0625d4d2d94f863305,
  `packages/renderer/coverage/renderer/lcov.info` sha256
  93467342aa0037de981cfd3fefc2e5e6d161d3c6d7a65e071a21dc8341a6edb2 (both mtime 08:12:22.85 +0100,
  the end of the renderer run); `packages/backend/coverage/coverage-summary.json` sha256
  81ffd798a668049a832911557e567e26a1dd50675d4ec3f8b7accf7ea8afecaf (identical to the previous
  report: the backend code and tests did not change); contract: text summary 1/1 statements,
  1/1 lines.
- Evidence outputs are fresh and inputs stayed unchanged: the renderer reports changed hash
  compared to the previous run and their mtime matches this run; no source or test file was edited
  after the coverage runs.
- Final run after latest test additions and production fixes: yes (after the fixer commit b23468b3
  and after the 2 tests added in this run).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/admin/stats/stats.ts` | 29/29 (100%) | 22/22 (100%) | 6/6 (100%) | 23/23 (100%) |
| `packages/backend/src/admin/stats/handlers.ts` | 3/3 (100%) | N/A (0/0) | 3/3 (100%) | 3/3 (100%) |
| `packages/backend/src/admin/stats/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/backend/src/server/backend.ts` | 58/62 (93.5%) | 16/18 (88.9%) | 19/23 (82.6%) | 55/57 (96.5%) |
| `packages/contract/src/admin.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/renderer/src/app/admin/stats/server-stats-view.ts` | 176/177 (99.4%) | 73/83 (88.0%) | 44/44 (100%) | 145/145 (100%) |
| `packages/renderer/src/app/admin/stats/server-stats.model.ts` | 143/144 (99.3%) | 158/162 (97.5%) | 28/28 (100%) | 116/117 (99.1%) |
| `packages/renderer/src/app/admin/stats/stats-chart.ts` | 132/132 (100%) | 43/44 (97.7%) | 19/19 (100%) | 94/94 (100%) |
| `packages/renderer/src/app/admin/stats/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.4%) | 16/16 (100%) | 38/38 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 244/244 (100%) | 109/109 (100%) | 70/70 (100%) | 197/197 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 403/412 (97.8%) | 238/272 (87.5%) | 95/95 (100%) | 345/346 (99.7%) |

Aggregate (summed counters over all files above; the excluded .html/.css/.json/.mjs are not in it):
statements 1246/1261 (98.8%), branches 696/748 (93.0%), functions 300/304 (98.7%),
lines 1019/1023 (99.6%). Renderer subset: statements 1154/1165, branches 658/708, functions
272/272, lines 936/938; backend subset: 91/95, 38/40, 28/32, 82/84; contract 1/1 statements and
lines. backend.ts, sidebar-tree.ts, sidebar-tree.service.ts and workspace.service.ts are large
pre-existing files where the task added 1-15 lines; their whole-file numbers are dominated by old
code. Compared to the previous report, the only change is `server-stats-view.ts` losing the dead
`formatRate` (statements 176/179 -> 176/177, functions 44/45 -> 44/44, lines 145/146 -> 145/145).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `server-stats-view.ts:147,151,155,159` fallback arms of `replView`/`replError`/`dbRows`/`dbError`; `:168` `role` with no sample; `:102` one statement of the `profileId` computed (`?? ''` without tab data) | none observable: the template reads them only inside the matching `@switch`/`@if` arm; a tab without profile is tested ("tab without a profile sends nothing") | Justified gap |
| `server-stats-view.ts:246,295` `this.request === request` / `this.dbRequest === request` false arms | superseded requests return earlier on `signal.aborted`, so not reachable | Justified gap; superseding itself is tested ("a refresh supersedes a pending one", "Reload while the listing is pending") |
| `server-stats-view.ts:303` `memberTitle` arms (no message, healthy) | tooltip text of a member without a heartbeat message | Low-value presentation detail; left uncovered |
| `server-stats.model.ts:112` uptime absent entirely, `:226` no PRIMARY member, `:232` `optimeDate` absent, `:281` `formatMebibytes(null)`, `:327` loop fall-through of `niceMax` (unreachable) | defensive defaults for partial server output | Justified gap; partial status and lag cases are covered elsewhere |
| `stats-chart.ts:158` `times()[index]` defined arm vs undefined | covered both ways by tests; v8 reports one arm of the `?:` in the template-bound computed | Justified gap |
| `workspace.service.ts:94` | pre-existing code, not touched by the task | Out of task responsibility |
| `sidebar-tree.ts` 34 branches, line 341 | pre-existing menu code; the task's added lines (the "Server stats" item) are covered | Out of task responsibility |
| `backend.ts` 4 statements / 4 functions (log callbacks) | pre-existing code; the task's `statsHandlers` registration is covered | Out of task responsibility |

## Unable to test

- `fixtures/capture.mjs` (changed by the fixer): a manual script that records fixtures from live
  `mongo:8.2` servers; it is not part of any test project and no containers were used in this
  re-run. Its `withoutDollarFields` was compared by reading with the backend's
  `withoutDollarFields` (`packages/backend/src/admin/stats/stats.ts`): same recursion into arrays and
  plain objects only, same `$` prefix filter. Its output contract (no `$`-named fields) is now
  checked by the `recorded fixtures` tests on the committed fixtures. No follow-up needed unless the
  fixtures are re-recorded, in which case those tests check the new output.
- E2E `test/e2e/server-stats.e2e.ts` and the integration test were not run in this re-run (no
  backend or e2e-relevant code changed since the previous run). The parent owns that evidence.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The fixer's changes
needed no changes to existing tests; 2 tests were added to guard CR-1 (recorded fixtures carry no
`$`-named fields, as the backend answers). Focused tests (56), `npm run check` (= `.taskcheck`) and
task-scoped coverage on the final code all pass.

## Addendum: revision e48cc2d641a802702124b300f6ad4b39bc7b7af5 (rebased onto main with gridfs)

Date: 2026-11-17

Scope: the task was rebased onto main after the gridfs task landed. New merge-base
c7d60256ab0272087d68559517da5e1364df0165, measured HEAD e48cc2d641a802702124b300f6ad4b39bc7b7af5
(branch main), clean working tree before this addendum (the `recorded fixtures` tests above are
committed in 9fcb88e1; `server-stats.model.spec.ts` sha256 is still
c62247742a316a41b7fd8347381dc0636a62472876ec32a926f388492c6466de, the snapshot tested above).
Task commits now: 233102e3, 71f2595e, 7f6e1753, ffd600f2, 663406fd, 9fcb88e1, e48cc2d6.

What changed in the task code: `git range-diff 27adc3ab..b23468b3 c7d60256..e48cc2d6 -- packages test`
shows commits 1, 3, 4, 5 identical (`=`) and commit 2 (71f2595e) differing only in context lines
from gridfs and in the conflict resolution of `TabKind` in
`packages/renderer/src/app/layout/workspace.service.ts`, which now keeps both `'gridfs'` and
`'serverstats'`. `app.config.ts` registers both `provideTabView('gridfs', GridfsView)` and
`provideTabView('serverstats', ServerStatsView)`. No task production logic changed, so no test
changes were needed and no test file was edited for this addendum.

Commands and results (2026-11-17, packages and repo root as noted):

| Command | Result |
|---|---|
| `cd packages/renderer && npx ng test --include='src/app/admin/stats/**/*.spec.ts'` (08:18:17 +0100) | Pass: 3 files, 56 tests |
| `npm run check` from the repo root (= `.taskcheck`; eslint, Prettier, type checks incl. `ngc` strictTemplates, root vitest, renderer `ng test`) | Pass: root vitest 95 files, 4972 tests; renderer 116 files, 3874 tests (includes the gridfs specs) |
| Renderer coverage, same command as in "Coverage" above (08:19:33 +0100) | Pass, exit 0: 116 files, 3874 tests |
| Backend coverage, same command as in "Coverage" above | Pass, exit 0 |

Integration and e2e tests were not re-run: the rebase changed no task backend code or e2e path
(range-diff above). Integration evidence from the earlier run still applies to identical code.

Coverage on e48cc2d6 (whole-file coverage of task-changed production files, covered/total):

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/admin/stats/stats.ts` | 29/29 | 22/22 | 6/6 | 23/23 |
| `packages/backend/src/admin/stats/handlers.ts` | 3/3 | N/A (0/0) | 3/3 | 3/3 |
| `packages/backend/src/admin/stats/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/index.ts` | 1/1 | N/A | N/A | 1/1 |
| `packages/backend/src/server/backend.ts` | 58/63 | 16/18 | 19/24 | 55/58 |
| `packages/contract/src/admin.ts` | 1/1 (unchanged file, not re-run) | N/A | N/A | 1/1 |
| `packages/renderer/src/app/admin/stats/server-stats-view.ts` | 176/177 | 73/83 | 44/44 | 145/145 |
| `packages/renderer/src/app/admin/stats/server-stats.model.ts` | 143/144 | 158/162 | 28/28 | 116/117 |
| `packages/renderer/src/app/admin/stats/stats-chart.ts` | 132/132 | 43/44 | 19/19 | 94/94 |
| `packages/renderer/src/app/admin/stats/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/app.config.ts` | 1/1 | N/A | N/A | 1/1 |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 | 37/38 | 16/16 | 38/38 |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 247/247 | 111/111 | 71/71 | 200/200 |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 404/413 | 238/272 | 96/96 | 346/347 |

Aggregate (summed counters, same exclusions as above): statements 1250/1266 (98.7%), branches
698/750 (93.1%), functions 302/307 (98.4%), lines 1023/1028 (99.5%). Renderer subset 1158/1169,
660/710, 274/274, 940/942; backend subset 91/96, 38/40, 28/33, 82/85; contract 1/1.
The task-owned stats files have exactly the numbers of the previous run. The differences are in
shared pre-existing files that now also contain gridfs code from main (`backend.ts` +1 uncovered
statement/function/line, `sidebar-tree.service.ts` and `sidebar-tree.ts` a few more covered
counters); they are outside this task's responsibility. Uncovered-location table above still applies
to the stats files (same line numbers).

Reports: `packages/renderer/coverage/renderer/coverage-summary.json` sha256
9ddc36810feb297ab6ff340e6290a03b91a994897ca418e115f301a559801c25,
`packages/renderer/coverage/renderer/lcov.info` sha256
410bf92678f6ac46c5a6d4b74c78cff6df9ae26ecfc7dd70159d2bca57c39cd5,
`packages/backend/coverage/coverage-summary.json` sha256
7c714cacd4495e8f89b7fe58bfb593a1bd28c52a51dac87e0df8716bc15b0348 (all regenerated by these runs;
no source or test file changed between the runs).

Bugs found: none. Result for e48cc2d6: tests and task-scoped coverage are sufficient; all validation
passed.
