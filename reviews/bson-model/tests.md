# Test Report

Date: 2026-11-16

Task: bson-model - Core: BSON value model with lossless EJSON round trip

Scope: third pass, re-validation of the final revision after the rebase onto main. Base `2ad72d2d5d76b68f3f9d834418ad86e4e37d3cf0` .. HEAD `baf3ba3dd760f22a26766a1bc2cf68c6162968f4`, branch `main`. Task-owned commits (`git log 2ad72d2..HEAD`, all five are bson-model): `fe32363` (implementation), `7dac9bd` (first-pass tests and reports), `c510559` (fixer), `668c57b` (second-pass tests and reports), `baf3ba3` (review report). The rebase put these on top of main, which added `packages/core/src/uri` (task `uri-model`, outside this scope). The parent resolved conflicts in `packages/core/package.json`, `packages/core/src/index.ts` and `package-lock.json` by keeping both sides. Production files in scope: `packages/core/src/bson/{model,json-tree,ejson,iso-date,convert,path,index}.ts`, `packages/core/src/index.ts`. Working tree: clean apart from the untracked `__pycache__/` at the repo root (not task input) and git-ignored `packages/core/coverage/`.

Requirements:
- `tasks/bson-model.md` acceptance criteria and recorded assumptions
- `SPEC.md` "Documents and BSON"
- `docs/ARCHITECTURE.md` "Coverage" and "Conventions"
- `reviews/bson-model/fixes.md` and the parent's instructions for this pass (re-run on the final revision; new tests only if the merge exposed something)

## Test files changed

None in this pass. All bson spec files are as committed at `baf3ba3`: `model.spec.ts`, `json-tree.spec.ts`, `ejson.spec.ts`, `iso-date.spec.ts`, `convert.spec.ts`, `path.spec.ts`.

## Tests added or updated

Count: 0 in this pass.

Merge check:
- Every bson production and spec file has the same sha256 as in the second pass (listed under Coverage). The bson code and tests did not change in the rebase.
- `packages/core/src/index.ts` now has `export * from './bson'` and `export * from './uri'`. I compared the exported names of `bson/index.ts` (`model`, `ejson`, `convert`, `iso-date`, `path`) with those of `uri/index.ts` (`model`, `convert`, `mask`), and no name is exported by both. With two `export *` sources, a shared name would be silently dropped or would raise TS2308. `tsc` for core passes, which confirms there is no clash. Both modules have a file called `convert.ts`, but `uri` re-exports only `ConnectionStringError`, `parseConnectionString` and `toConnectionString` from its file, so the names differ from bson's `convert`/`uuidOf`/`ConversionError`.
- `packages/core/package.json` keeps `bson` (^7.3.4) as a runtime dependency next to `mongodb-connection-string-url`. In `package-lock.json`, `bson` is no longer marked `dev` and is listed as a dependency of `@thicket/core`. This is consistent.
- I added no test for the `index.ts` re-exports. They are covered by `tsc` and by the coverage run (1/1 statement). A runtime test would only repeat what the type check proves.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Round trip of a fixture with every BSON type (deprecated, Binary subtypes, UUID, -0, NaN/Infinity, Int64 > 2^53) is byte-identical | `ejson.spec.ts` "EJSON round trip", "EJSON round trip edge cases", "Binary base64 canonicalization" | `npx vitest run --project core` (repo root) | Pass |
| AC2 Field order preserved incl. `$`-prefixed / duplicate-looking keys | `ejson.spec.ts` "field order", `json-tree.spec.ts` key-order test, `path.spec.ts` "path API with $-prefixed and repeated keys", `model.spec.ts` field-order test | same | Pass |
| AC3 Conversion table: String->ObjectId valid/invalid, Int32->Int64, Int64->Int32 overflow, Double->Decimal128, String<->Date ISO, Binary(4)<->UUID | `convert.spec.ts` "table from the acceptance criteria", "every target", "edge cases" (incl. the TW-1 regression, extended-year Date<->String, the UUID length and canonical base64 tests) | same | Pass |
| AC4 Path API get/set/insert/remove/move with tests | `path.spec.ts` | same | Pass |
| AC4 100% branch coverage on conversions | coverage run below | `npm exec -w packages/core -- vitest run --coverage ...` | Pass: convert.ts 148/148 branches |
| Task assumption / module contract: lossy conversions are errors | `convert.spec.ts` overflow tests (String->Double, Decimal->Int, Int64->Int32), Regex option loss | `npx vitest run --project core` | Pass (see OBS-4 for underflow) |
| Core exports both bson and uri APIs without clashes after the merge | static: `tsc` on core | `npm run typecheck -w packages/core` | Pass |
| No Node APIs in core (runs in the renderer) | not a behavioral test; checked by reading: only `bson` and relative imports, hand-written base64 | n/a | Not testable as a unit test (static property) |

