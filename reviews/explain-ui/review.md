# Code Review

Date: 2026-11-17

Task: explain-ui - M3: Explain plan viewer

Scope: code commits of the task, `git diff f73fabc..65e75e1` (3 commits). Later test-writer and
architecture-note commits and uncommitted working-tree changes are outside this scope.

Requirements:
- tasks/explain-ui.md (goal, 2 acceptance criteria, recorded assumption on idx.create in the e2e)
- SPEC.md M3 "Explain plan for find and aggregate", section 2 demo step 9, section 4 `agg.*`
- docs/ARCHITECTURE.md ("Explain plan viewer", explorer, e2e harness)
- docs/QUALITY.md, AGENTS.md "Quality sub-agent boundaries"
- packages/contract/src/agg.ts (`agg.explain` contract), packages/backend/src/agg/agg.ts (`explain`)

Git range:
- Branch: main
- HEAD: 65e75e1 (end of reviewed range)
- Base/start: f73fabc20516fdd249b095471a17ecc764c12b6c
- Commits reviewed: 3 (5fad4b8, a2fb559, 65e75e1)

Summary: 0 P0, 0 P1, 1 P2, 2 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Host-view Explain wiring has no unit tests (verbosity choice for $out/$merge, query-bar mapping, reset on target change)**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.ts:486`, `packages/renderer/src/app/collection/collection-view.ts:381`, `packages/renderer/src/app/collection/collection-view.ts:329`
    - Category: Tests
    - Problem: At 65e75e1 no spec in `aggregation/` or `collection/` mentions explain. Three behaviours are untested: `AggregationView.explain()` asks for `verbosity: 'queryPlanner'` when the pipeline has `$out`/`$merge`, and otherwise `executionStats`. It refuses an invalid pipeline or invalid text-mode input. `CollectionView.explain()` maps the parsed query bar (filter, projection, sort, collation, limit) to the `agg.explain` find target. The query-bar errors block the request. The panel closes when the collection target changes. The e2e covers only the happy path (find with filter+sort, aggregate without `$out`).
    - Why it matters: if the `$out`/`$merge` downgrade breaks, the server is never written to (the backend `buildExplained` refuses it), but the user then gets an INVALID_PARAMS error instead of a plan. Mapping mistakes (for example dropping collation or limit) would explain a different query than the one on the bar, and nothing would catch it.
    - Suggested fix: add component tests with `FakeThicketBridge`. Click `agg-explain` with a `$out` pipeline and assert `verbosity: 'queryPlanner'`. Without one, assert `executionStats`. Click `query-explain` with filter/sort/collation/limit and assert the exact `agg.explain` params. Assert that an invalid query sends no request and that changing the target removes the panel.

## P3 Low

- [ ] **CR-2 | Slot-based plans show no keys/docs examined per stage**
    - File: `packages/renderer/src/app/explain/explain.model.ts:131-141`, `packages/renderer/src/app/explain/explain.model.ts:176-177`
    - Category: Correctness
    - Problem: For SBE plans, `collectSbe` only copies `nReturned` and `executionTimeMillisEstimate` from the SBE stages. `keysExamined`/`docsExamined` come from the `queryPlan` stage, and that stage never has them. In the captured `agg-group-8.2.json`, the SBE `scan` stage of plan node 1 has `numReads: 2000`, but the COLLSCAN row only shows "1 500 returned". It has no docs figure, and its flow bar has no examined part. The totals (2 000 docs examined) are correct.
    - Why it matters: the task goal asks for a "tree of stages with keys/docs examined". On SBE plans, the per-stage figure is missing, and that figure is exactly what shows which stage discards most. Classic plans are fine.
    - Suggested fix: when collecting SBE stats, also take `numReads` of `scan`/`seek` stages as docs examined, and the key reads of `ixseek`/`ixscan` stages as keys examined, for the same `planNodeId`. Assert this on the captured `agg-group-8.2.json` fixture.

- [ ] **CR-3 | Explain with invalid input leaves the previous plan open (and clears the builder's run result)**
    - File: `packages/renderer/src/app/collection/collection-view.ts:382-386`, `packages/renderer/src/app/aggregation/aggregation-view.ts:487-491`
    - Category: Correctness
    - Problem: When the query bar does not parse, `CollectionView.explain()` sets the field errors and returns. `explainParams` stays unchanged, so the panel keeps showing the plan of the earlier query. `AggregationView.explain()` behaves the same, and on an invalid pipeline it also calls `failRun()`, which sets `result` to `null`. Clicking Explain therefore throws away the shown run result.
    - Why it matters: a stale plan next to an edited, invalid query can be mistaken for the plan of the current input. Losing the run result is an unexpected side effect of a read-only action.
    - Suggested fix: when the input is invalid, close the panel (`explainParams.set(null)`), or mark the shown plan as belonging to the earlier query. In the builder, report the error without clearing `result`, for example with a separate explain error or the panel's error state.

## Review conclusion

Material issues found; fix before completing the task.

Both acceptance criteria are addressed:
- The e2e `test/e2e/explain.e2e.ts` covers COLLSCAN before the index and IXSCAN after it, through the real query bar and the builder. The index is created over the bridge, as the recorded assumption says.
- `explain-plan.spec.ts` renders the captured mongo 8.2 fixtures.

These criteria are not yet recorded with `tasks.py verify`. The parent worker must still do that.

The explain model, panel cancellation and raw-view isolation look correct. The panel aborts the older request when a newer one starts, ignores results and errors of an aborted request, and always ends the loading state.

The findings are a non-blocking test gap (P2) and two minor behaviour gaps (P3). They do not block any acceptance criterion, so the parent may decide to fix them or record them with their disposition.
