# Test Report

Date: 2026-11-17

Task: csv-edge-cases - CSV edge cases: one-column blank rows, dates beyond year 9999, dotted field names; ARCHITECTURE.md io section

Scope: `ad4dde008e42b8df74f6b9f004ceb4067611ef01..a27a8aa43c0cafcb7d497306bad39036fb248189` (one task commit, a27a8aa4, on `main`), plus the uncommitted test changes of this report.

Requirements:
- `tasks/csv-edge-cases.md` acceptance criteria and its two recorded assumptions (dotted field names; ±YYYYYY date years)
- `reviews/io-advanced/review.md` CR-1..CR-4 (background)
- `docs/ARCHITECTURE.md` "Coverage" and io section
- Parent instructions (scope, base commit, focused command)

## Test files changed

- `packages/backend/src/io/csv/convert.spec.ts`
- `packages/backend/src/io/csv/csv.spec.ts`
- `packages/backend/src/io/export.spec.ts`

## Tests added or updated

Count: 15 added, 1 helper fixed, 2 reformatted

Added:
- `convert.spec.ts` collectPaths "field names with a dot": keeps flattening the documents a dotted key does not collide with; shadows the document named by the first segment of a deeper dotted key; makes a colliding scalar or empty document one column as before; does not flatten a nested document holding both a dotted key and a colliding document; flattens the same document in other documents, which then also appear whole in its column (pins the documented "duplicate, not loss" assumption).
- `convert.spec.ts` valueAt: reads a top-level key containing a dot before the nested path of the same name (incl. a literal `null` and `tags.0` vs an array); reads a dotted key only at the top level; does not read inherited properties as dotted keys.
- `convert.spec.ts` convertCell date: first and last representable instants and one millisecond beyond (`-271821-04-20T00:00:00.000Z`, `+275760-09-13T00:00:00.000Z`, `+275760-09-12T23:00-01:00` accepted; `...19T23:59:59.999Z`, `...13T00:00:00.001Z`, `-271821-04-20T00:00:00+00:01` (offset moves result out of range), `-271822-01-01`, `+999999-12-31` refused); leap years and day ranges in extended years (`+010000-02-29`, `-000004-02-29` accepted; `+010100-02-29`, `-000001-02-29`, month 13, April 31 refused); `+000000` equals `0000`, offsets/fraction/trimming/hour 24 on extended years.
- `csv.spec.ts`: consecutive and trailing one-empty-cell records read back, also split across chunks (`"` | `"`) and with CRLF; a one-cell whitespace record is quoted, not a blank line.
- `export.spec.ts`: a one-column export of a named dotted field (`csvFields: ['a.b']`) reads literal and nested values and writes `""` for empty/missing ones, re-imported as 4 records; a one-column export with collected header keeps documents whose only value is empty.

Fixed (test code from task commit a27a8aa4): `export.spec.ts` helper `importCsv` failed `tsc` (`TS18048: 'header' is possibly 'undefined'`, lines 573-574), which made `npm run check` / `.taskcheck` fail; it now throws when the CSV has no header. Prettier also reformatted two task-commit test snippets (`it.each(...)('refuses the year form %j')`, the `importCsv` signature) that were not Prettier-clean. No assertion was changed or weakened.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| 1. One-column CSV export of a document with an empty value round-trips (no dropped row) | csv.spec "writes a record of one empty cell as \"\"...", "reads back consecutive and trailing one-empty-cell records...", "quotes a one-cell record that is only whitespace..."; export.spec "a one-column export keeps documents with an empty, null or missing value", "a one-column export of a named dotted field...", "a one-column export collected from the documents..." | `npx vitest run packages/backend/src/io` | Pass |
| 2. Dates outside years 0000-9999 export in a form the `date` CSV type imports back | convert.spec "reads back the export text of a date in %s" (6), "reads the extended year form", "refuses the year form %j" (6), "reads the first and last representable instants...", "applies leap years and day ranges to extended years", "reads +000000 as year 0..."; export.spec "exports dates outside the years 0-9999 so that the date type imports them back" | `npx vitest run packages/backend/src/io` | Pass |
| 3. A field name containing a dot is exported with its value (behavior defined and documented) | convert.spec collectPaths "field names with a dot" (9) and valueAt dotted-key tests (3); export.spec "exports fields whose name contains a dot with their values", "a one-column export of a named dotted field..." | `npx vitest run packages/backend/src/io` | Pass |
| 4. docs/ARCHITECTURE.md io section describes the CSV/BSON scanners instead of `UNSUPPORTED` | Manual inspection of `git diff ad4dde00..a27a8aa4 -- docs/ARCHITECTURE.md`: the `UNSUPPORTED until io-advanced` sentence is replaced; new CSV export, CSV import (`CsvScanner`) and BSON (`BsonScanner`) bullets | `git diff` (inspection) | Not testable (documentation; inspected, matches) |

