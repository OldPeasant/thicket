# Test Report

Date: 2026-11-17

Task: change-streams - M6 (Could): Watch changes

Scope: `git diff ad1d789558b24b9260e53e38a53070f4b6d6ab3d..5182f3c97e6599fd0594dea8acc460107adcf9ff`
on `main`. The base was supplied by the parent worker; it is the claim commit, and HEAD comes after the
merges with main. This is a re-run. The previous report covered revision 1577c362. Since then, merge
resolutions with main changed these integration points:
- `packages/renderer/src/app/sidebar/sidebar-tree.ts` and `sidebar-tree.service.ts`
- `packages/renderer/src/app/layout/workspace.service.ts` (`TabKind`)
- `packages/renderer/src/app/app.config.ts`
- `packages/backend/src/server/backend.ts`
- `packages/backend/src/connections/manager.ts`

How task ownership was established: the range contains only change-streams commits (2572e941 through
f21a5584) and the merges of main into the task. `git diff --stat` of the range lists only task files
plus `docs/ARCHITECTURE.md`, `.gitignore`, `reviews/` and `tasks/`. The files under `reviews/` and
`tasks/` are not code.

Requirements:
- `tasks/change-streams.md`: acceptance criteria and recorded assumptions
- `SPEC.md` M6, and `docs/ARCHITECTURE.md` "Coverage"
- Parent worker instructions for this re-run, which say to focus on the merged integration points

## Test files changed

These test files are uncommitted. This run changed nothing else.
- `packages/backend/src/server/backend.spec.ts`
- `packages/renderer/src/app/app.spec.ts`
- `packages/renderer/src/app/watch/watch.model.spec.ts`

`reviews/change-streams/review.md` also shows as modified in the working tree. This run did not change
it; it is the code-reviewer's work, which ran at the same time.

## Tests added or updated

Count: 7 new tests. No existing test was changed or removed.

Merged integration points that had no test before:
- `startBackend: connections > serves admin.watch (change streams) next to the other admin handlers (merged wiring)`
  - Checks `...watchHandlers(connections)` in `backend.ts`. The test asserts that `admin.watch` is
    registered next to `admin.currentOp` and `admin.serverStatus`.
- `startBackend: connections > admin.watch is served and not guarded on a read-only profile (a read)`
  - Sends the call through a renderer port. The expected answer is NOT_CONNECTED, not READ_ONLY.
  - Without the wiring, rpc would answer UNSUPPORTED ("not implemented yet"), so this test catches a
    lost registration.
- `App > registers the change-stream view for the watch tab kind`
  - Checks `provideTabView('watch', WatchView)` in `app.config.ts`. Exactly one view is registered
    for `watch`, and it is `WatchView`.

Malformed or edge-case change events, from an external source (`watch.model.ts`):
- `reads a relaxed ISO wallTime; an unreadable one falls back to the cluster time, else null`
- `labels an _id that is not valid EJSON with its JSON text instead of failing`
- `summarises odd update descriptions without failing` (a non-array removedFields, non-string entries,
  and truncation at 200 characters)
- `an event with an _id but no collection cannot be opened`

These areas already had tests that stayed valid after the merge, so nothing was added:
- `sidebar-tree.service.spec.ts`: 5 `openWatch` tests (deployment, db, coll, re-select, unknown profile)
- `sidebar-tree.spec.ts`: 7 "watch changes" menu tests:
  - the connection menu entry, disabled while disconnected
  - the database menu entry next to GridFS
  - the collection menu entry, disabled on views
  - availability on read-only profiles
- `WorkspaceService`: `TabKind` only changes a type. The type check covers it, and the sidebar tests
  open real `watch` tabs.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: Integration test, insert/update/delete events received in order | `admin.watch on a replica set > receives insert, update and delete events of a collection in order` (+ db/pipeline, deployment, invalidate, cancel-on-close, invalid params, 3 cursor cleanup tests) | `npx vitest run --config test/integration/vitest.config.ts test/integration/change-streams.int.spec.ts` (Podman, mongo8rs replica-set fixture) | Pass (10/10) |
| AC2: Standalone shows a clear 'needs replica set' message (test) | Integration `admin.watch on a standalone server > refuses with a clear 'needs replica set' message`; renderer `WatchView > shows a clear 'needs replica set' message for a standalone server` | same integration command (mongo8 standalone fixture); `cd packages/renderer && npx ng test --watch=false --include='src/app/watch/**/*.spec.ts'` | Pass |
| Backend serves admin.watch after merge (backend.ts) | 2 new `startBackend` tests above; `src/admin/watch/handlers.spec.ts`, `watch.spec.ts` | `cd packages/backend && npx vitest run src/server/backend.spec.ts src/admin/watch` | Pass (117) |
| Watch tab view registered after merge (app.config.ts, TabKind) | `App > registers the change-stream view for the watch tab kind` | `cd packages/renderer && npx ng test --watch=false --include='src/app/watch/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts' --include='src/app/app.spec.ts' --include='src/app/layout/**/*.spec.ts'` | Pass (435, before the model tests were added) |
| Sidebar entries open the watch tab (sidebar-tree.ts/.service.ts after merge) | `SidebarTreeService openWatch *` (5), `SidebarTree > watch changes *` (7) | same | Pass |
| Live event list, open changed document, stop/restart, ordering | `WatchView` spec (23 tests, including reverse-order docs.get and stale stream after restart); watch.model spec (11 tests) | `npx ng test --watch=false --include='src/app/watch/**/*.spec.ts'` | Pass (33 after the additions) |

