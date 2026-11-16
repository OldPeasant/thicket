# Fix Report

Date: 2026-11-16

Task: bson-display — M1: Explorer shows BSON types

Scope: current task; findings TW-2, TW-1 (reviews/bson-display/tests.md), CR-4 (reviews/bson-display/review.md) and parent finding P-1 (renderer bundle pulls CommonJS deps through the `@thicket/core` root), reviewed at HEAD 7a78160.

## Fixed findings

### TW-2 — formatDate throws RangeError for dates near the JS date limits in local time

Files changed:
- `packages/renderer/src/app/explorer/bson-value.util.ts`

Problem:
For dates within a zone offset of the JS date limits (for example 8640000000000000 ms in Europe/Zurich), the zone's wall clock lies outside the JS date range. `zoneOffsetMs` then returns NaN, the `Math.abs(local) > limit` guard is false for NaN, and `new Date(NaN).toISOString()` throws `RangeError`, which stops the explorer from rendering.

Fix:
The guard now also falls back to the UTC ISO string when the local time is not finite: `if (!Number.isFinite(local) || Math.abs(local) > Number(DATE_LIMIT_MS)) return new Date(t).toISOString();`. `t` itself is always inside the JS range at that point, so the fallback cannot throw.

Validation:
- `cd packages/renderer && npx ng test` — Pass (the 3 TW-2 tests in `bson-value.util.spec.ts` and `bson-display.spec.ts > renders a date at the upper JS date limit in local time` pass)

### TW-1 — badgeColorVar('javascriptWithScope') names an undefined token

Files changed:
- `packages/renderer/src/app/explorer/bson-value.util.ts`

Problem:
`badgeColorVar('javascriptWithScope')` returned `var(--bson-javascript-with-scope)`, which `tokens.css` does not define in any theme, so the Code w/ scope badge had no color.

Fix:
`javascriptWithScope` maps to the existing `--bson-javascript` token (defined in every theme), like `binary` maps to `bin-data`. Doc comment updated.

Validation:
- `cd packages/renderer && npx ng test` — Pass (`badgeColorVar > only names tokens every theme defines`)

### CR-4 — A new Intl.DateTimeFormat is built for every date on every render and search

Files changed:
- `packages/renderer/src/app/explorer/bson-value.util.ts`

Problem:
`formatDate` resolved the system zone with a new `Intl.DateTimeFormat()` and `zoneOffsetMs` built a new formatter for every date display and search check.

Fix:
The system zone is resolved once (`systemTimeZone()`), and the wall-clock formatters are cached per time zone in a module-level `Map` (`zoneFormat()`). Output is unchanged.

Validation:
- `cd packages/renderer && npx ng test` — Pass (all existing date display tests, including the UTC toggle and zone tests, unchanged and passing)

### P-1 — Renderer bundle pulls CommonJS mongodb-connection-string-url/whatwg-url via the @thicket/core root

Files changed:
- `packages/core/package.json`
- `packages/renderer/src/app/explorer/bson-value.util.ts`
- `packages/renderer/src/app/explorer/bson-value.util.spec.ts`
- `packages/renderer/src/app/explorer/bson-display.spec.ts`

Problem:
The renderer imported `@thicket/core`, whose root also re-exports the connection-string code, so `npx ng build` bundled the CommonJS `whatwg-url` and warned.

Fix:
Added the subpath export `"./bson": "./src/bson/index.ts"` to `@thicket/core`. The renderer's production code (`bson-value.util.ts`, the only renderer file importing the core root) and the two specs now import from `@thicket/core/bson`. No other renderer file imported the root.

Validation:
- `cd packages/renderer && npx ng build` — Pass, no CommonJS/whatwg-url warning (initial 707.59 kB raw)
- `grep -rn "@thicket/core'" packages/renderer/src` — no matches

## Not fixed

### CR-1 — Field order of documents in the explorer tree

Status:
Out of scope

Reason:
Deferred by the parent worker to the bson-inputs task.

### CR-3 — fromExplorerValue

Status:
Requires decision

Reason:
The parent worker decided to keep `fromExplorerValue`; no change requested.

### CR-2 — Edit-mode coverage

Status:
Invalid

Reason:
Already covered by the test-writer's edit-mode tests; no code change needed.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test` — Pass, 32 files, 567 tests passed (previously 4 failing: TW-1/TW-2)

Full test suite:
- `npm run check` (root) — Pass: eslint and prettier --check pass, typecheck (core, backend, renderer app + spec) passes, vitest 42 files / 2533 tests passed, renderer `ng test` 32 files / 567 tests passed

Lint/type-check/build:
- included in `npm run check` — Pass
- `cd packages/renderer && npx ng build` — Pass, no whatwg-url warning

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check`, run directly as above)

Remaining unresolved findings:
0 (CR-1, CR-3 and CR-2 are dispositioned by the parent worker as not to fix)

## Final status

All validated findings fixed and validation passed.