## Focused test execution

Command:

`npx vitest run packages/backend/src/io` (repository root)

Result:

Pass - 7 files, 459 tests passed (final snapshot).

## Full test execution

Command:

`npm run check` (lint + Prettier + typecheck of all workspaces + root vitest + renderer `ng test`)

Result:

Pass - lint/Prettier clean, typecheck clean, vitest 90 files / 4776 tests passed, renderer 107 files / 3598 tests passed (after the `importCsv` type fix; before it, the backend typecheck failed with TS18048 at `export.spec.ts:573-574`).

Integration (`npm run test:int`) and e2e were not run: no criterion names them and the changed code is pure conversion logic covered by unit tests.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; run as `sh .taskcheck` and `npm run check`, both green on the final snapshot).

## Bugs found

No production defect blocks an acceptance criterion. One low-severity edge case, reported for the parent to decide (no failing test added, because the recorded assumption does not clearly require it and the export never produces such text):

### Representable instants written with an offset at the Date range edge are refused

Finding ID:

`TW-1`

Test:

None (observed with a temporary probe, removed). Reproduce: `convertCell('-271821-04-19T23:00:00-01:00', 'date')` and `convertCell('+275760-09-13T01:00+01:00', 'date')`.

Production source:

`packages/backend/src/io/csv/convert.ts:156-157` (`utc.setUTCFullYear(...)` / `setUTCHours(...)` builds the local wall-clock time before applying the offset)

Requirement:

Task assumption: the date type refuses "-000000 and results outside the JS Date range". Both inputs denote exactly the first/last representable instant (`-8.64e15` / `8.64e15` ms), i.e. a result inside the range.

Expected behavior:

Per the assumption's wording, both are accepted (`new Date(-8.64e15)` / `new Date(8.64e15)`).

Actual behavior:

Both throw `CellError('is not a date')`, because the wall-clock part alone is outside the range, so the intermediate `Date` is NaN and the field check fails. The mirrored forms that stay in range before the offset (`+275760-09-12T23:00-01:00`) are accepted.

Severity:

Low - CSV export always writes `Z` (`toISOString()`), so criterion 2 round-trips; only hand-written files with a non-zero offset on the two extreme days are affected.

Fix required:

`Optional - parent decides: either accept these (apply the offset before range checking) or reword the assumption/doc comment to "the date part and the result must be in range".`

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not separately computed as an intersection; both scoped files have 232/232 executable lines covered, so every executable changed line is covered. The only 2 uncovered branches (convert.ts:362, :376 in `recordToDocument`) are outside the task diff, so all branches on changed lines are covered too.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `csv-edge-cases`; base `ad4dde008e42b8df74f6b9f004ceb4067611ef01` (from parent); HEAD `a27a8aa43c0cafcb7d497306bad39036fb248189` = the single task commit (parent-supplied, confirmed by `git log ad4dde00..HEAD`).
- Source/test snapshot identifier (including uncommitted inputs): sha256 convert.ts `b07e39fda703033f019b0910004bb39d11f174d1228563c4bb27805990818e82`, csv.ts `e09a84720a49793e3637a2c62b154eacd3028c2663535c0b07cd27dccd3613c2` (both unchanged from HEAD), convert.spec.ts `17d8b3d9d14df3c0704b7cb9e00ad3755841b869a3ca3eb9ca19b28ea54ec7ef`, csv.spec.ts `e9353f21cb8b11e0ef656b34b46d9b265b15cad41d4f501d20c470bd5fe59ad9`, export.spec.ts `207ea92d34356c4ce44bfa6f70920c3dc380c7c0c9d014138cc0254fcd21670a` (uncommitted test changes).
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/io/csv/csv.ts`, `packages/backend/src/io/csv/convert.ts`. Excluded: `docs/ARCHITECTURE.md` (documentation), the three `*.spec.ts` (tests). `packages/backend/src/io/export.ts` is in the task's `touches` but has no production change in the diff, so it is not in scope. No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` with vitest 5.1.0 (node v24.21.0); `npx vitest run src/io --coverage --coverage.include='src/io/csv/csv.ts' --coverage.include='src/io/csv/convert.ts' --coverage.reporter=text --coverage.reporter=json-summary --coverage.reportsDirectory=coverage/csv-edge-cases-final` in `packages/backend`; all 7 spec files under `src/io`.
- Run start/completion time and exit status: started 2026-11-17 07:28:55 (local), duration 5.88 s, exit 0, 459/459 tests passed.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/csv-edge-cases-final/coverage-summary.json` sha256 `2a39448cfdc91b4f41c682e85e46132ce33bf2fb5857084f4da4f9e5d8e39563` (git-ignored; a fresh, previously non-existent directory).
- Evidence outputs are fresh and inputs stayed unchanged: yes - new output directory; source/test hashes taken right after the run match the snapshot above; production files unchanged versus HEAD (`git diff` shows only the three spec files).
- Final run after latest test additions and production fixes: yes (after the last test edit, the `importCsv` type fix; no production fixes were made).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/io/csv/convert.ts` | 191/191 (100%) | 166/168 (98.8%) | 23/23 (100%) | 153/153 (100%) |
| `packages/backend/src/io/csv/csv.ts` | 98/98 (100%) | 70/70 (100%) | 11/11 (100%) | 79/79 (100%) |
| Aggregate (both files, summed counters; no unmeasured files) | 289/289 (100%) | 236/238 (99.15%) | 34/34 (100%) | 232/232 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/io/csv/convert.ts:362` (`error instanceof Error ? ... : String(error)`, non-Error branch) | Pre-existing defensive fallback in `recordToDocument`; `convertCell` only throws `CellError`/`Error` | Not task code; not reachable without mocking `convertCell`; left uncovered |
| `packages/backend/src/io/csv/convert.ts:376` (`column.path.at(-1) ?? ''`) | Pre-existing defensive fallback for an empty path; mappings never yield one | Not task code; left uncovered |

No task-level coverage threshold is defined (`docs/ARCHITECTURE.md`: "No repository-wide percentage is enforced").

## Unable to test

- Criterion 4 (documentation) is not unit-testable; it was checked by inspecting the diff.
- CSV import of an exported file that holds both a literal `a.b` column and a whole `a` column (the dotted-key export case) was not asserted end to end: the recorded assumption only says import "still treats dots as nesting", and `defaultMapping` leaves out overlapping names, so no import behavior for that case is defined by the task. No follow-up needed unless a human wants that round trip.

## Summary

Tests added and all validation passed. No blocking production defect; one low-severity edge case (TW-1, offset forms at the Date range limits) is reported for the parent to accept or document. A pre-existing type error in the task commit's test helper (which failed `.taskcheck`) was fixed in test code.
