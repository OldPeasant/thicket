# Test Report

Date: 2026-11-16

Task: bson-inputs (M1: Explorer edits BSON values without changing types)

Scope: `git diff fc84d7a400ffc80511c5e7337fabf160126c7369..b47a8f5b94e74e0751097848c20381a3f23a8be4 -- packages` (task commits ba71ffa, b47a8f5 on branch main; base and commit list supplied by the parent worker and matching `tasks/bson-inputs.md` touches `packages/renderer/src/app/explorer`). The tests in this report are uncommitted working-tree changes on top of b47a8f5 (hashes below).

Requirements:
- `tasks/bson-inputs.md` acceptance criteria and the four recorded assumptions (type dropdown table and empty-value exception, new-number default, field order, typed-input commit/Escape/date rules)
- `SPEC.md`, `docs/ARCHITECTURE.md` (Coverage section), `AGENTS.md`
- Parent worker instructions (focus areas listed for bson-input.util, key-order.util, NumberDefaultService, blankLike)

## Test files changed

- `packages/renderer/src/app/explorer/bson-input.util.spec.ts` (new)
- `packages/renderer/src/app/explorer/key-order.util.spec.ts` (new)
- `packages/renderer/src/app/explorer/services/number-default.service.spec.ts` (new)
- `packages/renderer/src/app/explorer/bson-input/bson-input.component.spec.ts` (new)
- `packages/renderer/src/app/explorer/editable-value/editable-value.component.spec.ts` (new)
- `packages/renderer/src/app/explorer/json-edit.util.spec.ts` (added a `blankLike with BSON values` describe block; existing tests untouched)

The existing task spec `bson-inputs.spec.ts` (component tests written by the implementer for the acceptance criteria) was run, not changed.

## Tests added or updated

Count: 161 (86 in bson-input.util.spec, 21 key-order.util.spec, 8 number-default.service.spec, 32 bson-input.component.spec, 9 editable-value.component.spec, 5 json-edit.util.spec). 3 of them fail and document production defects TW-1 and TW-2.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: editing an Int64 keeps Int64; overflow shows an error; invalid ObjectId rejected | `bson-inputs.spec.ts` "typed inputs" (existing); `parseInt32`, `parseInt64`, `parseDouble`, `parseDecimal`, `parseObjectId` blocks (bounds ±1, -0, Infinity/NaN, Decimal128 exponent/precision overflow); `BsonInputComponent` "an error stays until a valid value is typed", "-0 and 0 are different Doubles", "leaving an untouched input" (13 types) | `cd packages/renderer && npx ng test` | Pass, except TW-1/TW-2 (below) |
| Typed inputs per type (UUID/Binary, Regex flags, Timestamp, Date, Code), commit on blur/Enter, Escape reverts (assumption 4) | `parseUuid`, `parseBinary`, `parseRegex`, `parseTimestamp`, `parseDate`, `wallTimeToMs`, `dateToWallTime`, `editText` blocks; `BsonInputComponent` part edits, Enter, Escape, picker tests | `npx ng test` | Pass, except 3 tests: Fail (TW-1, TW-2) |
| Date input: DST gap/overlap in Europe/Zurich, UTC mode, zone suffix, no offset = shown zone | `wallTimeToMs` gap/overlap/edge tests and full-year 15-min round-trip sweeps for Europe/Zurich, America/St_Johns, Australia/Lord_Howe, Pacific/Chatham, Asia/Kathmandu; `parseDate` blocks | `npx ng test` | Pass |
| ObjectId generate (clock + random + counter) | `generateObjectId` block (injected clock/random, counter +1 mod 2^24, 32-bit wrap, defaults); component "Generate replaces the ObjectId and clears an error" | `npx ng test` | Pass |
| AC2: dropdown conversions follow the bson-model table; impossible conversions disabled | `bson-inputs.spec.ts` "type dropdown" (existing); `typeOptions and convertValue` block (18 targets, no deprecated, empty values, UUID→Binary disabled with reason, 16-byte Binary→UUID, current type, array↔object); `EditableValueComponent type dropdown with a schema` (schema filter, current type kept, disabled options + reason in DOM) | `npx ng test` | Pass |
| AC3a: new numeric value defaults per setting (Int32/Int64/Double) | `bson-inputs.spec.ts` "new numbers" (existing); `newNumber` block (all three settings, 32-bit and safe-integer bounds, -0/NaN/Infinity); `NumberDefaultService` (load via app.settings.get, follows app.settings.changed, invalid/missing values ignored, error answer, no bridge → int32, unsubscribes on destroy); `EditableValueComponent` "a plain number typed becomes the configured BSON number" | `npx ng test` | Pass |
| AC3b: fields can be moved (key order kept) | `bson-inputs.spec.ts` "field order" (existing); `key-order.util.spec.ts` (objectFromEntries `__proto__`, repeated keys, hidden order, orderedKeys after mutation, withEntry/withoutEntry, moveEntry clamping/identity/integer-like keys) | `npx ng test` | Pass |
| blankLike keeps BSON types | `blankLike with BSON values` block; `emptyOf and blankBson` block | `npx ng test` | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/explorer/bson-input.util.spec.ts' --include='src/app/explorer/key-order.util.spec.ts' --include='src/app/explorer/services/number-default.service.spec.ts' --include='src/app/explorer/bson-input/bson-input.component.spec.ts' --include='src/app/explorer/json-edit.util.spec.ts'` and `npx ng test --include='src/app/explorer/editable-value/editable-value.component.spec.ts'`

