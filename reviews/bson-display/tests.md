# Test Report

Date: 2026-11-16

Task: bson-display - M1: Explorer shows BSON types

Scope: `git diff 66ecb35f86973277474b1a4f7fb01c67bb9680a2..4cada5f22fd3b713172f72cc5d50e76f3c928d30` (task base 66ecb35 supplied by the parent; single implementation commit 4cada5f = HEAD on `main`; working tree had no production changes, only the test files below).

Requirements:
- tasks/bson-display.md acceptance criteria and recorded assumptions (display formats, deprecated read-only, UTC toggle)
- SPEC.md ("Every BSON type is first-class"), docs/ARCHITECTURE.md "Coverage"
- Parent instructions (focused unit tests for bson-value.util, gaps in component tests)
- packages/renderer/src/app/theme/tokens.css (BSON color tokens from the `themes` task)

## Test files changed

- `packages/renderer/src/app/explorer/bson-value.util.spec.ts` (new)
- `packages/renderer/src/app/explorer/bson-display.spec.ts` (7 tests added; 9 existing tests unchanged)

## Tests added or updated

Count: 45 (38 in bson-value.util.spec.ts, 7 in bson-display.spec.ts)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: all-types fixture renders the correct badge per value | existing `shows the correct badge for every value of the all-types fixture`; new `keeps BSON values read-only in edit mode and locks deprecated types` (badges in edit mode), `keeps deprecated values read-only in the tables layout too`, `shows no badge for the document root`; unit `badgeOf` (binary subtypes 0x00/0x03/0x80/0xff, UUID only for 16-byte subtype 4, plain JS values, deprecated tooltip) | `cd packages/renderer && npx ng test --include='src/app/explorer/bson-*.spec.ts'` | Pass |
| AC1 (badge color per type) | `badgeColorVar > only names tokens every theme defines` | same | Fail: TW-1 |
| AC2: no precision loss (Int64 9007199254740993, 34-digit Decimal128) | existing `never loses precision on Int64 and Decimal128`, `... on the fixture extremes`; new unit `displayText > shows Int64 and Decimal128 exactly`, `BsonLeaf#toJSON > serializes as canonical EJSON v2, exact for Int64, Decimal128 and Date`, `round-trips the all-types fixture unchanged` | same | Pass |
| AC3: search works across BSON values | existing `finds BSON values by their exact text`, `finds values nested in documents and arrays`; new `finds BSON values in context mode and is case-insensitive` | same | Pass |
| Assumption: deprecated types read-only with lock in edit mode; other BSON leaves read-only | `keeps BSON values read-only in edit mode and locks deprecated types`, `shows no lock for deprecated types outside edit mode`, `keeps deprecated values read-only in the tables layout too` | same | Pass |
| Assumption: Date local ISO + offset + IANA zone, UTC toggle | unit `formatDate` (Zurich winter/summer, New York, St Johns -03:30, Kathmandu, UTC, pre-1970 ms, LMT +00:34:08 / -04:56:02 for year 0001, system zone default, out-of-range ms text, JS-limit UTC); component `marks the UTC button pressed while dates show in UTC` | same | Pass |
| Dates inside the JS range must display (not crash) in local mode | unit `shows the upper JS date limit in a zone ahead of UTC without throwing`, `shows the lower JS date limit in a zone behind UTC without throwing`; component `renders a date at the upper JS date limit in local time` | same | Fail: TW-2 |
| toExplorerValue/fromExplorerValue round trip, `__proto__` keys, integer-like/repeated keys, JS number -> Int32/Double, invalid inputs | `toExplorerValue / fromExplorerValue` (7 tests) | same | Pass |
| Leaves treated as scalars by typeOf/outline/json-lines shapes/layout | `explorer utilities treat BSON leaves as scalars` (4 tests) | same | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/explorer/bson-*.spec.ts'`

Result:

Fail: 2 files, 54 tests: 50 passed, 4 failed. The failing tests are exactly the TW-1 and TW-2 tests (1 + 2 unit, 1 component). All other new and existing tests pass.

## Full test execution

Command:

`cd packages/renderer && npx ng test` (run with the coverage options listed under Coverage, no filter)

Result:

Fail: 32 files, 567 tests: 563 passed, 4 failed (the TW-1/TW-2 tests only). No pre-existing test failed.

`cd packages/core && npx vitest run --coverage --coverage.include=src/paging/projection.ts src/paging`: Pass (4 files, 100 tests).

## .taskcheck

Result:

Fail: `npm run check` (from `.taskcheck`): `eslint` and `prettier --check` pass (after formatting the new spec with Prettier), `typecheck` passes; `npm run test` fails in the renderer workspace on the 4 TW-1/TW-2 tests. It will pass once the production defects are fixed.

## Bugs found

### Code w/ scope badge names a color token no theme defines

Finding ID:

`TW-1`

Test:

`bson-value.util.spec.ts > badgeColorVar > only names tokens every theme defines`

Production source:

