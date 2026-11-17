# Code Review

Date: 2026-11-17

Task: agg-ui-polish - Aggregation builder: stage-named preview announcements, no previews in text mode

Scope: the task's final code at dfde044. The task's own commits are:
- 409c87a: implementation, the rebased afa9e3c/6269139.
- 5bdea18: test-writer tests, the rebased c43202e.
- dfde044: fixer, CR-2 and CR-3.

The commits in between touch only `tasks/` or `reviews/`, or come from other tasks on main. `git diff --stat c43202e 5bdea18 -- packages/renderer/src/app/aggregation docs/ARCHITECTURE.md` is empty, so the rebase changed none of the code reviewed in rounds 1 and 2. This round reviews the fixer diff, `git diff aeb6233 dfde044 -- docs packages`, against the round-2 findings. Uncommitted changes: none (apart from this report).

Requirements:
- `tasks/agg-ui-polish.md`: acceptance criteria 1 (CR-8) and 2 (CR-9), and the three recorded assumptions
- `reviews/agg-ui/review.md`: CR-8 and CR-9
- `SPEC.md` M3 (aggregation builder: a preview per stage, full-text mode)
- `docs/ARCHITECTURE.md` "Aggregation builder"
- `AGENTS.md`, `docs/QUALITY.md`
- Coordinator instructions for each round: round 1, the implementation and the side effects of reusing ids; round 2, the test-writer tests and whether retrying a failed preview is acceptable; round 3, the fixer diff and the final status of CR-1..CR-3

Git range:
- Branch: main
- HEAD: dfde04459839d061aec3d8771dc2a721b2c8fe45
- Base/start: 317b9fc2212558f875e5d5cbb4c9fa0343ca865c (original task base). The task commits were later rebased onto the current main.
- Commits reviewed: 3 with code changes (409c87a, 5bdea18, dfde044)

Commands run:
- `cd packages/renderer && npx ng test --include src/app/aggregation/aggregation-view.spec.ts`:
  - round 1 (afa9e3c): 93 passed
  - round 2 (c43202e), run twice: 104 passed both times
  - round 3 (dfde044): 104 passed
- `git diff --stat afa9e3c c43202e` -> no production files changed between rounds 1 and 2
- `git diff --stat c43202e 5bdea18 -- packages/renderer/src/app/aggregation docs/ARCHITECTURE.md` -> empty (the rebase changed no task code)
- `git diff aeb6233 dfde044 -- docs packages` -> one sentence changed in ARCHITECTURE, one test's assertions changed

Summary: 0 P0, 0 P1, 0 P2, 3 P3 (CR-1 accepted, CR-2 and CR-3 resolved)

## What was checked

### Implementation (unchanged since round 1)

- **CR-8 (criterion 1).** `previewStatus(id, position)` (`aggregation-view.ts:471-479`) returns `Stage N: 5 documents from a sample` or `Stage N: preview failed: the error message`. It returns `''` while loading and for stages without a plan. N is `i + 1` from the `@for` (`aggregation-view.html:170`). The live region stays persistent and polite, and the visible "Loading preview…" note remains. Satisfied.
- **CR-9 (criterion 2).** The preview effect reads `mode()`. In text mode it calls `pausePreviews()`, which clears the debounce timer, aborts and forgets runs that have not finished, and keeps finished ones (`aggregation-view.ts:260-266`, `:392-404`). `applyText()` reuses ids by position (`:360-363`), so on return a stage whose `previewRuns` key is identical is skipped. A failed preview is retried; this is the documented exception, see CR-2. Satisfied.
- **Side effects of reusing ids by position:**
  - Previews map. A stage keeps its old preview only when the collection and its full pipeline prefix are identical. Aborted runs never write.
  - Retry. A failed run is forgotten and retried on return.
  - Angular `track stage.id`. The stage list is only rendered in stage mode, and `applyText()` only runs in text mode, so live rows are never re-associated.
  - Explain, Run and Export. They do not depend on ids.
  - Stale preview during the debounce. A changed stage shows its old result for up to 400 ms on return. Editing in stage mode already behaves this way.

### Tests

The 11 test-writer tests (round 2) are correct and deterministic, and they would fail against the base code. Round 2 has the details.

### Fixer diff (dfde044)

- **CR-2.** `docs/ARCHITECTURE.md:586-588` now says "only stages whose prefix changed, or whose preview failed, are read again". This matches the code (`aggregation-view.ts:446-449` forgets a failed run). The task notes now carry the matching assumption line (04:55) for criterion 2.
- **CR-3.** The failed-preview round-trip test now asserts `sentSince(before)` equals `['$match $group $sort']`. It also asserts that stage 3's live region reads `Stage 3: 3 documents from a sample`. This matches the fake: the handler that follows the failure returns one document per stage in the pipeline. The test now pins both the retry and the absence of other reads. It passes at dfde044.
- **Scope.** The fixer changed no production code, and no new issues were introduced.

### Observations (not findings)

- The coordinator said CR-1 was accepted with an assumption recorded. `tasks/agg-ui-polish.md` at dfde044 has three assumption lines (CR-9 ids, CR-8 wording, and CR-2's failed-preview retry), but none of them describes CR-1. That is acceptable, as long as `quality.json` records CR-1 as `accepted` with a note.
- Criterion evidence was recorded at 04:53, before dfde044. The fixer's change only tightened one test, and the suite still passes with 104 tests at dfde044, so the evidence remains accurate.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [x] **CR-1 | Renumbering a stage makes its live region announce an unchanged result again** - Status: accepted (not changed)
    - File: `packages/renderer/src/app/aggregation/aggregation-view.html:170`, `packages/renderer/src/app/aggregation/aggregation-view.ts:471-479`
    - Category: Quality (accessibility)
    - Problem: The stage number is part of the live-region text. When a stage's position changes but its prefix does not, the region text changes although no preview was read. This happens, for example, when a disabled stage or a stage with an error that sits before it is removed. The screen reader then announces the old count again under the new number.
    - Why it matters: The announcement repeats information the user already had. The text is correct, and it only happens on structural edits.
    - Suggested fix: None required. If it is revisited, build the announcement when the preview settles, so a position change alone does not alter the region. Record the acceptance in `quality.json`.

- [x] **CR-2 | On return, a failed preview is read again even with an unchanged prefix; the docs said only changed prefixes are read** - Status: resolved in dfde044
    - File: `docs/ARCHITECTURE.md:586-588`; `packages/renderer/src/app/aggregation/aggregation-view.ts:446-449`
    - Category: Quality (documentation / requirement interpretation)
    - Problem: The architecture text did not mention that a failed preview is retried when the stage list is back.
    - Resolution: ARCHITECTURE now states the exception, and the task records an assumption for the interpretation of criterion 2. The behavior itself is acceptable for criterion 2 (see round 2): a failed preview has no result to keep, so retrying it is not a wasted re-read.

- [x] **CR-3 | The failed-preview round-trip test did not assert what is read on return** - Status: resolved in dfde044
    - File: `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`, test "a failed preview is not asked again in text mode, and the good ones are kept on return"
    - Category: Tests
    - Problem: The test asserted only that two pipelines were absent from the requests sent on return.
    - Resolution: It now asserts the exact set of requests (`['$match $group $sort']`) and the recovered announcement for stage 3.

## Review conclusion

No material issues found. Both acceptance criteria are implemented and covered by deterministic component tests (104/104 at dfde044). CR-2 and CR-3 are resolved correctly. CR-1 is accepted as a P3 that does not block completion, and it should be recorded as `accepted` in `quality.json`. The review evidence covers revision dfde04459839d061aec3d8771dc2a721b2c8fe45.
