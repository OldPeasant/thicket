# Code Review

Date: 2026-11-17

Task: explain-ui - M3: Explain plan viewer

Scope: round 4. The whole task diff on the final code, `git diff ef8927e..7a06a56` (8 commits:
implementation, model/component tests, e2e, architecture notes, round-1 test-writer tests and
reports, fixer commit, round-2 test-writer tests and reports, CR-4 fix). Since round 3 (HEAD
e686724 on base a60d732) the branch was rebased onto ef8927e, and commit 7a06a56 fixed CR-4
(`docs/ARCHITECTURE.md`) and reworded one comment in `test/e2e/explain.e2e.ts`. The closest reading
went to 7a06a56 and to the rebase. There are no uncommitted changes. A test-writer runs in parallel;
any later changes to tests or `reviews/explain-ui/tests.md` are not part of this review.

Requirements:
- tasks/explain-ui.md (goal, 2 acceptance criteria, recorded assumptions: index created over the
  bridge in the e2e, and the query-bar Explain explains the query as typed)
- SPEC.md M3 "Explain plan for find and aggregate", demo step 9
- docs/ARCHITECTURE.md ("Explain plan viewer", "Indexes tab"), docs/QUALITY.md, AGENTS.md
- reviews/explain-ui/fixes.md (rounds 1-3), reviews/explain-ui/tests.md, the round-3 review

Git range:
- Branch: main
- HEAD: 7a06a568d0561f58932958c77142974b1e143c46
- Base/start: ef8927e50e0878c20c6d7b70533e22449855106c (`git merge-base HEAD origin/main`)
- Commits reviewed: 8 (c202c00, e6c39e1, 2fbf41d, 9ac2c96, a36416a, 8ec6154, 4049309, 7a06a56)

Summary: 0 P0, 0 P1, 0 P2, 0 P3 open (rounds 1-3 found 1 P2 and 3 P3; all 4 are resolved)

## How the rebase and the CR-4 commit were checked

- Code reviewed in round 3 is unchanged: `git diff a60d732..e686724 -- packages apps test` and
  `git diff ef8927e..4049309 -- packages apps test` both give `git patch-id --stable` f53878ca.
- `git diff 4049309..7a06a56 -- packages apps test` changes exactly one line: the comment above
  the `idx.create` request in `test/e2e/explain.e2e.ts:99`. No executable code changed.
- Main between a60d732 and ef8927e brought OIDC work (backend `auth/oidc`, `connections`,
  `contract`, desktop handlers, integration fixtures) and an ARCHITECTURE.md change. None of these
  files is in the task diff, and the task's ARCHITECTURE.md section is a pure addition after the
  "Indexes tab" section (`docs/ARCHITECTURE.md:612-629`), so nothing was lost or duplicated.

## CR-4 fix verification

- `docs/ARCHITECTURE.md:618-623` now says that, for slot-based plans, returned and time come from
  the outermost SBE stage with the same `planNodeId`, and keys/docs examined are the summed
  `numReads` of that node's `ixseek`/`ixscan`/`ixscan_generic` and `scan`/`seek` stages. This
  matches `explain.model.ts:139-167`: `collectSbe` creates the entry from the first (outermost)
  stage it meets for an id, with its `nReturned` and `executionTimeMillisEstimate`, and adds
  `numReads` through `addReads` for names in `SBE_DOC_READS`/`SBE_KEY_READS`. `planNode`
  (`explain.model.ts:182-205`) uses these values only when the `queryPlan` stage has none of its own.
- `docs/ARCHITECTURE.md:626-628` says the e2e creates the index with `idx.create` over the bridge,
  not through the Indexes tab. This matches `test/e2e/explain.e2e.ts:99-106` and the recorded
  assumption, and the "until the Indexes tab exists" wording is gone.
- The new e2e comment is accurate and no longer calls index-ui a pending task.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [x] **CR-1 | Host-view Explain wiring has no unit tests (round 1). Resolved.**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`, `packages/renderer/src/app/collection/collection-view.spec.ts`
    - Category: Tests
    - Problem (round 1): nothing covered the `$out`/`$merge` switch to `queryPlanner`, the query-bar-to-find mapping, the refusal of invalid input, and the panel reset on a target change.
    - Resolution: covered by the round-1 and round-2 test-writer specs. Unchanged since round 3.

## P3 Low

- [x] **CR-2 | Slot-based plans show no keys/docs examined per stage (round 1). Resolved.**
    - File: `packages/renderer/src/app/explain/explain.model.ts:139-167`
    - Category: Correctness
    - Resolution: `collectSbe` sums `numReads` per `planNodeId`. Tested for zero reads, non-scan stages and stages without an id or name. Unchanged since round 3.

- [x] **CR-3 | Explain with invalid input leaves the previous plan open and clears the builder's run result (round 1). Resolved.**
    - File: `packages/renderer/src/app/collection/collection-view.ts`, `packages/renderer/src/app/aggregation/aggregation-view.ts`
    - Category: Correctness
    - Resolution: unchanged since round 3. The refusal shows in `agg-explain-error` and clears on Explain, Close and a target change (tested).

- [x] **CR-4 | Architecture notes for the Explain viewer are out of date after the fix and the rebase (round 3). Resolved.**
    - File: `docs/ARCHITECTURE.md:618-628`, `test/e2e/explain.e2e.ts:99`
    - Category: Quality
    - Resolution: fixed in 7a06a56 and checked against the code (see "CR-4 fix verification").

## Review conclusion

No material issues found.

Both acceptance criteria are still addressed: `test/e2e/explain.e2e.ts` covers demo step 9, and
`explain-plan.spec.ts` renders the captured mongo 8.2 fixtures. The verify records (04:24) predate
the rebases onto a60d732 and ef8927e. Production code has the same patch-id since then. Main's
changes after a60d732 do not touch the renderer. The earlier rebase onto a60d732 brought index-ui's
`collection-view` changes, and I did not rerun the e2e myself. As in round 3, the parent may want to
rerun `test/e2e/explain.e2e.ts` on the final code before `done`, because `done` only runs the unit
check.
