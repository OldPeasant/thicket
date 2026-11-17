# Test Report

Date: 2026-11-17

Task: explain-ui - M3: Explain plan viewer (round 3, final revision)

Scope: task commits `ef8927e50e0878c20c6d7b70533e22449855106c..7a06a568d0561f58932958c77142974b1e143c46`
on `main`. Base = `git merge-base HEAD origin/main` = `ef8927e` (= `origin/main`). Task commits
(`git log --oneline ef8927e..HEAD`, 8 commits): c202c00 (implementation: explain plan viewer, Explain on
the query bar and the pipeline builder), e6c39e1 (model/component tests), 2fbf41d (e2e), 9ac2c96
(architecture notes), a36416a (round-1 tests and review reports), 8ec6154 (fixer: CR-2, CR-3, TW-1, A2),
4049309 (round-2 tests and review reports), 7a06a56 (CR-4: docs and e2e comment, round-3 review).

Changes since round 2: commit 7a06a56 changes only `docs/ARCHITECTURE.md` (wording of the explain
section, CR-4), one comment line in `test/e2e/explain.e2e.ts`, and `reviews/`. `git diff 4049309 7a06a56 --
packages test docs` confirms that no production code changed. The branch was also rebased onto a newer
main. That rebase brought in task index-ui's `openIndexes()`/"Indexes…" button in `collection-view.ts`/
`.html` and one new test in `collection-view.spec.ts`. These are in the base `ef8927e` (commit 2169939),
not task-owned, and not in the task diff (`git diff ef8927e HEAD -- collection-view.ts` is still the task's
own 22 added lines).

Uncommitted inputs: none for source or tests. The only working-tree change is `reviews/explain-ui/review.md`,
from the code-reviewer.

Requirements:
- `tasks/explain-ui.md` acceptance criteria: (1) e2e demo step 9; (2) a component test renders a captured 8.x explain fixture
- `SPEC.md` (Explain plan for find and aggregate: stage tree, keys/docs examined, time, index used; raw output in the document viewer; demo step 9)
- `docs/ARCHITECTURE.md` "Explain plan viewer" (as corrected by CR-4)
- `reviews/explain-ui/fixes.md` and `reviews/explain-ui/review.md`
- Parent worker's round-3 instructions

## Test files changed

None in round 3. Test files belonging to the task, all committed:
- `packages/renderer/src/app/explain/explain.model.spec.ts`
- `packages/renderer/src/app/explain/explain-plan.spec.ts`
- `packages/renderer/src/app/explain/explain-panel.spec.ts`
- `packages/renderer/src/app/collection/collection-view.spec.ts`
- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`
- `test/e2e/explain.e2e.ts` (round 3: comment-only change by the fixer, assertions unchanged)

No existing test was changed, weakened, skipped or removed.

## Tests added or updated

Count: 0 in round 3.

No new tests are needed. Round 3 changed only documentation and one e2e comment, so there is no new
behaviour to test. The CR-4 wording in `docs/ARCHITECTURE.md` matches the code that is already tested:
returned/time come from the outermost SBE stage per `planNodeId`, and keys/docs examined come from the
summed `numReads` of `ixseek`/`ixscan`/`ixscan_generic` and `scan`/`seek` stages (the CR-2 tests from the
fixer and round 2). The edited e2e comment now correctly says that the index is created with `idx.create`
over the bridge, which is what the test does.

## Requirement coverage

Focused command (F): `cd packages/renderer && npx ng test --coverage --include 'src/app/explain/**/*.spec.ts' --include 'src/app/collection/**/*.spec.ts' --include 'src/app/aggregation/**/*.spec.ts' --coverage-include=<7 scoped files, see Coverage>` -> 8 files, 307 tests passed (306 from round 2, plus 1 index-ui test from main in `collection-view.spec.ts`).

E2E command (E): `npm run build -w packages/renderer && npm run build -w apps/desktop && npx playwright test test/e2e/explain.e2e.ts test/e2e/collection.e2e.ts test/e2e/aggregation.e2e.ts` (repository root, default `mongo8` fixture = mongo 8.2 container via podman) -> 3 passed (18.0s) on HEAD 7a06a56.

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: e2e demo step 9 (COLLSCAN before the index, IXSCAN after) | `test/e2e/explain.e2e.ts` › `demo step 9: Explain shows COLLSCAN before the index and IXSCAN after it` | E | Pass (run by this helper on 7a06a56) |
| AC1 regression: collection and aggregation flows that share the changed views | `collection.e2e.ts` › `filter and sort 10 000 documents...`, `aggregation.e2e.ts` › `demo step 8: ...` | E | Pass |
| AC2: component test renders a captured 8.x explain fixture | `ExplainPlan with captured MongoDB 8.2 explain output`, `summarizeExplain (captured MongoDB 8.2 output)` | F | Pass |
| CR-2: slot-based plans show keys/docs examined per stage | fixer and round-2 SBE tests in `explain.model.spec.ts` and `explain-plan.spec.ts` | F | Pass |
| CR-3/A3: an invalid query or refused Explain closes the earlier plan and sends nothing (collection, builder, full-text) | `an invalid query closes the plan of an earlier query`, `a refused Explain closes the earlier plan and keeps the shown run result`, `in full-text mode, text that does not parse closes the earlier plan`, and related tests | F | Pass |
| A2: the builder's panel and refusal message clear on a target change | `pointing the tab at another collection closes the panel`, `... clears a refused Explain message`, `the same collection given again keeps the panel` | F | Pass |
| TW-1: `ExplainRaw` shows unreadable output as text, without throwing | `output that is not EJSON shows a message and the text, without throwing` | F | Pass |
| CR-4: docs describe the implemented SBE numbers and the e2e index creation | n/a (documentation) | manual comparison with `explain.model.ts` and `explain.e2e.ts` | Not testable (docs); the wording matches the tested behaviour |
| Round-1 behaviour (requests, `$out`/`$merge` planned only, ordering/abort, loading/retry, verdicts, parser edge cases) | round-1 tests, unchanged | F | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include 'src/app/explain/**/*.spec.ts'` (3 files, 56 passed), then the coverage run F above (8 files, 307 passed).

