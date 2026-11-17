# Test Report

Date: 2026-11-17

Task: io-advanced - M3: CSV import/export and BSON dump

Scope: task commits of io-advanced. Given by the parent as `9a67d703..e6f67d16`. During this run the branch was rebased (by the parent, not by this helper): HEAD is now `c444be1c08bcd81bbe8673aac5fae7754f7a678c` on base `155809bc2c8a34355b02d76c98acf1d1497f51d1` (`git merge-base HEAD origin/main`). `git diff e6f67d16..c444be1c` touches only `tasks/io-advanced.md`, so the production code measured is the same as at e6f67d16. The task file set (`git diff --name-only 155809bc..HEAD`) is the same as for the original range. The focus was the fixes in `reviews/io-advanced/fixes.md`: the lenient `defaultMapping`, `csvMapping` by index, the CSV record limit, strict ISO dates, and the renderer's `defaultCsvRows`/`csvMapping`.

Requirements:
- `tasks/io-advanced.md`: acceptance criteria and the 5 recorded assumptions (CSV types, CSV export columns, BSON dump metadata, strict CSV dates with no-offset = UTC, repeated/overlapping header handling)
- SPEC.md Import/export
- docs/ARCHITECTURE.md ("Coverage", conventions), AGENTS.md
- `reviews/io-advanced/review.md` (CR-1..CR-3) and `reviews/io-advanced/fixes.md` (fixes CR-1..CR-3, TW-1..TW-3)

## Test files changed

- `packages/backend/src/io/csv/csv.spec.ts`
- `packages/backend/src/io/csv/convert.spec.ts`
- `packages/backend/src/io/import.spec.ts`
- `packages/contract/src/methods.spec.ts`
- `packages/renderer/src/app/io/io.util.spec.ts`
- `test/integration/io-advanced.int.spec.ts`

(An earlier test-writer run had already added many unit tests in commit 7d4dac24 (was 875cca1e). That run stopped before it wrote this report. This run changed no existing test, and every test it added is listed below.)

## Tests added or updated

Count: 28 new test blocks (44 test cases with `it.each` expanded). No existing test was changed or removed.

- `csv.spec.ts` (3): counts cell text and separators but not the quotes around a cell; a line of separators fed in many small chunks hits the limit too; the separator count starts anew with every record.
- `convert.spec.ts` (11):
  - date: accepts February 29 in a leap year only (also refuses 2026-04-31, month 00, day 00); accepts the last valid time parts and refuses an offset minute of 60; an offset may move the instant to another UTC day or year; reads a comma as the decimal sign of the seconds fraction; reads years below 100 as written (no 19xx shift); trims spaces around a date cell; accepts epoch millis up to the largest JavaScript date and refuses one beyond; gives the same instant whatever the host time zone says (switches `process.env.TZ` between UTC, America/New_York and Asia/Kolkata).
  - mapping: the default skips a parent name after its nested names, and takes a name after an invalid one; a unique name may be given with its index, and an unnamed column by its index; both columns of a repeated name can be imported, each by its index.
