# Test Report

Date: 2026-11-16

Task: bson-model - Core: BSON value model with lossless EJSON round trip

Scope: base `ed95d7e3c8e0c3798e189970964380e6b495cfe3` .. HEAD `cc82bfdebffdc59efc9eb6f5feafde2267c2fae4` (single task commit cc82bfd "Add BSON value model with lossless canonical EJSON round trip, conversions and path API"; the parent named it 1222614, the checkout's HEAD is cc82bfd with exactly the file list the parent gave). Branch `main`. Production files in scope: `packages/core/src/bson/{model,json-tree,ejson,iso-date,convert,path,index}.ts`, `packages/core/src/index.ts`. Uncommitted inputs at measurement time: only test files written by this run (listed below); no uncommitted production changes.

Requirements:
- `tasks/bson-model.md` acceptance criteria and recorded assumptions
- `SPEC.md` "Documents and BSON"
- `docs/ARCHITECTURE.md` "Coverage" and "Conventions"
- Parent instructions (conversions must stay at 100% branch coverage; model.ts constructors uncovered)

## Test files changed

- `packages/core/src/bson/model.spec.ts` (new)
- `packages/core/src/bson/json-tree.spec.ts` (new)
- `packages/core/src/bson/ejson.spec.ts` (extended)
- `packages/core/src/bson/convert.spec.ts` (extended)
- `packages/core/src/bson/path.spec.ts` (extended)

## Tests added or updated

Count: 86 (core test count 100 -> 186, counting each `it.each` row; no existing test was changed except the import lines in `ejson.spec.ts`)

Added coverage, by area:
- model.ts: `int32` range edges, -0 normalization, fractions/NaN/Infinity rejected; `int64` range edges and values beyond 2^53; `double` keeps -0/NaN/Infinity; `str`/`bool`/`nil`/`doc`/`arr`; `BSON_TYPES`/`DEPRECATED_TYPES`; `BsonModelError`.
- json-tree.ts: key order/repeated keys/`__proto__`/raw number text, no prototype pollution, whitespace and escapes, top-level scalars, depth limit (1000 accepted, deeper rejected), 12 malformed inputs, error position.
- ejson.ts: doubles compared against `bson` canonical output (0.1, 1e-7, 2^53+2, 1e21, max double, -5e-324, ...), Int64 around +-2^53, escaped/empty/emoji keys, nested wrappers in arrays and `$scope`, round trip through indented output, indent clamping, normalization of 13 accepted non-canonical wrapper forms, Int32/Int64/Double boundaries for plain numbers, 17 more invalid wrapper values, base64/hex helpers for every padding length.
- convert.ts: String->ObjectId empty/untrimmed, Int32<->Int64 boundary round trip, Int64->Int32 overflow at Int64 extremes, Double->Int32 for -0/Infinity, Double->Decimal128->Double value round trip, Decimal128 integral values -> Int32/Int64 (exposes TW-1), Decimal overflow/NaN/Infinity, String->Int64 `+5` and Int64 min, Date->String->Date round trip for years 0001-9999, zone-less ISO rejected, UUID case normalization and 15-byte binary rejected, input not mutated.
- path.ts: `$`-prefixed, `__proto__` and repeated keys with get/set/remove/move/rename/insert (first match, others kept, byte-exact output), moving a `$oid` field keeps a document, immutability of every write op, structural sharing, scalar root, empty containers, append at index=length, non-integer positions, no-op move, root-level errors, array root, error messages naming the failing prefix.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Round trip of a fixture with every BSON type (deprecated, Binary subtypes, UUID, -0, NaN/Infinity, Int64 > 2^53) is byte-identical | `ejson.spec.ts` "EJSON round trip" (existing), "EJSON round trip edge cases" (doubles vs bson, Int64 around 2^53, escaped keys, nested wrappers, indented round trip) | `cd packages/core && npx vitest run src/bson` | Pass |
| AC2 Field order preserved incl. `$`-prefixed / duplicate-looking keys | `ejson.spec.ts` "field order" (existing), `json-tree.spec.ts` key-order test, `path.spec.ts` "path API with $-prefixed and repeated keys", `model.spec.ts` "compose into a document that keeps field order" | same | Pass |
| AC3 Conversion table: String->ObjectId valid/invalid, Int32->Int64, Int64->Int32 overflow, Double->Decimal128, String<->Date ISO, Binary(4)<->UUID | `convert.spec.ts` "table from the acceptance criteria" (existing) and "convert: edge cases" | same | Pass for every listed pair; 1 Fail in an adjacent conversion (Decimal128 -> Int32/Int64), see TW-1 |
| AC4 Path API get/set/insert/remove/move with tests | `path.spec.ts` (existing + 2 new describe blocks, 15 new tests) | same | Pass |
| AC4 100% branch coverage on conversions | coverage run below | see Coverage | Pass: convert.ts 145/145 branches (fresh run that includes the failing TW-1 test, see Coverage status) |
| No Node APIs in core (renderer) | not a behavioral test; checked by reading: no `Buffer`/`node:` imports in scope, base64 is hand-written | n/a | Not testable as a unit test (static property); see Unable to test |

## Focused test execution

Command:

`cd packages/core && npx vitest run src/bson`

Result:

Fail - 6 files, 185 tests: 184 passed, 1 failed (`convert.spec.ts > convert: edge cases > Decimal128 with an exact integral value converts to Int32 and Int64`, production defect TW-1).

Also run (repo root): `npx eslint packages/core --max-warnings 0` -> Pass (no output); `npx prettier --check packages/core` -> Pass ("All matched files use Prettier code style!", after `prettier --write` on the three spec files this run edited); `npm run typecheck -w packages/core` -> Pass (`tsc -p tsconfig.json`, no errors).

## Full test execution

Command:

`npm run check` (repository root; lint, type check, unit tests of all workspaces)

Result:

Fail - lint and type check passed; Vitest: 11 files, 784 tests, 783 passed, 1 failed (the same TW-1 test). No other test in the repository failed.

## .taskcheck

Result:

Fail - `.taskcheck` is `if [ -f package.json ]; then npm run check; ...`; `npm run check` was run directly (above) and fails only on TW-1. It passes once TW-1 is fixed in production code.

## Bugs found

### Decimal128 values with an exact integer value in plain notation cannot convert to Int32/Int64

Finding ID:

`TW-1`

Test:

`packages/core/src/bson/convert.spec.ts` > `convert: edge cases` > `Decimal128 with an exact integral value converts to Int32 and Int64`

Production source:

`packages/core/src/bson/convert.ts:157-182` (`toInteger` cases `decimal`/`string` and `decimalInteger`)

Requirement:

Conversion contract in `convert.ts` ("A conversion either produces an exactly corresponding value or throws"), task assumption "Lossy conversions are errors (... fractional->int)", SPEC "the type dropdown converts explicitly". The implementation explicitly intends integral Decimal128 values to convert (the existing test accepts `12000E-1` -> 1200, and `1.200E+3` -> 1200).

Expected behavior:

`convert({type:'decimal', value:'1200.0'}, 'int')` returns `{type:'int', value:1200}`; `convert({type:'decimal', value:'-7.00'}, 'long')` returns `{type:'long', value:-7n}`; `'7.50'` still fails as not an integer.

Actual behavior:

Throws `ConversionError: Cannot convert decimal to int: "1200.0" is not an integer`. `INT_TEXT` rejects the `.0` and `decimalInteger` only matches strings with an `E` exponent. The model always stores bson's canonical Decimal128 string, and bson writes `12000E-1` as `"1200.0"` (confirmed by the new ejson normalization test). So every value parsed from EJSON hits this path, and the passing existing test `dec('12000E-1')` uses a form the model never holds. Affects any Decimal128 with trailing fractional zeros, e.g. `"5.0"` and `"42.00"`. The failure is safe (an error, no data loss) but it rejects a lossless conversion.

Severity:

Low

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### Observations (no failing test added; requirement not specified, parent decides)

- OBS-1 (Low): `convert(date, 'string')` for dates outside years 0000-9999 produces extended ISO text (`+010000-01-01T00:00:00.000Z`, `-000001-...`) that `convert(string, 'date')` / `parseIsoDate` rejects (the regex accepts only 4-digit years), so Date->String->Date does not round-trip there. Within 0001-9999 it does (test added). `convert.ts:126-131`, `iso-date.ts:3-4,42-47`.
- OBS-2 (Low): `getAt(root, ['arr', -1])` or `['arr', 1.5]` throws `BsonModelError` (from `indexIn`), while other missing or mistyped segments return `undefined` (existing test "returns undefined for missing or mistyped segments"). `path.ts:46-58`. Not asserted either way, because the expected behavior is not specified.
- OBS-3 (Low): `convert(binary subtype 4, 'uuid')` returns the value unchanged even when its payload is not 16 bytes, while other subtypes are length-checked. `convert.ts:279`. `uuidOf` returns null for such values, so nothing is displayed wrongly.

## Coverage

Status: partial-failed. The run is fresh and complete for the scope (every scoped file instrumented, all 186 tests executed), but the command exited non-zero because of the TW-1 test. The report was emitted with `--coverage.reportOnFailure`. The numbers are therefore diagnostic. They will be valid for sign-off once TW-1 is fixed and coverage is re-run.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately. Every scoped file is new in this task except `packages/core/src/index.ts` (one added re-export line), so whole-file coverage equals changed-line coverage for the new files.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `bson-model`; base `ed95d7e3c8e0c3798e189970964380e6b495cfe3`; HEAD `cc82bfdebffdc59efc9eb6f5feafde2267c2fae4`; task-owned commit cc82bfd only (`git log ed95d7e..HEAD`); file scope from `git diff --stat ed95d7e..HEAD` and parent instructions (same list).
- Source/test snapshot identifier (including uncommitted inputs): HEAD cc82bfd plus uncommitted spec files with sha256: convert.spec.ts `9cbec57e6c40d5df3995de2de16f77eda665e0703cd99bcb3af071da8bada117`, ejson.spec.ts `7cff9ea5fa9b6671bccd6d448dbd0766f97921e3b2f02db5e4bbd97c6a0ee6c0`, json-tree.spec.ts `e0200f3b5ff4a2914ed46a946ac4af41bd12bc871e188c9b0e99a7b04005db70`, model.spec.ts `498ba375622402f486c772cb5666884d73e51742051766ccb03c371bd63b06fb`, path.spec.ts `42e29536153ecefbb7efcddebf2bb7bfe4e4c4d423404b098c18786e7b53cdc3`, iso-date.spec.ts (unchanged) `6bd6bbff49e89ccdc7a2b930c6981d1e5028c4fc3777df76cd2e59e2f86afa9e`. Production files unchanged from HEAD (`git status` shows no modified production file): convert.ts `7d9b91a92cf90184ded52531dc1484789a6bf661eb1f594d9a784e0bdeac3319`, ejson.ts `2bc9abdb5aac1575f20f668d33203c27507b8dab33597bd92ce49c1f50441a96`, json-tree.ts `2241ad0293f285d6da75c5de9e6439764819252ede81695f1f66f48cb8a6ed75`, model.ts `8dc667f03e61016bd5abec9c602e85847dc78f69817c10ef52e11c9b8b9e0f0e`, path.ts `c4f4c84c2b07e946665af36b90f5c66712930dcf87c9ac48dfb5fae16594cbbe`, iso-date.ts `d82f61b232e173dc53894bdfc64c519c3d69f97f4296a76c1fe3b6fceaaa1ccf`.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/bson/model.ts`, `json-tree.ts`, `ejson.ts`, `iso-date.ts`, `convert.ts`, `path.ts`, `index.ts`, `src/index.ts`. Excluded: `packages/core/package.json` and `package-lock.json` (dependency config, no executable behavior), all `*.spec.ts`. No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with `@vitest/coverage-v8` (v8 provider); cwd `packages/core`; `npx vitest run --coverage --coverage.reportOnFailure --coverage.reportsDirectory=coverage/tw-final --coverage.include='src/bson/model.ts' --coverage.include='src/bson/json-tree.ts' --coverage.include='src/bson/ejson.ts' --coverage.include='src/bson/iso-date.ts' --coverage.include='src/bson/convert.ts' --coverage.include='src/bson/path.ts' --coverage.include='src/bson/index.ts' --coverage.include='src/index.ts' --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text`; test selection: all core specs (7 files, 186 tests).
- Run start/completion time and exit status: started 2026-11-16 19:35:10 local, duration 227 ms; exit non-zero (1 failed test, TW-1).
- Generated report paths and report hashes/run identifier: `packages/core/coverage/tw-final/coverage-summary.json` sha256 `4710e61e261dc253136fb3864fd2151e440e457f105da237589b82fd9311624b`; `packages/core/coverage/tw-final/coverage-final.json` sha256 `70c4463a5d3dc348fb0f127897993b3b561cf32d0ebf0320514dd089d2e12d81` (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: new output directory `coverage/tw-final` created by this run; sha256 of all scoped source and spec files identical before and after the coverage and `npm run check` runs.
- Final run after latest test additions and production fixes: yes for the test additions; no production fix exists yet (TW-1 open). After the fixer changes `convert.ts` this coverage is stale and must be re-run.

Baseline before this run's tests (same command, `coverage/tw-baseline`, all 100 tests passing): model.ts 9/21 statements, 0/13 branches, 0/8 functions; json-tree.ts 33/35 branches; ejson.ts 162/164 branches; path.ts 86/87 branches; convert.ts and iso-date.ts already 100%.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/core/src/bson/model.ts` | 21/21 (100%) | 13/13 (100%) | 8/8 (100%) | 21/21 (100%) |
| `packages/core/src/bson/json-tree.ts` | 93/93 (100%) | 35/35 (100%) | 7/7 (100%) | 84/84 (100%) |
| `packages/core/src/bson/ejson.ts` | 188/188 (100%) | 164/164 (100%) | 29/29 (100%) | 160/160 (100%) |
| `packages/core/src/bson/iso-date.ts` | 24/24 (100%) | 24/24 (100%) | 2/2 (100%) | 22/22 (100%) |
| `packages/core/src/bson/convert.ts` | 151/151 (100%) | 145/145 (100%) | 14/14 (100%) | 129/129 (100%) |
| `packages/core/src/bson/path.ts` | 109/109 (100%) | 86/87 (98.85%) | 24/24 (100%) | 92/92 (100%) |
| `packages/core/src/bson/index.ts` | N/A (0/0, re-exports only) | N/A | N/A | N/A |
| `packages/core/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| Aggregate (summed counters, all 8 files, none missing or excluded) | 587/587 (100%) | 467/468 (99.78%) | 84/84 (100%) | 509/509 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/core/src/bson/path.ts:43` (falsy arm of `value ? ... : 'does not exist'` in `asContainer`) | none: `updateContainer` only recurses into an existing child (it checks `i < 0` first) and the root is always a value, so `value` is never undefined here | Justified gap: defensive code, unreachable through the public API |
| `packages/core/src/bson/convert.ts:157-182` | covered, but the decimal-with-fraction-zeros path is wrong | TW-1 failing test kept |

## Unable to test

- "No Node APIs (runs in the renderer)": a static property, not observable in a unit test under Vitest's `node` environment. Checked by reading the scoped files (only `bson` and relative imports; base64 is hand-written without `Buffer`). Lint or bundling rules would have to enforce it; no follow-up is needed for this task.
- Coverage numbers are diagnostic (partial-failed) until TW-1 is fixed. Re-run the coverage command above after the fix.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion.
