# Code Review

Date: 2026-11-17

Task: io-advanced - M3: CSV import/export and BSON dump

Scope: `git diff 0b3f8865..HEAD -- packages test` (task commits 348713b9, 9b1ee276, 572db72d), committed changes only

Requirements:
- tasks/io-advanced.md acceptance criteria and its recorded assumptions (CSV types, CSV export columns, BSON dump metadata)
- SPEC.md Import/export (CSV with field mapping and type per column, mongodump-compatible .bson per collection, no oplog)
- docs/ARCHITECTURE.md, AGENTS.md
- Parent instructions (unit tests are being added by test-writer in parallel)

Git range:
- Branch: main
- HEAD: 572db72dca432ae9417211d821d9514f64b6b4d5
- Base/start: 0b3f886541e3a5cad8d72fe70360447f70df82d2
- Commits reviewed: 3

Summary: 0 P0, 0 P1, 1 P2, 2 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | A CSV header with repeated or overlapping column names cannot be previewed, including CSV files Thicket exported itself**
    - File: `packages/backend/src/io/import.ts:146`, `packages/backend/src/io/csv/convert.ts:186-221`, `packages/backend/src/io/export.ts:158-167`
    - Category: Correctness
    - Problem: `csvItems` calls `resolveMapping(header, mapping)` as soon as the header arrives, and `previewCsv` calls it with `mapping === undefined`. The default mapping then uses every column name as its path, so it throws `INVALID_PARAMS` ("is used twice" / "overlap") when the header repeats a name (`a,a`) or has a name that is a prefix of another (`a,a.b`). `previewFile` rethrows it, so `io.previewImport` fails and the panel shows an error instead of the mapping table. The user never gets to the mapping UI that could fix it by unchecking or renaming a column. The renderer even expects this case (`defaultCsvRows` in `packages/renderer/src/app/io/io.util.ts`: "A repeated header name maps to its first column only"), but the backend fails before that code runs. Thicket's own CSV export produces such headers: `collectPaths` makes `a` a column for a document where `a` is a scalar or `{}`, and `a.b` for another document where `a` is `{b: …}`. Exporting a collection with mixed shapes and importing it back fails at the preview step. Also, because the mapping matches columns by name (`header.indexOf(m.column)`), a second column with a repeated name can never be imported, even with an explicit mapping. If the preview is fixed, including that second row in the UI would silently import the first column's cells.
    - Why it matters: The SPEC and task ask for CSV import with field mapping, and this AC is a CSV round trip. A whole class of real files, including Thicket's own exports of heterogeneous collections, cannot be imported at all. The integration round trip only covers documents with the same shape.
    - Suggested fix: Don't validate the default mapping in the preview. Return header and rows, and build the sample from a lenient default that skips repeated or overlapping columns, matching `defaultCsvRows`. Consider addressing columns by index in `csvMapping` (or reject an included repeated name in `csvMappingProblem`). Add a test for a header such as `a,a.b` and one with a repeated name.

## P3 Low

- [ ] **CR-2 | The CSV record size limit ignores separators, so a file of commas grows memory without bound**
    - File: `packages/backend/src/io/csv/csv.ts:115-130`
    - Category: Correctness
    - Problem: `size` grows only in `append()`. `endCell()` pushes a cell without counting it, and so does an empty quoted cell `""`. A record made only of separators (`,,,,…` or `"","",…` with no line break) never reaches `maxRecordChars`, and `cells` grows with the file. The class doc says a wrongly shaped file "never makes it hold the whole file".
    - Why it matters: Choosing a malformed or hostile file can exhaust memory in the backend instead of failing with a clean `ScanError`. This limit exists to prevent exactly that.
    - Suggested fix: Count each finished cell (e.g. `size += 1` per separator, or limit `cells.length`) toward the record limit, and add a unit test with a long comma-only line and a small `maxRecordChars`.

- [ ] **CR-3 | The `date` CSV type accepts any string `Date` can parse, in the host time zone**
    - File: `packages/backend/src/io/csv/convert.ts:109-114`
    - Category: Correctness
    - Problem: `new Date(text)` uses the engine's lenient parser. It accepts non-ISO forms such as `03/01/2026` or `2026-03-01 10:00`, and it reads date-times without an offset as local time. The recorded assumption says `date` accepts "ISO 8601 or epoch millis". In practice, common spreadsheet or SQL formats are taken silently, and the stored instant depends on the time zone of the machine running Thicket.
    - Why it matters: The same file can import different dates on different machines, with no error. A strict parser would report the cell.
    - Suggested fix: Accept only ISO 8601 (regex check before parsing) and treat a date-time without an offset as UTC, or document the local-time rule. Otherwise reject the cell with `CellError`. Record the chosen rule as an assumption.

## Review conclusion

Material issues found; fix before completing the task.

The P2 finding (CR-1) blocks importing a realistic class of CSV files, including Thicket's own exports of mixed-shape collections. Other areas I checked showed no defects:
- BSON dump scanning and lossless decoding (`RAW`/`DECODE`, no promotion)
- metadata read and write, and option and index restore
- export partial-file cleanup and cancellation
- CSV quoting and line handling
- `__proto__` handling (`setField`, `Object.hasOwn`)
- the contract changes and the handler wiring