`packages/renderer/src/app/explorer/bson-value.util.ts:182-186` (`badgeColorVar`)

Requirement:

Task goal "type badges and colors per type"; badges are colored with the `--bson-*` theme tokens.

Expected behavior:

Every BSON type's badge refers to a token defined in `tokens.css` for all themes.

Actual behavior:

`badgeColorVar('javascriptWithScope')` returns `var(--bson-javascript-with-scope)`. `tokens.css` defines 20 `--bson-*` tokens (the `$type` aliases) and no `--bson-javascript-with-scope`, so the Code w/ scope badge and value get an invalid custom property and fall back to the inherited text color, with no type color. Test output: `["javascriptWithScope -> --bson-javascript-with-scope"]`. The production fix could map it to `--bson-javascript`. Adding a token to the theme belongs to the `themes` task's file.

Severity:

Low

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### Dates near the JS date limits crash the explorer in local-time mode

Finding ID:

`TW-2`

Test:

`bson-value.util.spec.ts > formatDate > shows the upper JS date limit in a zone ahead of UTC without throwing`; `... > shows the lower JS date limit in a zone behind UTC without throwing`; `bson-display.spec.ts > Explorer with BSON values > renders a date at the upper JS date limit in local time`

Production source:

`packages/renderer/src/app/explorer/bson-value.util.ts:263-266` (`formatDate`), `:286-290` (`zoneOffsetMs`)

Requirement:

Every BSON Date is shown (task Goal; assumption that dates beyond the JS range show their milliseconds since 1970 with "(out of date range)"); a valid document must not break the explorer.

Expected behavior:

`formatDate(8640000000000000n, { utc: false, timeZone: 'Europe/Zurich' })` and `formatDate(-8640000000000000n, { utc: false, timeZone: 'America/New_York' })` return a text (for example the UTC ISO fallback the code intends at line 265).

Actual behavior:

Both throw `RangeError: Invalid time value`. The local wall clock (+02:00 / -04:56:02) lies outside the JS Date range, so `asUtc.setUTCFullYear(...)` in `zoneOffsetMs` produces an invalid Date. `offsetMs` and `local` become `NaN`, the guard `Math.abs(local) > Number(DATE_LIMIT_MS)` is false for NaN, and `new Date(NaN).toISOString()` throws. In the component, the error comes from `EditableValueComponent.bsonText` during change detection, so the document is not rendered. This affects any date within the zone offset of +/-8.64e15 ms when shown in local time, including the default mode.

Severity:

