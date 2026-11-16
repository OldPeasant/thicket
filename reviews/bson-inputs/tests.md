# Test Report

Date: 2026-11-16

Task: bson-inputs (M1: Explorer edits BSON values without changing types), round 2 after fixes

Scope: `git diff 02689abc90c72a0e8f6393141b4e40a46ff4962c..4da0a3ae2675fa76dc2fe890d6ddbc589dd43280 -- packages` on branch main. Task commits 304ae56, 1f891cd, 8d76754 and 4da0a3a. The parent worker supplied the base and the commit list, and they match `git log` and the task's `touches: packages/renderer/src/app/explorer`. Round 2 focuses on the fixes in 4da0a3a (CR-1..CR-5, TW-1, TW-2). The tests in this report are uncommitted changes to five spec files on top of 4da0a3a (hashes below). No production file is modified in the working tree.

Requirements:
- `tasks/bson-inputs.md`: the three acceptance criteria and the four recorded assumptions (type dropdown table and empty-value exception, new-number default, field order, typed-input commit/Escape/date rules)
- `reviews/bson-inputs/review.md`, `tests.md` (round 1) and `fixes.md`: approved fix requirements (a) commit is a no-op on untouched text, (b) `parseDate` reads bare Int64 milliseconds and `±HH:MM:SS` offsets, plus CR-2 memo/container shortcut, CR-3 `fromExplorerValue(value, integers)`, CR-4 stale error cleared on outside change, CR-5 moves only without declared keys
- `SPEC.md`, `docs/ARCHITECTURE.md` ("Coverage"), `AGENTS.md`
- Parent worker instructions for round 2

## Test files changed

Uncommitted in round 2 (on top of 4da0a3a):
- `packages/renderer/src/app/explorer/bson-input.util.spec.ts`
- `packages/renderer/src/app/explorer/bson-input/bson-input.component.spec.ts`
- `packages/renderer/src/app/explorer/bson-inputs.spec.ts`
- `packages/renderer/src/app/explorer/bson-value.util.spec.ts`
- `packages/renderer/src/app/explorer/editable-value/editable-value.component.spec.ts`

The task's committed test files were run and not changed: `key-order.util.spec.ts`, `services/number-default.service.spec.ts`, `json-edit.util.spec.ts`, `bson-display.spec.ts`, and the committed parts of the five files above.

## Tests added or updated

Count: 14 added, 0 changed, 0 removed.

An interrupted earlier round-2 run left 9 of them. I reviewed them: they assert approved behavior, are deterministic and pass, so I kept them unchanged. I added the other 5.

- `bson-input.util.spec.ts` > `parseDate`:
  - "accepts the lowest Int64 milliseconds and rejects one below"
  - "bounds each unit of a seconds offset (hours < 24, minutes and seconds < 60)"
  - "the shown text of extended-year dates in local mean time parses back"
  - "the bare milliseconds shown for out-of-range dates parse back in any zone" (new)
- `bson-input.component.spec.ts` > `BsonInputComponent`:
  - "leaving another, untouched part keeps the error of the invalid one"
  - "a new value from outside rewrites the invalid part, not the others"
  - "a new value of another type from outside clears the error"
  - "after an outside change, the old shown text is an edit again"
  - "a type change that replaces the invalid input clears the error safely" (new; the invalid input is no longer in the DOM, which is the `isConnected` path)
  - "a date outside the JS range is edited as milliseconds; Int64 overflow is rejected" (new)
- `bson-inputs.spec.ts` > "field order":
  - "offers moves under a schema that declares no keys for the object"
  - "after deleting the last field, the new last one cannot move down" (the `keyIndex` memo follows the deletion)
- `bson-value.util.spec.ts`:
  - "maps unsafe, -0 and non-finite numbers to Double under every integer default" (new; CR-3 edges)
- `editable-value.component.spec.ts`:
  - "emits nothing for the current type or a conversion that is not possible" (new). It covers the `onTypeChange` current-type branch and the stale disabled option, and checks that the select falls back to the current type.

The round-1 and fix-round tests already covered the remaining fix areas named by the parent: the CR-2 memo (`reuses the options while the value and the schema types stay the same`), the container shortcut (`enables for a filled document or array exactly what converting it allows`), the CR-3 nested and BsonLeaf cases, the CR-1 untouched-input cases, and the CR-5 schema-order case. I did not duplicate them.

## Requirement coverage

