# Code Review

Date: 2026-11-17

Task: server-stats - M6 (Could): Server stats dashboard

Scope: committed changes of task server-stats, `git diff d8fd865d..458bcd41` (the three task commits; the parent named them 69817aba, 859b2637, e807c1c4 on base 3df54d9b, and they were rebased onto main during the review with an identical 30-file, 4198-insertion diff). Uncommitted test edits in the working tree, made by the test-writer at the same time, are not part of this review.

Requirements:
- tasks/server-stats.md: goal, acceptance criteria 1 and 2, and the three recorded assumptions (admin.replSetStatus, dropped `$` fields, UI choices)
- SPEC.md section 4 (method groups) and M6 "Could"
- docs/ARCHITECTURE.md: "Adding a method", "Server stats", and the sibling "Current operations" section
- AGENTS.md (evidence rules, no secrets in fixtures)
- Sibling feature for comparison: packages/backend/src/admin/currentop, packages/renderer/src/app/admin/currentop

Git range:
- Branch: main
- HEAD: 458bcd411b365af4990050c9cee2eaa4032d044d
- Base/start: d8fd865deb93fee6989a288e82d09e9af61e064b (merge-base with origin/main; was 3df54d9b before the rebase)
- Commits reviewed: 3

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## Commands run

- `npx vitest run packages/backend/src/admin/stats packages/contract` -> 6 files, 859 tests passed
- `cd packages/renderer && npx ng test --include='src/app/admin/stats/**/*.spec.ts'` -> 2 files, 38 tests passed
- Integration and e2e suites were not re-run by the reviewer (they need containers). The recorded evidence for criterion 1 (`npm run test:int -- server-stats` against testcontainers mongo:8.2 standalone and replica set -> 7 passed) matches the committed `test/integration/server-stats.int.spec.ts`.

## What was checked

- Contract: `admin.replSetStatus` added to `packages/contract/src/admin.ts` with strict params and a nullable EJSON result. Valid and invalid samples were added to `index.spec.ts` and `methods.spec.ts`, as "Adding a method" requires. It is a read, so it has no `EXPECTED_WRITES` entry. The SPEC table does not list every exact signature ("exact signatures are written in the contract task"), and the extra method is a recorded assumption.
- Backend: `statsHandlers` is wired in `startBackend` and exported from the package index. Both commands run on `admin` through `runCommand` (the primary, like currentop) and are wrapped in `abortable`, so they return CANCELLED and NOT_CONNECTED the same way currentop does. `withoutDollarFields` recurses only into plain objects and arrays, so BSON values pass through unchanged. Only NoReplicationEnabled (76) and CommandNotFound (59) map to `null`; other refusals become SERVER_ERROR. The unit tests cover all of these paths.
- Integration test (criterion 1): runs through `serve()` with contract validation against a real standalone and a real replica set. It covers serverStatus fields and growing counters, replSetStatus `null` vs members, the repl section, db.stats and NOT_CONNECTED.
- Component tests (criterion 2): `server-stats-view.spec.ts` and `server-stats.model.spec.ts` import the recorded mongo:8.2 fixtures (`fixtures/*.json`, produced by `capture.mjs`). They check rates, tiles, tooltip, restart reset, replica set members, lag and health, error isolation, dbStats, Reload, the interval timer and stopping on destroy.
- Async and state handling in `ServerStatsView`: a newer `refresh()` aborts the previous request, and an aborted request returns before it writes any state. The next read is scheduled only after the answer, and only when `this.request === request`. Changing the interval while a request runs takes effect when it finishes. Failures set `statusError` and keep the history, and polling continues so the view recovers. `loadDatabases()` aborts an earlier load and ignores stale results. On destroy, both requests are aborted and the timer is cleared. I found no out-of-order overwrite and no stuck loading state.
- Model: rates use the `uptimeMillis` difference. Counters that go back, or a change of host, start the history over. Every field is read defensively (`ejsonNumber` and `ejsonDate` accept both canonical and relaxed EJSON). History is capped at 120 points.
- Wiring: tab kind `serverstats`, `provideTabView`, the sidebar menu item (disabled while disconnected) and `openServerStats` with the production flag all match the currentop pattern. Their tests are in `sidebar-tree.service.spec.ts`.
- Security: read-only commands only. The template uses no `innerHTML`. Fixtures contain container hostnames and an all-zero cluster-time signature from an unauthenticated local server, with no credentials or personal data. The e2e test uses its own throwaway database.
- docs/ARCHITECTURE.md "Server stats" matches the implementation.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Recorded replSetGetStatus fixture is not what `admin.replSetStatus` returns**
    - File: `packages/renderer/src/app/admin/stats/fixtures/capture.mjs:6` (the fixture is `packages/renderer/src/app/admin/stats/fixtures/repl-set-status-8.2.json:271`)
    - Category: Tests
    - Problem: The header of `capture.mjs` says it writes canonical EJSON "as `admin.serverStatus` / `admin.replSetStatus` return it". However, it saves the raw `replSetGetStatus` reply without the backend's `withoutDollarFields` step, so `repl-set-status-8.2.json` keeps a top-level `$clusterTime` object. The backend always removes that field (`packages/backend/src/admin/stats/stats.ts`, `replSetStatus`). The renderer reads the fixture with `JSON.parse`, so the tests pass today. But the "recorded" fixture is not the real contract output, and the comment says it is.
    - Why it matters: Component tests are meant to run on realistic backend answers (criterion 2). A fixture that differs from what the backend sends can hide or invent behavior. For example, a future parser that uses EJSON would fail on `$clusterTime`, the very problem the backend avoids.
    - Suggested fix: In `capture.mjs`, remove `$`-named fields the same way the backend does before saving (at least for the replSetGetStatus document), then re-record or edit the fixture. Alternatively, correct the header comment.

- [ ] **CR-2 | `StatsChart.showPoint` claims keyboard support that does not exist**
    - File: `packages/renderer/src/app/admin/stats/stats-chart.ts:203`
    - Category: Quality
    - Problem: The doc comment says "also for keyboard/tests". The chart SVG has no `tabindex` and no key handler, and nothing besides the specs calls `showPoint`. The hover tooltip works with a mouse only.
    - Why it matters: The comment misleads maintainers into thinking keyboard access exists. The per-point tooltip values are not available from the keyboard. Only the latest values are, through the legend and `aria-label`.
    - Suggested fix: Change the comment to say the method is for tests. If keyboard access is wanted, make the SVG focusable and map arrow keys to `showPoint`.

## Review conclusion

No material issues found.
