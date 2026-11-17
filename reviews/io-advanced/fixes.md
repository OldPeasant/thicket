# Fix Report

Date: 2026-11-17

Task: io-advanced - M3: CSV import/export and BSON dump

Scope: current task; findings CR-1, CR-2, CR-3 of `reviews/io-advanced/review.md` and the 6 failing test-writer unit tests (task commits 8ac01442..13ae41d7, base 1ff8c450)

## Fixed findings

### CR-1 — A CSV header with repeated or overlapping column names cannot be previewed (P2)

Also fixes the three failing test-writer tests in `import.spec.ts` ("previews a file with a repeated column name / a column name ending in a dot / overlapping column names").

Files changed:
- `packages/backend/src/io/csv/convert.ts`
- `packages/backend/src/io/import.ts`
- `packages/contract/src/io.ts`
- `packages/renderer/src/app/io/io.util.ts`
- `packages/backend/src/io/csv/convert.spec.ts`
- `packages/backend/src/io/import.spec.ts`
- `packages/renderer/src/app/io/io.util.spec.ts`

Problem:
Without a mapping, `resolveMapping` used every column name as a path and threw INVALID_PARAMS for `a,a`, `a,a.b` or `a.`, so `io.previewImport` failed before the mapping UI could be shown, including for Thicket's own exports of mixed-shape collections. An explicit mapping addressed columns by name (`header.indexOf`), so the second of two equally named columns could never be imported, and selecting it in the UI would silently import the first column's cells.

Fix:
- New `defaultMapping(header)` in `convert.ts`: every named column under its own name as `auto`, leaving out (never throwing for) a blank name, a name with an empty path segment (`a.`, `.a`), and a name that repeats or overlaps the path of an earlier taken column (first one wins). `resolveMapping(header, undefined)` returns it, so the preview sample and an import without `csvMapping` use the same lenient default.
- Columns are now addressable by index: `io.import`'s `csvMapping` entries take an optional `index` (0-based header position, `count`). With `index`, the header must hold `column` at that index, otherwise INVALID_PARAMS "The file has no column "x" at index N". Without `index`, a name that occurs more than once in the header is refused with INVALID_PARAMS "The file has more than one column "x": choose one by its index", so the wrong column can never be imported silently. Names that are unique keep working without `index` (backward compatible).
- Renderer: `defaultCsvRows` applies the same rule as the backend default (repeated, overlapping and invalid names start unchecked), and `csvMapping` sends each included row's header index, so the column the user checked is the one imported.
- Test changes: the existing `resolveMapping` test "a repeated header name means its first column" encoded exactly the behavior CR-1 identifies as unsafe; the shared test header no longer repeats `name` (`['name','qty','','city','note']`) and the test now only covers mapping an empty name. The renderer `csvMapping` expectation now includes `index`. The renderer test title about the backend "mapping a name to its first column" was reworded (assertions unchanged).
- New tests: lenient default (`a,a,a.b,x.,.y,c.d,c,cd,n`), repeated name chosen by index, repeated name without index refused, mismatched/out-of-range index refused, import without mapping of a mixed-shape header, import of the second of two equal names by index, refusal before any insert; renderer: overlapping/invalid defaults, index sent for a repeated name.

Validation:
- `npx vitest run packages/backend/src/io` — Pass (404 tests)
- `cd packages/renderer && npx ng test --include='src/app/io/**/*.spec.ts'` — Pass (121 tests)

### CR-2 — The CSV record size limit ignores separators (P3)

Files changed:
- `packages/backend/src/io/csv/csv.ts`
- `packages/backend/src/io/csv/csv.spec.ts`

Problem:
Only appended cell characters counted towards `maxRecordChars`; a record of separators (`,,,,…` or `"","",…`) grew `cells` without bound.

Fix:
Each comma now counts one character towards the record limit (`separator()` -> `grow(1)` -> `endCell()`), so the limit is the record's text length without quotes. The existing boundary test "accepts a record of exactly maxRecordChars characters" used `abc,de` as "exactly 5" under the old counting; it now uses `abc,d` (5 with the separator) and refuses `abc,de` — same intent, adjusted to the corrected rule. New tests: 1000 commas and 1000 `"",` with limit 10 throw `ScanError` on line 1; `,,,,` at limit 4 is still read.

Validation:
- `npx vitest run packages/backend/src/io/csv` — Pass

