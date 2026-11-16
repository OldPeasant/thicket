# Test Report

Date: 2026-11-16

Task: bson-inputs (M1: Explorer edits BSON values without changing types), round 3 on the final code

Scope: `git diff 8cd79004a2366c4e26eabc9767cc2cde28820f73..f5059914321accfcdb23b0cfa4bac86700fcd667 -- packages` on branch main. The parent worker supplied the base (merge-base with origin/main) and HEAD. Task commits: 9351828, a1f3dfc, 2b10d2c, b3c6e8b, 4b1c5e3, ef8b4f6, f505991. They match `git log 8cd7900..HEAD` and the task's `touches: packages/renderer/src/app/explorer`. Round 3 focuses on the only code change since round 2, which is f505991 (round-2 fix CR-1). In that change, `parseDate` accepts a bare integer as epoch ms only outside the JS Date range, and `DATE_LIMIT_MS` is exported from `bson-value.util.ts`. The working tree was clean before and after this round, apart from this report.

Requirements:
- `tasks/bson-inputs.md`: the acceptance criteria and recorded assumptions
- `reviews/bson-inputs/review.md` (round-2 CR-1) and `reviews/bson-inputs/fixes.md` (approved rule: a bare integer is Int64-checked first, accepted as ms only when `|ms| > 8_640_000_000_000_000`, otherwise rejected as "not an ISO-8601 date")
- `SPEC.md`, `docs/ARCHITECTURE.md` ("Coverage"), `AGENTS.md`
- Parent worker instructions for round 3

## Test files changed

None in round 3. The fix commit f505991 already changed `bson-input.util.spec.ts` and `bson-input/bson-input.component.spec.ts`, and I reviewed those changes. All of the task's test files were run.

## Tests added or updated

Count: 0

I checked whether the fix's tests were sufficient against the approved rule:
- Inside the range, rejected: `2024`, `20240501`, `1700000000000`, `0`, `-0`, and both exact limits `±8640000000000000`, each in UTC and in Europe/Zurich ("rejects a bare integer within the JS date range as not ISO-8601").
- Just outside the range, accepted: `±8640000000000001`, `-10^17`, and the Int64 ends. Int64 overflow on both sides still gets the "overflows" error, so the overflow check still comes before the range check ("reads a bare signed integer outside the JS date range…", "accepts the lowest Int64 milliseconds and rejects one below").
- Round trip: the text `editText` shows for `±8640000000000001`, `±10^17` and the Int64 ends parses back in both zones. The existing `editText` tests show that dates exactly at `±DATE_LIMIT_MS` appear as ISO text (`+275760-09-13T00:00:00.000Z`) and parse back, so the rule does not leave any shown text that cannot be parsed.
- Component: typing `2024` into a date input shows the ISO-8601 error and emits nothing. The round-2 component test "a date outside the JS range is edited as milliseconds; Int64 overflow is rejected" still passes.

Coverage confirms that every line and both sides of each new condition (`bson-input.util.ts:157-161`) were run (see Coverage). I found no gap that is worth an extra test.

## Requirement coverage

All rows were run with `cd packages/renderer && npx ng test --coverage …` (52 files, 1224 tests, the command is under Coverage) and again in `npm run check` at the repo root.

| Requirement | Tests | Command | Result |
|---|---|---|---|
| Round-2 CR-1: a bare integer within the JS Date range (a year, a compact date, small ms, the exact limits) is rejected as not ISO-8601 and is not saved as a 1970 date | `parseDate` "rejects a bare integer within the JS date range as not ISO-8601"; `BsonInputComponent` "a bare year typed into a date input is rejected, not read as milliseconds" | `cd packages/renderer && npx ng test --coverage …` | Pass |
| Round-2 CR-1: a bare integer outside the range stays editable as ms; Int64 overflow is rejected | `parseDate` "reads a bare signed integer outside the JS date range as milliseconds, within Int64", "accepts the lowest Int64 milliseconds and rejects one below", "the bare milliseconds shown for out-of-range dates parse back in any zone"; component "a date outside the JS range is edited as milliseconds; Int64 overflow is rejected" | same | Pass |
| AC1: typed inputs keep the BSON type; overflow and invalid ObjectId rejected; earlier fixes (a), TW-1, TW-2, CR-4 | `bson-inputs.spec.ts` "typed inputs"; `parse*` blocks; `BsonInputComponent` suite; `editText` round-trip tests | same | Pass |
| AC2: dropdown conversions follow the bson-model table; impossible conversions disabled; CR-2 memo | `bson-inputs.spec.ts` "type dropdown"; `typeOptions and convertValue`; `EditableValueComponent` dropdown tests | same | Pass |
| AC3a: new number default (Int32/Int64/Double); CR-3 | `bson-inputs.spec.ts` "new numbers"; `newNumber`; `NumberDefaultService` spec; `fromExplorerValue` tests | same | Pass |
| AC3b: field moves; CR-5 moves only without declared keys | `bson-inputs.spec.ts` "field order"; `key-order.util.spec.ts` | same | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --coverage --coverage-include=… (9 files, see Coverage)`. This is the whole renderer suite with coverage.

Result:

Pass. 52 files and 1224 tests passed, and the command exited 0.

## Full test execution

Command:

`npm run check` (repo root)

Result:

Pass. ESLint (`--max-warnings 0`), Prettier `--check` and the type check are clean. The root Vitest run passed 46 files and 2829 tests, and the renderer `ng test` run passed 52 files and 1224 tests. The command exited 0 (run 23:33:44 to 23:34:28 +01:00).

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` when `package.json` exists, and that is the run recorded above.