## Focused test execution

Command:

`npx vitest run --project core` (working directory: repo root `/home/eric/work/mongo-db-client-agents/agent-3`)

Result:

Pass: 9 test files, 532 tests (the 6 bson spec files plus the core specs that came from main, including `uri/convert.spec.ts` and `uri/mask.spec.ts`). Started 19:46:50, 736 ms.

Also run (repo root):
- `npx eslint packages/core --max-warnings 0` -> Pass (no output, exit 0)
- `npx prettier --check packages/core` -> Pass ("All matched files use Prettier code style!")
- `npm run typecheck -w packages/core` -> Pass (`tsc -p tsconfig.json`, no errors)

## Full test execution

Command:

Not run in this pass. The parent asked for the core-scoped commands above. The repo-wide `npm run check` is the parent's `.taskcheck` step. The second pass found it failed only in the `@thicket/desktop` typecheck because `electron`/`playwright-core` were not installed in this clone, which has nothing to do with this task.

Result:

Not run

## .taskcheck

Result:

Not run (parent-owned final step; see above).

## Bugs found

No production defects. The merge exposed no issues.

### Observations (no failing test added; requirement not specified, parent decides)

- OBS-4 (Low, carried over unchanged from the second pass): String -> Double and Decimal128 -> Double still underflow silently. `convert(s('1e-400'), 'double')` returns `0` (`convert.ts:196-210`). This is a precision loss, not an overflow, and the spec does not define it. It is not asserted either way.

## Coverage