### CR-3 — The `date` CSV type accepts any string `Date` can parse, in the host time zone (P3)

Files changed:
- `packages/backend/src/io/csv/convert.ts`
- `packages/backend/src/io/csv/convert.spec.ts`

Problem:
`new Date(text)` accepted non-ISO forms (`03/01/2026`, `2026-03-01 10:00`) and read date-times without an offset in the host time zone.

Fix:
`date` cells accept only epoch milliseconds (digits, as before) or ISO 8601 `YYYY-MM-DD[THH:mm[:ss[.fraction]][Z|±hh:mm|±hhmm]]`. A date-time without an offset is UTC. Out-of-range parts (month 13, February 30, hour 24, second 60, offset hour > 23) are refused instead of rolling over. Fractions beyond milliseconds are truncated. Everything else throws `CellError('is not a date')` (same message as before). Matches the recorded assumption "date accepts ISO 8601 or epoch millis"; the parent should record the "no offset = UTC" rule as an assumption.
New tests: no-offset date-times as UTC (incl. fraction), all offset forms, 13 refused inputs (`03/01/2026`, `2026-03-01 10:00`, RFC 2822, `2026-02-30`, `T24:00`, `T10:60`, seconds 60, offset `+24:00`, hour without minutes, date with `Z`, `1.5`, …).

Validation:
- `npx vitest run packages/backend/src/io/csv` — Pass
- `TZ=America/New_York npx vitest run packages/backend/src/io/csv` and `TZ=Asia/Kolkata …` — Pass (141 tests each)

### TW-1 — csv.spec.ts "counts a CR-only line break inside quotes for the lines that follow"

Files changed:
- `packages/backend/src/io/csv/csv.ts`

Problem:
Inside a quoted cell only `\n` advanced the line counter, so in CR-only files the line numbers of later records (and their error messages) were too low.

Fix:
In the quoted state a `\r` advances the line and remembers it, a `\n` advances it unless it directly follows that `\r` (CRLF counted once). The cell text still keeps the line break as written.

Validation:
- `npx vitest run packages/backend/src/io/csv` — Pass

### TW-2 — convert.spec.ts "writes a Timestamp as Extended JSON, not as the 64-bit number it is built on"

Files changed:
- `packages/backend/src/io/csv/convert.ts`

Problem:
`Timestamp` extends `Long` in the driver, so `cellText` wrote it as a 64-bit decimal number.

Fix:
The Long branch excludes `Timestamp`, which now falls through to Extended JSON (`{"$timestamp":{"t":5,"i":1}}`).

Validation:
- `npx vitest run packages/backend/src/io/csv` — Pass

### TW-3 — bson.spec.ts "refuses a metadata file holding a single number (not a document)"

Files changed:
- `packages/backend/src/io/bson/bson.ts`

Problem:
`readMetadata` accepted any non-array object; canonical EJSON parses `5` into an `Int32` object (and `{"$date": …}` into a Date), which passed as a metadata document.

Fix:
Only a plain object (prototype `Object.prototype`) is accepted; anything else is refused with the existing "… is not a valid metadata file" error.

Validation:
- `npx vitest run packages/backend/src/io/bson` — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `npx vitest run packages/backend/src/io packages/renderer/src/app/io` — Pass, 404 tests (the root Vitest config has no renderer project; renderer specs run with ng test below)
- `cd packages/renderer && npx ng test --include='src/app/io/**/*.spec.ts'` — Pass, 3 files, 121 tests
- `TZ=America/New_York` / `TZ=Asia/Kolkata npx vitest run packages/backend/src/io/csv` — Pass, 141 tests each
- `npx vitest run --config test/integration/vitest.config.ts test/integration/io-advanced.int.spec.ts` — Pass, 8 tests (CSV round trip, mongodump/mongorestore compatibility)
- `npm run test:e2e -- test/e2e/io.e2e.ts` — Pass, 2 tests (incl. "CSV import with a type per column")

Full test suite:
- `npm run check` (eslint, prettier, typecheck, vitest 4702 tests, renderer ng test 3440 tests) — Pass

Lint/type-check/build:
- Included in `npm run check` — Pass (prettier initially flagged formatting in convert.ts/convert.spec.ts; fixed with `npx prettier --write` on those two files)

`.taskcheck`:
- Runs `npm run check` — Pass (same run as above)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
