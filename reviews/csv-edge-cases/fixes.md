# Fix Report

Date: 2026-11-17

Task: csv-edge-cases — CSV edge cases: one-column blank rows, dates beyond year 9999, dotted field names; ARCHITECTURE.md io section

Scope: current task; findings CR-1 (reviews/csv-edge-cases/review.md) and TW-1 (reviews/csv-edge-cases/tests.md), reviewed at a27a8aa4 / 087d412e.

## Fixed findings

### CR-1 — A top-level dotted key whose value is a document is flattened into a column that reads nothing

Files changed:
- `packages/backend/src/io/csv/convert.ts`
- `packages/backend/src/io/csv/convert.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
`collectPaths` recursed into the non-empty document value of a top-level key containing a dot (`{"a.b": {c: 1}}` gave the column `a.b.c`). `valueAt` found no literal key `a.b.c` and walked `a` → `b` → `c`, so the cell was empty. With a colliding `a: {b: {c: 9}}`, the cell showed the nested 9 and the literal value was written nowhere. Reproduced before the fix.

Fix:
Added `!key.includes('.')` to the flatten condition in `collectPaths`. A key with a dot is never flattened: it is one column, written as Extended JSON when its value is a document, and `valueAt` reads it through its literal-key lookup. Updated the `collectPaths` doc comment and the dotted-field-name sentence in docs/ARCHITECTURE.md (Import/export, CSV export bullet) to match. New tests: `{"a.b": {c: 1}}` gives the single column `a.b` holding `{c: 1}`. With a colliding `a: {b: {c: 9}}`, the columns are `a.b` and `a` and both values are kept. The "loses no value of any document on export" test now includes both shapes.

Validation:
- `npx vitest run packages/backend/src/io` — Pass (7 files, 461 tests)

### TW-1 — Offset forms at the Date range limits refused

Files changed:
- `packages/backend/src/io/csv/convert.ts`
- `packages/backend/src/io/csv/convert.spec.ts`

Problem:
`date()` built the wall-clock time in a `Date` before applying the offset. When the wall-clock time was outside the Date range but the offset brought the instant back inside it (`-271821-04-19T23:00:00-01:00`, `+275760-09-13T01:00+01:00`), the intermediate Date was NaN and the input was refused.

Fix:
The parts are now checked directly, without a Date: month 1-12, day within the month (proleptic Gregorian leap years, negative years included), hour ≤ 23, minute and second ≤ 59, offset ≤ 23:59. The instant is then computed with plain arithmetic: a new private `daysFromCivil` (Hinnant's days-from-civil algorithm) plus the time and the offset. The values stay below 2^53, so the result is exact. Only results with |ms| > 8.64e15 are refused. `Date.UTC` would not work here, because it applies TimeClip and also returns NaN for wall-clock values outside the range. New tests: both inputs are accepted (giving `new Date(-8.64e15)` and `new Date(8.64e15)`). One ms beyond in the same offset form (`-271821-04-19T22:59:59.999-01:00`, `+275760-09-13T01:00:00.001+01:00`) is still refused. All earlier date tests (roll-over refusals, leap years in extended years, years 0-99 and negative years, range limits) pass unchanged. A throwaway differential probe (deleted afterwards, nothing committed) compared 200 000 random `Z` date-times in years -270000..270000, including invalid days, against the old `setUTCFullYear`/`setUTCHours` construction: 0 mismatches.

Validation:
- `npx vitest run packages/backend/src/io` — Pass (7 files, 461 tests)

## Not fixed

None.

## Validation summary

Focused tests:
- `npx vitest run packages/backend/src/io` — Pass (7 files, 461 tests)

Full test suite:
- `npm run check`: backend/shared 90 files, 4778 tests passed; renderer 107 files, 3598 tests passed — Pass

Lint/type-check/build:
- `npm run check` (eslint, prettier --check, typecheck): Pass. Prettier first flagged a line in convert.ts. I fixed it with `npx prettier --write` on the changed files, then re-ran the check.

`.taskcheck`:
- Not run directly (running the script needed approval). It runs `npm run check` (AGENTS.md), which passed.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