- `import.spec.ts` (5): builds the preview sample of a repeated or overlapping header from the first column only; reads on for a sampleSize above 20 rows, keeping the rows capped; refuses an index that does not hold the named column before inserting anything; CSV: an aborted signal cancels the import before any row is inserted; BSON: an aborted signal cancels the import before any document is inserted.
- `methods.spec.ts` (5 blocks, 19 cases): io.import accepts a csvMapping entry with or without its header index; io.import accepts each of the 10 CSV types; io.import refuses an entry with a negative, fractional or text index, an unknown type, an empty path or an unknown key; io.import refuses an empty csvMapping; io.export refuses empty csvFields and an empty field path.
- `io.util.spec.ts` (2): `defaultCsvRows` includes the same columns as the backend default mapping for the same header (the same 9-column header the backend test uses, giving the same indexes 0, 5, 7, 8); leaves out a parent name after its nested names, and takes a name after an invalid one.
- `io-advanced.int.spec.ts` (2, against the mongo:8 fixture): a CSV export of documents with mixed shapes previews and imports back (CR-1 end to end: header `_id,a,n,a.b`, import without a mapping succeeds, and mapping `a` as `json` restores the exact documents); imports the second of two equally named columns by its index (and refuses the name alone before any insert).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: Integration: CSV round trip with types | `io-advanced.int.spec.ts` CSV: "round trip: exported CSV imported with a type per column gives the same documents", "imports without a mapping as auto types…", "a cell that is no value of its type…", new "a CSV export of documents with mixed shapes previews and imports back", new "imports the second of two equally named columns by its index" | `npx vitest run --config test/integration/vitest.config.ts test/integration/io-advanced.int.spec.ts` (Podman/testcontainers, mongo:8 fixture) | Pass (10/10) |
| AC1: `.bson` written by Thicket restores with `mongorestore` in the fixture image, and vice versa | `io-advanced.int.spec.ts` BSON dump: "a .bson written by Thicket restores with mongorestore (documents and indexes)", "a mongodump .bson imports with Thicket (documents and indexes)", "a Thicket .bson of a query imports back with Thicket" | same command | Pass |
| AC2: e2e: CSV import with type mapping | `test/e2e/io.e2e.ts` "CSV import with a type per column: the documents get the mapped types" (plus the JSON export/import e2e) | `npm run test:e2e -- test/e2e/io.e2e.ts` (renderer + desktop build, Playwright/Electron against the fixture) | Pass (2/2) |
| Assumption: repeated/overlapping header: preview and default mapping skip later duplicates (first wins); explicit entries carry the index; a repeated name without index is refused (CR-1) | convert.spec `resolveMapping` (existing and new tests); import.spec preview/import tests (existing and new); io.util.spec `defaultCsvRows`/`csvMapping` (existing and new); import-panel.spec; integration tests above | `npx vitest run packages/backend/src/io`; `cd packages/renderer && npx ng test --include='src/app/io/**/*.spec.ts'` | Pass |
| CSV record limit counts separators (CR-2) | csv.spec "errors" block (existing and 3 new) | `npx vitest run packages/backend/src/io` | Pass |
| Assumption: CSV dates are only epoch millis or ISO 8601 with T; no offset = UTC; anything else is a cell error (CR-3) | convert.spec `convertCell` date block (existing and 8 new, including the host time zone test) | `npx vitest run packages/backend/src/io` | Pass |
| Assumption: CSV types are $type aliases; contract bsonType narrowed to the enum; csvMapping `index` is a non-negative integer | methods.spec "CSV import and export params" (new); io.util.spec CSV_TYPE_OPTIONS (existing) | `npx vitest run packages/contract/src/methods.spec.ts` | Pass |
| CSV/BSON import cancel | import.spec new cancel tests (CSV, BSON) | `npx vitest run packages/backend/src/io/import.spec.ts` | Pass |
| Assumption: CSV export columns, EJSON for nested/arrays, no formula escaping | export.spec (existing); integration "exports the chosen fields…" and new mixed-shape test (checks the `a` cell `"{""b"":6}"`) | as above | Pass |
| Assumption: BSON metadata written/applied (options, indexes, uuid) | bson.spec, import.spec BSON, export.spec (existing); integration BSON dump | as above | Pass |

## Focused test execution

Command:

`npx vitest run packages/backend/src/io` (7 files, 420 tests after the first additions), `npx vitest run packages/backend/src/io/import.spec.ts` (95 tests after the last additions), `npx vitest run packages/contract/src/methods.spec.ts` (360 tests), `cd packages/renderer && npx ng test --include='src/app/io/**/*.spec.ts'` (3 files, 123 tests), `npx vitest run --config test/integration/vitest.config.ts test/integration/io-advanced.int.spec.ts` (10 tests), `npm run test:e2e -- test/e2e/io.e2e.ts` (2 tests)

Result:

Pass. One new integration test failed on its first run. The test was wrong, not the code: it expected the parent column `a` of a mixed-shape export to be blank for the nested document. The recorded assumption says nested documents are written as EJSON text, so the cell holds `{"b":6}`. I corrected the test to assert that documented behavior. A typing error in that test (Int32 `_id` against the `Document` collection type) was also fixed.

## Full test execution

Command:

`npm run check` (eslint + prettier, tsc for all workspaces, root vitest, renderer ng test)

Result:

Pass: root vitest 90 files / 4740 tests, renderer 103 files / 3481 tests. The first two attempts failed: Prettier formatting of the new tests, then the integration-test type error above. Both were fixed in the test files only, and the third run passed.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; same run as above)

## Bugs found

None. No production defect was found. All new tests pass against the fixed code.

Observation, not a defect (it matches the recorded assumption): when one document has `a` as a scalar and another has `a` as a nested document, a CSV export without `csvFields` writes both an `a` column and an `a.b` column. For the nested document the `a` cell holds the whole sub-document as EJSON text, so its data appears twice. An `auto` import then keeps that text as a string. Mapping `a` as `json` restores the documents exactly (integration test). The parent may want this in the user docs.

## Coverage

