# Test Report

Date: 2026-11-17

Task: explain-ui - M3: Explain plan viewer (round 2, after the fixer)

Scope: task commits `6d14cda876ae5d665a9861e7e0ead68b908762d9..8d2acb332a69eb6ccf8e65fb9e061f71dcfd5fc4`
on `main`. Base = `git merge-base HEAD origin/main`. Task commits (`git log 6d14cda..HEAD`): f0cb232 (implementation:
explain plan viewer, Explain on the query bar and the pipeline builder), abb6b20 (model/component
tests), 4ed92b2 (e2e), 24eea68 (architecture notes), e0df0ad (round-1 tests and review reports),
8d2acb3 (fixer: CR-2, CR-3, TW-1, A2). HEAD moved from 85e5b10 to 8d2acb3 during this round because
the branch was rebased onto a newer main. `git diff 85e5b10 8d2acb3` changes only `tasks/explain-ui.md`,
so the production code measured here is the fixer's final code. Focus of this round: the fixer
commit's production changes in `explain.model.ts`, `explain-raw.ts`, `collection-view.ts`,
`aggregation-view.ts` and `aggregation-view.html`. Uncommitted inputs: the two test files listed
below. `reviews/explain-ui/review.md` was also modified in the working tree, by the code-reviewer
and not by this helper.

Requirements:
- `tasks/explain-ui.md` acceptance criteria: (1) e2e demo step 9; (2) a component test renders a captured 8.x explain fixture
- `SPEC.md` (Explain plan for find and aggregate: stage tree, keys/docs examined, time, index used; raw output in the document viewer; demo step 9)
- `docs/ARCHITECTURE.md` "Explain plan viewer"
- `reviews/explain-ui/fixes.md` (fixed findings CR-2, CR-3/A3, TW-1, A2) and `reviews/explain-ui/review.md`
- Parent worker's round-2 instructions

## Test files changed

