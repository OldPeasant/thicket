# Test Report

Date: 2026-11-16

Task: bson-model - Core: BSON value model with lossless EJSON round trip

Scope: second pass on the final code. Base `ed95d7e3c8e0c3798e189970964380e6b495cfe3` .. HEAD `e5ddbe41165a2efc285ca1bbfdeb61b4f624a630`, branch `main`. Task-owned code commits (from `git log ed95d7e..HEAD` and the parent's instructions): `e6a1a96` (implementation), `efe5a9c` (first-pass tests and reports), `e5ddbe4` (fixer: `convert.ts`, `ejson.ts`, `path.ts`, `iso-date.ts` and their specs, see `reviews/bson-model/fixes.md`). The other commits in the range are other tasks merged from main (`electron-shell`, heartbeats, claims), outside this scope. Production files in scope: `packages/core/src/bson/{model,json-tree,ejson,iso-date,convert,path,index}.ts`, `packages/core/src/index.ts`. Uncommitted inputs: the three spec files this pass edited (listed below). `reviews/bson-model/review.md` also shows as modified in the working tree. This pass did not change it (another helper did), and it does not affect the measurement.

Requirements:
- `tasks/bson-model.md` acceptance criteria and recorded assumptions
- `SPEC.md` "Documents and BSON"
- `docs/ARCHITECTURE.md` "Coverage" and "Conventions"
- `reviews/bson-model/fixes.md` (fixes for TW-1, CR-1..CR-4, OBS-1..OBS-3) and the parent's instructions (convert.ts must stay at 100% branches)

## Test files changed

This pass:
- `packages/core/src/bson/convert.spec.ts` (extended)
- `packages/core/src/bson/iso-date.spec.ts` (extended)
- `packages/core/src/bson/path.spec.ts` (extended)

Earlier passes (committed): `model.spec.ts`, `json-tree.spec.ts`, `ejson.spec.ts`, `convert.spec.ts`, `path.spec.ts` (first test-writer pass); the fixer's spec additions in `e5ddbe4`.

## Tests added or updated

Count: 15 new test cases in this pass (core tests 204 -> 219, counting each `it.each` row), plus 6 extra assertions added to 2 existing tests. No existing assertion was changed or removed.

Review of the fixer's tests: each fix has a test that fails without it (checked by reading the diff `efe5a9c..e5ddbe4`). The TW-1 test from the first pass is unchanged and now passes. The one changed existing assertion (Regex `/a+/i` -> String) used to encode the silent loss of options that CR-2 rejects. The new assertion checks the specified behavior, so this does not weaken the test. Gaps I found in the fix tests, and what this pass added for them:

- TW-1/CR-1 (Decimal128 with trailing fractional zeros -> Int32/Int64). New `convert.spec.ts` tests:
  - "Decimal128 with fractional zeros keeps the Int32/Int64 range checks": `2147483647.0`, `-2147483648.00` and `-9223372036854775808.0` convert; `2147483648.0` overflows Int32; `9223372036854775808.0` overflows Int64; `-0.0` -> 0; `1200.01` is not an integer.
  - "Decimal128 parsed from EJSON in non-canonical form converts to Int32 (TW-1 regression)": the end-to-end path. `{"$numberDecimal":"12000E-1"}` is parsed to the stored form `1200.0` and converts to 1200.
- CR-2 (String -> Double overflow; Regex -> String option loss). New tests:
  - "String -> Double: trimmed specials convert, padded overflow and junk fail": `' -Infinity '`, `+Infinity`, `' 2e308 '`, `Infinityx`, `nan`. This covers the reordered regex checks.
  - "Regex -> String fails for every non-empty option set": `imsx` fails; an empty pattern with empty options converts.
- OBS-3 (UUID from Binary subtype 4 of the wrong length): the existing test now also covers an empty payload and a 17-byte payload.
- CR-4 (canonical base64), as it affects conversions. New test "Binary subtype 4 parsed with non-canonical base64 converts to UUID text": a `$binary` subtype 04 whose last base64 character differs only in padding bits is stored canonically and converts to the expected UUID and UUID text.
- OBS-1 (extended ISO years). New `parseIsoDate` rows:
  - accepted: `0000-01-01T00:00:00Z`, the date-only `+010000-01-01`, `+010000-…+01:00` with an offset, and the JS minimum `-271821-04-20T00:00:00Z` with and without an offset;
  - rejected: one millisecond before the JS minimum, the date-only `-000000-01-01`, `+010000-02-30`, a 7-digit `+0010000`, and an unsigned 6-digit `010000`.
- CR-3/OBS-2 (`getAt` with an invalid array index): the existing test now also covers `NaN`, `Infinity` and `-0` (which behaves like index 0).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Round trip of a fixture with every BSON type (deprecated, Binary subtypes, UUID, -0, NaN/Infinity, Int64 > 2^53) is byte-identical | `ejson.spec.ts` "EJSON round trip", "EJSON round trip edge cases", "Binary base64 canonicalization" | `npx vitest run --project core` (repo root) | Pass |
| AC2 Field order preserved incl. `$`-prefixed / duplicate-looking keys | `ejson.spec.ts` "field order", `json-tree.spec.ts` key-order test, `path.spec.ts` "path API with $-prefixed and repeated keys", `model.spec.ts` field-order test | same | Pass |
| AC3 Conversion table: String->ObjectId valid/invalid, Int32->Int64, Int64->Int32 overflow, Double->Decimal128, String<->Date ISO, Binary(4)<->UUID | `convert.spec.ts` "table from the acceptance criteria", "every target", "edge cases" (incl. the TW-1 regression, extended-year Date<->String, the UUID length and canonical base64 tests) | same | Pass |
| AC4 Path API get/set/insert/remove/move with tests | `path.spec.ts` (incl. the negative/fractional/NaN/Infinity `getAt` test) | same | Pass |
| AC4 100% branch coverage on conversions | coverage run below | see Coverage | Pass: convert.ts 148/148 branches |
| Task assumption / module contract: lossy conversions are errors | `convert.spec.ts` overflow tests (String->Double, Decimal->Int, Int64->Int32), Regex option loss | `npx vitest run --project core` | Pass (see OBS-4 for underflow) |
| No Node APIs in core (runs in the renderer) | not a behavioral test; checked by reading: only `bson` and relative imports, hand-written base64 | n/a | Not testable as a unit test (static property) |

## Focused test execution

Command:

`npx vitest run src/bson` (repo root)

Result:

Pass: 6 files, 218 tests.

Also run (repo root):
- `npx eslint packages/core --max-warnings 0` -> Pass (no output)
- `npx prettier --check packages/core` -> Pass ("All matched files use Prettier code style!", after `npx prettier --write packages/core/src/bson/convert.spec.ts` on this pass's edits)
- `npm run typecheck -w packages/core` -> Pass (`tsc -p tsconfig.json`, no errors)

## Full test execution

Command:

`npm run check` (repo root; `npm run lint && npm run typecheck && npm run test`)

Result:

Fail (exit 2), for an environment reason outside this task. `lint` passed (eslint plus `prettier --check .`). `typecheck` failed only in the `@thicket/desktop` workspace: `TS2307: Cannot find module 'electron'` / `'playwright-core'` in `apps/desktop/src/main/index.ts`, `window.ts`, `src/preload/index.ts` and `apps/desktop/test/*.ts`, plus TS7006 errors that follow from them. Those dependencies came from the `electron-shell` task (commit `0358b98`, merged from main) and are not installed in this clone: `node_modules/electron` and `node_modules/playwright-core` do not exist. The test-writer may not install dependencies. The `core`, `contract`, `backend` and `renderer` type checks passed. Because `&&` stops after the typecheck failure, the test stage was run separately:

`npm run test` (repo root) -> Pass: Vitest 18 files / 956 tests passed; renderer `ng test` 5 files / 181 tests passed.

Follow-up for the parent: run `npm install` (or `npm ci`) so the lockfile's `electron`/`playwright-core` are present, then re-run `npm run check`. This must pass before `tasks.py done`.

## .taskcheck

Result:

Not run directly. `.taskcheck` runs `npm run check`, which was run directly above. It fails at the desktop typecheck because of the missing installed dependencies, not because of bson-model code.

## Bugs found

No new production defects. All first-pass findings (TW-1, OBS-1..OBS-3) are fixed and their tests pass.

### Observations (no failing test added; requirement not specified, parent decides)

- OBS-4 (Low): String -> Double and Decimal128 -> Double still underflow silently. `convert(s('1e-400'), 'double')` returns `0`, and `convert(dec('1E-6177'), 'double')` returns `0` (`convert.ts:196-210`). The module comment says a conversion "never silently truncates or overflows", and CR-2 made overflow an error. Underflow to 0 (or to a subnormal) is a precision loss, not an overflow, and every decimal-to-double conversion rounds anyway (e.g. `0.1`). So this is not asserted either way. Only flag it if the parent reads "truncates" as covering a non-zero value that becomes 0.

## Coverage

Status: verified. The run is fresh, all 219 core tests passed, exit 0, and every scoped file was instrumented.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately. Every scoped file is new in this task except `packages/core/src/index.ts` (one added re-export line), so whole-file coverage equals changed-line coverage for the new files.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `bson-model`; base `ed95d7e3c8e0c3798e189970964380e6b495cfe3`; HEAD `e5ddbe41165a2efc285ca1bbfdeb61b4f624a630`; task-owned commits `e6a1a96`, `efe5a9c`, `e5ddbe4` (parent instructions plus `git log`); file scope from the first pass and `git diff efe5a9c e5ddbe4 -- packages/core` (no new production files).
- Source/test snapshot identifier (including uncommitted inputs): HEAD e5ddbe4 plus uncommitted spec edits. sha256 of the specs: convert.spec.ts `e99515ce71ca43bb4c2a494775e47845c76f248ae69ec4157adc996f1098cca8`, iso-date.spec.ts `fa21e7b13b1bc5fdf375e203225f434f75b42bbe408c94f3a302798f5ae00ebd`, path.spec.ts `d0adf39619b8e9788e2d53833f8853fcf2b79b3f512c72abbeb777ea3693a14b`, ejson.spec.ts `43dd069fa6c6656074a79caf480c55d1a09f2cbd20de64f1b9c05568341bf888`, json-tree.spec.ts `e0200f3b5ff4a2914ed46a946ac4af41bd12bc871e188c9b0e99a7b04005db70`, model.spec.ts `498ba375622402f486c772cb5666884d73e51742051766ccb03c371bd63b06fb`. Production files are as committed at HEAD: convert.ts `c8bbd2f2109ce054740c81eb588d20fd7e52c3829e0d2fb11d6d0000ca34ba5d`, ejson.ts `09ebb536a7db5eb2c9cb389c1929235896dea98b8ee695868ca9c3d8c89caebc`, iso-date.ts `92c15a37db74937c8c8261d2f48e678f60681eb3708989e0bc13c1c59aed045e`, path.ts `9f316ea448f924425539fd8765edfc8ecf4d14c822983a2a060bc3bd750f8e17`, json-tree.ts `2241ad0293f285d6da75c5de9e6439764819252ede81695f1f66f48cb8a6ed75`, model.ts `8dc667f03e61016bd5abec9c602e85847dc78f69817c10ef52e11c9b8b9e0f0e`, bson/index.ts `df1b43c542ba79ccbd140e929e931fff376942a4da6ca129e43bbb1eaa2b2ec2`, src/index.ts `2309da5b43ac670850d7518aeb9431b3925fd9a342fdc521a0734c7511f57035`.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/bson/model.ts`, `json-tree.ts`, `ejson.ts`, `iso-date.ts`, `convert.ts`, `path.ts`, `index.ts`, and `src/index.ts`. Excluded: `*.spec.ts`, plus `packages/core/package.json` and `package-lock.json` (dependency configuration, no executable behavior). No files were renamed or deleted.
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with `@vitest/coverage-v8`. Working directory: repo root. Command: `npx vitest run --project core --coverage --coverage.include='src/bson/*.ts' --coverage.include='src/index.ts' --coverage.exclude='**/*.spec.ts' --coverage.reportsDirectory=packages/core/coverage/tw-pass2 --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text`. Test selection: all core specs (7 files, 219 tests). The include globs resolve against the `core` project root (`packages/core`). The command the parent suggested, `--coverage.include='packages/core/src/bson/*.ts'` from the repo root, matched no files and reported `0/0` ("Unknown%"). It also passed 219 tests, but its coverage output is not evidence.
- Run start/completion time and exit status: started 19:41:45 local (2026-11-16), duration 186 ms, exit 0.
- Generated report paths and report hashes/run identifier: `packages/core/coverage/tw-pass2/coverage-summary.json` sha256 `6d2c558a4e15f7e7e32829670c7a91693dbca3074453d69c3a44138529156221`; `packages/core/coverage/tw-pass2/coverage-final.json` sha256 `6514158374f368b664f2f3577491b4e8364db994085a3256b30421ae151f4346` (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: this run created the new output directory `coverage/tw-pass2`. The sha256 of every scoped source and spec file was identical before the coverage run and after `npm run test`.
- Final run after latest test additions and production fixes: yes. It ran after the fixer's commit `e5ddbe4` and after this pass's test additions.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/core/src/bson/model.ts` | 21/21 (100%) | 13/13 (100%) | 8/8 (100%) | 21/21 (100%) |
| `packages/core/src/bson/json-tree.ts` | 93/93 (100%) | 35/35 (100%) | 7/7 (100%) | 84/84 (100%) |
| `packages/core/src/bson/ejson.ts` | 188/188 (100%) | 164/164 (100%) | 29/29 (100%) | 160/160 (100%) |
| `packages/core/src/bson/iso-date.ts` | 24/24 (100%) | 26/26 (100%) | 2/2 (100%) | 22/22 (100%) |
| `packages/core/src/bson/convert.ts` | 156/156 (100%) | 148/148 (100%) | 14/14 (100%) | 131/131 (100%) |
| `packages/core/src/bson/path.ts` | 110/110 (100%) | 89/90 (98.89%) | 24/24 (100%) | 92/92 (100%) |
| `packages/core/src/bson/index.ts` | N/A (0/0, re-exports only) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/core/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| Aggregate (summed counters, all 8 files, none missing or excluded) | 593/593 (100%) | 475/476 (99.79%) | 84/84 (100%) | 511/511 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/core/src/bson/path.ts:43` (falsy arm of `value ? ... : 'does not exist'` in `asContainer`) | None. `updateContainer` only recurses into an existing child (it checks `i < 0` first), and the root is always a value, so `value` is never undefined here. | Justified gap: defensive code that the public API cannot reach (unchanged since the first pass) |

## Unable to test

- "No Node APIs (runs in the renderer)" is a static property. A unit test under Vitest's `node` environment cannot observe it. I checked it by reading the code instead. No follow-up is needed for this task.
- The full `npm run check` / `.taskcheck` could not pass in this clone because the desktop dependencies (`electron`, `playwright-core`) from the merged `electron-shell` task are not installed. The parent needs to install them and re-run the check (see Full test execution).

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The fixes are tested, and this pass added boundary and end-to-end tests. convert.ts is at 148/148 branches. Before `done`, the parent must get `npm run check` passing in an environment where the desktop dependencies are installed.