Result:

Pass

## Full test execution

Command:

`npm run check` (repository root: `npm run lint && npm run typecheck && npm run test`)

Result:

Pass. Lint and typecheck (backend and renderer) passed. Root Vitest: 73 files / 4038 tests passed. Renderer `ng test`: 87 files / 2742 tests passed. The round-2 failure (uninstalled `@mongosh/*` dependencies) no longer occurs: `node_modules/@mongosh` is now present.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` when `package.json` exists, and that passed as described above (run 2026-11-17 ~04:38-04:40 +0100).

## Bugs found

None. No production defect was found, and no failing test is kept.

## Coverage

Status: verified (fresh run on HEAD 7a06a56, all 307 tests passed, summary printed).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: 230/230 executable added/modified lines of the task diff were hit (100%); the fixer
commit alone (`git diff a36416a 8ec6154`) 36/36 (100%). Method: added line numbers from `git diff -U0
ef8927e HEAD -- <file>` (task) and `git diff -U0 a36416a 8ec6154 -- <file>` (fixer), intersected with the `DA:` lines
of this run's `lcov.info` (duplicate V8 `DA` entries merged by maximum hit count). Changed branches are not
measured separately. Per file (executable hit/total): explain.model 127/127, explain-plan 24/24,
explain-panel 37/37, explain-raw 15/15, index 0/0, collection-view 10/10, aggregation-view 17/17.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `explain-ui`; base `ef8927e50e0878c20c6d7b70533e22449855106c` (`git merge-base HEAD origin/main`); HEAD `7a06a568d0561f58932958c77142974b1e143c46`. Task commits come from the parent and `git log ef8927e..HEAD`. The file scope is `git diff --stat ef8927e..HEAD`, checked against the round-2 scope.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 7a06a56 with a clean source/test tree (`git status --short` shows only `reviews/explain-ui/review.md`, which is not a test input).
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/renderer/src/app/explain/{explain.model,explain-plan,explain-panel,explain-raw,index}.ts`, `packages/renderer/src/app/collection/collection-view.ts`, `packages/renderer/src/app/aggregation/aggregation-view.ts`. Excluded: `explain/fixtures/capture.mjs` (developer script that captures fixtures from a live server), `explain/fixtures/*.json` (data), `*.html`/`*.css` (templates/styles; V8 does not instrument them, and component tests and e2e cover them), `*.spec.ts` and `test/e2e/explain.e2e.ts` (tests), `docs/ARCHITECTURE.md` (docs). No renames or deletions. All 7 included files are in the report; none is unmeasured.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with the v8 coverage provider via the Angular builder; working directory `packages/renderer`; `npx ng test --coverage --include 'src/app/explain/**/*.spec.ts' --include 'src/app/collection/**/*.spec.ts' --include 'src/app/aggregation/**/*.spec.ts' --coverage-include='src/app/explain/explain.model.ts' --coverage-include='src/app/explain/explain-plan.ts' --coverage-include='src/app/explain/explain-panel.ts' --coverage-include='src/app/explain/explain-raw.ts' --coverage-include='src/app/explain/index.ts' --coverage-include='src/app/collection/collection-view.ts' --coverage-include='src/app/aggregation/aggregation-view.ts'` (8 spec files, 307 tests).
- Run start/completion time and exit status: build 2026-11-17 04:37:31 +0100, tests started 04:37:31, reports written 04:37:46 +0100; 307/307 passed (exit 0).
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 3ce83c7eecd2921f272ebf7d60441ce2243c759c0399c5997402dafffa4530da), `packages/renderer/coverage/renderer/lcov.info` (sha256 8cd362f0109fc40721565a249725f8f35485b11c51992b4cb816414356d121eb), `packages/renderer/coverage/renderer/lcov-report/`.
- Evidence outputs are fresh and inputs stayed unchanged: this run regenerated the coverage directory (files timestamped 04:37:46 +0100, which supersedes the round-2 reports from 04:26), and the directory contains exactly the 7 included files. HEAD was 7a06a56 before and after, and the source/test tree was clean.
- Final run after latest test additions and production fixes: yes. No production or test code changed after this run.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/explain/explain.model.ts` | 155/156 (99.36%) | 158/161 (98.14%) | 36/36 (100%) | 127/127 (100%) |
| `packages/renderer/src/app/explain/explain-plan.ts` | 29/30 (96.67%) | 33/36 (91.67%) | 8/8 (100%) | 24/24 (100%) |
| `packages/renderer/src/app/explain/explain-panel.ts` | 57/57 (100%) | 24/25 (96.00%) | 9/9 (100%) | 37/37 (100%) |
| `packages/renderer/src/app/explain/explain-raw.ts` | 23/23 (100%) | 13/14 (92.86%) | 3/3 (100%) | 15/15 (100%) |
| `packages/renderer/src/app/explain/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/renderer/src/app/collection/collection-view.ts` | 221/251 (88.05%) | 116/153 (75.82%) | 66/72 (91.67%) | 192/209 (91.87%) |
| `packages/renderer/src/app/aggregation/aggregation-view.ts` | 316/325 (97.23%) | 144/159 (90.57%) | 77/77 (100%) | 271/272 (99.63%) |
| Aggregate (summed counters, 7 files; no file unmeasured; templates/fixtures/capture script excluded as listed) | 801/842 (95.13%) | 488/548 (89.05%) | 199/205 (97.07%) | 666/684 (97.36%) |

Compared with round 2, only `collection-view.ts` changed (+3 statements, +1 function, +3 lines, all hit).
That comes from index-ui's `openIndexes()` from main, which is not task code. All other per-file counters
are identical to round 2.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `explain/explain.model.ts`: branches at 249 (`winning ?? {}` with neither plan), 276 (`stage[op] ?? null`), 316 (`maxOf` with `b` undefined) | Defensive fallbacks; the guards above them rule these inputs out | Justified gap (unchanged since round 2) |
| `explain/explain-raw.ts`: branch at 78 (`String(e)` for a non-`Error` throw) | Defensive; the parsers throw only `Error`s | Justified gap; the `Error` path is tested |
| `explain/explain-plan.ts`: branches at 37, 44, 62 | Defensive (non-Error throw; `maxFlow` when not parsed; `n > 0` with n = 0) | Justified gap (unchanged) |
| `explain/explain-panel.ts`: branch at 143 (`signal.aborted` true after a successful answer) | A microtask race that a test cannot order without reaching into internals | Justified gap; the visible late-answer cases are tested |
| `collection/collection-view.ts`: 37 branches, 17 lines | Pre-existing behaviour not changed by this task | Out of task scope; all 10 task-changed executable lines hit |
| `aggregation/aggregation-view.ts`: 15 branches, 1 line | Pre-existing behaviour | Out of task scope; all 17 task-changed executable lines hit |

## Unable to test

- `fixtures/capture.mjs` (a developer script that captures fixtures from a live `mongo:8.2`) is not tested. It is not app code; no follow-up needed.
- CR-4 is a documentation change and cannot be tested; it was checked by reading it against the code.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. Round 3 needed no new tests:
only documentation and one e2e comment changed. On the final HEAD 7a06a56: the focused renderer selection
passed (307 tests), task-scoped coverage was measured fresh (all 230 changed executable lines hit; whole-file
aggregate 97.36 % lines / 89.05 % branches), `npm run check` (= `.taskcheck`) passed, and the explain,
collection and aggregation e2e specs passed against the mongo 8.2 fixture (3 passed).
