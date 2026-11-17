# Test Report

Date: 2026-11-17

Task: explain-ui - M3: Explain plan viewer

Scope: task commits `f73fabc20516fdd249b095471a17ecc764c12b6c..0b46eaca42794ab432df20598cbeecd7d66e6d67`
on `main` (5fad4b8 implementation, a2fb559 model/component tests, 65e75e1 e2e, 0b46eac
architecture notes only). Base and task commits were given by the parent worker and match
`git log f73fabc..HEAD`. Uncommitted inputs: only the test files listed below (no production
changes in the working tree).

Requirements:
- `tasks/explain-ui.md` acceptance criteria (1) e2e demo step 9, (2) component test renders a captured 8.x explain fixture
- `SPEC.md` line 158 (Explain plan for find and aggregate: stage tree, keys/docs examined, time, index used; raw output in the document viewer) and demo step 9 (line 42)
- `docs/ARCHITECTURE.md` "Explain plan viewer" (query-explain / agg-explain, `$out`/`$merge` only with `queryPlanner`, a new Explain aborts the previous request)
- Parent worker's instructions (collection-view and aggregation-view Explain behaviour, model edge cases)

## Test files changed

- `packages/renderer/src/app/collection/collection-view.spec.ts` (new `describe('Explain (explain-ui)')`)
- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts` (new `describe('Explain (explain-ui)')`)
- `packages/renderer/src/app/explain/explain-panel.spec.ts` (new file)
- `packages/renderer/src/app/explain/explain-plan.spec.ts` (6 tests added to the `ExplainPlan` describe)
- `packages/renderer/src/app/explain/explain.model.spec.ts` (new `describe('summarizeExplain (edge cases)')`)

No existing test was changed, weakened, skipped or removed.

## Tests added or updated

Count: 50 added (collection-view 8, aggregation-view 11, explain-panel 8, explain-plan 6, explain.model 17); 0 updated.

## Requirement coverage

Focused command (F): `cd packages/renderer && npx ng test --include 'src/app/explain/**/*.spec.ts' --include 'src/app/collection/collection-view.spec.ts' --include 'src/app/aggregation/aggregation-view.spec.ts'` -> 5 files, 201 tests passed.

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: e2e demo step 9 (COLLSCAN before the index, IXSCAN after) | `test/e2e/explain.e2e.ts` (written by the parent) | not run by the test-writer (needs the e2e stack with MongoDB containers) | Not run: the parent reports it ran and passed; this report does not count as evidence for it |
| AC2: component test renders a captured 8.x explain fixture | existing `ExplainPlan with captured MongoDB 8.2 explain output` tests, plus added `a new explain output replaces the shown plan and keeps the chosen view` | F | Pass |
| Query bar Explain: sends the parsed query bar to `agg.explain` as a find on the tab collection, shows the plan, does not run the query | `explains the parsed query bar as a find on the tab collection and shows the plan`, `an empty query bar explains the empty filter without optional fields` | F | Pass |
| Query bar Explain: an invalid query shows the field errors and sends nothing | `an invalid query shows the field errors and sends nothing` | F | Pass |
| Query bar Explain: each click asks again with the current query; a failure shows in the panel | `each Explain asks again, with the query bar at that moment`, `shows a failed explain in the panel, not as a query error` | F | Pass |
| Query bar panel closes on Close and on target change | `Close closes the panel`, `pointing the tab at another collection closes the panel`, `the same collection opened again keeps the panel` | F | Pass |
| Pipeline builder Explain: enabled stages, `executionStats`, plan shown, nothing run | `explains the enabled stages with execution stats and shows the plan` | F | Pass |
| `$out`/`$merge` pipelines only with `queryPlanner` (and without the write confirmation) | `a pipeline with $out is only planned (verbosity queryPlanner), without asking`, `a pipeline with $merge is only planned too`, `a disabled $out stage does not limit the verbosity` | F | Pass |
| Pipeline builder Explain: an invalid stage or operator sends nothing and names the stage | `an enabled stage with an error sends nothing and names the stage`, `an invalid operator is refused the same way` | F | Pass |
| Pipeline builder Explain in full-text mode | `in full-text mode explains the text as typed`, `in full-text mode refuses text that does not parse and sends nothing` | F | Pass |
| Pipeline builder: asks again per click, Close, failure in the panel, read-only profile | `each Explain asks again with the pipeline at that moment; Close closes the panel`, `shows a failed explain in the panel, not as a run error`, `explains on a read-only profile (it does not write)` | F | Pass |
| A new Explain aborts the previous request (ordering) | explain-panel.spec: `new params cancel the running request; its late answer does not replace the newer plan`, `an older request that fails after the newer one answered shows no error`, `a newer request still running keeps the loading state when the older one answers`, `params set back to null cancel the running request and show nothing`, `closing the panel (destroying it) cancels the running request` | F | Pass |
| Loading state ends after failure and can retry | `shows a loading state until the answer, then the plan`, `a failure ends the loading state and Explain again can retry`, `shows nothing and asks nothing for null params` | F | Pass |
| Stage tree, keys/docs examined, time, index used (verdict variants, flow bars) | explain-plan.spec: `several indexes and a collection scan: ...`, `neither an index nor a collection scan: ...`, `flow bars: ...`, `planned only: no flow bars (nothing to compare)` | F | Pass |
| Parser handles 7/8 shapes (classic, SBE, aggregate stages, sharded) and refuses non-explain output | explain.model.spec `summarizeExplain (edge cases)` (17 tests: toPlain wrappers, non-documents, empty stages/shards, stats without winning plan, OR/inputStages, joins, express/_id stages, details filtering, nameless stage, SBE without stats, outermost SBE stage, pipeline stage details, `$documents` pipeline, `$cursor` without a plan, partly executed sharded aggregate, sharded SBE, SHARD_MERGE shard without plan) | F | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include 'src/app/explain/**/*.spec.ts' --include 'src/app/collection/collection-view.spec.ts' --include 'src/app/aggregation/aggregation-view.spec.ts'`