Status: verified (whole-file coverage of the task-changed production files, fresh runs on the final test snapshot)

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line report). For the uncovered locations listed below, `git blame` against `155809bc..HEAD` was used to tell which ones the task wrote.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: io-advanced. The parent gave base 9a67d703 and HEAD e6f67d16. After the parent's rebase the base is `155809bc2c8a34355b02d76c98acf1d1497f51d1` and HEAD is `c444be1c08bcd81bbe8673aac5fae7754f7a678c` (task commits 59084815, 62fd2bd4, a916613b, 7d4dac24, c444be1c). The file scope comes from `git diff --name-only 155809bc..HEAD`, which is the same file set as `9a67d703..e6f67d16`, and `git diff e6f67d16..c444be1c` touches only `tasks/io-advanced.md`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD c444be1c plus uncommitted test edits. sha256: csv.spec.ts `3e25af24…984df84`, convert.spec.ts `c984edc7…e9e31a86`, import.spec.ts `82358fc3…7ec3`, methods.spec.ts `a504ee6f…7bde`, io.util.spec.ts `cf065991…a6a6`, io-advanced.int.spec.ts `717c229b…fce0`. No production file is modified in the working tree. `reviews/io-advanced/review.md` was changed by another helper during this run; it is not a test input.
- Exact included files; renamed/deleted/excluded files and reasons:
  - Included, backend: `packages/backend/src/io/{bson/bson.ts, csv/convert.ts, csv/csv.ts, export.ts, handlers.ts, import.ts}`.
  - Included, renderer: `packages/renderer/src/app/io/{io.util.ts, import-panel.ts, export-panel.ts}`.
  - Included, contract: `packages/contract/src/io.ts`.
  - Excluded: Angular templates/CSS (`export-panel.html`, `import-panel.html`, `io-panel.css`, `collection/collection-view.html`), which v8 does not instrument as source files (exercised by the panel specs and e2e); test files; `reviews/*`.
  - No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8, node v24.21.0.
  - Backend: `cd packages/backend && npx vitest run --coverage --coverage.include='src/io/bson/bson.ts' --coverage.include='src/io/csv/convert.ts' --coverage.include='src/io/csv/csv.ts' --coverage.include='src/io/export.ts' --coverage.include='src/io/handlers.ts' --coverage.include='src/io/import.ts' --coverage.reporter=lcovonly --coverage.reporter=json-summary --coverage.reportsDirectory=coverage/io-advanced-final2` (all 47 backend spec files, 2068 tests).
  - Renderer: `cd packages/renderer && npx ng test --coverage --coverage-include='src/app/io/io.util.ts' --coverage-include='src/app/io/import-panel.ts' --coverage-include='src/app/io/export-panel.ts' --coverage-reporters=json-summary --coverage-reporters=lcovonly --coverage-reporters=text` (all 103 renderer spec files, 3481 tests).
  - Contract: `cd packages/contract && npx vitest run --coverage --coverage.include='src/io.ts' --coverage.reporter=json-summary --coverage.reporter=text --coverage.reportsDirectory=coverage/io-advanced-final` (5 files, 841 tests).
- Run start/completion time and exit status (2026-11-17, +01:00): backend final 07:14:06, about 17 s, exit 0; renderer 07:11:14, about 22 s, exit 0; contract 07:14:30, under 1 s, exit 0.
- Generated report paths and report hashes/run identifier:
  - `packages/backend/coverage/io-advanced-final2/coverage-summary.json` sha256 `503e0b52…1b`, `lcov.info` `eed99037…25c`. Identical to the earlier run `io-advanced-final` taken before Prettier reformatted the specs.
  - `packages/renderer/coverage/renderer/coverage-summary.json` `22a738fc…821929`, `lcov.info` `ef2eac4d…be94`.
  - `packages/contract/coverage/io-advanced-final/coverage-summary.json`.
  - All of these are git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: each run wrote a new reports directory, except the renderer, which writes its fixed `coverage/renderer` (its timestamps are from this run). The test-file hashes were the same before and after the final backend run (`git status` and `sha256sum`). The renderer spec has not changed since its coverage run.