- `packages/renderer/src/app/explain/explain.model.spec.ts` (3 tests added to `summarizeExplain (edge cases)`)
- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts` (1 test added to `Explain (explain-ui)`)

No existing test was changed, weakened, skipped or removed.

## Tests added or updated

Count: 4 added in round 2, 0 updated:
- `slot-based ixscan reads are keys examined; zero reads stay 0, not missing`: covers the plain SBE `ixscan` stage name. The fixer's tests and the captured fixtures only use `ixseek`/`ixscan_generic`/`scan`/`seek`. It also checks that `numReads: 0` gives 0, not undefined.
- `slot-based: stages without numReads, or that are not scans, add no keys/docs examined`: a `filter` stage's `numReads` is not counted, and a `scan` without `numReads` leaves the figure missing.
- `slot-based: a stage without planNodeId or name is passed through to the scans below`: covers the new false branches at `explain.model.ts:151` and `:160`.
- `pointing the tab at another collection clears a refused Explain message` (aggregation view): `closeExplain()` from the target effect also clears `explainError`. The fixer only tested that it closes the panel.

Review of the fixer's own tests (8 added, 2 assertions retargeted from `agg-run-error` to `agg-explain-error`, each with an added "no run error" check): each fix has a direct, behaviour-level test. CR-2 is covered on the captured `agg-group-8.2.json` fixture (model and component, including flow bar widths) and on a synthetic plan. CR-3 has tests for the collection view, the aggregation view and full-text mode. TW-1 renders `'{ not json'` with no throw. A2 is tested for both a target change and the same target. The retargeted assertions are not weaker: the message moved to its own element by design (fixes.md), and the tests now also check that no run error appears.

## Requirement coverage

Focused command (F): `cd packages/renderer && npx ng test --include 'src/app/explain/**/*.spec.ts' --include 'src/app/collection/**/*.spec.ts' --include 'src/app/aggregation/**/*.spec.ts'` -> 8 files, 306 tests passed. That is the final run, the coverage run below. The first run before the last test was added had 305 tests passed.

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: e2e demo step 9 (COLLSCAN before the index, IXSCAN after) | `test/e2e/explain.e2e.ts` | not run by the test-writer (needs the e2e stack with MongoDB containers) | Not run: the parent reports `npx playwright test test/e2e/explain.e2e.ts test/e2e/aggregation.e2e.ts test/e2e/collection.e2e.ts` against the mongo8 fixture -> 3 passed on the final code; this report is not evidence for it |
| AC2: component test renders a captured 8.x explain fixture | `ExplainPlan with captured MongoDB 8.2 explain output` (incl. fixer's COLLSCAN "2,000 docs" row and 100 %/75 % flow bars), `summarizeExplain (captured MongoDB 8.2 output)` | F | Pass |
| CR-2: slot-based plans show keys/docs examined per stage (SBE `numReads` per `planNodeId`) | fixer: `slot-based keys/docs examined: the reads of the index and fetch stages per planNodeId`, `slot-based fetch without a plan-stage number takes the seek reads`, fixture assertions; round 2: `slot-based ixscan reads are keys examined; zero reads stay 0, not missing`, `slot-based: stages without numReads, or that are not scans, add no keys/docs examined`, `slot-based: a stage without planNodeId or name is passed through to the scans below` | F | Pass |
| CR-3/A3 (collection): an invalid query closes the earlier plan, sends nothing | `an invalid query closes the plan of an earlier query`, `an invalid query shows the field errors and sends nothing` | F | Pass |
| CR-3/A3 (builder): a refused Explain closes the plan, keeps the run result, shows `agg-explain-error`, not a run error; the message clears on the next Explain | `a refused Explain closes the earlier plan and keeps the shown run result`, `an enabled stage with an error sends nothing and names the stage`, `an invalid operator is refused the same way`, `in full-text mode, text that does not parse closes the earlier plan` | F | Pass |
| A2: the builder's panel closes on a target change, and the refusal message clears too | `pointing the tab at another collection closes the panel`, `the same collection given again keeps the panel`, round 2: `pointing the tab at another collection clears a refused Explain message` | F | Pass |
| TW-1: `ExplainRaw` shows unreadable output as text, without throwing | `output that is not EJSON shows a message and the text, without throwing` | F | Pass |
| Round-1 behaviour (query-bar/builder Explain requests, `$out`/`$merge` planned only, ordering/abort, loading/retry, verdicts, parser edge cases) | round-1 tests, unchanged (see the requirement list in round 1, all still in the suites) | F | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include 'src/app/explain/**/*.spec.ts' --include 'src/app/collection/**/*.spec.ts' --include 'src/app/aggregation/**/*.spec.ts'`

Result:

Pass (8 files, 305 tests; the same selection with coverage after the last added test: 306 passed)

## Full test execution

Command:

`npm run check` (repository root), then its parts separately

Result:

Fail, for a reason outside this task (environment). `npm run lint` (eslint --max-warnings 0, prettier --check) passed. `npm run typecheck` failed in `packages/backend`: `src/shell/runtime.ts(5..8): TS2307 Cannot find module '@mongosh/browser-runtime-core/...' / '@mongosh/service-provider-node-driver' / '@mongosh/shell-api' / '@mongosh/shell-evaluator'`. These packages are declared in `packages/backend/package.json` (added by task shell-backend, 2f0b3d7, now on main), but `node_modules/@mongosh` does not exist in this clone. The rebase brought the dependency in, and `npm install` has not been run since. This helper may not install dependencies. The other parts, run separately, passed:
- `cd packages/renderer && npm run typecheck` (ngc + tsc spec): Pass
- `cd packages/renderer && npm test` (renderer `ng test`): Pass, 84 files / 2536 tests
- `npx vitest run` (repository root, all workspace Vitest projects): Pass, 69 files / 3866 tests

Follow-up for the parent: run `npm install` (or `npm ci`) and rerun `npm run check` / `.taskcheck` before `done`.

## .taskcheck

Result:

Fail (not run separately). `.taskcheck` runs `npm run check`, and that failed at the backend typecheck for the uninstalled `@mongosh/*` dependencies described above. This is not caused by this task's code. It must pass after `npm install` before `done`.

## Bugs found

No production defect was found in the fixer's changes or in the rest of the task scope. No failing test is kept.

