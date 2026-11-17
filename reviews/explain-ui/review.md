# Code Review

Date: 2026-11-17

Task: explain-ui - M3: Explain plan viewer

Scope: round 3. The whole task diff on the final code, `git diff a60d732..e686724` (7 commits:
implementation, model/component tests, e2e, architecture notes, round-1 test-writer tests and
reports, fixer commit, round-2 test-writer tests and reports). Since round 2 (old HEAD 8d2acb3)
the branch has been rebased onto a60d732. The closest reading went to the only code commit since
round 2 (e686724: new tests in `explain.model.spec.ts` and `aggregation-view.spec.ts`) and to the
rebase resolution of `docs/ARCHITECTURE.md`. There are no uncommitted changes.

Requirements:
- tasks/explain-ui.md (goal, 2 acceptance criteria, recorded assumptions: index created over the
  bridge in the e2e, and the query-bar Explain explains the query as typed)
- SPEC.md M3 "Explain plan for find and aggregate", demo step 9
- docs/ARCHITECTURE.md ("Explain plan viewer", "Indexes tab"), docs/QUALITY.md, AGENTS.md
- reviews/explain-ui/fixes.md, reviews/explain-ui/tests.md, the round-2 review

Git range:
- Branch: main
- HEAD: e686724b5ea589ca0f8417ac5c70c3a68ec1a551
- Base/start: a60d7325727c3212ad69a51e4ce927acc962c801 (`git merge-base HEAD origin/main`)
- Commits reviewed: 7 (f6e4dea, 375928c, 5a37965, 6ba4fe3, 8740d57, 688d6a2, e686724)

Summary: 0 P0, 0 P1, 0 P2, 1 P3 open (round 1 found 1 P2 and 2 P3; all 3 are still resolved)

## How the rebase was checked

- The task's code (`packages`, `apps`, `test`) has the same `git patch-id --stable` before and after
  the rebase: `git diff 6d14cda..8d2acb3` and `git diff a60d732..688d6a2` both give 1a8f7ee2. So the
  production code reviewed in round 2 is unchanged. Only `docs/` differs, because of the
  ARCHITECTURE.md conflict.
- `docs/ARCHITECTURE.md`: the resolution keeps main's "Indexes tab" section in full and adds the
  task's "Explain plan viewer" section after it. The added text matches the pre-rebase text exactly.
  Nothing was lost or duplicated.
- Main changed `collection-view.ts/.html/.spec.ts` in the meantime (index-ui's "Indexes…" button).
  The merged template keeps `query-explain` in the query bar and the `app-explain-panel` block
  under the form, and the Indexes button sits separately in the bar. I found no interference.

## Round-3 test changes (e686724)

I traced each new test against `collectSbe`/`planNode` (`explain.model.ts:148-201`) and against the
target effect / `closeExplain()` in `aggregation-view.ts:262-268, 515-518`:
- "slot-based ixscan reads are keys examined; zero reads stay 0": `ixscan` reads of node 1 count as
  keys. The `seek` with `numReads: 0` gives `docsExamined` 0 on FETCH (through `addReads(undefined,
  0)`), not undefined. The IXSCAN node has no docs examined. The expectations are correct and test a
  real boundary (0 vs missing).
- "stages without numReads, or that are not scans, add no keys/docs examined": the `numReads` of a
  `filter` is ignored, and a `scan` without `numReads` leaves the value undefined. Correct.
- "a stage without planNodeId or name is passed through": the walk continues below a stage without
  an id, and a stage without a name adds no reads. Result: 4 docs examined. Correct.
- "pointing the tab at another collection clears a refused Explain message": a target change calls
  `closeExplain()`, which clears `explainError`. The test also asserts that no `agg.explain` was
  sent. Correct, and it covers the A2/CR-3 path that was missing.

The tests assert behaviour (summaries and DOM), not internals. No existing test was weakened or
removed (the commit only adds lines to both spec files).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [x] **CR-1 | Host-view Explain wiring has no unit tests (round 1). Resolved.**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.spec.ts:1371-1543`, `packages/renderer/src/app/collection/collection-view.spec.ts`
    - Category: Tests
    - Problem (round 1): no spec covered these behaviours: the `$out`/`$merge` switch to `queryPlanner`, the mapping from the query bar to the find target, the refusal of invalid input, and the panel reset when the target changes.
    - Resolution: covered by the round-1 test-writer specs. Round 3 adds the "target change clears the refusal message" case.

## P3 Low

- [ ] **CR-4 | Architecture notes for the Explain viewer are out of date after the fix and the rebase**
    - File: `docs/ARCHITECTURE.md:585-593`
    - Category: Quality
    - Problem: two statements no longer match the code:
      1. "(the index is created with `idx.create` until the Indexes tab exists)". After the rebase, the Indexes tab exists: index-ui is `done`, and the "Indexes tab" section sits right above this one. The e2e still uses `idx.create`. That is fine (the recorded assumption covers it), but the "until" wording now describes a pending change that nothing tracks.
      2. Slot-based plans take the "numbers of the outermost SBE stage with the same `planNodeId`". Since the CR-2 fix, that is only true for `nReturned` and time. Keys/docs examined are the summed `numReads` of the `scan`/`seek` and `ixseek`/`ixscan`/`ixscan_generic` stages of the node (`explain.model.ts:139-166`).
    - Why it matters: ARCHITECTURE.md is what the next agents read before they touch this code. A wrong description of where the examined counts come from could lead to a "fix" that undoes CR-2.
    - Suggested fix: state that keys/docs examined come from the summed `numReads` of the node's scan stages. Then either say the e2e creates the index over the bridge (no "until"), or switch the e2e to the Indexes tab. That would be a separate change, and the assumption should be updated with it.

- [x] **CR-2 | Slot-based plans show no keys/docs examined per stage (round 1). Resolved.**
    - File: `packages/renderer/src/app/explain/explain.model.ts:139-166`
    - Category: Correctness
    - Resolution: `collectSbe` adds up `numReads` per `planNodeId`. The round-3 tests add the zero-reads, non-scan and missing-id/name cases. The code is unchanged since round 2.

- [x] **CR-3 | Explain with invalid input leaves the previous plan open and clears the builder's run result (round 1). Resolved.**
    - File: `packages/renderer/src/app/collection/collection-view.ts`, `packages/renderer/src/app/aggregation/aggregation-view.ts:493-518`
    - Category: Correctness
    - Resolution: unchanged since round 2. The refusal shows in `agg-explain-error`, and the message clears on Explain, Close and a target change. The last case is now tested.

## Review conclusion

No material issues found.

The only open finding (CR-4) is a P3 documentation inaccuracy. It does not block completion, but it
is cheap to fix. Both acceptance criteria are still addressed. `test/e2e/explain.e2e.ts` covers demo
step 9. `explain-plan.spec.ts` renders the captured mongo 8.2 fixtures. The verify records
(7ec485b, 6d14cda, 04:24) are newer than the fixer commit (04:23), so they describe the final
production code. They were recorded before the rebase onto a60d732, which brought index-ui's
changes to `collection-view`. The merge is clean, and the parent reports that `npm run check`
passes at HEAD. I did not rerun the e2e myself. The parent may want to rerun
`test/e2e/explain.e2e.ts` on the rebased code before `done`, because `done` only runs the unit
check.