## Focused test execution

Commands:
- `cd packages/backend && npx vitest run src/server/backend.spec.ts src/admin/watch`: 3 files, 117 passed.
- `cd packages/renderer && npx ng test --watch=false --include='src/app/watch/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts' --include='src/app/app.spec.ts' --include='src/app/layout/**/*.spec.ts'`: 12 files, 435 passed.
- `cd packages/renderer && npx ng test --watch=false --include='src/app/watch/**/*.spec.ts'`, after the model tests were added: 2 files, 33 passed.
- `npx vitest run --config test/integration/vitest.config.ts test/integration/change-streams.int.spec.ts`: 1 file, 10 passed in 8.4 s, run twice. The fixtures run on Podman.

Result: Pass

## Full test execution

Command:

`sh .taskcheck` (= `npm run check`: `npm run lint && npm run typecheck && npm run test`)

Result:

Pass. Lint (eslint `--max-warnings 0` and prettier) and the type check of all workspaces passed. The
root vitest projects ran 99 files, 5217 tests, all passed. The renderer ran 121 files, 4051 tests, all
passed. The renderer stage only runs after the earlier `&&` stages succeed.

## .taskcheck

Result:

Pass (see above). It ran on the final test snapshot.

## Bugs found

None. No test failed against the production code.

## Coverage

Status: verified. Fresh runs with the configured provider; both commands passed every test.

Metric: whole-file coverage of task-changed production files.

Changed-line coverage: not measured by tooling, because the project has no changed-line reporter. A
manual check of the lcov output found no uncovered line or branch on the lines the task added to the
merged integration files:
- `backend.ts`: the import and line 151 `...watchHandlers(connections)`
- `sidebar-tree.ts`: lines 418-423, 478-482, 507-512
- `sidebar-tree.service.ts`: `openWatch`
- `app.config.ts`: line 36

Every uncovered location in those files is in pre-existing code.

Evidence:
- Task id: change-streams.
  - Immutable base: ad1d789558b24b9260e53e38a53070f4b6d6ab3d.
  - Measured HEAD: 5182f3c97e6599fd0594dea8acc460107adcf9ff.
  - Scope: `git diff --stat ad1d7895..HEAD`, as supplied by the parent.
- Source/test snapshot: HEAD 5182f3c9 plus 3 uncommitted test files. Their sha256 hashes:
  - `backend.spec.ts`: c79d79e7...e5b9e
  - `app.spec.ts`: d0c5faec...2bd04
  - `watch.model.spec.ts`: d53d5b17...0f4

  No production file is modified in the working tree.
- Included backend files (relative to `packages/backend`): `src/admin/watch/watch.ts`,
  `src/admin/watch/handlers.ts`, `src/admin/watch/index.ts`, `src/server/backend.ts`,
  `src/connections/manager.ts`, `src/index.ts`.
- Included renderer files (relative to `packages/renderer`): `src/app/watch/watch-view.ts`,
  `src/app/watch/watch.model.ts`, `src/app/watch/index.ts`, `src/app/sidebar/sidebar-tree.ts`,
  `src/app/sidebar/sidebar-tree.service.ts`, `src/app/app.config.ts`,
  `src/app/layout/workspace.service.ts`.
- Excluded: `*.spec.ts`, `watch-view.html`/`.css` (templates and styles; V8 does not instrument them),
  `test/integration/change-streams.int.spec.ts` (a test), `docs/ARCHITECTURE.md`, `.gitignore`,
  `reviews/`, `tasks/`. No files were renamed or deleted.
- Provider: `@vitest/coverage-v8` 5.1.0 (vitest 5.1.0).
- Backend run:
  - Command, from `packages/backend`: `npx vitest run --coverage --coverage.include='src/admin/watch/watch.ts' (one --coverage.include per backend file listed above)`.
  - It ran the full backend unit suite: 2349 passed. Start 08:35:38, exit 0.
  - Report: `packages/backend/coverage/coverage-summary.json`, sha256 5fd88286...c80fa.
  - It ran after the backend test additions; the backend files did not change afterwards.
- Renderer run:
  - Command, from `packages/renderer`: `npx ng test --watch=false --coverage --coverage-include='src/app/watch/watch-view.ts' (one --coverage-include per renderer file listed above)`.
  - It ran the full renderer suite. Started at about 08:39:20, after the snapshot at 08:39:18, and
    finished before 08:39:48. Exit 0.
  - Report: `packages/renderer/coverage/renderer/coverage-summary.json`, sha256 91194452...b4b63.