All round-1 observations are resolved: TW-1 is fixed (ExplainRaw no longer throws), and A2 and A3 were fixed with CR-3. A1 (the query-bar Explain explains the query as typed, without the paging sort and limit) is now recorded as an assumption in `tasks/explain-ui.md`, so the parent has handled it.

## Coverage

Status: verified (fresh run on the final code, exit 0, all 306 tests passed).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: whole task diff 230/230 executable added/modified lines hit (100%); fixer commit alone 36/36 (100%). Method: added line numbers from `git diff -U0 6d14cda..HEAD` (task) and `git diff -U0 85e5b10~1 85e5b10` (fixer; same code as 8d2acb3) per file, intersected with the `DA:` lines of this run's `lcov.info`. Duplicate V8 `DA` entries for a line were merged by the maximum hit count. Changed branches are not measured separately.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `explain-ui`; base `6d14cda876ae5d665a9861e7e0ead68b908762d9` (`git merge-base HEAD origin/main` after the rebase); HEAD `8d2acb332a69eb6ccf8e65fb9e061f71dcfd5fc4`. Task commits and file list come from the parent, `git log`, and the round-1 scope. `git diff 85e5b10 8d2acb3` touches only `tasks/explain-ui.md`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 8d2acb3, plus the uncommitted test files `explain.model.spec.ts` (sha256 2c0bc9f83991804bc013c050500efb52f96e754e00fa2a52c16fbb065551d2ee) and `aggregation-view.spec.ts` (sha256 5e31c4e97f0f5fabae4bad8075017a25b7760e94c0810b31217d07006dfbade1). No uncommitted production changes.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/renderer/src/app/explain/{explain.model,explain-plan,explain-panel,explain-raw,index}.ts`, `packages/renderer/src/app/collection/collection-view.ts`, `packages/renderer/src/app/aggregation/aggregation-view.ts`. Excluded: `explain/fixtures/capture.mjs` (a developer script that captures fixtures from a live server, not app code), `explain/fixtures/*.json` (data), `*.html`/`*.css` including the fixer's `aggregation-view.html` change (templates and styles; V8 does not instrument them, and the component tests above assert `agg-explain-error` and the panel), `*.spec.ts` and `test/e2e/explain.e2e.ts` (tests), `docs/ARCHITECTURE.md` (docs). No renames or deletions. All 7 included files are in the report; none is unmeasured.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` (v8 provider) via the Angular builder; working directory `packages/renderer`; `npx ng test --coverage --include 'src/app/explain/**/*.spec.ts' --include 'src/app/collection/**/*.spec.ts' --include 'src/app/aggregation/**/*.spec.ts' --coverage-include='src/app/explain/explain.model.ts' --coverage-include='src/app/explain/explain-plan.ts' --coverage-include='src/app/explain/explain-panel.ts' --coverage-include='src/app/explain/explain-raw.ts' --coverage-include='src/app/explain/index.ts' --coverage-include='src/app/collection/collection-view.ts' --coverage-include='src/app/aggregation/aggregation-view.ts'` (8 spec files, 306 tests).
- Run start/completion time and exit status: started 2026-11-17 04:26:30 +0100, reports written 04:26:48 +0100; 306/306 passed, summary printed (exit 0).
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 5caf18832bf849201b3b4fbab08f0864afe40470710475ca362938c621b1a6ac), `packages/renderer/coverage/renderer/lcov.info` (sha256 a48db34889afa83fec7325406f534b4325feef159f4ccf16d23069d758eef70c), `packages/renderer/coverage/renderer/lcov-report/`.
- Evidence outputs are fresh and inputs stayed unchanged: the coverage directory was regenerated by this run (directory and files timestamped 04:26:30-04:26:48) and contains exactly the 7 included files. HEAD and the test file hashes were the same before and after the run. An earlier coverage run at 04:25:40, before the last model test was added, is superseded.
- Final run after latest test additions and production fixes: yes. It ran on the fixer's final code with all round-2 tests.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/explain/explain.model.ts` | 155/156 (99.36%) | 158/161 (98.14%) | 36/36 (100%) | 127/127 (100%) |
| `packages/renderer/src/app/explain/explain-plan.ts` | 29/30 (96.67%) | 33/36 (91.67%) | 8/8 (100%) | 24/24 (100%) |
| `packages/renderer/src/app/explain/explain-panel.ts` | 57/57 (100%) | 24/25 (96.00%) | 9/9 (100%) | 37/37 (100%) |
| `packages/renderer/src/app/explain/explain-raw.ts` | 23/23 (100%) | 13/14 (92.86%) | 3/3 (100%) | 15/15 (100%) |
| `packages/renderer/src/app/explain/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/renderer/src/app/collection/collection-view.ts` | 218/248 (87.90%) | 116/153 (75.82%) | 65/71 (91.55%) | 189/206 (91.75%) |
| `packages/renderer/src/app/aggregation/aggregation-view.ts` | 316/325 (97.23%) | 144/159 (90.57%) | 77/77 (100%) | 271/272 (99.63%) |
| Aggregate (summed counters, 7 files; no file unmeasured; templates/fixtures/capture script excluded as listed) | 798/839 (95.11%) | 488/548 (89.05%) | 198/204 (97.06%) | 663/681 (97.36%) |

