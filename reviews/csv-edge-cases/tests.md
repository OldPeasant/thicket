# Test Report

Date: 2026-11-17

Task: csv-edge-cases - CSV edge cases: one-column blank rows, dates beyond year 9999, dotted field names; ARCHITECTURE.md io section

Scope: `ad4dde008e42b8df74f6b9f004ceb4067611ef01..3dae8b2f1b49f4e640bcb7c6d7ccbed329875216` (task commits a27a8aa4 implementation, 087d412e tests/reports, 3dae8b2f fixes for CR-1 and TW-1), plus the uncommitted test additions of this second pass. This report replaces the first-pass report (measured at a27a8aa4).

Requirements:
- `tasks/csv-edge-cases.md` acceptance criteria and its two recorded assumptions (dotted field names; ±YYYYYY date years)
- `reviews/csv-edge-cases/review.md` CR-1, `reviews/csv-edge-cases/fixes.md` (CR-1, TW-1 fixes)
- `reviews/io-advanced/review.md` CR-1..CR-4 (background)
- `docs/ARCHITECTURE.md` "Coverage" and io section
- Parent instructions (scope, base commit, focused command, second-pass focus on `daysFromCivil` and date validation)

## Test files changed

- `packages/backend/src/io/csv/convert.spec.ts` (this pass)
- `packages/backend/src/io/csv/csv.spec.ts` (first pass, committed in 087d412e)
- `packages/backend/src/io/export.spec.ts` (first pass, committed in 087d412e)

## Tests added or updated