- Freshness: Vitest cleans the coverage directory before each run. The renderer coverage was re-run
  after the model tests were added; the earlier renderer run at 08:36 was replaced. `git status` showed
  the same set of modified files before and after the final run.
- Final run after the latest test additions: yes. No production fixes were made in this run.

Coverage is listed as covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/admin/watch/watch.ts` | 90/90 (100%) | 47/48 (97.91%) | 18/18 (100%) | 77/77 (100%) |
| `packages/backend/src/admin/watch/handlers.ts` | 12/12 (100%) | 2/2 (100%) | 5/5 (100%) | 10/10 (100%) |
| `packages/backend/src/admin/watch/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/server/backend.ts` | 58/63 (92.06%) | 16/18 (88.88%) | 19/24 (79.16%) | 55/58 (94.82%) |
| `packages/backend/src/connections/manager.ts` | 271/273 (99.26%) | 143/145 (98.62%) | 51/51 (100%) | 235/236 (99.57%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| **Backend aggregate (summed)** | 432/439 (98.40%) | 208/213 (97.65%) | 93/98 (94.89%) | 378/382 (98.95%) |
| `packages/renderer/src/app/watch/watch-view.ts` | 109/113 (96.46%) | 61/70 (87.14%) | 29/29 (100%) | 93/93 (100%) |
| `packages/renderer/src/app/watch/watch.model.ts` | 62/62 (100%) | 80/81 (98.76%) | 12/12 (100%) | 49/49 (100%) |
| `packages/renderer/src/app/watch/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 407/416 (97.83%) | 238/272 (87.5%) | 99/99 (100%) | 349/350 (99.71%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 251/251 (100%) | 121/121 (100%) | 72/72 (100%) | 204/204 (100%) |
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.36%) | 16/16 (100%) | 38/38 (100%) |
| **Renderer aggregate (summed)** | 885/898 (98.55%) | 537/582 (92.26%) | 228/228 (100%) | 734/735 (99.86%) |

The two aggregates come from separate runs and are not combined. The project defines no coverage
threshold. Every file in scope was measured; none is missing from the report.

Coverage change in this run:
- `watch.model.ts` went from 48/49 to 49/49 lines and from 73/81 to 80/81 branches.
- The backend wiring and the `watch` tab view registration are now asserted by tests.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `backend/src/admin/watch/watch.ts:130` (the `hasNext()` false branch) | Only for fake cursors without `tryNext`. The real driver cursor always takes the `tryNext` path, and integration tests cover that path. | No test, by justification: this is fallback code for test fakes. |
| `backend/src/server/backend.ts:56, 84, 90, 125, 159`, plus 5 anonymous functions | Pre-existing log adapters, a `connClose` branch and the gridfs dialog lambda. None of these lines were added by the task. | Out of task scope. The line the task added (151) is covered. |
| `backend/src/connections/manager.ts:367, 524-525` | Pre-existing connect and `configOf` paths. The task added only the optional `tryNext`/`setMaxTimeMS` interface members, which are not executable. | Out of task scope. |
| `renderer/src/app/watch/watch-view.ts:137, 143, 148` (the stale-subscription guards in onStart, complete and error) | Ordering: a replaced stream must not change the state. | Tested behaviorally: `ignores events and errors of a stream replaced by a restart`. These branches cannot be reached through `ThicketApi`, because RxJS does not call an observer after it unsubscribes. They are defensive code; no test was added. |
| `renderer/src/app/watch/watch-view.ts:200` (an aborted request that resolves) | Ordering: an older docs.get request that answers last. | Tested behaviorally: `shows the newest document when an older request answers last` and `a late failure of an older request...`. The API rejects an aborted request, so the resolved-while-aborted branch is defensive. |
| `renderer/src/app/watch/watch-view.ts:94, 98, 102, 154, 189` (fallback branches of computed signals; a subscription that closed synchronously; `id === null`) | Fallback values of computed signals and defensive guards. The template does not show "open" for entries that cannot be opened. | No test, by justification: these are not material. |
| `renderer/src/app/watch/watch.model.ts:116` (`?? {}` for an event that is valid JSON but not an object) | A malformed event. The "unreadable event" test covers the neighbouring path, where the text is not JSON at all. | No test, by justification: this is low risk and the row still renders. |
| `renderer/src/app/sidebar/sidebar-tree.ts` (1 line and 34 branches) | All of them are outside the task's watch menu entries (418-423, 478-482, 507-512). | Out of task scope. |
| `renderer/src/app/layout/workspace.service.ts:96` | Pre-existing code; the task changed only the `TabKind` type. | Out of task scope. |

## Unable to test

- The e2e browser flow for the watch tab was not run. The acceptance criteria do not name it, and the
  renderer component tests cover the UI.
- No automatic resume after a failover. This is by design, according to the recorded assumption, so
  there is nothing to test.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient, and no
production defects were found. The merged integration points are now covered by tests:
- the `admin.watch` registration in `backend.ts`;
- the `watch` view registration in `app.config.ts`;
- the sidebar entries and `openWatch`, which already had tests.

Both acceptance criteria were re-verified on this revision against the Podman replica-set and
standalone fixtures.