All rows were run with `cd packages/renderer && npx ng test` (52 files, 1222 tests) and again in `npm run check` at the repo root.

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: editing an Int64 keeps Int64; overflow shows an error; invalid ObjectId rejected | `bson-inputs.spec.ts` "typed inputs"; `parseInt32`/`parseInt64`/`parseDouble`/`parseDecimal`/`parseObjectId` blocks; `BsonInputComponent` "leaving an untouched input" (15 cases), "an error stays until a valid value is typed" | `cd packages/renderer && npx ng test` | Pass |
| Fix (a) / CR-1: commit is a no-op on the shown text; error stays with the input holding invalid text | `BsonInputComponent` "leaving an untouched input" (incl. Date before 1894 in Zurich, Date outside JS range), "the shown text typed back after an error clears it without emitting", "leaving another, untouched part keeps the error of the invalid one", "after an outside change, the old shown text is an edit again" | `cd packages/renderer && npx ng test` | Pass |
| Fix (b) / TW-1 / TW-2: `parseDate` reads `±HH:MM:SS` offsets and bare Int64 ms; shown text round-trips | `parseDate` "reads a bare signed integer…", "reads an offset with seconds", "accepts the lowest Int64 milliseconds…", "bounds each unit of a seconds offset…", "the shown text of extended-year dates in local mean time parses back", "the bare milliseconds shown for out-of-range dates parse back in any zone"; `editText` round-trip tests (whole-minute, extended years, seconds offsets); component "a date outside the JS range is edited as milliseconds…" | `cd packages/renderer && npx ng test` | Pass |
| CR-4: a value from outside clears a stale error and rewrites the invalid input | "a new value from outside clears the error and shows the new value", "…rewrites the invalid part, not the others", "a new value of another type…", "a type change that replaces the invalid input clears the error safely" | `cd packages/renderer && npx ng test` | Pass |
| AC2: dropdown conversions follow the bson-model table; impossible conversions disabled | `bson-inputs.spec.ts` "type dropdown"; `typeOptions and convertValue` block; `EditableValueComponent type dropdown with a schema` incl. "marks the current type and disables impossible conversions in the DOM", "emits nothing for the current type or a conversion that is not possible" | `cd packages/renderer && npx ng test` | Pass |
| CR-2: options memoized; filled containers decided by type alone with identical result | "reuses the options while the value and the schema types stay the same"; "enables for a filled document or array exactly what converting it allows" | `cd packages/renderer && npx ng test` | Pass |
| AC3a: new numeric value defaults per setting (Int32/Int64/Double) | `bson-inputs.spec.ts` "new numbers"; `newNumber` block; `NumberDefaultService` spec; "a plain number typed becomes the configured BSON number" | `cd packages/renderer && npx ng test` | Pass |
| CR-3: `fromExplorerValue(value, integers)` applies the integer default | "maps plain JS numbers by the integer default it is given, also when nested"; "maps unsafe, -0 and non-finite numbers to Double under every integer default"; "maps typed-in JS numbers to Int32 when they fit, Double otherwise" (default) | `cd packages/renderer && npx ng test` | Pass |
| AC3b: fields can be moved; CR-5 moves only without declared keys; `keyIndex` memo | `bson-inputs.spec.ts` "field order" (6 tests incl. integer-like keys, schema-declared keys, schema without declared keys, deletion of last field); `key-order.util.spec.ts` | `cd packages/renderer && npx ng test` | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/explorer/editable-value/editable-value.component.spec.ts'` (after adding the dropdown test), then `cd packages/renderer && npx ng test`

Result:

Pass. The focused run had 1 file and 11 tests. The renderer suite had 52 files and 1222 tests, all passed. Before my additions the suite was 1217/1217, which already included the 9 tests left by the earlier run.

## Full test execution

Command:

`npm run check` (repo root: `npm run lint && npm run typecheck && npm run test`)

Result:

