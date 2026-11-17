# Code Review

Date: 2026-11-17

Task: agg-ui-polish - Aggregation builder: stage-named preview announcements, no previews in text mode

Scope: the task's final code at c43202e. This covers the implementation commit (originally afa9e3c, rebased as 6269139 with an identical code diff) and the test-writer commit c43202e, which added tests to `aggregation-view.spec.ts` and `reviews/agg-ui-polish/tests.md`. `git diff --stat afa9e3c c43202e` shows that only `aggregation-view.spec.ts`, `reviews/agg-ui-polish/tests.md` and `tasks/agg-ui-polish.md` changed after the first review round, so the production code is unchanged. Uncommitted changes: none (apart from this report).

Requirements:
- `tasks/agg-ui-polish.md`: acceptance criteria 1 (CR-8) and 2 (CR-9), and the two recorded assumptions
- `reviews/agg-ui/review.md`: CR-8 and CR-9 (problem statements and suggested fixes)
- `SPEC.md` M3 (aggregation builder: a preview per stage, full-text mode)
- `docs/ARCHITECTURE.md` "Aggregation builder" (Previews paragraph, updated by this task)
- `AGENTS.md`, `docs/QUALITY.md`
- Coordinator instructions for round 2: review the new tests, keep CR-1, and say whether re-reading a failed preview on return is acceptable for criterion 2

Git range:
- Branch: main
- HEAD reviewed: c43202e6a666d76be65504b7022b72487826b55d
- Base/start: 317b9fc2212558f875e5d5cbb4c9fa0343ca865c (task base). The task's commits sit on top of 7f14348 after the rebase.
- Commits reviewed: 2 with code changes (6269139, the rebased afa9e3c84a90b3a56a420ac2ab073721d774de2e, and c43202e). The rest are `tasks/`-only `assume`/heartbeat commits.

Commands run:
- `cd packages/renderer && npx ng test --include src/app/aggregation/aggregation-view.spec.ts` at afa9e3c -> 93 passed
- The same command at c43202e, run twice -> 104 passed both times
- `git diff --stat afa9e3c c43202e` -> no production files changed
- `python tasks.py verify agg-ui-polish` (round 1) -> both criteria unticked. The parent records evidence after the review, so this is not a finding.

Summary: 0 P0, 0 P1, 0 P2, 3 P3

## What was checked

### Implementation (unchanged since round 1)

- **CR-8 (criterion 1).** `previewStatus(id, position)` (`aggregation-view.ts:471-479`) returns `Stage N: <count> from a sample` or `Stage N: preview failed: <message>`. It returns `''` while loading and for stages without a plan. N is `i + 1` from the `@for` (`aggregation-view.html:170`). The live region stays persistent and polite, and the visible "Loading preview…" note remains. Satisfied.
- **CR-9 (criterion 2).** The preview effect reads `mode()`. In text mode it calls `pausePreviews()`, which clears the debounce timer, aborts and forgets runs that have not finished, and keeps finished ones (`aggregation-view.ts:260-266`, `:392-404`). `applyText()` reuses ids by position (`:360-363`), so on return a stage whose `previewRuns` key is identical is skipped by `schedulePreviews`. Satisfied, with the caveat discussed under CR-2.
- **Side effects of reusing ids by position:**
  - Previews map. A stage keeps its old preview only when the collection and its full pipeline prefix are identical. `preview()` sets `loading` synchronously, and aborted runs never write. No stale result can be taken for current.
  - Retry. A failed run is still removed from `previewRuns` (`:448`), so it is retried on return (see CR-2). `retryPreview` is only reachable in stage mode.
  - Angular `track stage.id`. The list is only rendered in stage mode (`aggregation-view.html:72`), and `applyText()` only runs in text mode, so live rows are never re-associated.
  - Explain, Run and Export. They do not depend on ids.
  - Stale preview during the debounce. A changed stage shows its old result for up to 400 ms on return. Editing in stage mode already behaves this way.

### New tests (c43202e)

All 11 new tests were read against the component code and the spec helpers (`settle`, `buildDemo`, the default `agg.previewStage` handler, which returns one document per pipeline stage, and the fake-timer `tick`).

- **Correctness.** Each assertion matches the implemented behavior and the criteria:
  - The removed-last-stage case keeps both previews and announces "Stage 1/2".
  - The appended stage is the only one read.
  - Removing the first stage re-reads `$group` and `$group $sort`.
  - A stage inserted in the middle re-reads that stage and the ones after it.
  - Explain in text mode applies the text without previews, and only the edited `$sort` is read on return. This also proves that `DEMO` matches what `buildDemo` builds; otherwise more stages would be read.
  - A Run refused for a parse error sends no previews.
  - Toggling the mode back and forth without edits reads nothing.
  - Changing the collection in text mode reads nothing until the return, then reads 3 stages against `invoices`.
  - Out-of-order answers leave each region silent until its own result arrives, and that result names the right stage.
  - The debounce test with fake timers shows that a pending debounce is cancelled on entering text mode and runs exactly one debounce after returning.
