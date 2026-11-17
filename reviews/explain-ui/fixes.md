# Fix Report

Date: 2026-11-17

Task: explain-ui - M3: Explain plan viewer

Scope: current task. Findings approved by the parent worker: CR-2 and CR-3 from
`reviews/explain-ui/review.md`, plus TW-1, A2 and A3 from `reviews/explain-ui/tests.md`.
Base f73fabc20516fdd249b095471a17ecc764c12b6c, HEAD dc3121f. The changes are uncommitted; the
parent worker commits them.

## Fixed findings

### CR-2 — Slot-based plans show no keys/docs examined per stage

Files changed:
- `packages/renderer/src/app/explain/explain.model.ts`
- `packages/renderer/src/app/explain/explain.model.spec.ts`
- `packages/renderer/src/app/explain/explain-plan.spec.ts`

Problem:
For `explainVersion` 2 plans, `collectSbe` copied only `nReturned` and the time estimate from the
SBE stages. The `queryPlan` stages have no keys/docs figures, so in the captured
`agg-group-8.2.json` fixture the COLLSCAN row showed no docs examined and its flow bar had no
examined part.

Fix:
`collectSbe` now also adds up `numReads` for each `planNodeId`. Reads of the SBE stages `scan` and
`seek` count as docs examined. Reads of `ixseek`, `ixscan` and `ixscan_generic` count as keys
examined. `planNode` uses these figures only when the classic plan stage has no
`keysExamined`/`docsExamined` of its own. The totals still come from `executionStats` and did not
change.

New tests:
- The fixture's COLLSCAN node now has `docsExamined` 2000. GROUP has none.
- On a synthetic SBE plan, two index stages of one node add up, a FETCH takes the `seek` reads,
  and a number already on the plan stage is kept.
- The `ExplainPlan` component shows "2,000 docs" on the COLLSCAN row, with a 100 % examined bar and
  a 75 % returned bar.

Validation:
- `cd packages/renderer && npx ng test --include 'src/app/explain/**/*.spec.ts' --include 'src/app/collection/collection-view.spec.ts' --include 'src/app/aggregation/aggregation-view.spec.ts'` — Pass

### CR-3 / A3 — Explain with invalid input left the previous plan open and cleared the builder's run result

Files changed:
- `packages/renderer/src/app/collection/collection-view.ts`
- `packages/renderer/src/app/collection/collection-view.spec.ts`
- `packages/renderer/src/app/aggregation/aggregation-view.ts`
- `packages/renderer/src/app/aggregation/aggregation-view.html`
- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`

Problem:
When the query bar or pipeline was invalid, Explain left an earlier plan open, so it could be taken
for the plan of the edited input. In the builder, the refusal also went through `failRun`, which
removed the shown run result.

Fix:
- Collection view: an invalid query bar sets `explainParams` to `null`.
- Aggregation view: a refused Explain closes the panel. This covers both full-text input that does
  not parse and a stage with an error. The view no longer calls `failRun` here. The
  "Fix stage N first" message goes to a new `explainError` signal, shown as `agg-explain-error`
  above the panel. `result` and `runError` are not changed. The message goes away on the next
  successful Explain, on Close, and when the target changes (`closeExplain()`).
- Two existing assertions changed from `agg-run-error` to `agg-explain-error`, because the message
  now has its own element. Their expectations are otherwise the same, and both now also check that
  no run error is shown.

New tests:
- Collection: an invalid query closes the earlier plan and sends nothing.
- Aggregation: a refused Explain closes the earlier plan, keeps the run result and shows no run
  error. The message clears on the next Explain.
- Aggregation: in full-text mode, text that does not parse closes the earlier plan.

Validation:
- Focused renderer command above — Pass

### TW-1 — `ExplainRaw` threw on output that does not parse

Files changed:
- `packages/renderer/src/app/explain/explain-raw.ts`
- `packages/renderer/src/app/explain/explain-plan.spec.ts`

Problem:
`parseEJson` inside a `computed` threw during change detection when the explain text was not
EJSON. This text reaches `ExplainRaw` through the error branch of `ExplainPlan`.

Fix:
The `computed` now catches the parse error. In that case the template shows a short message
(`explain-raw-error`, with the parser's message) and the text as it is in a `<pre>`, instead of the
explorer.

New test:
`'{ not json'` shows the plan error, the raw-view message and the text, with no explorer and no
thrown error.

Validation:
- Focused renderer command above — Pass

### A2 — The builder's explain panel stayed open after the tab's target changed

Files changed:
- `packages/renderer/src/app/aggregation/aggregation-view.ts`
- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`

Problem:
In the collection view the panel closes when the profile, database or collection changes. The
aggregation view kept showing the plan of the old collection.

Fix:
A new effect on `target()` (the computed already compares profileId/db/coll) calls
`closeExplain()`.

New tests:
- Pointing the tab at another collection closes the panel, and the next Explain uses the new
  collection.
- Setting the same collection again keeps the panel.

Validation:
- Focused renderer command above — Pass

## Not fixed

None. CR-1 (P2, the test gap) was not in the list given to this fixer. The test-writer's
`collection-view.spec.ts` and `aggregation-view.spec.ts` additions already cover it. A1 (Explain
uses the query as typed, without the paging sort) was not in the list either; the parent decides
how to record it.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include 'src/app/explain/**/*.spec.ts' --include 'src/app/collection/collection-view.spec.ts' --include 'src/app/aggregation/aggregation-view.spec.ts'` — Pass (5 files, 209 tests; 201 before, 8 added)

Full test suite:
- `npm run check` (repository root) — Pass: workspaces 64 files / 3545 tests, renderer 83 files / 2513 tests

Lint/type-check/build:
- `npx prettier --write` on the 9 touched files — all unchanged
- `npm run lint` (eslint --max-warnings 0 and prettier --check, run as part of `npm run check`) — Pass
- `npm run typecheck` (as part of `npm run check`) — Pass

`.taskcheck`:
- Pass. `.taskcheck` runs `npm run check`, and the run above passed. It was not run a second time.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

# Fix Report (round 3)

Date: 2026-11-17

Task: explain-ui

Scope: CR-4 from the round-3 `reviews/explain-ui/review.md`. Docs only, no code changed.

## Fixed findings

### CR-4 — Architecture notes for the Explain viewer are out of date after the fix and the rebase

Files changed:
- `docs/ARCHITECTURE.md` (section "Explain plan viewer")

Problem:
The section said slot-based plans take the numbers of the outermost SBE stage with the same
`planNodeId`. Since the CR-2 fix, only returned and time come from there. It also said the e2e
creates the index with `idx.create` "until the Indexes tab exists", but index-ui is done.

Fix:
- Slot-based: returned and time come from the outermost SBE stage with the same `planNodeId`.
  Keys/docs examined are the summed `numReads` of that node's `ixseek`/`ixscan`/`ixscan_generic`
  and `scan`/`seek` stages. Checked against `collectSbe` and `planNode` in `explain.model.ts`.
- e2e: the test creates the index with `idx.create` over the bridge, not through the Indexes tab
  (`test/e2e/explain.e2e.ts`). The "until" clause is gone.

Validation:
- `npx prettier --check docs/ARCHITECTURE.md` — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- Not applicable (documentation only)

Full test suite:
- Not run (no code changed)

Lint/type-check/build:
- `npx prettier --check docs/ARCHITECTURE.md` — Pass

`.taskcheck`:
- Not run (documentation-only change; the parent runs it before `done`)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