Result:

Fail: 3 failed, the rest passed. The 3 failures are the TW-1/TW-2 regression tests below. Every other new test passes.

## Full test execution

Command:

`cd packages/renderer && npx ng test`

Result:

Fail: 50 files, 1020 tests, 3 failed (TW-1 x2, TW-2 x1), 1017 passed. No pre-existing test fails.

`npm run lint` (repo root, ESLint + Prettier check): Pass.

## .taskcheck

Result:

Fail: `sh .taskcheck` (`npm run check`). Lint, type check and the core/other workspaces pass (46 files, 2829 tests). The renderer step fails on the same 3 tests (TW-1, TW-2).

## Bugs found

### Dates whose zone offset has seconds cannot be read back (untouched input shows an error)

Finding ID:

`TW-1`

Test:

`bson-input.util.spec.ts > editText > the shown date text parses back when the offset has seconds (local mean time)`; `bson-input.component.spec.ts > BsonInputComponent > leaving an untouched input > Date before 1894 in Zurich (offset with seconds): emits nothing and shows no error`

Production source:

`packages/renderer/src/app/explorer/bson-input.util.ts:145` (`parseDate`), together with `editText` (`:218`), which shows `formatDate` output, and `formatOffset` in `bson-value.util.ts:317`, which writes `+HH:MM:SS` offsets. `parseIsoDate` (core) accepts only `±HH:MM`.

Requirement:

AC1 and assumption 4: typed inputs keep the value's type. Invalid text gets an inline error, but a valid value the input shows must not be rejected. Dates are ISO text with the trailing zone name ignored.

Expected behavior:

If a date input is focused and left without editing, or its shown text is committed unchanged, nothing is emitted and no error appears.

Actual behavior:

Dates where the display zone used local mean time are shown with a seconds offset, e.g. `1850-01-01T00:34:08.000+00:34:08 Europe/Zurich`. Other examples: Zurich before 1894-06-01, Asia/Kathmandu before 1920 (`+05:41:16`), and year 0001 in Zurich. When such an input is blurred, the inline error `"…" is not an ISO-8601 date` appears. The user cannot commit the shown text, so they have to retype the date with a different offset.

Severity:

Low (only historical dates in local display mode; the value itself is not changed)

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### Out-of-range dates show an error when their untouched input is left

