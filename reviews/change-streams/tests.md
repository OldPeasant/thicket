# Test Report

Date: 2026-11-17

Task: change-streams - M6 (Could): Watch changes

Scope: `git diff a9dcfb7b7cfc684b2abbb11befe0e654f53623e4..91cbb5a4d16b36931757fdbf578669ea9398c30e` on branch `main`
(task commits 4fcdf4c3, 7673013e, 91cbb5a4, supplied by the parent worker and confirmed with
`git log a9dcfb7b..HEAD`), plus the uncommitted test files listed below.

Requirements:
- `tasks/change-streams.md` acceptance criteria and recorded assumptions (raw `$changeStream` +
  getMore loop, standalone refused via `hello` with `UNSUPPORTED` / `{ reason: 'needsReplicaSet' }`,
  "open document" via `docs.get`, newest 1000 events)
- `SPEC.md` M6 "Could" (watch changes), `docs/ARCHITECTURE.md` "Coverage" and conventions
- Parent worker instructions (missing backend unit tests and sidebar tests)

## Test files changed

- `packages/backend/src/admin/watch/watch.spec.ts` (new)
- `packages/backend/src/admin/watch/handlers.spec.ts` (new)
- `packages/renderer/src/app/watch/watch-view.spec.ts` (extended)
- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts` (extended)
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts` (extended)

## Tests added or updated

