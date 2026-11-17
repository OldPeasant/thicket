# Test Report

Date: 2026-11-17

Task: change-streams - M6 (Could): Watch changes

Scope: `git diff e0c5399eb4626056de8746d47a1ed811c95cad96..8b6b6966825bc17e0e8e1f4a1003bac43db396cd` on
branch `main` (task commits d1e63bcc, 810ef00c, b7c8e438, 90daa343, 8b6b6966, as given by the parent
worker and confirmed with `git log e0c5399e..HEAD`), plus the two uncommitted test files listed
below. This is a re-run after the fixes for review findings CR-1/CR-2 (commit 8b6b6966). It focuses on
the changed driver-cursor path in `packages/backend/src/admin/watch/watch.ts` and the optional
`CursorLike` members in `packages/backend/src/connections/manager.ts`. Behaviour that was already
tested is re-validated, not retested.

Requirements:
- `tasks/change-streams.md` acceptance criteria and recorded assumptions (raw `$changeStream` +
  getMore loop on the primary, no auto-resume; standalone refused via `hello` with `UNSUPPORTED` /
  `{ reason: 'needsReplicaSet' }`; "open document" via `docs.get`)
- `reviews/change-streams/review.md` CR-1 (getMore/killCursors pinned to the opening server) and CR-2
  (cancel during the opening aggregate leaves no cursor), `reviews/change-streams/fixes.md`
- `SPEC.md` M6, `docs/ARCHITECTURE.md` "Watch changes" and "Coverage"
- Parent worker instructions for this run

## Test files changed

- `packages/backend/src/admin/watch/watch.spec.ts` (extended, uncommitted)
- `test/integration/change-streams.int.spec.ts` (extended, uncommitted)

## Tests added or updated

Count: 3 new tests. No existing test was changed or removed.

- `streamChanges with a driver cursor (runCursorCommand) > a send that throws ends the stream with that error and closes the cursor` (unit)
- `streamChanges with a driver cursor (runCursorCommand) > keeps going over empty rounds (no events yet) until events arrive` (unit)
- `streamChanges cursor cleanup on a replica set > runs getMores and the kill through the cursor the aggregate opened, waiting WATCH_AWAIT_MS per round` (integration, real driver on `mongo8rs`). It uses command monitoring to check the following:
  - exactly one `aggregate` is sent;
  - every `getMore` continues that one cursor id on the test's dedicated `killed_*` collection, carries `maxTimeMS: 1000` and goes to the aggregate's server address;
  - an idle stream does not end on empty batches and does not spin: over a 2.5 s idle window it sends at most ceil(idle/1000)+1 getMores;
  - an event inserted after the idle rounds is still delivered;
  - the cancel sends exactly one `killCursors` for that cursor id, on the same address, and the server then holds no cursors.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: insert/update/delete events received in order (integration, real replica set) | `admin.watch on a replica set > receives insert, update and delete events of a collection in order` (+ database/pipeline, deployment, invalidate on drop, connection close, invalid params) | `npx vitest run --config test/integration/vitest.config.ts test/integration/change-streams.int.spec.ts` (repo root, Podman fixtures `mongo8rs`/`mongo8`) | Pass (10/10, 3 consecutive runs 08:06-08:07) |
