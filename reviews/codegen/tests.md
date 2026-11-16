# Test Report

Date: 2026-11-16

Task: codegen - M3: Code export (shell, Node, Python, Java)

Scope: second pass, on the final code after the fixes. Task base `8d4a6936df82e08a9a8e68fdd496ce290bf6b40c` .. HEAD `4f928fd3e0bfef4aa5e528844786b619ccd679f6`, branch `main`. The parent named the task-owned commits: `51753b5` (code export in `packages/core/src/codegen` plus the re-export in `packages/core/src/index.ts`), `db456ab` (`test/integration/codegen.int.spec.ts`), `42fd635` (edge-case tests from the first pass) and `4f928fd` (fixes for CR-1, CR-2 and TW-1, see `reviews/codegen/fixes.md`). The range base..HEAD also holds commits from other tasks that were merged from main (profiles-store, e2e-harness, and TFP state commits under `tasks/`). I left those out; the task's production scope is the `packages/core/src/codegen/*.ts` files and `packages/core/src/index.ts`. This pass reviewed the fix commit `4f928fd` in detail. Working tree at the start: only the untracked `reviews/codegen/`. At the end: one modified test file (`codegen.edge.spec.ts`, 2 new tests) and this report.

Requirements:
- `tasks/codegen.md` acceptance criteria and recorded assumptions
- `SPEC.md` (code export for shell, Node, Python, Java)
- `docs/ARCHITECTURE.md` "Coverage"
- `reviews/codegen/fixes.md` (what the fixes are meant to do) and the `layout.ts` module contract (80-column `WIDTH`)
- The parent's instructions: check that the fixed behavior is covered, run the named commands, rewrite this report for `4f928fd`

## Test files changed

- `packages/core/src/codegen/codegen.edge.spec.ts` (2 tests added in the `layout` block; nothing else changed)

No existing test was weakened, skipped or removed. `codegen.spec.ts`, its snapshot and `test/integration/codegen.int.spec.ts` are unchanged from HEAD.

## Tests added or updated

Count: 2 (codegen unit tests: 128 at HEAD, 130 now)

Checking the fixes:
- **CR-1 (Java `Arrays.asList((Object) null)`)**: already covered by the fixer. The unit tests "Java arrays" cover a lone null, a lone null in a nested array, and check that `[null, null]` and `[1]` are unchanged. The integration query `{ ratio: { $in: [null] }, ... }` runs in Node, Python and Java against mongo8 and gives the same documents as the driver. Nothing added.
- **CR-2 (Python SON removed)**: already covered. The "duplicate keys" test expects dict literals at the top level, nested and in a pipeline, and expects no `SON` import. `python.ts` is 60/60 branches. Nothing added.
- **TW-1 (layout trailing width)**: the fixer added the layout-level test I proposed and a second test for the later-parts rule. I found two gaps and added a test for each:
  - "generated find statements stay within WIDTH when `;` or `)` follows the group (TW-1)": for each of the 4 languages and string lengths 1..45, every line of the `generateCode` output that holds the string stays within 80 columns. This covers the exact cases from the first pass (Node 41, shell 18, Java 37 `v`s, all 81 columns before the fix) through the public API, not just through `layout`. I did not revert the fix to watch the test fail, because that would mean changing production code. The first-pass report measured these inputs at 81 columns before the fix.
  - "counts an empty list after a group as unbreakable text": the new `firstLine` helper treats an empty list as text that can't break (`layout.ts:63-64`). This branch was not covered. The test checks that `group[]` at exactly 80 columns stays on one line and that `group[];` (81) breaks the group. If an empty list were counted as breakable, the second case would print an 81-column line.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Snapshot tests for each language over 10 queries/pipelines including every BSON type | `codegen.spec.ts` (type coverage check + 40 snapshots), plus the meaning checks in `codegen.edge.spec.ts` (Node BSON byte comparison, shell parse-back) | `npx vitest run --project core packages/core/src/codegen` (repo root) | Pass (2 files, 130 tests) |