Count: 65 (backend 45: `watch.spec.ts` 34, `handlers.spec.ts` 11; renderer 20: `watch-view.spec.ts` 9,
`sidebar-tree.service.spec.ts` 5, `sidebar-tree.spec.ts` 6). No existing test was changed or removed.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: insert/update/delete events received in order (integration, real replica set) | `admin.watch on a replica set > receives insert, update and delete events of a collection in order` (+ 5 more in the file: database + pipeline, deployment, invalidate on drop, connection close, invalid params) | `npx vitest run --config test/integration/vitest.config.ts test/integration/change-streams.int.spec.ts` (Podman containers) | Pass (7/7) |
| AC1 (unit): events of the first batch and every getMore batch go out one by one in server order; ends on a closed cursor (invalidate) | `streamChanges > sends the first batch and each getMore batch in server order, then ends on a closed cursor`; `watchHandlers > streams insert, update and delete in order until the server closes the cursor` | `cd packages/backend && npx vitest run src/admin/watch` | Pass |
| AC2: standalone server shows a clear 'needs replica set' message (integration) | `admin.watch on a standalone server > refuses with a clear 'needs replica set' message` | integration command above | Pass |
| AC2 (backend unit): standalone refused before any stream opens, `UNSUPPORTED` + `{ reason: 'needsReplicaSet' }`; server code 40573 / `Location40573` mapped the same way | `assertWatchable > refuses a standalone server (...)` (2 cases), `the message clearly names the replica set requirement...`, `streamChanges > maps the server's $changeStream refusal (...)` (2 cases), `watchHandlers > refuses a standalone server before a stream exists...`, `watchHandlers > maps the server's own replica-set refusal on the aggregate...` | backend command above | Pass |
| AC2 (renderer): dedicated notice | existing `WatchView > shows a clear 'needs replica set' message for a standalone server` | `cd packages/renderer && npx ng test --include='src/app/watch/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts'` | Pass |
| Command shapes: collection / database (`aggregate: 1`) / deployment (`admin`, `allChangesForCluster`), `fullDocument`, user stages after `$changeStream`, invalid params | `watchCommand > ...` (9 cases), `streamChanges > refuses invalid params before any command is sent`, `watchHandlers > refuses invalid params before asking the server anything` | backend command | Pass |
| Replica set / sharded / load-balanced pass `hello`; hello errors mapped; cancel during hello | `assertWatchable > lets ... pass` (3), `maps a failing hello...`, `answers CANCELLED ...` (2) | backend command | Pass |
| Cancel kills the server cursor (`killCursors` on the right namespace), late getMore answers deliver nothing; failing killCursors does not hide the cancel; getMore failure kills the open cursor; lossless EJSON from raw BSON batches | `streamChanges > cancel while a getMore waits...`, `cancel of a database stream kills the cursor on $cmd.aggregate`, `a signal aborted between batches...`, `a cancel before the aggregate answers...`, `a failing killCursors does not hide the cancel`, `a failing getMore ends the stream...`, `decodes raw BSON batches losslessly...`; `watchHandlers > a stream cancel kills the server cursor...`, `closing the connection ends the stream CANCELLED...` | backend command | Pass |
| Handler wiring: only `admin.watch`, `NOT_CONNECTED`, `INTERNAL` without streaming server, cancelled request opens no stream, aggregate only after the response | `watchHandlers > serves exactly admin.watch`, `answers NOT_CONNECTED...`, `answers INTERNAL...`, `a cancelled request opens no stream`, `returns the stream id, and the stream sends each event as { event } canonical EJSON` | backend command | Pass |
| Sidebar: "Watch changes" on connection (only while connected), database, collection (disabled on views), read-only profiles allowed; `openWatch` tab id/title/detail/production/data, dedupe | `SidebarTree > watch changes > ...` (6), `SidebarTreeService > openWatch ...` (5) | renderer command | Pass |
| Watch tab ordering: stale stream events/errors after restart ignored; `docs.get` answers in reverse order (success and failure) keep the newest document; closing the panel while loading; load failure shown; lookup switch while stopped/back on; collapse; no profile -> no start | `WatchView > ignores events and errors of a stream replaced by a restart`, `opening documents in quick succession > ...` (4), `switching the lookup while stopped...`, `switching the lookup back on...`, `collapses an expanded event on a second click`, `does not start without a profile` | renderer command | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/admin/watch`

Result:

Pass (2 files, 45 tests, exit 0)

Command:

`cd packages/renderer && npx ng test --include='src/app/watch/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts'`

Result:

Pass (4 files, 243 tests, exit 0)

Command:

`npx vitest run --config test/integration/vitest.config.ts test/integration/change-streams.int.spec.ts`

Result:

Pass (7 tests, 2026-11-17 07:39:55-07:40:04 +01:00, Podman)

## Full test execution

Command:

`npm run check` (lint, type check, all unit tests)

Result:

Pass (exit 0; root vitest 93 files / 4816 tests, renderer 112 files / 3754 tests in the logged run)

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; run after the final test edits, exit 0)

## Bugs found

None. No production defect was found; no test fails.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured as a separate number. For the wholly new files (`watch.ts`,
`handlers.ts`, `watch-view.ts`, `watch.model.ts`) changed lines equal the whole file. For the
modified files, inspecting the provider's uncovered locations shows no uncovered statement or branch
in the added lines (`sidebar-tree.ts` 424-429, 467-471, 496-501; `sidebar-tree.service.ts` is 100%).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `change-streams`;
  base `a9dcfb7b7cfc684b2abbb11befe0e654f53623e4`; HEAD `91cbb5a4d16b36931757fdbf578669ea9398c30e`;
  commits 4fcdf4c3, 7673013e, 91cbb5a4 from the parent worker, matching `git log a9dcfb7b..HEAD`
  and the task's `touches`.
- Source/test snapshot identifier (including uncommitted inputs): sha256 of the files at measurement
  time: `watch.ts` 742e0fc6..., `handlers.ts` a25a437f..., `watch.spec.ts` 38749c42...,
  `handlers.spec.ts` (backend) 94245dcf..., `watch-view.ts` 79af91a3..., `watch.model.ts` af2b84eb...,
  `watch-view.spec.ts` 9af1891a..., `watch.model.spec.ts` e889ecb1..., `sidebar-tree.ts` d357367f...,
  `sidebar-tree.service.ts` 971da2f1..., `sidebar-tree.spec.ts` 3ad94719...,
  `sidebar-tree.service.spec.ts` 6125d638...; combined hash of the listing after the runs
  52880ce1... (unchanged during measurement).
- Exact included files; renamed/deleted/excluded files and reasons: included
  `packages/backend/src/admin/watch/watch.ts`, `packages/backend/src/admin/watch/handlers.ts`,
  `packages/renderer/src/app/watch/watch-view.ts`, `packages/renderer/src/app/watch/watch.model.ts`,
  `packages/renderer/src/app/sidebar/sidebar-tree.ts`, `packages/renderer/src/app/sidebar/sidebar-tree.service.ts`.
  Excluded: `admin/watch/index.ts`, `renderer/.../watch/index.ts`, `backend/src/index.ts` (re-export
  barrels, no behavior); `layout/workspace.service.ts` (type-only union member); `app.config.ts` and
  `backend/src/server/backend.ts` (one registration line each in large pre-existing files: whole-file
  numbers would describe unrelated code; the backend registration is exercised by the integration
  test through the real backend); `watch-view.html`/`.css` (template/style, exercised by the
  component tests); `docs/ARCHITECTURE.md` (docs); `test/integration/...` (test). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with v8
  (`@vitest/coverage-v8`). Backend, in `packages/backend`:
  `npx vitest run src/admin/watch --coverage --coverage.include='src/admin/watch/watch.ts' --coverage.include='src/admin/watch/handlers.ts' --coverage.reportsDirectory=coverage/change-streams-final --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text-summary`.
  Renderer, in `packages/renderer`:
  `npx ng test --include='src/app/watch/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts' --coverage --coverage-include='src/app/watch/watch-view.ts' --coverage-include='src/app/watch/watch.model.ts' --coverage-include='src/app/sidebar/sidebar-tree.ts' --coverage-include='src/app/sidebar/sidebar-tree.service.ts' --coverage-reporters=json-summary --coverage-reporters=json`.
- Run start/completion time and exit status: backend 2026-11-17 07:43:28-07:43:29 +01:00, exit 0
  (45 tests pass); renderer 07:43:36-07:43:48 +01:00, exit 0.
- Generated report paths and report hashes/run identifier (git-ignored):
  `packages/backend/coverage/change-streams-final/coverage-summary.json` sha256 41a4bcee...,
  `coverage-final.json` 88a1add3...; `packages/renderer/coverage/renderer/coverage-summary.json`
  sha256 c681a73c..., `coverage-final.json` 39b127b8...
- Evidence outputs are fresh and inputs stayed unchanged: backend into a new directory created by
  this run (07:43 mtimes); renderer report regenerated by the run (07:43 mtimes, hashes differ from
  the earlier 07:40 run); source/test hashes identical before and after.
- Final run after latest test additions and production fixes: yes (no production changes; last test
  edit preceded both runs).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/admin/watch/watch.ts` | 56/56 (100%) | 30/30 (100%) | 10/10 (100%) | 49/49 (100%) |