Result:

Pass (5 files, 201 tests)

## Full test execution

Command:

`npm run check` (repository root: eslint + prettier --check, tsc / ngc typecheck of all workspaces, all Vitest projects, renderer `ng test`)

Result:

Pass on the final run: lint and typecheck clean; workspaces 64 files / 3545 tests passed; renderer 83 files / 2505 tests passed.
One earlier run of the same command failed once in `packages/backend/src/server/backend.spec.ts` ("Cannot parse privateKey: Malformed OpenSSH private key", SSH key generated at test time); it passed on the next two runs. Unrelated to this task (no backend files changed); intermittent, worth a separate look.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; run via `sh .taskcheck`, output 64 files / 3545 tests and 83 files / 2505 tests passed; the following direct `npm run check` run also passed).

## Bugs found

No production defect that violates a task requirement was found.

Observations for the parent (not blocking, no failing test kept):

### ExplainRaw throws on text that is not valid EJSON

Finding ID:

`TW-1`

Test:

None kept (a probe test `fixture.componentRef.setInput('explain', '{')` on `ExplainPlan` raised an uncaught `BsonModelError` from `ExplainRaw`; replaced because the input is not reachable through the backend contract).

Production source:

`packages/renderer/src/app/explain/explain-raw.ts:51` (`computed(() => toExplorerValue(parseEJson(this.explain())))`), reached from the error branch of `packages/renderer/src/app/explain/explain-plan.html` (line 1-6) which always renders `<app-explain-raw>`.

Requirement:

Not a stated requirement. The error branch says "The raw output is below", which cannot hold for unparseable text.

Expected behavior:

The error message shows; the raw view is left out or shows the text without throwing.

Actual behavior:

The `ExplainRaw` template throws during change detection (uncaught error). `agg.explain` results are produced by the backend's EJSON serializer, and the contract only checks the first character (`{`), so this happens only on a backend bug.

Severity:

Low

Fix required:

No for this task (optional hardening); the parent decides.

Requirement ambiguities for the parent:

- A1: The query bar Explain explains the query as typed (`filter`, `projection`, `sort`, `collation`, `limit`). Run additionally uses the implied paging sort `{_id: 1}` and the page size, so the plan shown can differ from the plan of the query Run executes (for example an `_id` index scan with a sort versus an `IXSCAN` on the filter index). SPEC demo step 9 says "run the earlier query with Explain"; the current choice is reasonable but not recorded as an assumption.
- A2: In the pipeline builder the explain panel stays open, still explaining the old collection, when the tab is pointed at another collection. In the collection view it closes. This matches how the builder keeps a shown result pinned to its collection, but the two views differ.
- A3: A pipeline Explain refused for a stage error uses `failRun`, which also clears an earlier run result, and leaves an earlier explain panel (for the previous pipeline) open. Run behaves the same way.

## Coverage

