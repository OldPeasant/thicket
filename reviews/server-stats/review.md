# Code Review

Date: 2026-11-17

Task: server-stats - M6 (Could): Server stats dashboard

Scope: re-review of the final code of task server-stats at revision b23468b382a7dbe5d2dd34297c182f2e684ed0c7, after the fixer resolved CR-1, CR-2 and TW-1 (`reviews/server-stats/fixes.md`). Full task diff `git diff 27adc3ab..b23468b3`, without `reviews/` and `tasks/` (33 files, 4592 insertions, 1 deletion). The fix commit b23468b3 and the commit ae53d546 (e2e, chart axis ticks, tile wrapping), which came after the first review, were read in detail. Committed changes only. One uncommitted test-writer change was in the working tree when the review ended. I read it and ran it, but it is not part of the reviewed revision (see "Commands run"). It was committed later as 2a34290d (see "Addendum: revision 2a34290d…"). The task was then rebased onto main after gridfs landed. The rebased revision e48cc2d6 is covered in "Addendum: revision e48cc2d6…".

Requirements:
- tasks/server-stats.md: goal, acceptance criteria 1 (integration test for the data methods) and 2 (component tests with recorded serverStatus fixtures), and the three recorded assumptions (admin.replSetStatus, dropped `$` fields, UI choices)
- SPEC.md M6 "Could" and the method groups
- docs/ARCHITECTURE.md: "Adding a method", "Server stats", and the sibling "Current operations" section
- AGENTS.md (evidence rules, no secrets in fixtures)
- Earlier review `reviews/server-stats/review.md` (findings CR-1 and CR-2) and `reviews/server-stats/fixes.md`

Git range:
- Branch: main
- HEAD: b23468b382a7dbe5d2dd34297c182f2e684ed0c7 (reviewed revision); test-only follow-up 2a34290dee7fff4f03fd29dc837f1647b39034b6 and the rebased revision e48cc2d641a802702124b300f6ad4b39bc7b7af5 also reviewed (see the addenda)
- Base/start: 27adc3abd4885ca9a8f0496a7abc21d3a21853d1; after the rebase c7d60256 (merge-base of e48cc2d6)
- Commits reviewed: 6 (5564d1da, ba0fd12e, ae53d546, 06eda52b, b23468b3, and the test-only 2a34290d), plus their 7 rebased counterparts 233102e3..e48cc2d6

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Earlier findings

- CR-1 (recorded replSetGetStatus fixture kept `$clusterTime`): resolved. `fixtures/capture.mjs` now has a `withoutDollarFields` that works like the backend's (`packages/backend/src/admin/stats/stats.ts`). It recurses only into arrays and plain objects, so BSON values such as `Timestamp` and `Long` are kept. `save()` applies it before canonical EJSON serialization. The header comment matches. The `$clusterTime` block was removed from `repl-set-status-8.2.json`, and `operationTime`, which the backend also keeps, is still there. A grep for `"$clusterTime"` and `"$regex"` in the fixtures finds nothing. The remaining `$` keys are EJSON type wrappers, which the backend's canonical output contains too.
- CR-2 (`StatsChart.showPoint` comment claimed keyboard support): resolved. The comment at `packages/renderer/src/app/admin/stats/stats-chart.ts:203` now says the method is called by tests and that mouse hover sets `hoverIndex` directly.
- TW-1 (unused `formatRate`): resolved. The member was removed from `server-stats-view.ts`. `formatCount` is still used.

## Commands run

- `cd packages/renderer && npx ng test --include='src/app/admin/stats/**/*.spec.ts'` -> 3 files, 56 tests passed. This run included one uncommitted test-writer change in `server-stats.model.spec.ts`: a new "recorded fixtures" block that checks that no fixture has `$`-named fields besides EJSON wrappers. That change is not part of revision b23468b3. The fixer reported 54 tests on the committed files.
- `npx vitest run packages/backend/src/admin/stats` -> 1 file, 11 tests passed.
- I did not re-run the integration and e2e suites (they need containers). The recorded evidence for criterion 1 (`npm run test:int -- server-stats` against testcontainers mongo:8.2 standalone and replica set -> 7 passed) matches the committed `test/integration/server-stats.int.spec.ts`. Criterion 2 also cites `npm run test:e2e -- server-stats` -> 1 passed, which matches the committed `test/e2e/server-stats.e2e.ts`.

## What was checked

