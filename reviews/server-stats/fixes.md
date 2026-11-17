# Fix Report

Date: 2026-11-17

Task: server-stats - M6 (Could): Server stats dashboard

Scope: current task; the findings approved by the parent worker: CR-1 and CR-2 from `reviews/server-stats/review.md`, TW-1 (the unused `formatRate` noted in `reviews/server-stats/tests.md`, "No production defects found" paragraph and coverage table).

## Fixed findings

### CR-1 — Recorded replSetGetStatus fixture is not what `admin.replSetStatus` returns

Files changed:
- `packages/renderer/src/app/admin/stats/fixtures/capture.mjs`
- `packages/renderer/src/app/admin/stats/fixtures/repl-set-status-8.2.json`

Problem:
`capture.mjs` saved the raw command replies, although its header says the fixtures are what `admin.serverStatus` / `admin.replSetStatus` return. The backend removes `$`-named fields (`withoutDollarFields` in `packages/backend/src/admin/stats/stats.ts`), so `repl-set-status-8.2.json` kept a top-level `$clusterTime` that the backend never sends.

Fix:
`capture.mjs` now has a `withoutDollarFields` that mirrors the backend one: it drops `$`-named keys at any depth, recursing only into arrays and plain objects, so BSON values such as `Timestamp` and `Long` stay unchanged. `save()` applies it to the BSON document before the canonical EJSON serialization. The header comment now says the output has no `$`-named fields. No containers were available to re-record, so the `$clusterTime` object was removed from `repl-set-status-8.2.json` by hand. A scan of all four fixtures for `"$name"` keys found that this was the only real `$`-named field. The rest are EJSON type wrappers (`$numberInt`, `$numberLong`, `$date`, `$timestamp`, `$oid`, and the `$binary` inside `$clusterTime`), and the script would produce those too. `operationTime` is not `$`-named, so it stays, as it does in the backend output. The `serverStatus` fixtures were already free of such fields because `trim` keeps only listed sections.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/admin/stats/**/*.spec.ts'` — Pass (3 files, 54 tests)
- `npm run check` — Pass

### CR-2 — `StatsChart.showPoint` claims keyboard support that does not exist

Files changed:
- `packages/renderer/src/app/admin/stats/stats-chart.ts`

Problem:
The doc comment said "also for keyboard/tests", but the chart has no keyboard handling. Only the specs call `showPoint`.

Fix:
The comment now says the method is called by tests and that mouse hover sets `hoverIndex` directly. No behavior change, and no keyboard support was added.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/admin/stats/**/*.spec.ts'` — Pass
- `npm run check` — Pass

### TW-1 — Unused `formatRate` in `ServerStatsView`

Files changed:
- `packages/renderer/src/app/admin/stats/server-stats-view.ts`

Problem:
The class and its template never used the protected member `formatRate`. It was dead code.

Fix:
Removed the member. `grep -rn formatRate packages/renderer/src` now finds nothing. `formatCount` is still imported and used.

Validation:
- `npm run check` (lint, `ngc` template type check, tests) — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/admin/stats/**/*.spec.ts'` — Pass, 3 files, 54 tests

Full test suite:
- `npm run check` from the repo root — Pass: eslint and `prettier --check`, all workspace type checks, vitest 93 files and 4875 tests, renderer `ng test` 114 files and 3801 tests

Lint/type-check/build:
- Part of `npm run check` — Pass. `npx prettier --write` on the four changed files left them unchanged.

`.taskcheck`:
- Not run separately. `.taskcheck` runs `npm run check`, which passed (see above).

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