## Bugs found

None. The round-2 CR-1 fix behaves as the approved rule in `fixes.md` describes.

## Coverage

Status: verified. The run was fresh, all tests passed, and all 9 task-changed `.ts` production files were measured.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: 353/354 executable added or modified lines are covered (99.72%). Method: I intersected the lcov `DA` lines from the run below with the `+` line ranges of `git diff -U0 8cd7900..f505991` for the 9 files. Removed and non-executable lines are not counted. The one uncovered changed line is `bson-input.util.ts:264`, a defensive rethrow. Every line and branch of the round-3 change (`bson-input.util.ts:157-161`, `bson-value.util.ts:219`) is covered: the BRDA counts for the new condition at line 160 are 18/15 and 33/24. Changed-branch coverage was not measured as a separate aggregate.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `bson-inputs`; base `8cd79004a2366c4e26eabc9767cc2cde28820f73`; HEAD `f5059914321accfcdb23b0cfa4bac86700fcd667`; task commits 9351828, a1f3dfc, 2b10d2c, b3c6e8b, 4b1c5e3, ef8b4f6, f505991. The parent supplied them, and I confirmed them with `git log` and `git diff --name-status 8cd7900..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD f505991 with a clean working tree, so there were no uncommitted inputs. Production sha256 values: bson-input.util.ts `415268b0ed1d8c5b975eb92e54adc511f935cc6af1a570cebc06e96f24f99834`, bson-value.util.ts `5467fcfd68aa9bfe2ba72880f2478bdee7e03bd5b14a86beb39ac1dadee608c0`, bson-input.component.ts `e671a3bd…1382`, editable-value.component.ts `1c8d1efd…6b07`, form-fields.util.ts `745f8976…e82e`, json-edit.util.ts `1579ce8d…bf21`, json-form.component.ts `89519634…7072`, key-order.util.ts `4e9e04dd…6b06`, number-default.service.ts `84c25917…e6b9`. Spec sha256 values: bson-input.util.spec.ts `93216a4b…07ca`, bson-input.component.spec.ts `7321d3d3…85df`.
- Exact included files: under `packages/renderer/`, `src/app/explorer/bson-input.util.ts`, `bson-input/bson-input.component.ts`, `bson-value.util.ts`, `editable-value/editable-value.component.ts`, `form-fields.util.ts`, `json-edit.util.ts`, `json-form/json-form.component.ts`, `key-order.util.ts`, `services/number-default.service.ts`. Excluded: the task's `.html` and `.css` files, because V8 does not instrument templates or styles (the component specs exercise the templates). There are no renamed or deleted files, and no scoped file is missing from the report.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` through the Angular `ng test` builder, cwd `packages/renderer`. Command: `npx ng test --coverage --coverage-include=src/app/explorer/bson-input.util.ts --coverage-include=src/app/explorer/bson-input/bson-input.component.ts --coverage-include=src/app/explorer/bson-value.util.ts --coverage-include=src/app/explorer/editable-value/editable-value.component.ts --coverage-include=src/app/explorer/form-fields.util.ts --coverage-include=src/app/explorer/json-edit.util.ts --coverage-include=src/app/explorer/json-form/json-form.component.ts --coverage-include=src/app/explorer/key-order.util.ts --coverage-include=src/app/explorer/services/number-default.service.ts`. Selection: the whole renderer suite, unfiltered.
- Run start/completion time and exit status: Vitest started at 23:33:09 +01:00 and reports were written at 23:33:17. The exit status was 0 (`&& echo EXIT_OK` printed), and 52 files and 1224 tests passed.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` has sha256 `8a834beec187e50f2cf6453afe100cba561e3b8131db20d877238c6f9fcf9166` and mtime 23:33:17.210. `packages/renderer/coverage/renderer/lcov.info` has sha256 `017d88a794fc8e6220608b41e4145b501c4a51d98e4b9d6a90ccd193a5a52293` and mtime 23:33:17.227.
- Evidence outputs are fresh and inputs stayed unchanged: yes. Both report mtimes fall inside this run, and the hashes differ from the round-2 reports (`36d826c0…659f`, `1ab4abef…94cb`). The working tree was clean before and after, so the inputs equal HEAD f505991.
- Final run after latest test additions and production fixes: yes. It ran on f505991, which includes the round-2 CR-1 fix, and round 3 added no tests.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `src/app/explorer/bson-input.util.ts` | 197/199 (98.99%) | 158/162 (97.53%) | 29/29 (100%) | 164/165 (99.39%) |
| `src/app/explorer/bson-input/bson-input.component.ts` | 90/91 (98.90%) | 78/85 (91.76%) | 25/25 (100%) | 79/79 (100%) |
| `src/app/explorer/bson-value.util.ts` | 137/137 (100%) | 135/137 (98.54%) | 27/27 (100%) | 118/118 (100%) |
| `src/app/explorer/editable-value/editable-value.component.ts` | 59/72 (81.94%) | 44/59 (74.57%) | 20/26 (76.92%) | 50/59 (84.74%) |
| `src/app/explorer/form-fields.util.ts` | 16/16 (100%) | 7/8 (87.5%) | 2/2 (100%) | 14/14 (100%) |
| `src/app/explorer/json-edit.util.ts` | 32/41 (78.04%) | 23/25 (92%) | 6/9 (66.66%) | 25/34 (73.52%) |
| `src/app/explorer/json-form/json-form.component.ts` | 74/114 (64.91%) | 51/87 (58.62%) | 32/49 (65.3%) | 68/101 (67.32%) |
| `src/app/explorer/key-order.util.ts` | 46/46 (100%) | 14/14 (100%) | 13/13 (100%) | 33/33 (100%) |
| `src/app/explorer/services/number-default.service.ts` | 23/23 (100%) | 11/11 (100%) | 6/6 (100%) | 18/18 (100%) |
| Aggregate (summed counters, all 9 files; templates/styles excluded, none unmeasured) | 674/739 (91.20%) | 521/588 (88.61%) | 160/186 (86.02%) | 569/621 (91.63%) |

The lower numbers for `editable-value`, `json-edit` and `json-form` come from code that existed before the task. All of their changed executable lines are covered: 31/31, 2/2 and 12/12.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `bson-input.util.ts:264` (and branch at 263) | `viaConvert` rethrows a non-`ConversionError` | Defensive. Core `convert` from a string throws only `ConversionError`. Justified gap |
| `bson-input.util.ts:365` (branch) | `typeOptions` rethrows a non-`ConversionError` | Defensive, for the same reason |
| `bson-input.util.ts:393-394` (branches) | `?? 0` fallbacks for UUID bytes 6 and 8 of a 16-byte array | Not reachable, because the array always has 16 entries |
| `bson-input/bson-input.component.ts` (7 branches, 1 statement) | `''` fallbacks of part getters for other types; `sameValue` type mismatch | The template shows each getter only for its own type, so these are trivial or defensive. The same as round 2 |
| `bson-value.util.ts:331-332` (branches) | BC-era and missing-part fallbacks of `zoneOffsetMs` | Code from before the task, out of scope |
| `editable-value.component.ts` (enum choice, plain `commitString`/`commitNumber`/`commitBoolean`) | Schema enum dropdown and plain value commits | Code from before the task. All task-changed lines are covered |
| `json-form.component.ts` (`fieldIndex` `?? -1`, `moveField` on an unknown key or past either end; reveal paging, ghosts, variants, table hand-off) | Defensive move guards; code from before the task | The UI offers moves only for own keys and disables moves past the ends (tested). The rest is out of scope |
| `json-edit.util.ts`, `form-fields.util.ts:32` | `defaultForType`, `withItem`/`withoutItemAt`/`withAppended`, the ghost `required` fallback | Code from before the task, out of scope |

## Unable to test

- The real browser `datetime-local` widget was not exercised. The unit tests drive its `change` event in the test DOM, and `npm run test:e2e` was not part of this round. The acceptance criteria name component tests, so no follow-up is needed.
- These items carry over from earlier rounds and are observations, not defects. `NumberDefaultService` was not tested for the case where `app.settings.changed` arrives before the initial `get` reply (the Electron channel orders them). No production caller passes the integer default to `fromExplorerValue` yet. Round-2 CR-2 (the integer default for unedited plain numbers in the badge and dropdown) was deferred by the parent worker, so it has no tests here.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The round-2 CR-1 fix is fully covered by the tests in f505991, so round 3 added none. The renderer suite (1224 tests), `npm run check` and `.taskcheck` pass. Changed-line coverage is 353/354, and the one uncovered line is a defensive rethrow.