Finding ID:

`TW-2`

Test:

`bson-input.component.spec.ts > BsonInputComponent > leaving an untouched input > Date outside the JS date range: emits nothing and shows no error`

Production source:

`packages/renderer/src/app/explorer/bson-input.util.ts:219` (`editText` shows the bare milliseconds, e.g. `100000000000000000`) and `:145` (`parseDate` does not accept that text). `BsonInputComponent.commit` is in `bson-input.component.ts:163`.

Requirement:

Assumption 4: invalid text gets an inline error and is not applied. The value the input shows for an existing date should not count as invalid.

Expected behavior:

Leaving the untouched input of a date beyond ±8.64e15 ms emits nothing and shows no error. Either `parseDate` accepts the shown millisecond text, or the commit skips text that equals the shown text.

Actual behavior:

The error `"100000000000000000" is not an ISO-8601 date` appears when the user tabs through the field. The value is kept.

Severity:

Low

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: partial. Coverage was measured with the 3 known-failing TW tests deselected (`--filter`), because Vitest writes no report when tests fail. The unfiltered suite fails (see above), so these numbers are diagnostic. They are not a passing validation.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the existing tooling has no changed-line report).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `bson-inputs`; base `fc84d7a400ffc80511c5e7337fabf160126c7369`; HEAD `b47a8f5b94e74e0751097848c20381a3f23a8be4`; task commits ba71ffa, b47a8f5 (supplied by the parent worker, confirmed with `git log`/`git diff --stat fc84d7a..HEAD`).
- Source/test snapshot identifier (including uncommitted inputs): HEAD b47a8f5 with no production changes, plus the uncommitted test files below (sha256): bson-input.util.spec.ts `0ec51505…deaa3d`, key-order.util.spec.ts `3f09af52…ca33`, json-edit.util.spec.ts `2b883767…1e879`, number-default.service.spec.ts `4454e1f1…b11e`, bson-input.component.spec.ts `e71fda77…b11e`, editable-value.component.spec.ts `ee0221cd…88d2`. The hashes were identical before and after the final run.
- Exact included files (all changed `.ts` production files in the diff): `src/app/explorer/bson-input.util.ts`, `key-order.util.ts`, `bson-value.util.ts`, `form-fields.util.ts`, `json-edit.util.ts`, `bson-input/bson-input.component.ts`, `editable-value/editable-value.component.ts`, `json-form/json-form.component.ts`, `services/number-default.service.ts`. Excluded: `.html`/`.css` templates and styles (V8 does not instrument them; the templates are exercised through the component specs). No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` (Angular `ng test` builder), cwd `packages/renderer`. Command: `npx ng test --coverage --filter='^(?!.*(Date before 1894|Date outside the JS date range|offset has seconds)).*$' --coverage-reporters=json-summary --coverage-reporters=text --coverage-include=<each file above>`. Selection: the whole renderer suite minus the 3 TW tests (1017 passed, 3 skipped).
- Run start/completion time and exit status: started 2026-11-16 23:10:37 +01:00, report written 23:10:49; tests passed (exit 0).
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json`, sha256 `91d3918c46a2655a1a1d6c96424787820c680f77350f39e72c989c9a6ad15e11` (mtime 23:10:49.999).
- Evidence outputs are fresh and inputs stayed unchanged: yes. The report mtime falls inside the run, and the test hashes and the clean production tree were unchanged before and after the run.
- Final run after latest test additions and production fixes: yes for the test additions. No production fixes have been made yet; after TW-1/TW-2 are fixed, the coverage must be measured again.
- Baseline before this report's tests (implementer's tests only, 5 files from the parent's list, same command without filter): statements 332/404 (82.17%), branches 216/305 (70.81%), functions 85/98 (86.73%), lines 284/332 (85.54%). The same 5 files now: 388/404, 278/305, 92/98, 322/332.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `src/app/explorer/bson-input.util.ts` | 188/190 (98.9%) | 147/151 (97.4%) | 30/30 (100%) | 157/158 (99.4%) |
| `src/app/explorer/key-order.util.ts` | 46/46 (100%) | 14/14 (100%) | 13/13 (100%) | 33/33 (100%) |
| `src/app/explorer/services/number-default.service.ts` | 23/23 (100%) | 11/11 (100%) | 6/6 (100%) | 18/18 (100%) |
| `src/app/explorer/bson-input/bson-input.component.ts` | 76/77 (98.7%) | 68/75 (90.7%) | 23/23 (100%) | 68/68 (100%) |
| `src/app/explorer/editable-value/editable-value.component.ts` | 55/68 (80.9%) | 38/54 (70.4%) | 20/26 (76.9%) | 46/55 (83.6%) |
| `src/app/explorer/bson-value.util.ts` | 127/127 (100%) | 119/121 (98.3%) | 25/25 (100%) | 111/111 (100%) |
| `src/app/explorer/form-fields.util.ts` | 16/16 (100%) | 7/8 (87.5%) | 2/2 (100%) | 14/14 (100%) |
| `src/app/explorer/json-edit.util.ts` | 32/41 (78.0%) | 23/25 (92.0%) | 6/9 (66.7%) | 25/34 (73.5%) |
| `src/app/explorer/json-form/json-form.component.ts` | 70/111 (63.1%) | 50/85 (58.8%) | 28/46 (60.9%) | 64/98 (65.3%) |
| Aggregate (summed counters, 9 files; templates/styles excluded) | 633/699 (90.6%) | 477/544 (87.7%) | 153/180 (85.0%) | 536/589 (91.0%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `bson-input.util.ts:238` | `viaConvert` rethrows non-`ConversionError` exceptions | Defensive and not reachable through the public parsers; no test added |
| `bson-input/bson-input.component.ts:70-94` (branches), `:218` | `''` fallbacks of part getters for other types; `sameValue` type mismatch | Parsers always return the edited type, so the mismatch branch cannot be reached; the fallbacks are trivial |
| `editable-value.component.ts:85-90, 118-125, 162` | `choiceIndex`/`choiceLabel`/`onChoice` (schema enum dropdown), `commitBoolean` | Code from before this task, not changed by it; out of scope |
| `json-edit.util.ts:28-30, 76-88` | `defaultForType`, `withItem`/`withoutItemAt`/`withAppended` | Code from before this task, not changed by it (the task only changed `blankLike` and re-exports, both covered) |
| `json-form.component.ts` (remaining 41 statements) | Code from before this task (reveal paging, schema ghosts, table hand-off) | The task-added `fieldIndex`/`fieldCount`/`moveField` run through `bson-inputs.spec.ts` "field order"; the rest is out of scope |
| `bson-value.util.ts:307-308`, `form-fields.util.ts:32` | BC-era branch of `zoneOffsetMs`; ghost-key branch | Code from before this task, not changed by it |

## Unable to test

- Behavior when the initial `app.settings.get` answer arrives after an `app.settings.changed` broadcast (NumberDefaultService would apply the older value): not tested. Electron delivers the reply and the broadcast in order on the same channel, so this order should not happen in production. Follow-up only if the bridge ordering changes.
- `NumberDefaultService.init()` resolves at once when the constructor has already started loading, so `await init()` does not wait for the setting. No production code awaits it. The tests wait for the request instead. This is noted as an observation, not a defect.
- The real `<input type="datetime-local">` picker UI (browser widget) was not exercised; tests drive its `change` event under happy-dom/jsdom. A browser test belongs to e2e (`npm run test:e2e`) and was not run.
- Pre-existing (not changed by this task): `blankItemLike` builds records with plain assignment, so a record key `__proto__` would set the prototype and integer-like key order is lost there. Out of scope; no test added.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion.