Medium

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: verified for the passing test subset. The coverage run deselected only the 4 known-failing TW-1/TW-2 tests with `--filter`; nothing in the files was skipped or disabled. The unfiltered run with the same options exited non-zero and wrote no coverage (empty `coverage/`). Task validation is still blocked by TW-1/TW-2.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line report).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `bson-display`; base 66ecb35f86973277474b1a4f7fb01c67bb9680a2; HEAD 4cada5f22fd3b713172f72cc5d50e76f3c928d30 (task commit 4cada5f, from the parent and `git log`); scope from `git diff --name-only 66ecb35..4cada5f -- '*.ts' ':!*.spec.ts'`.
- Source/test snapshot identifier (including uncommitted inputs): production = HEAD 4cada5f, unchanged; uncommitted tests: `bson-value.util.spec.ts` sha256 b55a6c844b8be15391a0e1b69061941139cf08b48399ee4c9003d78ef88cb5ab, `bson-display.spec.ts` sha256 37dd9e22230ccba6821a9c8a5ce5388d699327445f31784b27b57def30fb8948. The hashes were the same before and after the run.
- Exact included files: renderer `src/app/explorer/{bson-value.util.ts, services/bson-display.service.ts, services/filter.service.ts, editable-value/editable-value.component.ts, json-edit.util.ts, json-explorer.component.ts, json-lines.util.ts, jump-steps.util.ts, layout.util.ts, outline/outline.util.ts}`; core `src/paging/projection.ts`. Excluded: `packages/core/src/bson/fixtures.ts` (test fixture data, exported as `@thicket/core/testing`, no runtime behavior); `*.html`/`*.css`/`package.json`/`package-lock.json` (not instrumented by v8). The templates are exercised by the component tests. No renames and no deleted files.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0 (vitest 5.1.0, Node v24.22.1). In `packages/renderer`: `npx ng test --filter='^(?!.*(only names tokens every theme defines|JS date limit)).*' --coverage --coverage-include=<each of the 10 files above> --coverage-reporters=json-summary --coverage-reporters=json`, run over all 32 spec files. In `packages/core`: `npx vitest run --coverage --coverage.include=src/paging/projection.ts --coverage.reporter=text src/paging`.
- Run start/completion time and exit status: renderer 2026-11-16T20:15:24Z to 20:15:36Z, exit 0 (563 passed, 4 deselected); core 2026-11-16T20:14:31 local, exit 0 (100 passed).
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 83a2e41f08950fcbc98b1b134d4c40f713f4682a9176b3096ec4e4dce1116384; `coverage-final.json` sha256 a5fbc2923d3656940110891a9f91e977ead315271d1b124d78afbbdf4e9d41e9. The core report is console text only.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The previous (failed) run left an empty `coverage/`; the report directory was regenerated at 21:15 local by this run. The test hashes are the same before and after.
- Final run after latest test additions and production fixes: yes for the latest test additions. No production fixes have been made yet; after TW-1/TW-2 are fixed, coverage needs a fresh run.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/explorer/bson-value.util.ts` | 120/121 (99.17%) | 112/115 (97.39%) | 22/22 (100%) | 104/104 (100%) |
| `packages/renderer/src/app/explorer/services/bson-display.service.ts` | 11/11 (100%) | 5/5 (100%) | 4/4 (100%) | 6/6 (100%) |
| `packages/renderer/src/app/explorer/services/filter.service.ts` | 71/72 (98.61%) | 59/60 (98.33%) | 20/20 (100%) | 48/48 (100%) |
| `packages/renderer/src/app/explorer/editable-value/editable-value.component.ts` | 23/46 (50%) | 16/40 (40%) | 11/20 (55%) | 19/36 (52.77%) |
| `packages/renderer/src/app/explorer/json-edit.util.ts` | 34/44 (77.27%) | 20/23 (86.95%) | 8/11 (72.72%) | 27/37 (72.97%) |
| `packages/renderer/src/app/explorer/json-explorer.component.ts` | 21/21 (100%) | 11/12 (91.66%) | 5/5 (100%) | 16/16 (100%) |
| `packages/renderer/src/app/explorer/json-lines.util.ts` | 103/105 (98.09%) | 58/63 (92.06%) | 25/25 (100%) | 89/89 (100%) |
| `packages/renderer/src/app/explorer/jump-steps.util.ts` | 38/38 (100%) | 22/24 (91.66%) | 2/2 (100%) | 36/36 (100%) |
| `packages/renderer/src/app/explorer/layout.util.ts` | 11/11 (100%) | 12/12 (100%) | 3/3 (100%) | 7/7 (100%) |
| `packages/renderer/src/app/explorer/outline/outline.util.ts` | 26/26 (100%) | 22/22 (100%) | 3/3 (100%) | 22/22 (100%) |
| `packages/core/src/paging/projection.ts` | 40/40 (100%) | 47/47 (100%) | 15/15 (100%) | 25/25 (100%) |

Aggregate (summed counters, the 10 renderer files, from the provider's `total`): statements 458/495 (92.52%), branches 337/376 (89.62%), functions 103/115 (89.56%), lines 374/401 (93.26%). With core `projection.ts`: statements 498/535 (93.08%), branches 384/423 (90.78%), functions 118/130 (90.77%), lines 399/426 (93.66%). Excluded: `fixtures.ts` (test data) and the non-TS files listed above. No scoped TS file is unmeasured.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `bson-value.util.ts:265` (if true branch + statement) | Fallback when the local wall clock is outside the JS range | Unreachable today because of TW-2 (NaN skips the guard). TW-2 tests cover the intent; it becomes covered once fixed. |
| `bson-value.util.ts:283` (`?? 0`), `:284` (`?? 'AD'`) | Defensive defaults for missing Intl parts | Non-material: Intl always returns these parts for the requested options. |
| `editable-value.component.ts:69-117` (choiceIndex, choiceLabel, typeOptions, onChoice, onTypeChange, commitString/Number/Boolean), `:34` third operand | Pre-existing JSON edit behavior. In this task only `typeOptions` got a type-only cast, and the `bson` branch in the template was added (covered). | Outside this task's behavior; not added. The BSON-related parts (badge, showBadge, deprecated, bsonText, read-only template branch) are covered. |
| `json-edit.util.ts:25-28, 45, 84-96` | Pre-existing helpers (`blankLike`, `withItem`, ...) not changed by the task | Outside task scope. The changed `typeOf` 'bson' and `defaultForType('bson')` are covered. |
| `filter.service.ts:63` | Pre-existing `if (!term) return false` in `valueMatch` | Non-material; callers guard the empty term. |
| `json-lines.util.ts`, `jump-steps.util.ts`, `json-explorer.component.ts` remaining branches | Pre-existing branches. The changed `isContainer` calls are covered. | Outside task scope. |

## Unable to test

- Visual rendering of badge colors and the dashed border (needs a real browser and CSS computed styles; jsdom does not resolve `var()`). The token wiring is checked via inline style and token-name tests instead. No follow-up beyond TW-1.
- `formatDate` with a missing/unknown IANA zone (`Intl` throws `RangeError`): not tested because zones come only from the system or tests, and the spec does not define the required behavior. No follow-up needed unless a zone setting is added.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion. TW-1 (Low): the Code w/ scope badge names an undefined color token. TW-2 (Medium): dates within the zone offset of the JS date limits throw `RangeError` and stop the explorer from rendering. The acceptance criteria themselves (badges, exact Int64/Decimal128, search over BSON values) pass.
