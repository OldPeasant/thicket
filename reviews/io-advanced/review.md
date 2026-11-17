# Code Review

Date: 2026-11-17

Task: io-advanced - M3: CSV import/export and BSON dump

Scope: `git diff 9a67d703..HEAD -- packages test` (task commits 59084815, 62fd2bd4, a916613b, 7d4dac24, c444be1c; these are the rebased forms of 6e109223..e6f67d16, and `git diff e6f67d16 HEAD -- packages test docs` is empty). Committed changes only. Second review, after the fixer addressed CR-1..CR-3 of the first review.

Requirements:
- tasks/io-advanced.md acceptance criteria and its five recorded assumptions (CSV types, CSV export columns, BSON dump metadata, strict CSV dates, repeated/overlapping CSV headers)
- SPEC.md Import/export ("CSV (with field mapping and type per column) and as BSON dump (mongodump-compatible .bson per collection, no oplog)")
- docs/ARCHITECTURE.md, AGENTS.md
- Parent instructions (verify the fixes in reviews/io-advanced/fixes.md, then review the whole final implementation)

Git range:
- Branch: main
- HEAD: c444be1c08bcd81bbe8673aac5fae7754f7a678c (same code as e6f67d16)
- Base/start: 9a67d70390f2ca7b0e8b4a2ff7c301ffba46de1e
- Commits reviewed: 5

Summary: 0 P0, 0 P1, 0 P2, 4 P3

## Verification of the previous findings

- CR-1 (preview of repeated or overlapping headers) is fixed. `defaultMapping` (`packages/backend/src/io/csv/convert.ts:238`) is lenient and never throws. `resolveMapping(header, undefined)` uses it, so the preview works for `a,a` and `a,a.b`. Explicit entries can carry `index` (`columnIndex`, convert.ts:253). A repeated name without an index is refused. The renderer's `defaultCsvRows` applies the same rule, and `csvMapping` sends the header index (`packages/renderer/src/app/io/io.util.ts:52-106`). Tests cover all of this.
- CR-2 (the record limit ignored separators) is fixed. `separator()` counts each comma (`packages/backend/src/io/csv/csv.ts:136`), and tests cover lines made only of commas and of `"",`.
- CR-3 (lenient date parsing) is fixed. `date()` (convert.ts:125) accepts only epoch millis or strict ISO 8601, reads a missing offset as UTC, and refuses rolled-over parts. The rule is recorded as an assumption.
- The test-writer's documented bugs are fixed: CR-only line counting inside quotes, Timestamp cells written as Extended JSON, and metadata that is not a plain object.

Checks run:
- `npx vitest run packages/backend/src/io`: 7 files, 418 tests, all pass.
- `npx ng test --include='src/app/io/**/*.spec.ts'` in `packages/renderer`: 3 files, 123 tests, all pass.

Both runs used the working tree. A test-writer may be adding uncommitted tests to it in parallel.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | A one-column CSV export writes empty values as blank lines, and the import silently drops those rows**
    - File: `packages/backend/src/io/csv/csv.ts:163` (`csvLine`), `packages/backend/src/io/csv/csv.ts:88-90` (blank lines skipped)
    - Category: Correctness
    - Problem: `csvLine([''])` returns `"\n"`. So with one column (for example `csvFields: ['email']`), every document whose value is missing, null or `""` becomes an empty line. `CsvScanner` skips blank lines as "no record", so on import those rows are neither inserted nor counted in `processed` or `failed`.
    - Why it matters: In a round trip of such a file, fewer documents come back than were exported, and nothing reports it.
    - Suggested fix: When a record has exactly one cell and it is empty, write it as `""`. RFC 4180 writers do this, and the scanner already reads `""` as one empty cell. Add a round-trip unit test.

- [ ] **CR-2 | Dates outside the years 0000-9999 are exported in a form the `date` type refuses**
    - File: `packages/backend/src/io/csv/convert.ts:76` (export as `toISOString()`), `packages/backend/src/io/csv/convert.ts:116-117` (`ISO_DATE` requires a 4-digit year)
    - Category: Correctness
    - Problem: For years outside 0..9999, `toISOString()` writes the extended-year form (`+010000-01-01T00:00:00.000Z`, `-000001-…`). `ISO_DATE` does not accept it, so re-importing the column as `date` fails those cells with "is not a date".
    - Why it matters: These are valid BSON dates that Thicket's own CSV export cannot restore with types. The impact is small because such dates are rare.
    - Suggested fix: Accept the `±YYYYYY` extended year in `ISO_DATE`, or export dates outside that range as epoch millis, which `date` already reads.

- [ ] **CR-3 | Field names that contain a dot are exported as empty cells**
    - File: `packages/backend/src/io/csv/convert.ts:28-37` (`collectPaths`), `packages/backend/src/io/csv/convert.ts:43-57` (`valueAt`)
    - Category: Correctness
    - Problem: `collectPaths` makes a column named `a.b` for a top-level key `"a.b"`, which MongoDB 5.0+ allows. `valueAt` then splits the column on dots and looks for `a` → `b`. It finds nothing, so the cell is empty. A document holding both `{"a.b": 1}` and `{a: {b: 2}}` shares one column, and the dotted key's value is lost.
    - Why it matters: The export loses data silently. Such keys are uncommon but legal.
    - Suggested fix: Leave columns from keys that contain a dot out of the default header, or write the whole parent value as Extended JSON. Either way, record the rule as an assumption.

- [ ] **CR-4 | docs/ARCHITECTURE.md still says CSV and BSON answer UNSUPPORTED**
    - File: `docs/ARCHITECTURE.md:354`
    - Category: Integration
    - Problem: The Import/export paragraph still reads "JSON and JSON Lines, CSV/BSON answer `UNSUPPORTED` until io-advanced". It describes only the JSON scanners. It also says an error's `IoProgress.index` is a line, but for BSON it is now a document number.
    - Why it matters: The architecture document is what other agents read before changing `packages/backend/src/io`. As written, it describes behavior that this task removed.
    - Suggested fix: Update the paragraph. Cover the CSV scanner and mapping (default mapping, `index`, types), the BSON scanner and metadata (options when the collection is new, indexes after the documents), and that the error index is a document number for BSON.

## Review conclusion

No material issues found.

The four P3 findings are optional cleanups. The previous P2 and P3 findings and the documented test-writer bugs are fixed and tested. Other areas I checked showed no defects:
- BSON export and import keep every type (cursor batches decoded with `DECODE`)
- the metadata file matches the mongodump shape
- partial files are removed when an export fails or is cancelled
- `__proto__` field paths are handled safely
- the contract changes (`CSV_TYPES` enum, `index`, `csvRows`, `metadataFile`) match the handler and renderer wiring
- the integration tests run mongorestore and mongodump compatibility in both directions
- the e2e test covers CSV import with a type mapping

Evidence for the acceptance criteria is not recorded in `tasks/io-advanced.md` yet. The parent worker records it with `tasks.py verify`.
