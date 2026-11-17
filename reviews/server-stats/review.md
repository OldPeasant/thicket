# Code Review

Date: 2026-11-17

Task: server-stats - M6 (Could): Server stats dashboard

Scope: re-review of the final code of task server-stats at revision b23468b382a7dbe5d2dd34297c182f2e684ed0c7, after the fixer resolved CR-1, CR-2 and TW-1 (`reviews/server-stats/fixes.md`). Full task diff `git diff 27adc3ab..b23468b3`, without `reviews/` and `tasks/` (33 files, 4592 insertions, 1 deletion). The fix commit b23468b3 and the commit ae53d546 (e2e, chart axis ticks, tile wrapping), which came after the first review, were read in detail. Committed changes only. One uncommitted test-writer change was in the working tree when the review ended. I read it and ran it, but it is not part of the reviewed revision (see "Commands run").

Requirements:
- tasks/server-stats.md: goal, acceptance criteria 1 (integration test for the data methods) and 2 (component tests with recorded serverStatus fixtures), and the three recorded assumptions (admin.replSetStatus, dropped `$` fields, UI choices)
- SPEC.md M6 "Could" and the method groups
- docs/ARCHITECTURE.md: "Adding a method", "Server stats", and the sibling "Current operations" section
- AGENTS.md (evidence rules, no secrets in fixtures)
- Earlier review `reviews/server-stats/review.md` (findings CR-1 and CR-2) and `reviews/server-stats/fixes.md`

Git range:
- Branch: main
- HEAD: b23468b382a7dbe5d2dd34297c182f2e684ed0c7 (reviewed revision)
- Base/start: 27adc3abd4885ca9a8f0496a7abc21d3a21853d1
- Commits reviewed: 5 (5564d1da, ba0fd12e, ae53d546, 06eda52b, b23468b3)

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