`collection-view.ts` and `aggregation-view.ts` are pre-existing files. Most of their gaps are in code this task did not change, and all of their changed lines were hit.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `explain/explain.model.ts`: branches at 151 and 160 (new in the fixer's `collectSbe`) | An SBE stage without `planNodeId` or a string `stage` name must still pass its children through | Covered in round 2: `slot-based: a stage without planNodeId or name is passed through to the scans below` |
| `explain/explain.model.ts`: branches at 249 (`winning ?? {}` with neither plan), 276 (`stage[op] ?? null`), 316 (`maxOf` with `b` undefined) | Defensive fallbacks; the guards above them rule these inputs out (same as round 1, lines shifted) | Justified gap |
| `explain/explain-raw.ts`: branch at 78 (`String(e)` for a non-`Error` throw) | Defensive; `parseEJson`/`toExplorerValue` throw `Error`s only | Justified gap; the `Error` path is tested |
| `explain/explain-plan.ts`: branches at 37, 44, 62 | Defensive (non-Error throw; `maxFlow` when not parsed; `n > 0` with n = 0) | Justified gap (unchanged since round 1) |
| `explain/explain-panel.ts`: branch at 143 (`signal.aborted` true after a successful answer) | A microtask race that a test cannot order without reaching into internals | Justified gap; the visible late-answer cases are tested |
| `collection/collection-view.ts`: 30 branches and 17 lines (e.g. 296-301, 432-443, 461-462) | Pre-existing behaviour not changed by this task | Out of task scope; all changed lines hit (incl. the fixer's line 386) |
| `aggregation/aggregation-view.ts`: 15 branches, 1 line | Pre-existing behaviour | Out of task scope; all changed lines hit (incl. the fixer's target effect, `explainError`, `closeExplain`) |

## Unable to test

- AC1 (e2e demo step 9) was not run by the test-writer, because it needs the e2e stack with MongoDB containers. The parent reports that it ran on the final code against the mongo8 fixture with 3 passed. The parent must record that run as evidence.
- `npm run check` / `.taskcheck` could not pass in this clone: the `@mongosh/*` dependencies from main are not installed, and this helper may not install them. Follow-up: the parent runs `npm install` and reruns the check.
- `fixtures/capture.mjs` (a developer script that captures fixtures from a live `mongo:8.2`) is not tested.

## Summary

Tests and task-scoped coverage are sufficient; no production defects were found. The fixer's tests cover each fixed behaviour. Round 2 added 4 tests: the SBE `ixscan` name and zero reads, stages that are not scans or have no reads, a stage without an id or name, and the refusal message clearing on a target change. All focused, renderer and workspace tests pass. The full `npm run check` / `.taskcheck` currently fails at the backend typecheck only because the `@mongosh/*` dependencies brought in from main are not installed. The parent must run `npm install` and get `.taskcheck` to pass before `done`.