| `packages/backend/src/admin/watch/handlers.ts` | 12/12 (100%) | 2/2 (100%) | 5/5 (100%) | 10/10 (100%) |
| `packages/renderer/src/app/watch/watch-view.ts` | 109/113 (96.5%) | 61/70 (87.1%) | 29/29 (100%) | 93/93 (100%) |
| `packages/renderer/src/app/watch/watch.model.ts` | 61/62 (98.4%) | 73/81 (90.1%) | 12/12 (100%) | 48/49 (98.0%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 405/414 (97.8%) | 236/272 (86.8%) | 97/97 (100%) | 347/348 (99.7%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 245/245 (100%) | 117/117 (100%) | 70/70 (100%) | 198/198 (100%) |
| **Aggregate (summed counters, 6 measured files; exclusions listed above)** | 888/902 (98.4%) | 519/572 (90.7%) | 223/223 (100%) | 745/747 (99.7%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `watch-view.ts:143,148` (stale-subscription `return` in `complete`/`error`) | Late completion/error of a replaced stream | Defensive: an unsubscribed rxjs subscription never calls back; the observable behavior is covered by `ignores events and errors of a stream replaced by a restart`. Left uncovered. |
| `watch-view.ts:154` (`subscription.closed` true arm), `:137` (onStart of a replaced stream) | Synchronous settle during subscribe / start after replacement | `ApiService.stream` answers asynchronously; not reachable with the real service. Left uncovered. |
| `watch-view.ts:189` (non-openable entry), `:200` (aborted after a resolved `docs.get`) | Guard for events without `documentKey._id`; abort race | The template only offers "Open" for openable entries; an aborted request rejects (CANCELLED) and is covered via the catch path in the reverse-order tests. Left uncovered. |
| `watch-view.ts:94,98,102` (`''` arms of computed messages) | Empty-string fallbacks | Trivial. Left uncovered. |
| `watch.model.ts:73` (fallback when a value cannot be printed as shell syntax), branches 87-116 (alternative wallTime formats, invalid dates, non-array `removedFields`, truncation) | Robustness for malformed events | Low risk display fallbacks; existing `keeps an unreadable event as a row` covers the main fallback. Left uncovered. |
| `sidebar-tree.ts` 307, 335-371, 544-810 (36 branches, 9 statements) | Pre-existing sidebar code | Outside this task's change; the added watch menu entries have no uncovered location. |

## Unable to test

- Running the watch tab end-to-end in the browser/Electron against a real replica set was not
  done: neither acceptance criterion names an e2e run, and the criteria are covered by the
  integration test (backend) plus component tests (renderer notice). No follow-up required for the criteria.
- Automatic resume after failover is deliberately not implemented (recorded assumption), so it is not tested.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found.