Status: verified (fresh run, exit 0, tests all passed).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: 213/213 executable added lines hit (100%). Method: added line numbers from `git diff -U0 f73fabc..HEAD` per file, intersected with `DA:` lines from the run's `lcov.info` (V8 duplicate `DA` entries for a line merged by the maximum hit count). Changed branches are not measured separately.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `explain-ui`; base `f73fabc20516fdd249b095471a17ecc764c12b6c`; HEAD `0b46eaca42794ab432df20598cbeecd7d66e6d67`; commits 5fad4b8, a2fb559, 65e75e1, 0b46eac (from the parent and `git log f73fabc..HEAD`).
- Source/test snapshot identifier (including uncommitted inputs): HEAD 0b46eac plus uncommitted test files with sha256: `explain.model.spec.ts` 38807601…a7a7, `explain-panel.spec.ts` 0e8dd127…4a54d, `explain-plan.spec.ts` 612f1ece…6a36, `collection-view.spec.ts` 986023bf…caf1f, `aggregation-view.spec.ts` 21d046c0…f902. Same hashes before and after the coverage run.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/renderer/src/app/explain/{explain.model,explain-plan,explain-panel,explain-raw,index}.ts`, `packages/renderer/src/app/collection/collection-view.ts`, `packages/renderer/src/app/aggregation/aggregation-view.ts`. Excluded: `explain/fixtures/capture.mjs` (developer script that captures fixtures from a live server, not part of the app), `explain/fixtures/*.json` (data), `*.html`/`*.css` (templates and styles, not instrumented by V8; template behaviour is covered by the component tests above), `test/e2e/explain.e2e.ts` and `*.spec.ts` (tests), `docs/ARCHITECTURE.md` (docs). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` ^5.1.0 via the Angular builder; working directory `packages/renderer`; `npx ng test --coverage --include 'src/app/explain/**/*.spec.ts' --include 'src/app/collection/**/*.spec.ts' --include 'src/app/aggregation/**/*.spec.ts' --coverage-include='src/app/explain/explain.model.ts' --coverage-include='src/app/explain/explain-plan.ts' --coverage-include='src/app/explain/explain-panel.ts' --coverage-include='src/app/explain/explain-raw.ts' --coverage-include='src/app/explain/index.ts' --coverage-include='src/app/collection/collection-view.ts' --coverage-include='src/app/aggregation/aggregation-view.ts'` (8 spec files, 294 tests).
- Run start/completion time and exit status: started 2026-11-17 04:12:45 +0100, report written 04:13 +0100; all 294 tests passed, summary printed (exit 0).
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 a267a97a8df4046a529c31aaab6ce2dde5cfb8844b4a1489875f7844fe3f3b4d), `packages/renderer/coverage/renderer/lcov.info` (sha256 57006e7dc6b9c8e2a2634af34cedacfd3cc775c4a6922cf7c2d21fab77f8a7dc), `packages/renderer/coverage/renderer/lcov-report/`.
- Evidence outputs are fresh and inputs stayed unchanged: report files timestamped 04:13 by this run and contain exactly the 7 included files; test file hashes and HEAD identical before and after.
- Final run after latest test additions and production fixes: yes (no production fixes were made; the run used the final tests).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/explain/explain.model.ts` | 143/144 (99.30%) | 144/147 (97.96%) | 35/35 (100%) | 117/117 (100%) |
| `packages/renderer/src/app/explain/explain-plan.ts` | 29/30 (96.67%) | 33/36 (91.67%) | 8/8 (100%) | 24/24 (100%) |
| `packages/renderer/src/app/explain/explain-panel.ts` | 57/57 (100%) | 24/25 (96.00%) | 9/9 (100%) | 37/37 (100%) |
| `packages/renderer/src/app/explain/explain-raw.ts` | 11/11 (100%) | 10/10 (100%) | 3/3 (100%) | 6/6 (100%) |
| `packages/renderer/src/app/explain/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/renderer/src/app/collection/collection-view.ts` | 217/247 (87.85%) | 116/153 (75.82%) | 65/71 (91.55%) | 188/205 (91.71%) |
| `packages/renderer/src/app/aggregation/aggregation-view.ts` | 306/315 (97.14%) | 144/159 (90.57%) | 74/74 (100%) | 261/262 (99.62%) |
| Aggregate (summed counters, 7 files; no file unmeasured) | 763/804 (94.90%) | 471/530 (88.87%) | 194/200 (97.00%) | 633/651 (97.24%) |

`collection-view.ts` and `aggregation-view.ts` are whole pre-existing files of which the task changed 9 and 8 executable lines; their gaps are in code outside this task.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `explain/explain.model.ts`: branches at 226 (`winning ?? {}` with neither plan), 253 (`stage[op] ?? null`), 293 (`maxOf` with `b` undefined) | Defensive fallbacks; the inputs cannot occur after the guards above them | Justified gap |
| `explain/explain-plan.ts`: branches at 37 (`String(e)` for a non-Error throw), 44 (`maxFlow` when not parsed), 62 (`n > 0 ? 1 : 0` with n = 0) | Defensive; `summarizeExplain` throws only `Error`s, the flow bar is not rendered when not parsed | Justified gap |
| `explain/explain-panel.ts`: branch at 143 (`signal.aborted` true after a successful answer) | A request aborted after its answer resolved but before the continuation: a microtask race that cannot be ordered from a test without reaching into internals | Justified gap; the visible late-answer cases are tested |
| `collection/collection-view.ts`: lines 296-301, 432-443, 461-462 and 30 branches | Pre-existing behaviour (not changed by this task) | Out of task scope; all 9 changed lines (329, 380-394) hit |
| `aggregation/aggregation-view.ts`: line 245 and 15 branches | Pre-existing behaviour | Out of task scope; all 8 changed lines (486-497) hit |

## Unable to test

- AC1 (e2e demo step 9) was not executed by the test-writer: it needs the e2e stack (Electron/browser and MongoDB containers). The parent reports `test/e2e/explain.e2e.ts` ran and passed; the parent must record that run as evidence. Follow-up: none if the parent's run is recorded.
- `fixtures/capture.mjs` (captures fixtures from a live `mongo:8.2`) is a developer script; not tested.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. 50 tests were added and all validation passed. One optional hardening item (TW-1) and three ambiguities (A1-A3) are left for the parent to decide.
