# Test Report

Date: 2026-11-16

Task: bson-display - M1: Explorer shows BSON types (round 2, final code after the fixer)

Scope: `git diff 66ecb35f86973277474b1a4f7fb01c67bb9680a2..82f93e2ad749d6f955da033f57e435db5c3037d3 -- packages`. The parent named the final HEAD as 8f6277a; the clone's HEAD is now 82f93e2 after a rebase onto task-board commits. `git diff 8f6277a 82f93e2 -- packages` is empty, so the measured code is identical to 8f6277a. Task commits: 758bb5c (implementation), 161f914 (round-1 tests and reports), 82f93e2 (fixer: TW-1, TW-2, CR-4, `@thicket/core/bson`). Uncommitted: only the two spec files below.

Requirements:
- tasks/bson-display.md acceptance criteria and recorded assumptions (display formats, deprecated read-only, UTC toggle)
- SPEC.md ("Every BSON type is first-class"), docs/ARCHITECTURE.md "Coverage"
- reviews/bson-display/fixes.md (TW-1, TW-2, CR-4, P-1 fixes to verify)
- Parent instructions (verify fixes are tested; formatter cache returns the same output across zones/toggles; full unfiltered coverage run)

## Test files changed

- `packages/renderer/src/app/explorer/bson-value.util.spec.ts` (3 tests added in round 2)
- `packages/renderer/src/app/explorer/bson-display.spec.ts` (1 test added, 1 assertion added to an existing test in round 2)

No existing test was removed, skipped or weakened.

## Tests added or updated

Count: 5 in round 2 (4 new tests, 1 strengthened test); 45 from round 1 remain.

Round 2:
- unit `badgeColorVar > colors Code with scope with the Code token` (TW-1, explicit mapping)
- unit `formatDate > falls back to UTC when the local wall clock lies outside the JS date range` (TW-2: exact fallback text at both limits, one second below the upper limit in Tokyo, and the in-range case behind UTC at the upper limit still shows local time)
- unit `formatDate > gives the same text when zones and the UTC mode alternate between calls` (CR-4 formatter cache: interleaved zones, UTC calls between, repeated calls and the system-zone default give identical, correct output)
- component `shows a date whose local wall clock is past the JS range in UTC and finds it` (TW-2 in the explorer: exact UTC text, the rest of the document renders, search matches the fallback text)
- component `colors badges with the BSON type tokens and marks deprecated types`: added that the Code w/ scope badge uses `var(--bson-javascript)` (TW-1 in the explorer)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: all-types fixture renders the correct badge per value | `shows the correct badge for every value of the all-types fixture`, `colors badges with the BSON type tokens and marks deprecated types`, `shows badges in the tables layout too, ...`, `keeps BSON values read-only in edit mode and locks deprecated types`, `shows no badge for the document root`; unit `badgeOf` (4 tests), `badgeColorVar` (3 tests incl. `only names tokens every theme defines`) | `cd packages/renderer && npx ng test` (with coverage options, see Coverage) | Pass |
| AC2: Int64 9007199254740993 and 34-digit Decimal128 without precision loss | `never loses precision on Int64 and Decimal128`, `never loses precision on the fixture extremes`; unit `displayText > shows Int64 and Decimal128 exactly`, `BsonLeaf#toJSON > serializes as canonical EJSON v2, ...`, `round-trips the all-types fixture unchanged` | same | Pass |
| AC3: search works across BSON values | `finds BSON values by their exact text` (Int64, Decimal128, ObjectId, UUID, Date local then UTC), `finds values nested in documents and arrays`, `finds BSON values in context mode and is case-insensitive`, `shows a date whose local wall clock is past the JS range in UTC and finds it` | same | Pass |
| TW-1 fix: Code w/ scope badge has a defined color token | `badgeColorVar > only names tokens every theme defines`, `colors Code with scope with the Code token`, component badge color assertion | same | Pass |
| TW-2 fix: dates near the JS limits display in local mode without throwing | unit `shows the upper/lower JS date limit ... without throwing`, `falls back to UTC when the local wall clock lies outside the JS date range`, `shows dates near the JS limits whose wall clock stays in range`; component `renders a date at the upper JS date limit in local time`, `shows a date whose local wall clock is past the JS range in UTC and finds it` | same | Pass |
| CR-4 fix: cached formatters, unchanged output | `gives the same text when zones and the UTC mode alternate between calls`, all existing `formatDate` zone tests, `uses the system time zone when none is given`, component `marks the UTC button pressed while dates show in UTC` (local -> UTC -> local) | same | Pass |
| P-1: renderer imports `@thicket/core/bson` | Both specs import `@thicket/core/bson`; the renderer build/typecheck resolves it | `npm run check` (renderer `ngc` typecheck + `ng test`) | Pass |
| Assumptions: deprecated read-only, Date local ISO + offset + zone, UTC toggle | round-1 tests (see test names in the specs) | `cd packages/renderer && npx ng test` | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/explorer/bson-*.spec.ts'`

Result:

Pass: 2 files, 58 tests passed.

## Full test execution

Command:

`cd packages/renderer && npx ng test --coverage <options under Coverage>` (no filter, all 32 spec files)

Result:

Pass: 32 files, 571 tests passed.

`cd packages/core && npx vitest run --coverage --coverage.include=src/paging/projection.ts --coverage.reporter=text src/paging src/bson`: Pass, 10 files, 318 tests.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, run from the repository root: eslint, prettier --check and typecheck (core, backend, renderer app + spec) passed; root vitest 42 files / 2533 tests passed; renderer `ng test` 32 files / 571 tests passed.

