# Code Review

Date: 2026-11-17

Task: csv-edge-cases - CSV edge cases: one-column blank rows, dates beyond year 9999, dotted field names; ARCHITECTURE.md io section

Scope: `git diff ad4dde00..a27a8aa4`, committed changes only (one task commit a27a8aa4). Files: packages/backend/src/io/csv/csv.ts, packages/backend/src/io/csv/convert.ts, csv.spec.ts, convert.spec.ts, packages/backend/src/io/export.spec.ts, docs/ARCHITECTURE.md. The ARCHITECTURE Import/export paragraph was checked against the code in packages/backend/src/io (export.ts, import.ts, csv/, bson/).

Requirements:
- tasks/csv-edge-cases.md: four acceptance criteria and two recorded assumptions (dotted field names in CSV export; `±YYYYYY` extended years in the CSV `date` type)
- reviews/io-advanced/review.md CR-1..CR-4 (the deferred findings this task fixes)
- SPEC.md, docs/ARCHITECTURE.md, AGENTS.md
- Parent instructions: review the committed code at a27a8aa4

Git range:
- Branch: main
- HEAD: a27a8aa43c0cafcb7d497306bad39036fb248189
- Base/start: ad4dde008e42b8df74f6b9f004ceb4067611ef01
- Commits reviewed: 1

Summary: 0 P0, 0 P1, 1 P2, 0 P3

## Verification of the acceptance criteria

- **1. One-column export of an empty value round-trips:** met. `csvLine([''])` now returns `""\n` (csv.ts:167). `CsvScanner` reads that as one empty cell (state `quoted` → `quoteSeen` → newline ends the record, also at EOF through `end()`). Tests: csv.spec.ts (scanner round trip), export.spec.ts (empty, null and missing values, imported with a `string` mapping and with the default mapping, 5 documents back). It also fixes a header of a single column named `""` (top-level key `''`), which used to be written as a blank line.
- **2. Dates outside the years 0000-9999:** met. `ISO_DATE` accepts `[+-]\d{6}` (convert.ts:137) and refuses `-000000`. `setUTCFullYear` handles years 0-99 and negative years correctly, the roll-over check refuses an out-of-range result (NaN fails every comparison), and the new NaN check after the offset (convert.ts:172-174) catches offsets that move the first or last representable day out of range. Tests cover years 10000, -1, 0, 9999, ±8.64e15 and the refused forms, both in `convertCell` and through `exportToFile` + import.
- **3. Field names containing a dot:** partly met. Top-level dotted keys with scalar or array values, collisions with a top-level document, and nested documents holding a dotted key are exported with their values and tested. A top-level dotted key whose value is a non-empty document still loses its value (CR-1).
- **4. ARCHITECTURE io section:** met. The `UNSUPPORTED` wording is gone. These claims match the code: the CSV header from `csvFields` or the first batch (`CSV_SAMPLE_DOCS` = 1000), the cell rules, `CsvScanner` (blank lines skipped, the record limit counting separators), `csvMapping` with `index`, `CSV_TYPES`, `defaultMapping`, blank cells, `CSV_PREVIEW_ROWS` = 20, and the BSON metadata, options and indexes behavior (`collectionMetadata`, `createWithOptions`, `createDumpIndexes`). One exception: the dotted-name sentence is inaccurate for the case in CR-1.

Checks run at a27a8aa4:
- `npx vitest run packages/backend/src/io/csv packages/backend/src/io/export.spec.ts`: 4 files, 215 tests, all pass.
- `npx tsx -e` with `collectPaths` / `valueAt` / `cellText` on `{ 'a.b': { c: 1 } }`: the header is `['a.b.c']`, and the cell is `''`. This reproduces CR-1.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | A top-level dotted key whose value is a document is flattened into a column that reads nothing (value lost)**
    - File: `packages/backend/src/io/csv/convert.ts:41-49` (`collectPaths`), `packages/backend/src/io/csv/convert.ts:62` (`valueAt`), `docs/ARCHITECTURE.md:381-384`
    - Category: Correctness
    - Problem: `collectPaths` flattens every non-empty plain document whose key is not shadowed and whose children have no dot. That includes a top-level key that itself contains a dot. For `{ "a.b": { c: 1 } }` it adds the column `a.b.c`. `valueAt(doc, 'a.b.c')` looks for the literal top-level key `a.b.c`, finds none, then walks `a` → `b` → `c` and returns `undefined`, so the cell is empty. When the same document also has `a: { b: { c: 9 } }`, the `a.b.c` cell shows the nested `9`, `a` is written whole, and the literal `"a.b"` value appears nowhere. The doc comment ("never lose their value") and the ARCHITECTURE sentence ("a top-level one (`"a.b"`) is its own column") both state otherwise.
    - Why it matters: Criterion 3 says a dotted field name is exported with its value. For this shape the export still drops data silently, which is the defect io-advanced CR-3 asked to remove.
    - Suggested fix: Do not recurse into a value whose key contains a dot. Add `!key.includes('.')` to the flatten condition, so the key is one Extended JSON column that `valueAt` reads literally. Add a unit test for `{ "a.b": { c: 1 } }`, with and without a colliding `a: { b: { c: … } }`, and extend the "loses no value" test with this shape.

## P3 Low

None.

## Review conclusion

Material issues found; fix before completing the task.

CR-1 leaves acceptance criterion 3 partly unmet. The fix is one condition plus a test. The other three criteria are implemented, documented and tested correctly.