| AC1 (unit): batches delivered in order through the driver cursor, including after empty rounds; ends on a closed cursor (invalidate) | `streamChanges with a driver cursor > runs the stream as one pinned raw cursor ... in order`, `keeps going over empty rounds ...`, plus the plain-command suite `streamChanges > sends the first batch and each getMore batch in server order ...` | `cd packages/backend && npx vitest run src/admin/watch` | Pass (2 files, 59 tests) |
| AC2: standalone server shows a clear 'needs replica set' message | integration `admin.watch on a standalone server > refuses with a clear 'needs replica set' message`; unit `assertWatchable > refuses a standalone ...`, `streamChanges with a driver cursor > maps the server's $changeStream refusal to UNSUPPORTED needsReplicaSet`; renderer `WatchView > shows a clear 'needs replica set' message for a standalone server` | integration and backend commands above; renderer: `cd packages/renderer && npx ng test --include='src/app/watch/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts'` | Pass |
| CR-1: getMores and the kill go through the cursor the aggregate opened (pinned), each getMore waits `WATCH_AWAIT_MS` | new integration `runs getMores and the kill through the cursor the aggregate opened ...`; unit `runs the stream as one pinned raw cursor ...` (exactly one `runCursorCommand` with `{ raw: true }`, no separate commands) | integration + backend commands | Pass |
| CR-2: cancel during the opening aggregate / during a getMore leaves no server cursor | integration `kills the cursor after a cancel while a getMore waits`, `kills the cursor after a cancel while the opening aggregate is in flight`; unit `cancel while a getMore waits ...`, `a cancel while the opening aggregate is in flight closes the cursor once it opened`, `a cancelled round that then fails still closes the cursor` | integration + backend commands | Pass |
| Cursor closed on every other exit: server error, failing getMore, failing close, throwing `send`, abort between rounds | unit `maps the server's $changeStream refusal ...`, `a failing getMore ends the stream with the mapped error and closes the cursor`, `a failing close does not hide the result`, `a send that throws ...` (new), `a signal aborted between rounds ...` | backend command | Pass |
| Handler wiring, sidebar entries, watch tab state (unchanged since the previous report) | `handlers.spec.ts` (11), renderer watch/sidebar specs | backend + renderer commands | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/admin/watch`

Result:

Pass (2 files, 59 tests, 08:06)

Command:

`npx vitest run --config test/integration/vitest.config.ts test/integration/change-streams.int.spec.ts` (repo root, Podman)

Result:

Pass (10 tests; 3 consecutive runs after the final test edit, at 08:06:32, 08:06:52 and 08:07:08, all 10/10).
The first run of the new integration test failed because of a test bug: it read the cursor id from
the `commandSucceeded` reply, which is not a plain document for a raw cursor. I fixed the test to
take the id from the first `getMore`. No production problem was involved.

Command:

`cd packages/renderer && npx ng test --include='src/app/watch/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts'` (run with coverage, see below)

Result:

Pass (4 files, 243 tests)

`npx prettier --check` and `npx eslint` on both changed test files: Pass.

## Full test execution

Command:

`npm run check` (repo root: eslint, prettier, tsc for all workspaces, root vitest, renderer `ng test`)

Result:

Pass (completed 08:12; root vitest 94 files / 4915 tests, renderer 113 files / 3779 tests; the
`&&` chain ran to the end and the tool reported no error)

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` when `package.json` exists, and the run above passed. Running
`sh .taskcheck` directly needed sandbox approval, so the equivalent command was run instead.

## Bugs found

None. No production defect found; no test fails.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: `watch.ts` and `handlers.ts` are new in this task, so their changed lines are
the whole file (`watch.ts` lines 77/77). The `manager.ts` change adds only optional interface
members, so it has no executable lines. The renderer files are unchanged since the previous run.
The earlier report found no uncovered location in their added lines; that inspection still holds
because the reports are identical (same hashes). No separate changed-line tool was run.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `change-streams`;
  base `e0c5399eb4626056de8746d47a1ed811c95cad96`; HEAD `8b6b6966825bc17e0e8e1f4a1003bac43db396cd`;
  commits d1e63bcc, 810ef00c, b7c8e438, 90daa343, 8b6b6966 from the parent, matching
  `git log e0c5399e..HEAD` and the task's `touches`.
- Source/test snapshot identifier (including uncommitted inputs): sha256 identical before and after
  all runs: `watch.ts` 8133e9ea8a13..., `handlers.ts` a25a437f4f72..., `manager.ts` 1012982831d5...,
  `watch.spec.ts` (uncommitted) b8a23ffcd7ad..., `handlers.spec.ts` 94245dcf7a64...,
  `change-streams.int.spec.ts` (uncommitted) 301ec7b805cf.... Renderer sources are unchanged at HEAD.
  `git status`: only the two test files are modified.
- Exact included files:
  - `packages/backend/src/admin/watch/watch.ts`
  - `packages/backend/src/admin/watch/handlers.ts`
  - `packages/renderer/src/app/watch/watch-view.ts`
  - `packages/renderer/src/app/watch/watch.model.ts`
  - `packages/renderer/src/app/sidebar/sidebar-tree.ts`
  - `packages/renderer/src/app/sidebar/sidebar-tree.service.ts`
