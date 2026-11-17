# Test Report

Date: 2026-11-17

Task: currentop - M6 (Should): currentOp and killOp

Scope: base `375764073310b27677a5248cc28decf8bd2da845` .. HEAD `cbc4bcd63b12a9a73f10db0dd5e7cc4b1936b233` on branch `main` (3 task commits: `745a8fec` backend handlers + integration test, `f3aefcc4` current operations tab, `cbc4bcd6` e2e + architecture notes + filter alignment). Scope given by the parent worker and checked against `git log`/`git diff --stat` of that range; no other commits in the range. Uncommitted at measurement time: only the test files listed below (no production changes).

Requirements:
- `tasks/currentop.md` acceptance criteria (1: integration test, a slow op is listed and killed; 2: e2e, kill from the UI with confirm) and its three recorded assumptions (primary only; namespace prefix on name boundaries; tab kind `currentop`, refresh never/2/5/10 s default 5, kill only for active operations)
- `SPEC.md` M6 "Should" line 190 (filter by namespace/duration/op type, auto-refresh, killOp) and the `admin.*` method table
- `docs/ARCHITECTURE.md` "Current operations", "Coverage", "Integration tests", "End-to-end tests"
- `AGENTS.md`, `docs/QUALITY.md`; existing spec conventions (`users-roles.model.spec.ts`, `sidebar-tree*.spec.ts`, `app.spec.ts`, `FakeThicketBridge`)

## Test files changed

- `packages/renderer/src/app/admin/currentop/currentop.model.spec.ts` (new)
- `packages/renderer/src/app/admin/currentop/currentop-view.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`
- `packages/renderer/src/app/app.spec.ts`
- `packages/backend/src/admin/currentop/handlers.spec.ts`

No existing test was removed, weakened or skipped (the only deleted line is an import widened to also import `escapeRegExp`).

## Tests added or updated

Count: 65 new tests (renderer model 30, renderer view 17, sidebar service 3, sidebar tree 3, app 1, backend 11).