- Final run after latest test additions and production fixes: yes. The fixes are in c444be1c (= e6f67d16), and every test addition and formatting change came before the final runs.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/io/bson/bson.ts` | 115/115 (100%) | 66/68 (97.05%) | 17/17 (100%) | 99/99 (100%) |
| `packages/backend/src/io/csv/convert.ts` | 181/181 (100%) | 154/156 (98.71%) | 20/20 (100%) | 146/146 (100%) |
| `packages/backend/src/io/csv/csv.ts` | 96/96 (100%) | 66/66 (100%) | 11/11 (100%) | 78/78 (100%) |
| `packages/backend/src/io/export.ts` | 157/163 (96.31%) | 75/81 (92.59%) | 35/38 (92.1%) | 133/133 (100%) |
| `packages/backend/src/io/handlers.ts` | 52/52 (100%) | 26/26 (100%) | 16/16 (100%) | 47/47 (100%) |
| `packages/backend/src/io/import.ts` | 191/191 (100%) | 99/107 (92.52%) | 24/24 (100%) | 165/165 (100%) |
| `packages/renderer/src/app/io/io.util.ts` | 89/90 (98.88%) | 70/71 (98.59%) | 21/21 (100%) | 75/75 (100%) |
| `packages/renderer/src/app/io/import-panel.ts` | 162/167 (97%) | 76/85 (89.41%) | 39/39 (100%) | 138/141 (97.87%) |
| `packages/renderer/src/app/io/export-panel.ts` | 86/86 (100%) | 40/40 (100%) | 29/29 (100%) | 71/71 (100%) |
| `packages/contract/src/io.ts` | 5/5 (100%) | N/A (0/0) | N/A (0/0) | 5/5 (100%) |
| **Aggregate (summed counters, 10 files)** | 1134/1146 (98.95%) | 672/700 (96.00%) | 212/215 (98.60%) | 957/960 (99.69%) |

The aggregate covers the 10 files above. Excluded: the Angular templates/CSS listed above (not instrumented). No in-scope file is unmeasured.

Before this run's additions, `import.ts` was at statements 189/191 and branches 96/107 (uncovered: CSV/BSON cancel checks at lines 162 and 180, and the preview row cap at line 234). The new tests cover all three.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/io/import.ts:162, 180` (CSV / BSON read loop cancel) | Cancel of a CSV or BSON import | Added: import.spec "an aborted signal cancels the import before any row/document is inserted". Now covered. |
| `packages/backend/src/io/import.ts:234` (preview row cap with a larger sampleSize) | Preview shows at most 20 rows | Added: import.spec "reads on for a sampleSize above 20 rows…". Now covered. |
| `packages/backend/src/io/import.ts:75, 93, 324-325, 365, 390-399` (fallback branches: non-Error throws, missing `index`/`errmsg`/`n` in a server reply, write-concern `errmsg`) | Defensive handling of malformed server replies | Left uncovered: written before this task (`git blame` shows base 155809bc), not task behavior. |
| `packages/backend/src/io/export.ts:63, 85, 95, 122, 263, 280-281` (stream already destroyed/closed, `rm` failure catch) | File-stream failure edge cases | Left uncovered: written before this task (base 155809bc). The task only widened `write()` to `Uint8Array` (line 71, covered by the BSON export tests). |
| `packages/backend/src/io/bson/bson.ts:113, 233` (`String(error)` for a non-Error throw) | Message of a non-Error exception | Left uncovered: the driver throws `Error` subclasses only. Defensive, not material. |
| `packages/backend/src/io/csv/convert.ts:338` (non-Error from `convertCell`), `:352` (`path.at(-1) ?? ''`) | Defensive fallbacks | Left uncovered: `convertCell` throws only `CellError`, and a path always has at least one segment. Not reachable. |
| `packages/renderer/src/app/io/import-panel.ts:186` (`?? '--text-faint'` in `typeColor`) | Color of an unknown CSV type | Left uncovered: every `CsvType` has a token (io.util.spec "offers every CSV type of the contract exactly once… each with a color token"). Not reachable. |
| `packages/renderer/src/app/io/import-panel.ts:111, 113, 141, 211, 263-266, 271, 308` | Preview/approve race and error paths | Left uncovered: written before this task (io-basic-ui, base 155809bc). |
| `packages/renderer/src/app/io/io.util.ts:195` (`shell()` fallback) | describeExport with a missing part | Left uncovered: written before this task (base 155809bc). |

## Unable to test

- Nothing in the acceptance criteria was left unrun. Both ACs ran in the configurations they name: the integration test against the mongo:8 fixture and the mongodump/mongorestore tools of its image, and the e2e test through the real renderer + desktop build with Playwright.
- Strict-date behavior on a machine whose real host time zone is not UTC is checked by switching `process.env.TZ` at runtime inside a test. The fixer also ran the date tests with `TZ=America/New_York` and `TZ=Asia/Kolkata`. No follow-up needed.

## Summary

Tests added and all validation passed. Task-scoped coverage is sufficient; no production defects were found.
