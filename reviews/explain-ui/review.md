# Code Review

Date: 2026-11-17

Task: explain-ui - M3: Explain plan viewer

Scope: round 2. The whole task diff on the final code, `git diff 6d14cda..8d2acb3` (6 commits:
implementation, model/component tests, e2e, architecture notes, test-writer tests and reports, and
the fixer commit). The fixer commit 8d2acb3 got the closest reading. There are no uncommitted
changes. Round 1 reviewed the implementation commits only. Since then the branch has been rebased,
so the round-1 hashes (f73fabc..65e75e1) are now 6d14cda..f0cb232.

Requirements:
- tasks/explain-ui.md (goal, 2 acceptance criteria, recorded assumptions: index created over the
  bridge in the e2e, and the query-bar Explain explains the query as typed)
- SPEC.md M3 "Explain plan for find and aggregate", demo step 9
- docs/ARCHITECTURE.md ("Explain plan viewer"), docs/QUALITY.md, AGENTS.md "Quality sub-agent
  boundaries"
- reviews/explain-ui/fixes.md, reviews/explain-ui/tests.md (round-1 findings and their fixes)

Git range:
- Branch: main
- HEAD: 8d2acb332a69eb6ccf8e65fb9e061f71dcfd5fc4
- Base/start: 6d14cda876ae5d665a9861e7e0ead68b908762d9 (`git merge-base HEAD origin/main`)
- Commits reviewed: 6 (f0cb232, abb6b20, 4ed92b2, 24eea68, e0df0ad, 8d2acb3)

Summary: 0 P0, 0 P1, 0 P2, 0 P3 open (round 1 found 1 P2 and 2 P3; all 3 are resolved)

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [x] **CR-1 | Host-view Explain wiring has no unit tests (round 1). Resolved.**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.spec.ts:1371-1530`, `packages/renderer/src/app/collection/collection-view.spec.ts:1247-1360`
    - Category: Tests
    - Problem (round 1): no spec covered these behaviours: the `$out`/`$merge` switch to `queryPlanner`, the mapping from the query bar to the find target, the refusal of invalid input, and the panel reset when the target changes.
    - Resolution: the test-writer's specs now check all of them. The aggregation specs check `executionStats` vs `queryPlanner` with `$out`, the refusal message, closing on an invalid stage or invalid text, closing on a target change, and Explain again/Close. The collection specs check the exact `agg.explain` params (filter, projection, sort, collation, limit), that an invalid query sends nothing and closes the plan, Close, and closing on a target change.

## P3 Low

- [x] **CR-2 | Slot-based plans show no keys/docs examined per stage (round 1). Resolved.**
    - File: `packages/renderer/src/app/explain/explain.model.ts:139-167`, `packages/renderer/src/app/explain/explain.model.ts:199-200`
    - Category: Correctness
    - Problem (round 1): on SBE plans, `collectSbe` copied only `nReturned` and the time from the SBE stages, so the COLLSCAN/IXSCAN/FETCH rows had no examined figure.
    - Resolution: `collectSbe` now adds up `numReads` per `planNodeId`. The `scan`/`seek` stages count as docs examined, and `ixseek`/`ixscan`/`ixscan_generic` as keys examined. `nReturned`/time still come from the outermost stage of each node, because the walk is pre-order. A number on the classic stage takes precedence, and the totals still come from `executionStats`. Tests check the captured `agg-group-8.2.json` (COLLSCAN 2000 docs, GROUP none), a synthetic SBE plan (two index stages of one node add up, `$numberLong` reads, FETCH takes the `seek` reads, a classic number is kept), and the rendered "2,000 docs" row. I found no regression.

- [x] **CR-3 | Explain with invalid input leaves the previous plan open and clears the builder's run result (round 1). Resolved.**
    - File: `packages/renderer/src/app/collection/collection-view.ts:381-395`, `packages/renderer/src/app/aggregation/aggregation-view.ts:493-518`, `packages/renderer/src/app/aggregation/aggregation-view.html:64-69`
    - Category: Correctness
    - Problem (round 1): an invalid query bar or pipeline left the earlier plan open. In the builder, the refusal also went through `failRun`, which set `result` to `null`.
    - Resolution: the collection view sets `explainParams` to `null` on parse errors. The builder calls `closeExplain()` for invalid text and for a stage with an error, and shows the refusal in its own `agg-explain-error` alert, so `result`/`runError` stay as they are. The message clears on the next successful Explain, on Close (the panel's `closed` now calls `closeExplain()`), and on a target change. The new target effect depends only on `target()`, and that computed has a custom equality on profileId/db/coll. So the panel survives an edit in the same tab, as `aggregation-view.spec.ts` checks with "setting the same collection again keeps the panel". The run on construction is harmless because nothing is open yet.

Other fixer changes, reviewed with no findings:
- TW-1 (`packages/renderer/src/app/explain/explain-raw.ts:45-81`): a parse error inside the `computed` is now caught. The text is shown through Angular interpolation in a `<pre>`, which escapes it, so no unsafe HTML rendering is introduced. `explain-plan.spec.ts:104` covers it.
- A2 (builder panel closes on a target change): see CR-3. It matches the collection view (`collection-view.ts:325-338`).

## Review conclusion

No material issues found.

Both acceptance criteria are addressed:
- `test/e2e/explain.e2e.ts` covers demo step 9 (COLLSCAN before the index, IXSCAN after it) through the real query bar and builder. The index is created over the bridge, as the recorded assumption says. The parent reports that it reran the explain, aggregation and collection e2e specs on the final code: 3 passed. I did not run them myself.
- `explain-plan.spec.ts` renders the captured mongo 8.2 fixtures, now including the SBE per-stage docs examined.

The `verify` commits for both criteria (7ec485b, 6d14cda) are older than the fixer commit. The parent should check that the recorded evidence still describes the run on the final code, and record it again if it does not.

Review method: Bash was refused for most git commands in this session. The scope was resolved with `git log`, `git merge-base`, `git status`, `git diff --stat` and `git show 8d2acb3`. The changed production files were read in full from the working tree, which matches HEAD (it is clean).