Count: 5 added in this pass (on top of the 15 added in the first pass and the fixer's tests in 3dae8b2f)

Added in this pass, `convert.spec.ts` > convertCell > date > "calendar arithmetic against the Date calendar". The reference is the `Date` calendar through `setUTCFullYear`/`setUTCHours`, not the code under test. `Date.UTC` is not used as the reference because it shifts years 0-99 to 19xx.
- "agrees on the first and last day of every month around 400-year era boundaries": 36 years (-271820, -270001, -2001, -801/-800, -401/-400/-399, -101/-100, -5/-4/-1/0/1, 99/100, 399/400/401, 1599-1601, 1899/1900, 1969/1970, 1999-2001, 9999/10000, 10399/10400, 270000, 275759) x 12 months x {day 1, last day} at 23:59:59.999. This covers the `month <= 2` year shift and the `Math.floor` era split for negative years in `daysFromCivil`.
- "agrees on seeded random date-times across the whole year range": 3000 date-times with a fixed-seed LCG, years -271820..275759, all time parts and milliseconds.
- "applies the Gregorian century rule to negative years": Feb 29 accepted in -4, -96, -400, -800, -2000, -271820. Refused in -100, -200, -300, -1900. This covers JS `%` on negative numbers (`-100 % 100 === -0`). `-000100-02-28T23:59:59.999Z` is 1 ms before `-000100-03-01`.
- "reads 1 to 3 fraction digits as milliseconds and truncates further digits": `.0`, `.1`=100, `.01`=10, `.001`=1, `.9999`=999 (truncation, no carry into the next second), `.0009`=0.
- "adds the fraction after the offset in negative years and at the range edges": `-000001-06-15T12:00:00.001+01:00`, `-271821-04-20T00:00:00.001Z` = -8.64e15+1, `-271821-04-19T23:00:00.5-01:00` = -8.64e15+500 (the wall clock is outside the range, the result is inside), `+275760-09-12T23:59:59.999Z` and `+275760-09-13T00:59:59.999+01:00` = 8.64e15-1.

Already present for the fixes (3dae8b2f, checked as sufficient): CR-1 "does not flatten the document value of a top-level dotted key", "keeps the document value of a top-level dotted key next to a colliding document", and "loses no value..." extended with both shapes. TW-1: both offset forms at the range limits are accepted and the 1 ms beyond forms refused. Earlier refusals of rolled-over parts (month 13/00, day 00, Feb 30, Apr 31, hour 24, minute/second 60, offset 24:00 / :60) still pass against the new explicit validation.

No existing test was changed or weakened. Prettier reformatted only the new block.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| 1. One-column CSV export of a document with an empty value round-trips (no dropped row) | csv.spec "writes a record of one empty cell as \"\"...", "reads back consecutive and trailing one-empty-cell records...", "quotes a one-cell record that is only whitespace..."; export.spec "a one-column export keeps documents with an empty, null or missing value", "a one-column export of a named dotted field...", "a one-column export collected from the documents..." | `npx vitest run packages/backend/src/io` | Pass |
| 2. Dates outside years 0000-9999 export in a form the `date` CSV type imports back | convert.spec "reads back the export text of a date in %s" (6), "reads the extended year form", "refuses the year form %j" (6), "reads the first and last representable instants...", "applies leap years and day ranges to extended years", the 5 "calendar arithmetic against the Date calendar" tests (this pass), "reads +000000 as year 0..."; export.spec "exports dates outside the years 0-9999 so that the date type imports them back" | `npx vitest run packages/backend/src/io` | Pass |
| 3. A field name containing a dot is exported with its value (behavior defined and documented) | convert.spec collectPaths "field names with a dot" (11, incl. the 2 CR-1 tests) and valueAt dotted-key tests (3); export.spec "exports fields whose name contains a dot with their values", "a one-column export of a named dotted field..." | `npx vitest run packages/backend/src/io` | Pass |
| 4. docs/ARCHITECTURE.md io section describes the CSV/BSON scanners instead of `UNSUPPORTED` | Manual inspection of `git diff ad4dde00..3dae8b2f -- docs/ARCHITECTURE.md`: `UNSUPPORTED until io-advanced` replaced; CSV export (incl. the CR-1 dotted-key sentence), CSV import (`CsvScanner`) and BSON (`BsonScanner`) bullets | `git diff` (inspection) | Not testable (documentation; inspected, matches) |

## Focused test execution

Command:

`npx vitest run packages/backend/src/io/csv/convert.spec.ts`, then `npx vitest run packages/backend/src/io` (repository root)

Result:

Pass. convert.spec: 145 tests. io: 7 files, 466 tests passed.

## Full test execution

Command:

`npm run check` (eslint + Prettier check + typecheck of all workspaces + root vitest + renderer `ng test`)

Result:

Pass. Lint and Prettier clean, typecheck clean. Vitest: 90 files, 4783 tests passed. Renderer: 107 files, 3598 tests passed.

Integration (`npm run test:int`) and e2e were not run. No criterion names them, and the changed code is pure conversion logic covered by unit tests.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` (AGENTS.md), which passed on the final snapshot. The script itself was not invoked separately in this pass.

## Bugs found

None. TW-1 from the first pass is fixed in 3dae8b2f and pinned by tests. The new differential tests agree with the `Date` calendar on every sampled case.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not computed separately as an intersection. Both scoped files have 237/237 executable lines covered, so every executable changed line is covered. Of the 3 uncovered branches, one is on a changed line (convert.ts:166, see the table below). The other two are outside the task diff.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `csv-edge-cases`; base `ad4dde008e42b8df74f6b9f004ceb4067611ef01` (from parent); HEAD `3dae8b2f1b49f4e640bcb7c6d7ccbed329875216`. Task commits a27a8aa4, 087d412e and 3dae8b2f were supplied by the parent and confirmed by `git log ad4dde00..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs), sha256:
  - convert.ts `bb56c0f8bcaa8cf22c85cb4ff6b14c329b5a3b799a798e15772a1b7f0181e0eb` (= HEAD)
  - csv.ts `e09a84720a49793e3637a2c62b154eacd3028c2663535c0b07cd27dccd3613c2` (= HEAD)
  - convert.spec.ts `21e455bd9c8b7154e4c14d49118ed4572017cf4d85d3ca772d2dbee37b06e9fc` (uncommitted additions from this pass)
  - csv.spec.ts `e9353f21cb8b11e0ef656b34b46d9b265b15cad41d4f501d20c470bd5fe59ad9` (= HEAD)
  - export.spec.ts `207ea92d34356c4ce44bfa6f70920c3dc380c7c0c9d014138cc0254fcd21670a` (= HEAD)
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/io/csv/csv.ts` and `packages/backend/src/io/csv/convert.ts`. Excluded `docs/ARCHITECTURE.md` (documentation), the three `*.spec.ts` (tests) and `reviews/` (reports). `packages/backend/src/io/export.ts` is in the task's `touches` but has no production change in the diff. No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8`, vitest 5.1.0. Command: `npx vitest run src/io --coverage --coverage.include='src/io/csv/csv.ts' --coverage.include='src/io/csv/convert.ts' --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json --coverage.reportsDirectory=coverage/csv-edge-cases-pass2`, run in `packages/backend`. Selection: all 7 spec files under `src/io`.
- Run start/completion time and exit status: started 2026-11-17 07:36:37 (local), duration 6.14 s, exit 0, 466/466 tests passed.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/csv-edge-cases-pass2/coverage-summary.json`, sha256 `8c524a538c75f9221b37c20fd0ccae760c17d28a80a211bd703890d0e4e1c920` (git-ignored; the directory did not exist before this run).
- Evidence outputs are fresh and inputs stayed unchanged: yes. The output directory is new, and the hashes above were taken right after the run. Production files are identical to HEAD; `git status` shows only convert.spec.ts as changed by this pass. `reviews/csv-edge-cases/review.md` was also modified in the working tree by another helper and is not an input.
- Final run after latest test additions and production fixes: yes. It ran after the last test edit, at HEAD 3dae8b2f, which includes the CR-1/TW-1 fixes.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/io/csv/convert.ts` | 196/196 (100%) | 178/181 (98.34%) | 24/24 (100%) | 158/158 (100%) |
| `packages/backend/src/io/csv/csv.ts` | 98/98 (100%) | 70/70 (100%) | 11/11 (100%) | 79/79 (100%) |
| Aggregate (both files, summed counters; no unmeasured files) | 294/294 (100%) | 248/251 (98.8%) | 35/35 (100%) | 237/237 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/io/csv/convert.ts:166` (`monthDays[month - 1] ?? 0`, the `?? 0` fallback) | Task code (TW-1 fix), a type-level fallback for `noUncheckedIndexedAccess`. `month` is already checked to be 1-12 on the preceding lines, so the index is always defined. | Unreachable; no test possible without changing production code. Month 00/13 refusals are tested. |
| `packages/backend/src/io/csv/convert.ts:379` (`error instanceof Error ? ... : String(error)`, the non-Error branch) | Existing defensive fallback in `recordToDocument`; `convertCell` only throws `CellError`/`Error`. | Not task code; not reachable without mocking `convertCell`; left uncovered. |
| `packages/backend/src/io/csv/convert.ts:393` (`column.path.at(-1) ?? ''`) | Existing defensive fallback for an empty path; mappings never produce one. | Not task code; left uncovered. |

No task-level coverage threshold is defined (`docs/ARCHITECTURE.md`: "No repository-wide percentage is enforced").

## Unable to test

- Criterion 4 (documentation) cannot be unit tested. It was checked by inspecting the diff.
- CSV import of an exported file that holds both a literal `a.b` column and a whole `a` column was not asserted end to end. The recorded assumption only says import "still treats dots as nesting", and `defaultMapping` leaves out overlapping names, so the task defines no import behavior for that case. No follow-up is needed unless a human wants that round trip.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. This pass added 5 tests that check the new date arithmetic (`daysFromCivil`, explicit part validation, fractions, offsets at the range edges) against the `Date` calendar across eras and negative years. All validation passed at HEAD 3dae8b2f plus the uncommitted test additions.