Status: verified. The run is fresh, all 532 core tests passed, exit 0, and every scoped file was instrumented.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately. Every scoped bson file is new in this task. In `packages/core/src/index.ts` the task adds `export * from './bson'` and changes a comment, and that file's only executable statement is covered. So whole-file coverage equals changed-line coverage here.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `bson-model`; base `2ad72d2d5d76b68f3f9d834418ad86e4e37d3cf0` (from the parent); HEAD `baf3ba3dd760f22a26766a1bc2cf68c6162968f4`; task-owned commits `fe32363`, `7dac9bd`, `c510559`, `668c57b`, `baf3ba3` (`git log 2ad72d2..HEAD`). File scope from `git diff --stat 2ad72d2..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD `baf3ba3`, no uncommitted task inputs. sha256 before and after the runs (identical): convert.ts `c8bbd2f2109ce054740c81eb588d20fd7e52c3829e0d2fb11d6d0000ca34ba5d`, ejson.ts `09ebb536a7db5eb2c9cb389c1929235896dea98b8ee695868ca9c3d8c89caebc`, iso-date.ts `92c15a37db74937c8c8261d2f48e678f60681eb3708989e0bc13c1c59aed045e`, path.ts `9f316ea448f924425539fd8765edfc8ecf4d14c822983a2a060bc3bd750f8e17`, json-tree.ts `2241ad0293f285d6da75c5de9e6439764819252ede81695f1f66f48cb8a6ed75`, model.ts `8dc667f03e61016bd5abec9c602e85847dc78f69817c10ef52e11c9b8b9e0f0e`, bson/index.ts `df1b43c542ba79ccbd140e929e931fff376942a4da6ca129e43bbb1eaa2b2ec2`, src/index.ts `68ae1fd8e54a432de2125fa46606bfd32db9a8622bdfc4cd3addb9413ddf3174` (changed by the merge, which added the uri export); specs: convert.spec.ts `e99515ce71ca43bb4c2a494775e47845c76f248ae69ec4157adc996f1098cca8`, ejson.spec.ts `43dd069fa6c6656074a79caf480c55d1a09f2cbd20de64f1b9c05568341bf888`, iso-date.spec.ts `fa21e7b13b1bc5fdf375e203225f434f75b42bbe408c94f3a302798f5ae00ebd`, json-tree.spec.ts `e0200f3b5ff4a2914ed46a946ac4af41bd12bc871e188c9b0e99a7b04005db70`, model.spec.ts `498ba375622402f486c772cb5666884d73e51742051766ccb03c371bd63b06fb`, path.spec.ts `d0adf39619b8e9788e2d53833f8853fcf2b79b3f512c72abbeb777ea3693a14b`.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/bson/model.ts`, `json-tree.ts`, `ejson.ts`, `iso-date.ts`, `convert.ts`, `path.ts`, `index.ts`, and `src/index.ts`. Excluded: `*.spec.ts`; `packages/core/package.json` and `package-lock.json` (dependency configuration, no executable behavior); `src/uri/**` (task `uri-model`, from main). No files were renamed or deleted.
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with v8 coverage. Command (run from the repo root, so Vitest's working directory is `packages/core`): `npm exec -w packages/core -- vitest run --coverage --coverage.include='src/bson/*.ts' --coverage.include='src/index.ts' --coverage.exclude='**/*.spec.ts' --coverage.reportsDirectory=coverage/tw-pass3 --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text`. Test selection: all core specs (9 files, 532 tests).
- Run start/completion time and exit status: started 19:46:56 local (2026-11-16), duration 1.06 s, exit 0, all tests passed.
- Generated report paths and report hashes/run identifier: `packages/core/coverage/tw-pass3/coverage-summary.json` sha256 `6d2c558a4e15f7e7e32829670c7a91693dbca3074453d69c3a44138529156221`; `packages/core/coverage/tw-pass3/coverage-final.json` sha256 `6514158374f368b664f2f3577491b4e8364db994085a3256b30421ae151f4346` (git-ignored). These hashes are byte-identical to the second pass's `tw-pass2` reports. That is expected: the instrumented files, their absolute paths and all counters are unchanged, and the uri specs from main add no hits outside `src/uri`, which is not instrumented.
- Evidence outputs are fresh and inputs stayed unchanged: this run created the new directory `coverage/tw-pass3`, which no earlier run had used. The scoped source and spec hashes were identical before and after the test, coverage, lint and typecheck runs.
- Final run after latest test additions and production fixes: yes. It ran on the final revision `baf3ba3`. No test or production change followed.

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
| Aggregate (summed counters, all 8 files, none missing; `src/uri/**` excluded as another task's code) | 593/593 (100%) | 475/476 (99.79%) | 84/84 (100%) | 511/511 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/core/src/bson/path.ts:43` (falsy arm of `value ? ... : 'does not exist'` in `asContainer`) | None. `updateContainer` only recurses into an existing child (it checks `i < 0` first), and the root is always a value, so `value` is never undefined here. | Justified gap: defensive code that the public API cannot reach (unchanged since the first pass) |

## Unable to test

- "No Node APIs (runs in the renderer)" is a static property. A unit test under Vitest's `node` environment cannot observe it. I checked it by reading the code instead. No follow-up is needed.
- I did not run the repo-wide `npm run check` / `.taskcheck` in this pass (parent-owned). The parent must run it before `done`.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. On the final revision `baf3ba3`, the core suite passes (9 files, 532 tests), as do eslint, prettier and the core typecheck. The merged `src/index.ts` exports the bson and uri APIs with no name clashes. convert.ts is at 148/148 branches. The only uncovered branch is the unreachable defensive arm at `path.ts:43`.