- **Regression value.** The debounce test, "switching back and forth", "reads only a stage appended" and the collection-change test would all fail against the base code. Before the fix, the effect did not track `mode()`, and `applyText()` assigned fresh ids.
- **Determinism.** Tests outside `describe('preview debounce')` use the real-timer `settle()` with `debounceMs = 0`. The debounce test relies on fake timers firing in time order: Angular's zoneless scheduler timer at +0 runs the effect, so `pausePreviews()` clears the pending debounce at +100. The order is fixed. Two full runs passed with 104/104.
- **Weakness.** One test asserts too little; see CR-3.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Renumbering a stage makes its live region announce an unchanged result again**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.html:170`, `packages/renderer/src/app/aggregation/aggregation-view.ts:471-479`
    - Category: Quality (accessibility)
    - Problem: The stage number is part of the live-region text. When a stage's position changes but its prefix does not, the text changes although no preview was read. Examples: removing a disabled stage, or a stage with a syntax error, that sits before it; inserting a stage and then disabling it. The prefix keys stay the same, so the previews stay `ok`, but "Stage 3: …" becomes "Stage 2: …" in the same `aria-live` node, and the screen reader announces each later stage's old count again. The spec "Moving a stage renames its announcement" does not cover this case, because its move changes both prefixes and reloads both previews.
    - Why it matters: CR-8 was meant to tie each announcement to a new result. This path brings back announcements that carry no new information. The text is correct, and it only happens on structural edits.
    - Suggested fix: Accept as is, or announce only when the result changes. For example, build the text when the preview settles and store it with the preview, so a position change alone does not alter the region. If kept as is, note it in the CR-8 disposition.

- [ ] **CR-2 | On return, a failed preview is read again even with an unchanged prefix; the docs say only changed prefixes are read**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.ts:446-449` (failed run forgotten), `:392-404`; `docs/ARCHITECTURE.md:586-587`
    - Category: Quality (documentation / requirement interpretation)
    - Problem: A failed run is removed from `previewRuns`, so the first `schedulePreviews` pass after returning to stage mode reads that stage again, even when its prefix did not change. The new ARCHITECTURE sentence says "back in the stage list only stages whose prefix changed are read again", which is not quite true for failed stages. The retry rule itself ("Forget the failed run, so the next scheduling pass (any edit) asks again") predates this task and is not documented in ARCHITECTURE.
    - Assessment for criterion 2: **acceptable.** CR-9 targeted wasted requests whose results are discarded: hidden text-mode previews and re-reads of previews that are already shown. A failed stage has no result to keep, and on return the user sees the stage list again, so one retry for it is useful work. It also matches the existing behavior in stage mode, where any edit retries a failed preview. The criterion's intent ("does not re-preview stages whose pipeline prefix did not change") concerns previews that are still current. A failed preview is not current. Literally, though, the criterion and the new doc sentence do not mention this exception.
    - Suggested fix: Make no code change. Add the exception to the ARCHITECTURE sentence, for example "only stages whose prefix changed, or whose preview failed, are read again". Then record a `tasks.py assume` line for the interpretation of criterion 2, so a human can confirm it.

- [ ] **CR-3 | The failed-preview round-trip test does not assert what is read on return**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.spec.ts` test "a failed preview is not asked again in text mode, and the good ones are kept on return" (the final two `expect(sentSince(before)).not.toContain(...)` lines)
    - Category: Tests
    - Problem: The test only asserts that `$match` and `$match $group` are absent from the requests sent after the return. It would also pass if nothing were sent, or if extra unrelated requests were sent. It does not check that the failed stage 3 is read again or that it now shows its result, which is the behavior discussed in CR-2.
    - Why it matters: The test gives weak protection for the exact case the coordinator asked about. A regression that drops the retry, or one that reads too much, would not be caught by this test.
    - Suggested fix: Assert `expect(sentSince(before)).toEqual(['$match $group $sort'])` and `expect(inStage(2, 'agg-preview-live').textContent?.trim()).toBe('Stage 3: 3 documents from a sample')`. This pins the retry-on-return rule from CR-2.

## Review conclusion

No material issues found. Both acceptance criteria are implemented and covered by component tests that fail against the base code. The 11 test-writer tests are correct and deterministic (104/104 in two runs), and they assert the intended behavior. One of them should assert more precisely (CR-3). Re-reading a failed preview on return is acceptable for criterion 2, but it should be documented and recorded as an assumption (CR-2). CR-1 is kept from round 1. All three findings are P3 and do not block completion. The parent still has to record `tasks.py verify` evidence for both criteria.