Pass. ESLint and Prettier are clean, and the type check passes in all workspaces. Root Vitest: 46 files, 2829 tests passed. Renderer `ng test`: 52 files, 1222 tests passed.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` because `package.json` exists, and that run is the one recorded above.

## Bugs found

None. No test found a production defect in round 2, and every round-1 finding covered by tests (TW-1, TW-2) now passes.

## Coverage

Status: verified. The run was fresh, exited with all tests passing, and covers all 9 task-changed `.ts` production files.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: 351/352 executable added or modified lines covered (99.7%). Method: I intersected the lcov `DA` lines from the run below with the `+` line ranges of `git diff -U0 02689ab..4da0a3a` for the 9 files. Removed and non-executable lines are not counted. The one uncovered changed line is `bson-input.util.ts:258`. Changed-branch coverage was not measured separately.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `bson-inputs`; base `02689abc90c72a0e8f6393141b4e40a46ff4962c`; HEAD `4da0a3ae2675fa76dc2fe890d6ddbc589dd43280`; task commits 304ae56, 1f891cd, 8d76754, 4da0a3a. The parent worker supplied them, and I confirmed them with `git log` and `git diff --name-status 02689ab..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 4da0a3a with no production changes. Production sha256 values were identical before and after the run: bson-input.util.ts `08d530df…6b9`, bson-input.component.ts `e671a3bd…382`, bson-value.util.ts `2ad5ad10…637`, editable-value.component.ts `1c8d1efd…e07`, form-fields.util.ts `745f8976…f80`, json-edit.util.ts `1579ce8d…f21`, json-form.component.ts `89519634…207`, key-order.util.ts `4e9e04dd…b06`, number-default.service.ts `84c25917…9b9`. Uncommitted test sha256: bson-input.util.spec.ts `7ac38081…efd`, bson-input.component.spec.ts `8ac93bea…e9ed`, bson-inputs.spec.ts `5af63761…c32`, bson-value.util.spec.ts `626a58be…0d7`, editable-value.component.spec.ts `f053babf…673`.
- Exact included files: under `packages/renderer/`, `src/app/explorer/bson-input.util.ts`, `bson-input/bson-input.component.ts`, `bson-value.util.ts`, `editable-value/editable-value.component.ts`, `form-fields.util.ts`, `json-edit.util.ts`, `json-form/json-form.component.ts`, `key-order.util.ts`, `services/number-default.service.ts`. Excluded: the task's `.html` and `.css` files (`bson-input.component.html/.css`, `editable-value.component.html/.css`, `json-form.component.html/.css`), because V8 does not instrument templates or styles; the component specs exercise the templates. There are no renamed or deleted files. No file is missing from the report.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` 5.1.0 through the Angular `ng test` builder, cwd `packages/renderer`. Command: `npx ng test --coverage --coverage-include='src/app/explorer/bson-input.util.ts' --coverage-include='src/app/explorer/bson-input/bson-input.component.ts' --coverage-include='src/app/explorer/bson-value.util.ts' --coverage-include='src/app/explorer/editable-value/editable-value.component.ts' --coverage-include='src/app/explorer/form-fields.util.ts' --coverage-include='src/app/explorer/json-edit.util.ts' --coverage-include='src/app/explorer/json-form/json-form.component.ts' --coverage-include='src/app/explorer/key-order.util.ts' --coverage-include='src/app/explorer/services/number-default.service.ts'`. Selection: the whole renderer suite, unfiltered.
- Run start/completion time and exit status: started 2026-11-16 23:24:00 +01:00 (Vitest start 23:24:10) and completed 23:24:26. All 52 files and 1222 tests passed. The output went through `grep`/`tail`, so I did not capture the process exit code separately. The pass line and the freshly written reports show the run completed.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json`, sha256 `36d826c08cb3c54abd2b971c9b0da1f8509bc00b72d5cd7c31808b06c127659f`, mtime 23:24:26.303. `packages/renderer/coverage/renderer/lcov.info`, sha256 `1ab4abef7c4275a5bbcb13b0542222e17993696bc02ba487bbbdbea262f494cb`, mtime 23:24:26.332.
- Evidence outputs are fresh and inputs stayed unchanged: yes. Both report mtimes fall inside the run, they differ from the earlier pre-addition run (summary sha256 `eca6d55a…7ce` at 23:23:00), and the source and test hashes matched before and after.
- Final run after latest test additions and production fixes: yes. It ran after all 14 round-2 tests were in place, on the fixed code 4da0a3a.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `src/app/explorer/bson-input.util.ts` | 195/197 (98.98%) | 154/158 (97.46%) | 29/29 (100%) | 163/164 (99.39%) |
| `src/app/explorer/bson-input/bson-input.component.ts` | 90/91 (98.90%) | 78/85 (91.76%) | 25/25 (100%) | 79/79 (100%) |
| `src/app/explorer/bson-value.util.ts` | 137/137 (100%) | 135/137 (98.54%) | 27/27 (100%) | 118/118 (100%) |
| `src/app/explorer/editable-value/editable-value.component.ts` | 59/72 (81.94%) | 44/59 (74.57%) | 20/26 (76.92%) | 50/59 (84.74%) |
| `src/app/explorer/form-fields.util.ts` | 16/16 (100%) | 7/8 (87.5%) | 2/2 (100%) | 14/14 (100%) |
| `src/app/explorer/json-edit.util.ts` | 32/41 (78.04%) | 23/25 (92%) | 6/9 (66.66%) | 25/34 (73.52%) |
| `src/app/explorer/json-form/json-form.component.ts` | 74/114 (64.91%) | 51/87 (58.62%) | 32/49 (65.3%) | 68/101 (67.32%) |
| `src/app/explorer/key-order.util.ts` | 46/46 (100%) | 14/14 (100%) | 13/13 (100%) | 33/33 (100%) |
| `src/app/explorer/services/number-default.service.ts` | 23/23 (100%) | 11/11 (100%) | 6/6 (100%) | 18/18 (100%) |
| Aggregate (summed counters, all 9 files; templates/styles excluded, none unmeasured) | 672/737 (91.18%) | 517/584 (88.52%) | 160/186 (86.02%) | 568/620 (91.61%) |

The lower numbers for `editable-value`, `json-edit` and `json-form` come from code that existed before the task. All 12 changed executable lines in `json-form.component.ts`, all 31 in `editable-value.component.ts` and both in `json-edit.util.ts` are covered.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `bson-input.util.ts:257-258` | `viaConvert` rethrows a non-`ConversionError` | Defensive; core `convert` from a string throws only `ConversionError`. Justified gap |
| `bson-input.util.ts:359` (branch) | `typeOptions` rethrows a non-`ConversionError` | Defensive; same reason |
| `bson-input.util.ts:387-388` (branches) | `?? 0` fallbacks for UUID bytes 6/8 of a 16-byte array | Not reachable (the array always has 16 entries) |
| `bson-input/bson-input.component.ts:80-104` (branches), `:254` | `''` fallbacks of part getters for other types; `sameValue` type mismatch | The template shows each getter only for its own type, and parsers return the edited type. Trivial or defensive |
| `editable-value.component.ts:50, 85-90, 132-139` (`choiceIndex`/`choiceLabel`/`onChoice`), `:162` (`commitString`), `:169-170` (`commitNumber` empty/NaN), `:176` (`commitBoolean`) | Schema enum dropdown and plain value commits | Code from before the task (blame `^02689ab`). The task's `onTypeChange` branches are now covered by "emits nothing for the current type or a conversion that is not possible" |
| `json-form.component.ts:341, 352, 354` (branches) | `fieldIndex` `?? -1`, `moveField` on an unknown key, and a no-op move past either end | The UI shows moves only for own keys and disables up on the first and down on the last field (tested). Defensive |
| `json-form.component.ts` (other uncovered lines) | Reveal paging, schema ghosts, variant switch, table hand-off | Code from before the task, out of scope |
| `json-edit.util.ts:17, 28-30, 76-88`; `bson-value.util.ts:331-332`; `form-fields.util.ts:32` | `defaultForType`, `withItem`/`withoutItemAt`/`withAppended`, the BC-era/missing-part fallbacks of `zoneOffsetMs`, the ghost `required` fallback | Code from before the task (blame `^02689ab`), out of scope |

## Unable to test

- The real browser `datetime-local` input widget was not exercised. The unit tests drive its `change` event in the test DOM, and an e2e run (`npm run test:e2e`) was not part of this round. No follow-up is needed for the acceptance criteria, which name component tests.
- From round 1, still applicable: `NumberDefaultService` ordering when `app.settings.changed` arrives before the initial `get` reply was not tested (the Electron channel orders them). Also, `init()` resolves early when loading has already started. No production code awaits it. Observation only.
- CR-3 note (not a test gap): no production caller passes the integer default to `fromExplorerValue` yet (see `fixes.md`). The function behaves as specified when given the setting. Wiring it into a save path is outside this task's explorer scope.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. All 14 round-2 tests pass. The renderer suite (1222 tests), `npm run check` and `.taskcheck` pass. Changed-line coverage is 351/352, and the one uncovered line is a defensive rethrow.