- `currentop.model.spec.ts`: `ejsonNumber` (EJSON Int32/Int64/Double, non-finite and malformed values -> null); `toOpEntry` (full reduction, canonical EJSON `opId` incl. Int64 above 2^53, mongos `"shard:opid"` string, missing/null opid, `secs_running` fallback, idle -> `secs: null`, only literal `true` for active/waitingForLock, `client_s` fallback, `users` fallback and empty user filtering, missing/non-object command, invalid canonical EJSON command -> `''`, 400-char cut with ellipsis, non-object documents); `formatDuration` (ms / s / min / h at and around 1 s, 60 s, 3600 s); `durationLevel` (thresholds 10 s and 60 s exactly and just below); `durationShare` (0 for idle/zero/negative/no longest, 100 for longest, log scale, min 2 / max 100 clamp); `currentOpCall` (empty, all filters in order, single filters, trimming, regex escaping incl. `/`, prefix-on-name-boundaries semantics).
- `currentop-view.spec.ts`: default interval 5 s and options never/2/5/10 s; Refresh button; loading state until first answer; no read for a tab without profile; recovery after a failed read via Refresh; auto-refresh keeps running after a failed read; next automatic read scheduled only after the previous answer (deferred promise + fake timers); out-of-order answers (older success and older failure arriving after a newer filter's answer are ignored; the older request is cancelled); no re-read when a filter is set to its current value (blank ns, negative/non-numeric seconds); failed kill shown as `role="alert"` notice, list kept, kill re-enabled; a second kill is ignored while the first waits for confirmation and other Kill buttons are disabled; confirm dialog title/detail (with and without type/namespace); mongos `"shard:opid"` kill sends the string id; read-only profile refuses `view.kill()` called directly (no dialog, nothing sent, error notice); closing the tab cancels the pending read and stops auto-refresh.
- `sidebar-tree.service.spec.ts`: `openCurrentOps` tab shape with production flag; one tab per connection (re-open selects); unknown profile falls back to its id.
- `sidebar-tree.spec.ts` (`describe('current operations')`): `menu-current-ops` disabled while disconnected (click opens nothing); opens the `currentop:p1` tab from the connection menu and closes the menu; enabled on read-only profiles.
- `app.spec.ts`: `currentop` tab kind is registered to `CurrentOpView`.
- `handlers.spec.ts`: `escapeRegExp` makes every metacharacter literal; negative `minSecsRunning`/blank `ns` ignored; aggregate `$currentOp` probe filtered and operations without a running time sorted last (also `command: null`); reply without `inprog` -> `{ ops: [] }`; canonical EJSON output keeps Int64; Unauthorized recognised by code name alone and filters kept on the `$ownOps` retry; error of the `$ownOps` retry passed on (2 commands sent); abort while the server answers -> `CANCELLED`; killOp with `"shard01:77"` and an Int64 above 2^53; killOp server error -> `SERVER_ERROR`.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: integration test, a slow op is listed and killed | `test/integration/currentop.int.spec.ts` (3 tests, existing, not changed by me) | `npx vitest run --config test/integration/vitest.config.ts test/integration/currentop.int.spec.ts` (repo root, Podman containers) | Pass (3 passed) |
| AC2: e2e, kill from the UI with confirm | `test/e2e/currentop.e2e.ts` "current operations: a slow query is listed and killed from the UI after confirming" (existing) | `npm run test:e2e -- test/e2e/currentop.e2e.ts` (builds renderer + desktop, Playwright Electron harness with MongoDB container, headless) | Pass (1 passed) |
| Kill only after confirm (`alwaysConfirm`), cancel sends nothing, failure shown | view: existing kill/cancel tests + `shows a failed kill as an error notice and keeps the list`, `asks only once while a kill waits for confirmation…`, `describes the operation in the confirm dialog`, `describes an operation without type or namespace…`, `kills a mongos shard:opid…`, `refuses a kill on a read-only profile even when called directly` | `cd packages/renderer && npx ng test --include='src/app/admin/currentop/**/*.spec.ts'` | Pass (54 passed) |
| Filters namespace (prefix on name boundaries), duration, type, idle/system | backend `currentOpCommand`/`escapeRegExp` tests; model `currentOpCall` tests; view filter tests | backend: `cd packages/backend && npx vitest run src/admin/currentop`; renderer command above | Pass (28 / 54 passed) |
| Auto-refresh (default 5 s; never/2/5/10; next read after previous answer) | view: existing interval test + `shows the default interval…`, `schedules the next automatic read only after the previous answer`, `keeps refreshing automatically after a failed read`, `gives up the pending read and stops refreshing when the tab closes` | renderer command above | Pass |
| Stale/out-of-order reads do not overwrite newer results | `ignores an older answer that arrives after the answer for newer filters`, `ignores a late failure of an older read` | renderer command above | Pass |
| Listing: own probe hidden, longest first, `$ownOps` fallback, errors | backend handler tests (existing + 6 new) | `cd packages/backend && npx vitest run src/admin/currentop` | Pass (28 passed) |
| killOp opid parsing (Int32/Int64/Double/"shard:opid", else INVALID_PARAMS) | backend `parseOpId` + killOp handler tests | backend command above | Pass |
| EJSON reduction and display (running time text, levels 10 s / 60 s, log bar) | `currentop.model.spec.ts` (30 tests) | renderer command above | Pass |
| Tab opened from the connection's sidebar menu, tab kind `currentop` registered | sidebar service/tree tests, `app.spec.ts` registration test | `cd packages/renderer && npx ng test --include='src/app/sidebar/*.spec.ts' --include='src/app/app.spec.ts'` | Pass (209 passed) |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/admin/currentop`; `cd packages/renderer && npx ng test --include='src/app/admin/currentop/**/*.spec.ts'`; `cd packages/renderer && npx ng test --include='src/app/sidebar/*.spec.ts' --include='src/app/app.spec.ts'`

Result:

Pass (28 passed; 54 passed; 209 passed)

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier --check, typecheck of all workspaces, `vitest run` + `ng test`); plus `npx vitest run --config test/integration/vitest.config.ts test/integration/currentop.int.spec.ts` and `npm run test:e2e -- test/e2e/currentop.e2e.ts`

Result:

Pass (vitest 86 files / 4454 tests; renderer 104 files / 3452 tests; integration 3 passed; e2e 1 passed). The first `npm run check` attempt failed only on Prettier formatting of two of my new test files; I ran `npx prettier --write` on the changed test files and the rerun passed.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; see above)

## Bugs found

None. No test exposed behavior that contradicts the acceptance criteria, SPEC or the recorded assumptions.

Observation (not a requirement violation, no failing test kept, no fix required): `formatDuration` rounds before choosing its unit, so 59.96 s shows `60.0 s` instead of `1 min 00 s`, and 0.9996 s shows `1000 ms`. Cosmetic only; the parent may record it as accepted.

## Coverage

Status: verified (fresh runs on the final test snapshot; both commands completed with all tests passing).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured separately by intersecting provider lcov `DA` lines with the added lines of `git diff -U0 375764073310b27677a5248cc28decf8bd2da845 HEAD` per file: every executable changed line is covered (backend `currentop.ts` 42/42, `handlers.ts` 4/4; renderer `currentop-view.ts` 85/85, `currentop.model.ts` 49/49, `sidebar-tree.service.ts` 3/3, `sidebar-tree.ts` 1/1). The changed lines of `backend.ts`, `src/index.ts`, `app.config.ts`, `workspace.service.ts` and both `index.ts` barrels have no lcov `DA` entry (imports, a spread inside an existing object literal, a type union): 0 executable changed lines, N/A. Changed-branch coverage not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `currentop`; base `375764073310b27677a5248cc28decf8bd2da845`; HEAD `cbc4bcd63b12a9a73f10db0dd5e7cc4b1936b233`; commits `745a8fec`, `f3aefcc4`, `cbc4bcd6`, supplied by the parent and matching `git log base..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD above plus uncommitted test files with sha256: `handlers.spec.ts` 52fe4525…c95, `currentop.model.spec.ts` b18afb17…2d813, `currentop-view.spec.ts` 54807719…c722e, `sidebar-tree.service.spec.ts` e4af7a00…5ffa, `sidebar-tree.spec.ts` 49251d2a…7be, `app.spec.ts` 431fc215…112. Production hashes unchanged from HEAD (e.g. `currentop.ts` f3ab8fbe…b65b, `currentop-view.ts` 79b09b1f…996b, `currentop.model.ts` 98438c17…c95).
- Exact included files; renamed/deleted/excluded files and reasons: backend `src/admin/currentop/currentop.ts`, `src/admin/currentop/handlers.ts`, `src/admin/currentop/index.ts`, `src/server/backend.ts`, `src/index.ts`; renderer `src/app/admin/currentop/currentop.model.ts`, `src/app/admin/currentop/currentop-view.ts`, `src/app/admin/currentop/index.ts`, `src/app/app.config.ts`, `src/app/layout/workspace.service.ts`, `src/app/sidebar/sidebar-tree.ts`, `src/app/sidebar/sidebar-tree.service.ts`. Excluded: `currentop-view.html` / `.css` (template and styles; not instrumented as separate files by the provider; template behavior is exercised through the view specs), specs, `test/integration/*`, `test/e2e/*`, `docs/ARCHITECTURE.md`. No renames or deletions in scope. No scoped file is missing from the reports.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` (Node 24.22.1). Backend, in `packages/backend`: `npx vitest run --coverage --coverage.include='src/admin/currentop/currentop.ts' --coverage.include='src/admin/currentop/handlers.ts' --coverage.include='src/admin/currentop/index.ts' --coverage.include='src/server/backend.ts' --coverage.include='src/index.ts' --coverage.reportsDirectory=coverage/currentop-task --coverage.reporter=text-summary --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=lcovonly` (whole backend suite, 45 files / 1832 tests). Renderer, in `packages/renderer`: `npx ng test --coverage --coverage-include='src/app/admin/currentop/currentop.model.ts' --coverage-include='src/app/admin/currentop/currentop-view.ts' --coverage-include='src/app/admin/currentop/index.ts' --coverage-include='src/app/app.config.ts' --coverage-include='src/app/layout/workspace.service.ts' --coverage-include='src/app/sidebar/sidebar-tree.ts' --coverage-include='src/app/sidebar/sidebar-tree.service.ts' --coverage-reporters=text-summary --coverage-reporters=json-summary --coverage-reporters=json --coverage-reporters=lcovonly` (whole renderer suite, 104 files / 3452 tests).
- Run start/completion time and exit status: backend started 2026-11-17 06:47:26 +01:00, reports written 06:48:03, all 45 files passed (re-run once with identical inputs to read the test counts; reports from that run). Renderer started 06:48:16 +01:00, reports written 06:49:01, all 104 files passed.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/currentop-task/coverage-summary.json` (sha256 00c060c0…36f4), `coverage-final.json` (fbe20970…ecfb45), `lcov.info` (5de7c72b…60d7); `packages/renderer/coverage/renderer/coverage-summary.json` (9ba00a21…c5f), `coverage-final.json` (97861c92…29f8), `lcov.info` (3a7ee4ef…c5f). All git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes; sha256 of every scoped production and test file was taken before the final runs and again after them, identical; report files are timestamped by these runs (Vitest cleans the reports directory per run).
- Final run after latest test additions and production fixes: yes (no production fixes were made; the final runs include all added tests).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/admin/currentop/currentop.ts` | 51/53 (96.2%) | 47/50 (94.0%) | 11/11 (100%) | 42/42 (100%) |
| `packages/backend/src/admin/currentop/handlers.ts` | 4/4 (100%) | N/A (0/0) | 3/3 (100%) | 4/4 (100%) |
| `packages/backend/src/admin/currentop/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/server/backend.ts` | 58/62 (93.5%) | 16/18 (88.9%) | 19/23 (82.6%) | 55/57 (96.5%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/renderer/src/app/admin/currentop/currentop.model.ts` | 64/64 (100%) | 75/75 (100%) | 13/13 (100%) | 49/49 (100%) |
| `packages/renderer/src/app/admin/currentop/currentop-view.ts` | 98/99 (99.0%) | 68/72 (94.4%) | 23/23 (100%) | 85/85 (100%) |
| `packages/renderer/src/app/admin/currentop/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.4%) | 16/16 (100%) | 38/38 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 402/411 (97.8%) | 238/272 (87.5%) | 94/94 (100%) | 344/345 (99.7%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 241/241 (100%) | 107/107 (100%) | 69/69 (100%) | 194/194 (100%) |

Aggregates (summed provider counters): backend scope 114/120 statements (95.0%), 63/68 branches (92.6%), 33/37 functions (89.2%), 102/104 lines (98.1%); renderer scope 861/871 statements (98.9%), 525/564 branches (93.1%), 215/215 functions (100%), 711/712 lines (99.9%). No scoped file is unmeasured; `.html`/`.css` excluded as stated above. The large shared files (`backend.ts`, `sidebar-tree.ts`, `sidebar-tree.service.ts`, `workspace.service.ts`) dominate these aggregates with mostly pre-existing code.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/admin/currentop/currentop.ts:46` (`!(error instanceof RpcError)` return) | Defensive: `runCommand` already converts every server error to `RpcError` | Justified gap; not reachable through the handlers |
| `packages/backend/src/admin/currentop/currentop.ts:107` (plain `number` opid) | Defensive: `EJSON.parse(..., { relaxed: false })` returns `Int32`/`Double`, never a JS number | Justified gap; all reachable opid forms are tested |
| `packages/backend/src/server/backend.ts:53,81,87,167` | Pre-existing code (not part of this task's diff); the task's added lines are imports/spreads with no executable line entry | Out of task scope |
| `packages/renderer/src/app/admin/currentop/currentop-view.ts:172` (`aborted` after a successful answer) | Defensive: `ApiService.request` rejects with `CANCELLED` on abort, so the success path never sees an aborted signal; the stale-answer behavior itself is covered by the out-of-order tests | Justified gap |
| `currentop-view.ts:178` (else arm: request replaced) | Defensive: a replaced request is aborted and returns earlier | Justified gap |
| `currentop-view.ts:93` (`?? []` arm), `:97` (`null` arm) | `longest`/`updatedAt` are only read by the template inside the loaded branch | Justified gap |
| `packages/renderer/src/app/layout/workspace.service.ts:93`, `sidebar-tree.ts` (various) | Pre-existing code; the task's changed lines (type union, menu item at 418-423) are covered | Out of task scope |

## Unable to test

- Visual presentation (amber/red colors of the duration bar, layout of the aligned filter controls in `currentop-view.css`): not covered by unit tests; `data-level` attributes and bar widths are asserted. The e2e test runs the real UI but does not assert colors. No follow-up required by the criteria.
- The e2e run was headless (no `xvfb-run` on this machine), as the harness does by default; it ran against the real backend and a MongoDB container, not a dev shortcut.
- Kill on a sharded cluster (mongos `"shard:opid"`) is covered by unit tests only; no mongos fixture exists in the integration harness. Not required by the task's criteria.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. 65 tests were added (model spec, view edge cases incl. out-of-order and failure paths, sidebar menu, tab registration, backend handler edge cases); `npm run check` (= `.taskcheck`), the currentop integration test and the currentop e2e test all pass.