| AC2 Generated Node and Python code for 3 samples runs against a fixture (Java too) | `test/integration/codegen.int.spec.ts`: vacuity check `[2, 1, 2, 2]` + 4 queries x node/python/java | `npm run test:int -- codegen` (repo root; mongo8 fixture, Python and Java containers via podman) | Pass (13 tests, 10.33 s) |
| CR-1 fix: a lone `null` in a Java array becomes `(Object) null`; other arrays unchanged | "Java arrays" (2 tests); int query "find null or missing values with $in: [null]" (node, python, java) | both commands above | Pass |
| CR-2 fix: Python writes repeated keys as a dict literal and does not import SON | "duplicate keys" > "Python writes a document with a repeated key as a dict literal, nested too", "Python uses a plain dict (and no SON import) when the keys are unique" | focused command | Pass |
| TW-1 fix: text after a group counts toward the 80-column width | "does not let text after a group push the line past WIDTH", "counts later parts up to their first break, and the outer trailing text", **new** "counts an empty list after a group as unbreakable text", **new** "generated find statements stay within WIDTH when `;` or `)` follows the group (TW-1)"; the updated Java snapshot and "writes positive values in every language" | focused command | Pass |
| Earlier edge cases (dates, timestamps, collation, skip/limit, empty options, uri, `__proto__`, escapes, booleans) | `codegen.edge.spec.ts` (unchanged from the first pass, except the fixer's updates above) | focused command | Pass |

## Focused test execution

Command:

`npx vitest run --project core packages/core/src/codegen` (working directory: repo root)

Result:

Pass: 2 test files, 130 tests. Before my changes, the same command at HEAD gave 128/128 at 20:37:42. With the first new test: 129/129 at 20:37:48. With both new tests: 130/130, in the coverage run at 20:38:27. `npx prettier --check` and `npx eslint` on the edge spec are clean.

Integration:

`npm run test:int -- codegen` (repo root) -> Pass, 1 file, 13 tests, started 20:38:00, 10.33 s. Node runs on the host; Python and Java run in containers via podman against mongo8.

## Full test execution

Command:

`npm run check` (= `.taskcheck`), and since it stopped at the typecheck step, the remaining steps run separately: `npm run typecheck --workspaces --if-present` and `npm run test`

Result:

Fail (environment, not codegen). `npm run lint` (eslint + `prettier --check .`) passed. The root `tsc -p tsconfig.json` failed: `Cannot find module '@playwright/test'` in `playwright.config.ts`, `test/e2e/failure-fixture/playwright.config.ts`, `test/e2e/harness/app.ts` and `test/e2e/harness/fixtures.ts`, plus the implicit-any errors that follow from it in `test/e2e/*`. `node_modules/@playwright` does not exist in this clone. That dependency comes from the e2e-harness task, which was merged from main; it is not part of codegen. I am not allowed to install dependencies.

The remaining steps, run separately, passed: the workspace typechecks (desktop, contract, core, backend, renderer) gave no errors, `npx tsc -p packages/core --noEmit` passed, and `npm run test` passed (root vitest 36 files / 2296 tests; renderer 27 files / 437 tests).

## .taskcheck

Result:

Fail: the same run as above. The failure is the missing `@playwright/test` module in the root typecheck; no codegen file is involved. The parent should run `npm install` (or `npm ci`) so the lockfile's `@playwright/test` is installed, then run `.taskcheck` again before `done`.

## Bugs found

None in this pass. The fixes for CR-1, CR-2 and TW-1 behave as `fixes.md` describes, and every test passes.

Status of the first-pass findings:
- `TW-1` (layout lines over 80 columns): fixed in `4f928fd`. A regression test now checks it at the API level.
- `TW-2` (Node and Python write the dbPointer namespace differently) and `TW-3` (Node sends BSON undefined as null, and the assumption only mentions Python): Low, not fixed, and left for the parent to decide. Both are documentation or assumption questions, not acceptance-criterion defects. The test "deprecated types: symbol and code with scope are exact; dbPointer becomes a DBRef" still pins the current Node behaviour.

Note for the parent, not a code defect: `fixes.md` says recorded assumption #2 still says Python uses SON for duplicate keys. Since CR-2, Python writes a dict literal, which keeps only the last value of a repeated key. The assumption should be corrected with `tasks.py assume`.

## Coverage

Status: verified (whole-file coverage of all task-changed production files, measured on the final code plus the 2 new tests).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately. Every file in `src/codegen` is new in this task, so whole-file coverage equals changed-line coverage there. `packages/core/src/index.ts` has one added line.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `codegen`; base `8d4a6936df82e08a9a8e68fdd496ce290bf6b40c`; HEAD `4f928fd3e0bfef4aa5e528844786b619ccd679f6`; task commits `51753b5`, `db456ab`, `42fd635`, `4f928fd`, as given by the parent and in `fixes.md`, and checked with `git log`/`git show --stat`.
- Source/test snapshot identifier (including uncommitted inputs): production and integration files equal HEAD (`git diff --quiet HEAD` over the 9 production files listed below and `test/integration` passed after the run). The only uncommitted input is `codegen.edge.spec.ts`, sha256 `74f0848dd4cdc1d200c4186f125243b033029460bd3c96a120a1f2d94c8a2e73`. `codegen.spec.ts` is `458d9b20…`. Production sha256: `index.ts` 6330b8fd…, `java.ts` 43c8566e…, `layout.ts` adbec64f…, `model.ts` 92cf6139…, `node.ts` 78fa8ba3…, `python.ts` 16aa2a51…, `samples.ts` 72135201…, `shell.ts` f881de50…, `packages/core/src/index.ts` 8bfe5865….
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/core/src/codegen/{index,java,layout,model,node,python,samples,shell}.ts` and `packages/core/src/index.ts`. Excluded: `codegen.spec.ts`, `codegen.edge.spec.ts`, the snapshot and `test/integration/codegen.int.spec.ts`, because they are tests. Also excluded are the other tasks' files in the base..HEAD range (profiles-store, e2e-harness), which belong to other tasks. No renamed or deleted files.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8`, vitest 5.1.0. Command `npx vitest run --coverage --coverage.include='src/codegen/*.ts' --coverage.include='src/index.ts' --coverage.reporter=text --coverage.reporter=json-summary src/codegen`, run in `packages/core`. This is the parent's command plus `src/index.ts` and machine-readable output. Test selection: `codegen.spec.ts` and `codegen.edge.spec.ts`.
- Run start/completion time and exit status: started 2026-11-16T20:38:27+01:00, duration 305 ms, exit 0, 130 tests passed.
- Generated report paths and report hashes/run identifier: `packages/core/coverage/coverage-summary.json`, sha256 `f8381211d4e450cea0e027cb02a3573fce8d723a1545ad222f08d9d75a2e467e`.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The earlier run in this pass (20:38:13, 129 tests) showed `layout.ts` at 41/42 branches. This run shows 42/42 and 283 total branches, which matches the current code and does not match the first-pass report (270). The sha256 values above were taken after the run, production files match HEAD, and nothing changed after the run.
- Final run after latest test additions and production fixes: yes. It ran after the fix commit `4f928fd` and after my last test change.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/core/src/codegen/index.ts` | 5/5 (100%) | 5/5 (100%) | 1/1 (100%) | 5/5 (100%) |
| `packages/core/src/codegen/java.ts` | 109/109 (100%) | 86/87 (98.85%) | 17/17 (100%) | 93/93 (100%) |
| `packages/core/src/codegen/layout.ts` | 54/54 (100%) | 42/42 (100%) | 11/11 (100%) | 47/47 (100%) |
| `packages/core/src/codegen/model.ts` | 14/14 (100%) | 12/12 (100%) | 4/4 (100%) | 12/12 (100%) |
| `packages/core/src/codegen/node.ts` | 67/67 (100%) | 50/50 (100%) | 11/11 (100%) | 60/60 (100%) |
| `packages/core/src/codegen/python.ts` | 80/80 (100%) | 60/60 (100%) | 11/11 (100%) | 68/68 (100%) |
| `packages/core/src/codegen/samples.ts` | 15/15 (100%) | 7/7 (100%) | 5/5 (100%) | 8/8 (100%) |
| `packages/core/src/codegen/shell.ts` | 30/30 (100%) | 20/20 (100%) | 5/5 (100%) | 23/23 (100%) |
| `packages/core/src/index.ts` | 0/1 (0%) | N/A (0/0) | N/A (0/0) | 0/1 (0%) |
| Aggregate (summed counters, all 9 files above) | 374/375 (99.73%) | 282/283 (99.65%) | 65/65 (100%) | 316/317 (99.68%) |

The provider printed 99.64% for branches; the row above is computed from the summed counters. No file in scope is missing or unmeasured.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/core/src/codegen/layout.ts:63-64` (`firstLine`, empty-list arm), added by the TW-1 fix | Width of an empty list that follows a group (can't break) | Covered by the new test "counts an empty list after a group as unbreakable text" (41/42 -> 42/42) |
| `packages/core/src/codegen/java.ts:235` (`IMPORTS[n] ?? n`, the `?? n` arm) | None. Every name passed to `use()` is a key of `IMPORTS`, so the public API can't reach this fallback | Justified gap: defensive code (unchanged since the first pass, now 3 lines lower) |
| `packages/core/src/index.ts:2` (barrel `export * from './codegen'`) | The public `@thicket/core` export of `generateCode` | No unit test needed: the workspace typecheck checks it, and the int test imports `generateCode` from `@thicket/core` (passed). The unit specs import `./index` directly and never load the barrel |

## Unable to test

- Watching the new API-level TW-1 test fail on the code before the fix would mean reverting production code, which I may not do. The first pass measured the same inputs at 81 columns, and the test's input range includes those inputs.
- Compiling and running the generated Python and Java for the snapshot samples that the int test does not use (special doubles, deprecated types, `__proto__`, out-of-range dates). Unit tests check their text only; the int test runs 4 queries per language, more than the 3 samples AC2 asks for. Follow-up only if the parent wants broader runtime evidence.
- A complete `.taskcheck` pass: blocked by the missing `@playwright/test` install (see above). The parent must install dependencies and run it again.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The fixes for CR-1, CR-2 and TW-1 are covered by unit tests, and CR-1 also by the integration test. I added 2 tests: one for the empty-list branch that the TW-1 fix added, and one that checks the 80-column limit through `generateCode` for all 4 languages. Focused unit tests (130/130), the codegen integration test (13/13, Java included), lint, all workspace typechecks and `npm run test` pass. Coverage in `src/codegen` is 100% for statements, lines and functions, with one defensive branch uncovered in `java.ts`. Before `done`, the parent must resolve one thing outside the codegen code: `.taskcheck` currently fails in the root typecheck because `@playwright/test` (from the merged e2e-harness task) is not installed in this clone. TW-2 and TW-3 (Low) and the outdated SON assumption are still for the parent to decide.