- Excluded files and reasons:
  - `connections/manager.ts`: type-only change, no executable code;
  - the `index.ts` barrels: re-exports only;
  - `backend.ts` and `app.config.ts`: one registration line each in large pre-existing files; the backend registration is exercised by the integration test;
  - `workspace.service.ts`: type union member;
  - `watch-view.html`/`.css`: template and styles;
  - docs and tests.
  - No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with
  `@vitest/coverage-v8`. Backend in `packages/backend`:
  `npx vitest run src/admin/watch --coverage --coverage.include='src/admin/watch/watch.ts' --coverage.include='src/admin/watch/handlers.ts' --coverage.reportsDirectory=coverage/change-streams-r3 --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text`.
  Renderer in `packages/renderer`:
  `npx ng test --include='src/app/watch/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts' --coverage --coverage-include='src/app/watch/watch-view.ts' --coverage-include='src/app/watch/watch.model.ts' --coverage-include='src/app/sidebar/sidebar-tree.ts' --coverage-include='src/app/sidebar/sidebar-tree.service.ts' --coverage-reporters=json-summary --coverage-reporters=json`.
  Unit tests only: the integration run is not instrumented, because the project's coverage setup covers the workspace unit runs.
- Run start/completion time and exit status: backend 08:07:35-08:07:37 +01:00, 59 tests pass, exit 0;
  renderer 08:12:43-08:12:58 +01:00, 243 tests pass, exit 0.
- Generated report paths and report hashes (git-ignored):
  - `packages/backend/coverage/change-streams-r3/coverage-summary.json` sha256 8e9dce694925...
  - `packages/backend/coverage/change-streams-r3/coverage-final.json` afdad5388...
  - `packages/renderer/coverage/renderer/coverage-summary.json` c681a73cd85e...
  - `packages/renderer/coverage/renderer/coverage-final.json` 39b127b8885f...
  - The renderer reports are byte-identical to the previous run's, as expected for unchanged code and tests.
- Evidence outputs are fresh and inputs stayed unchanged: the backend report went into a new directory
  created by this run (08:07 mtimes). The renderer report was rewritten by this run (08:12:58 mtimes).
  The input hashes were the same before and after.
- Final run after latest test additions and production fixes: yes. The fix commit 8b6b6966 and the
  last test edit both came before these runs.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/admin/watch/watch.ts` | 90/90 (100%) | 47/48 (97.9%) | 18/18 (100%) | 77/77 (100%) |
| `packages/backend/src/admin/watch/handlers.ts` | 12/12 (100%) | 2/2 (100%) | 5/5 (100%) | 10/10 (100%) |
| `packages/renderer/src/app/watch/watch-view.ts` | 109/113 (96.5%) | 61/70 (87.1%) | 29/29 (100%) | 93/93 (100%) |
| `packages/renderer/src/app/watch/watch.model.ts` | 61/62 (98.4%) | 73/81 (90.1%) | 12/12 (100%) | 48/49 (98.0%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 405/414 (97.8%) | 236/272 (86.8%) | 97/97 (100%) | 347/348 (99.7%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 245/245 (100%) | 117/117 (100%) | 70/70 (100%) | 198/198 (100%) |
| **Aggregate (summed counters, 6 measured files; exclusions listed above)** | 922/936 (98.5%) | 536/590 (90.8%) | 231/231 (100%) | 773/775 (99.7%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `watch.ts:130` (false arm of `hasNext()` in the fake-only fallback for cursors without `tryNext`) | None for the product: the real driver cursor always has `tryNext`, and that path (including empty rounds) is covered by unit and integration tests | Left uncovered: this is test-fake glue, not production behaviour. |
| `watch-view.ts:137,143,148,154,189,200,94,98,102`; `watch.model.ts:73` and branches 87-116 | Defensive stale-subscription guards, unreachable synchronous settle, empty-string fallbacks, display fallbacks for malformed events | Unchanged since the previous report; justified there. The observable behaviour is covered by the component tests. Left uncovered. |
| `sidebar-tree.ts` 307, 335-371, 544-810 | Pre-existing sidebar code | Outside this task's change; the added watch menu entries have no uncovered location. |

## Unable to test

- Pinning on a sharded cluster with several mongos, or in load-balanced mode (the actual CR-1
  scenario): there is no such fixture. The integration test checks the mechanism on the replica set:
  every getMore and the kill continue the aggregate's cursor id through the driver cursor, on the
  same server address. The driver's `RunCommandCursor` pins later operations to the server that
  answered (`getMore` uses `this.server`). Follow-up is only needed if a sharded or load-balanced
  fixture is added.
- Browser/Electron end-to-end run of the watch tab: neither criterion names one (unchanged from the
  previous report).
- Automatic resume after failover: deliberately not implemented (recorded assumption).

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found.