- Contract: `admin.replSetStatus` (strict `{profileId}` params, nullable EJSON result) has valid and invalid samples in `index.spec.ts` and `methods.spec.ts`. It is a read, so it has no write-guard entry. The extra method is a recorded assumption.
- Backend: `statsHandlers` is wired in `startBackend` and exported. Both commands run on `admin` through `runCommand` and are wrapped in `abortable`, so they behave like currentop for NOT_CONNECTED and CANCELLED. Only NoReplicationEnabled (76) and CommandNotFound (59) map to `status: null`. Other errors stay SERVER_ERROR. `withoutDollarFields` does not touch BSON class instances.
- `ServerStatsView` async handling: a newer `refresh()` aborts the older one, and an aborted request returns before it writes any state. The next read is scheduled only after the answer, and only when the finished request is still the current one. An interval change during a request takes effect after that request. `serverStatus` failures keep the history and show `statusError`, and polling continues. `replSetStatus` failures are reported separately. `loadDatabases()` aborts the previous load and ignores stale results, and a failure of one `db.stats` affects only that row. On destroy, both requests are aborted and the timer is cleared. I found no out-of-order overwrite and no stuck loading state.
- Model: rates use the `uptimeMillis` difference. Counters that go back, or a different host, start the history over. Every field is read defensively in both canonical and relaxed EJSON. The history keeps 120 points.
- The changes in ae53d546 are CSS only (axis tick width, tile wrapping) plus the e2e test. The e2e test drives the real menu entry against a real mongod. It cleans up its own throwaway database and the load interval in `finally`.
- Wiring: the tab kind `serverstats`, `provideTabView`, the sidebar menu item (disabled while disconnected) and `openServerStats` (including the production flag) follow the currentop pattern and are tested. docs/ARCHITECTURE.md "Server stats" matches the implementation.
- Security: the feature runs read-only commands only, and the templates use no `innerHTML`. The fixtures contain container hostnames and nothing else sensitive. The all-zero cluster-time signature was removed with `$clusterTime`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found.

## Addendum: revision 2a34290dee7fff4f03fd29dc837f1647b39034b6

Revision 2a34290dee7fff4f03fd29dc837f1647b39034b6 is reviewed. Findings are unchanged: 0 P0, 0 P1, 0 P2, 0 P3.

- `git diff b23468b3..2a34290d -- packages/` changes only `packages/renderer/src/app/admin/stats/server-stats.model.spec.ts` (+54 lines, no deletions). The rest of commit 2a34290d changes only `reviews/server-stats/review.md` and `reviews/server-stats/tests.md`. No production code, fixture or configuration changed.
- The new "recorded fixtures" block is the same test change I read and ran before it was committed. It checks that the four recorded fixtures have no `$`-named fields other than canonical EJSON type wrappers, as `withoutDollarFields` guarantees for the backend answers. It also checks that `$clusterTime` is absent from the replSetGetStatus fixture and `operationTime` is present. A second test confirms the detector itself: it finds a `$`-named field next to normal fields and ignores EJSON wrappers. The block adds a regression test for CR-1 and does not weaken any existing test.
- `cd packages/renderer && npx ng test --include='src/app/admin/stats/**/*.spec.ts'` at 2a34290d -> 3 files, 56 tests passed.

## Addendum: revision e48cc2d641a802702124b300f6ad4b39bc7b7af5

Revision e48cc2d641a802702124b300f6ad4b39bc7b7af5 is reviewed. This is the task rebased onto main after gridfs landed (merge-base c7d60256, 7 task commits 233102e3..e48cc2d6). Findings are unchanged: 0 P0, 0 P1, 0 P2, 0 P3.

- Size: `git diff --stat c7d60256..e48cc2d6 -- packages/ test/ docs/` and `git diff --stat 27adc3ab..2a34290d -- packages/ test/ docs/` both report 33 files, 4646 insertions and 1 deletion.
- Task-owned files: `git diff 2a34290d e48cc2d6` is empty for `packages/renderer/src/app/admin/stats`, `packages/backend/src/admin/stats`, `test/e2e/server-stats.e2e.ts` and `test/integration/server-stats.int.spec.ts`. The rebase did not change the stats code, fixtures or tests.
- Shared files, read hunk by hunk in `git diff c7d60256..e48cc2d6`:
  - `packages/renderer/src/app/layout/workspace.service.ts`: the `TabKind` union now ends `| 'gridfs' | 'serverstats';`. Both kinds are kept, which matches the conflict resolution the coordinator described.
  - `packages/renderer/src/app/app.config.ts`: `provideTabView('serverstats', ServerStatsView)` sits next to the existing `provideTabView('gridfs', GridfsView)`, and both imports are present. Each kind has exactly one registration.
  - `packages/renderer/src/app/sidebar/sidebar-tree.service.ts`: the `serverStatsTabId` import sits next to the gridfs import, and `openServerStats` is unchanged.
  - `packages/renderer/src/app/sidebar/sidebar-tree.ts`: the "Server stats" item is still in the connection menu after "Current operations" and before "Create database…". Gridfs does not touch this menu block.
  - Backend (`index.ts`, `backend.ts`), contract (`admin.ts` and both spec sample tables) and the `docs/ARCHITECTURE.md` section: the same additions as before, at shifted line offsets only.
- `TabKind` is used only in `workspace.service.ts`, `layout/tab-views.ts` and `layout/app-shell.ts` (`viewFor`). There is no exhaustive map over the kinds that gridfs or this task would also need to update.
- `cd packages/renderer && npx ng test --include='src/app/admin/stats/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts' --include='src/app/app.spec.ts' --include='src/app/gridfs/**/*.spec.ts'` at e48cc2d6 -> 8 files, 334 tests passed. That covers the stats specs, the sidebar specs with the serverstats and gridfs menu and tab tests, the app view-registration spec and the gridfs specs.
- Integration and e2e were not re-run (they need containers). The stats test files are byte-identical to the ones the recorded evidence refers to.