## Bugs found

None in round 2. Round-1 findings TW-1 and TW-2 are fixed at 82f93e2; their tests pass.

## Coverage

Status: verified. Unfiltered run, exit 0, fresh report.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line report).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `bson-display`; base 66ecb35f86973277474b1a4f7fb01c67bb9680a2 (from the parent); measured HEAD 82f93e2ad749d6f955da033f57e435db5c3037d3 (packages identical to the parent's 8f6277a); task commits 758bb5c, 161f914, 82f93e2 from `git log`; file scope from `git diff --stat 66ecb35 82f93e2 -- packages`.
- Source/test snapshot identifier (including uncommitted inputs): production = HEAD 82f93e2, unmodified; uncommitted specs `bson-value.util.spec.ts` sha256 502d924ac1325251f41272387c412afb96bd1aa8fa0ad034348c6b72d4756962, `bson-display.spec.ts` sha256 369833b1b2bda1af46316ecbc9d93b9cda83bf3aa7ca8ffcdf0b8c4738cee7e9 (same before and after the run).
- Exact included files: renderer `src/app/explorer/{bson-value.util.ts, services/bson-display.service.ts, services/filter.service.ts, editable-value/editable-value.component.ts, json-edit.util.ts, json-explorer.component.ts, json-lines.util.ts, jump-steps.util.ts, layout.util.ts, outline/outline.util.ts}`; core `src/paging/projection.ts`. Excluded: `packages/core/src/bson/fixtures.ts` (test fixture data, `@thicket/core/testing`); `*.html`, `*.css`, `package.json`, `package-lock.json` (not instrumented by v8; templates are exercised by the component tests). No renames, no deleted files.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0 (vitest 5.1.0). In `packages/renderer`: `npx ng test --coverage --coverage-include=<each of the 10 renderer files> --coverage-reporters=json-summary --coverage-reporters=json --coverage-reporters=text`, all 32 spec files, no filter. In `packages/core`: `npx vitest run --coverage --coverage.include=src/paging/projection.ts --coverage.reporter=text src/paging src/bson`.
- Run start/completion time and exit status: renderer 2026-11-16T20:21:13Z to about 20:21:20Z, exit 0 (571 passed); core 2026-11-16T20:21:29Z, exit 0 (318 passed).
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 72354550161e19cff3c227c509aa613bcccb7317c0906b86419da8d304c209a1; `coverage-final.json` sha256 0fea370d2c2a31ecc61c4be9cbc60903f438f9c1ae691c3e43236f05b44aba61 (both written 21:21:20 local by this run). The core report is console text only.
- Evidence outputs are fresh and inputs stayed unchanged: yes; the report files were rewritten by this run and the spec hashes are unchanged.
- Final run after latest test additions and production fixes: yes (after the fixer commit and all round-2 tests).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/explorer/bson-value.util.ts` | 129/129 (100%) | 119/121 (98.34%) | 24/24 (100%) | 114/114 (100%) |
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

Aggregate (summed counters, the 10 renderer files, provider `total`): statements 467/503 (92.84%), branches 344/382 (90.05%), functions 105/117 (89.74%), lines 384/411 (93.43%). With core `projection.ts`: statements 507/543 (93.37%), branches 391/429 (91.14%), functions 120/132 (90.91%), lines 409/436 (93.81%). Excluded: `fixtures.ts` (test data) and the non-TS files listed above. No scoped TS file is unmeasured.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `bson-value.util.ts:314-315` (`?? 0`, `?? 'AD'`) | Defensive defaults for missing Intl parts | Non-material: Intl always returns these parts for the requested options. The TW-2 fallback (former round-1 gap) is now covered. |
| `editable-value.component.ts:69-117` (choiceIndex, choiceLabel, typeOptions, onChoice, onTypeChange, commitString/Number/Boolean) | Pre-existing JSON edit behavior; this task only added a type-only cast to `typeOptions` and the `bson` template branch (covered) | Outside the task's behavior. BSON parts (badge, showBadge, deprecated, bsonText, read-only branch) are covered. |
| `json-edit.util.ts:26-28, 45, 84-96` | Pre-existing helpers not changed by the task | Outside task scope; the changed `typeOf` 'bson' and `defaultForType('bson')` are covered. |
| `filter.service.ts:63` | Pre-existing `if (!term) return false` | Non-material; callers guard the empty term. |
| `json-lines.util.ts:65,81,118,186,212`, `jump-steps.util.ts:64,74`, `json-explorer.component.ts:71` (branches) | Pre-existing branches; the changed `isContainer` calls are covered | Outside task scope. |

## Unable to test

- Visual rendering of badge colors and the dashed border: jsdom does not resolve `var()` or computed styles. The token wiring is checked through the inline style and the token-name test against `tokens.css`. No follow-up needed.
- The formatter cache itself (that a formatter is built once per zone) is module-private; the test checks the observable contract (identical, correct output across interleaved zones and UTC toggles), not the number of `Intl.DateTimeFormat` constructions. The performance effect is not measured.
- `systemTimeZone()` caches the zone for the process lifetime; a system zone change while the app runs is not tested (the process zone cannot be changed in a test run, and the spec defines no such behavior).

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The fixes for TW-1, TW-2 and CR-4 are covered by tests, all three acceptance criteria pass, the full renderer suite (571 tests) and `npm run check` pass.
