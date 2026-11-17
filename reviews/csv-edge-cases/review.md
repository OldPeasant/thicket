# Code Review

Date: 2026-11-17

Task: csv-edge-cases - CSV edge cases: one-column blank rows, dates beyond year 9999, dotted field names; ARCHITECTURE.md io section

Scope: `git diff ad4dde00..3dae8b2f`, committed changes only. This is the second review, of the final code: the task commit a27a8aa4, the test commit 087d412e and the fix commit 3dae8b2f. Production files: packages/backend/src/io/csv/convert.ts and packages/backend/src/io/csv/csv.ts. Tests: convert.spec.ts, csv.spec.ts and packages/backend/src/io/export.spec.ts. Docs: docs/ARCHITECTURE.md. The review also checked that the fixes for CR-1 (first review) and TW-1 (reviews/csv-edge-cases/tests.md), described in reviews/csv-edge-cases/fixes.md, are correct. An uncommitted change to convert.spec.ts by a concurrent test-writer is outside this scope.

Requirements:
- tasks/csv-edge-cases.md: four acceptance criteria and two recorded assumptions (dotted field names in CSV export; `±YYYYYY` extended years in the CSV `date` type)
- reviews/io-advanced/review.md CR-1..CR-4 (the deferred findings this task fixes)
- SPEC.md, docs/ARCHITECTURE.md, AGENTS.md
- Parent instructions: second review of the committed code at 3dae8b2f, including the fixes and docs/ARCHITECTURE.md

Git range:
- Branch: main
- HEAD: 3dae8b2f1b49f4e640bcb7c6d7ccbed329875216
- Base/start: ad4dde008e42b8df74f6b9f004ceb4067611ef01
- Commits reviewed: 3

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Verification of the fixes

- **CR-1 (a top-level dotted key holding a document lost its value): fixed.** `collectPaths` now has `!key.includes('.')` in the flatten condition (convert.ts:47). As a result, `{"a.b": {c: 1}}` gives the single column `a.b`, holding `{"c":1}`. With a colliding `a: {b: {c: 9}}`, the columns are `a.b` and `a`, and both values are written. Other shapes I probed also keep their values: `{".": 1, "a.": {b: 2}}` and `{x: {y: {"z.w": 1}}}` (the latter as column `x.y`). The doc comment and the ARCHITECTURE sentence now match the behavior. New tests cover both reported shapes, and the "loses no value" test includes them.
- **TW-1 (offset forms at the Date range limits refused): fixed.** `date()` now validates the parts directly: month, days per month with proleptic Gregorian leap years (negative years included, since `-0 === 0`), hour, minute, second and offset. It then computes the instant arithmetically with `daysFromCivil` and refuses `|ms| > 8.64e15`. Near the limit every intermediate value is an exact integer, because 8.64e15 < 2^53. Values far beyond the limit (6-digit years up to 999999) can exceed 2^53, but they are well over 8.64e15 and are refused anyway, so the comment "Exact: |ms| < 2^53" only describes the accepted range.

## Verification of the acceptance criteria

- **1. One-column export of an empty value round-trips:** met. `csvLine([''])` writes `""\n` (csv.ts:167), and `CsvScanner` reads it as one empty cell. Tests: csv.spec.ts (scanner round trip), and export.spec.ts with empty, null and missing values, a named dotted column, and collected columns, imported back with the row count kept.
- **2. Dates outside years 0000-9999:** met. `ISO_DATE` accepts `[+-]\d{6}` and refuses `-000000`. The export writes `toISOString()`, and that output parses back to the same instant (see the probe below). Tests cover years 10000, -1, 0, ±8.64e15, values one ms beyond the limit, extended-year leap days, offsets on extended years, and the export + import round trip.
- **3. Field names containing a dot:** met. Top-level dotted keys are their own column, with document values written as one Extended JSON column. Colliding top-level documents and nested documents that hold dotted keys are written whole. The behavior is documented in the `collectPaths` comment, in docs/ARCHITECTURE.md and in the task assumption, and the tests cover it.
- **4. ARCHITECTURE io section:** met. The `UNSUPPORTED` wording is gone. The new CSV export, CSV import and BSON bullets match the code, as already checked in the first review; the only change since then is the corrected dotted-name sentence, which now matches `collectPaths`.

Checks run at 3dae8b2f:
- `npx vitest run packages/backend/src/io`: 7 files, 461 tests, all pass.
- `npx tsx -e` differential probe: 300 000 random instants across the full Date range. Each instant was converted with `toISOString()` and parsed back with `convertCell(…, 'date')`, both in `Z` form and in a random `±hhmm` offset form (offset up to ±23:59). Result: 0 mismatches. Spot checks: `-000001-02-29`, `2024-02-30`, `2024-01-01T24:00`, `+999999-12-31`, and one ms beyond either limit are refused; `+000000-02-29`, `-000004-02-29`, `0000-01-01` and `+002024-01-01` are accepted with the correct instants.
- `npx tsx -e` with `collectPaths` / `valueAt` / `cellText` on the dotted-key shapes listed above: every value appears in some column.

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

The fixes for CR-1 and TW-1 are correct and covered by regression tests. All four acceptance criteria are implemented, documented and unit tested at 3dae8b2f.
