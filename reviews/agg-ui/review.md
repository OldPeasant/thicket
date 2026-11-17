# Code Review

Date: 2026-11-17

Task: agg-ui (M3: Aggregation pipeline builder). Third review round, on the final code at 14aed95. That is 142f443 (the round-2 fixes for CR-6 and CR-7) plus two spec tests added by test-writer.

Scope: `git diff ee32d24..14aed95`, excluding `tasks/` and `reviews/`. Committed changes only. The whole task diff was re-read against the acceptance criteria. The round-2 fix commit 142f443 and the spec-only delta `142f443..14aed95` were checked in detail. Spec files were read from the commits (`git show`/`git diff`), not from the working tree.

Requirements:
- tasks/agg-ui.md acceptance criteria and recorded assumptions
- SPEC.md M3 (aggregation builder, create view, `$out`/`$merge` ask first) and demo step 8
- docs/ARCHITECTURE.md "Aggregation builder" and "Write safety in the renderer"
- AGENTS.md project notes (theme tokens only, no secrets, no eval)
- Earlier reviews (round 1: CR-1 to CR-5; round 2: CR-6, CR-7) and reviews/agg-ui/fixes.md (round 1 and "Round 2")
- Parent and coordinator instructions for this round

Git range:
- Branch: main
- HEAD: 14aed958785daecb18a1621b3b830bed712bfd02
- Base/start: ee32d24eb81473ce09be0131f954f888132ca0ac
- Commits reviewed: 11 (c76cb7f, e3b2cf6, 82ffc9f, 8605b19, 92c8a0c, ae781ab, b638489, 2811e73, dab2d57, 142f443, 14aed95). 82ffc9f and 8605b19 touch only `tasks/saved-pipelines.md`.
- Production code last changed in 142f443. 14aed95 changes only `packages/renderer/src/app/aggregation/aggregation-view.spec.ts` (+63 lines) plus `reviews/agg-ui/`.
- Uncommitted changes: none in code at review time.

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## Spec-only delta 142f443..14aed95

`git diff 142f443 14aed95 -- packages` adds two tests to `aggregation-view.spec.ts` and changes no production code. Both tests check behavior through the DOM and the requests the fake receives, and both match the code at 142f443:
- "the live region counts every previewed stage and is empty for stages without a preview": `previewStatus()` returns `''` when `previewPlans()` has no entry for a stage. Disabled stages, stages with an error and `$out`/`$merge` stages have no entry, which matches `aggregation-view.ts:159-180` and `:440-446`. The region stays the same element across disable and enable because the `@for` is tracked by `stage.id`. The test also checks for exactly one `[aria-live]` per preview.
- "a Run refused for a full-text parse error sends nothing and keeps the text and stages": `applyText()` returns before `stages.set` on a parse error (`:342-346`), so `view.stages()` stays the same reference. After the text is fixed, the EJSON that is sent includes the `$limit` of 21 that `runPage` appends (`:506`).

The tests do not weaken or remove any earlier assertions. They add regression coverage for CR-6 and CR-7, and they don't change any finding below.

## Disposition of earlier findings

- **CR-6 (P3), a text-mode Run refused for a parse error kept the earlier result and run error. Resolved.** `run()` now clears `runError` and `result` when `applyText()` fails, and adds no second message (`aggregation-view.ts:465-470`). The text error stays as the only message (`agg-text-error`, `role="alert"`). This matches the stage-mode path through `failRun`. Two tests cover it:
  - "a Run refused for a full-text parse error clears the earlier result and run error" (`aggregation-view.spec.ts:1082`) covers both an earlier result and an earlier run error.
  - The new 14aed95 test checks that nothing is sent and that the text and stages are kept.

  An in-flight run cannot overwrite the cleared state afterwards: while `running()` is true, the Run button is replaced by Cancel (`aggregation-view.html:26-32`), and Prev/Next are disabled.
- **CR-7 (P3), the live region was created together with its text. Resolved.** Each `agg-stage-preview` now starts with a persistent `<p class="sr-only" data-testid="agg-preview-live" aria-live="polite">`, outside the `@if`/`@switch` (`aggregation-view.html:153-155`). Its text comes from `previewStatus(id)` (`aggregation-view.ts:440-446`). The document list and the visible count are no longer live. Two tests cover it:
  - The test at `aggregation-view.spec.ts:1241` checks that the element stays the same across the loading, ok and error states, and checks its text in each.
  - The new 14aed95 test checks the text for disabled, invalid and `$out`/`$merge` stages.

  The `.sr-only` rule copies the per-component pattern used elsewhere in the renderer and has no color literals. `.preview` got `position: relative` to contain it.
- CR-1 to CR-5 (round 1) were confirmed resolved in round 2. The code they changed was not altered after that, apart from the CR-6 lines in `run()`.

Checked across the whole task with no findings:
- Acceptance criterion 1 (e2e demo step 8): `test/e2e/aggregation.e2e.ts` opens the builder from the collection tab and builds `$match` → `$group` → `$sort`. It checks a preview count and documents per stage, and that a syntax error blocks only that stage. It runs the pipeline and compares the result with the driver's `aggregate`, then exports as shell and as Node (with the profile URI). The test ids it uses (`agg-preview-count`, `agg-preview-doc`, `agg-stage-error`, `agg-preview-blocked`, `agg-result-doc`, `agg-code`, `agg-lang-node`) are all still rendered at HEAD. The visible count keeps `data-testid="agg-preview-count"` inside `@case ('ok')`.
- Acceptance criterion 2 (component tests): "reordering stages changes the pipeline that runs and the previews" and "a disabled stage is left out of the pipeline and of later previews" cover reorder and disable. "a syntax error blocks the preview of that stage only" checks that the earlier stage is not re-previewed and that the later stage is previewed without the broken stage.
- Safety: `$out`/`$merge` runs go through `WriteGuard.approve` with `alwaysConfirm`. Create view goes through `WriteGuard.run` and refuses `$out`/`$merge`. Both Create view buttons have `appWriteControl`. The text is parsed with core's shell-syntax parser, never `eval`. Documents are rendered with text interpolation only, with no `innerHTML`.
- Integration: the `aggregation` tab kind is registered (`app.config.ts`), and `TabKind` is extended. The sidebar closes aggregation tabs on drop/rename (`sidebar-tree.service.ts:448`). Core exports `./codegen`. The ARCHITECTURE "Aggregation builder" section matches the code (debounce of 400 ms, 20 per page plus 1, `alwaysConfirm`, `saved-pipelines` split out).
- Async ordering: previews abort older runs per stage, and only the run's own `previewRuns` entry is deleted on failure. `runPage` cancels the earlier stream before it starts. Paging uses the stored pipeline and target.
- Theme: the aggregation CSS has no hex, `rgb()` or `hsl()` color literals.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

The parent has deferred CR-8 and CR-9 to a follow-up task. They stay listed here as open.

- [ ] **CR-8 | The per-stage live regions announce downstream reloads without naming the stage**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.ts:440-446` (template `aggregation-view.html:153-155`)
    - Category: Quality (accessibility)
    - Problem: Each stage has its own polite live region. An edit to stage k changes the preview key of every later enabled stage (`previewPlans`, `:159-180`), so each of those stages moves to `loading` and then to `ok` or `error`. Each change updates its live region. After a pause in typing in stage 1 of a three-stage pipeline, a screen reader can therefore queue up to six messages, for example "Loading preview…" three times, then "20 documents from a sample", "5 documents from a sample" and "5 documents from a sample". None of them says which stage it belongs to, so the listener cannot tell which count belongs to which stage.
    - Why it matters: CR-7 fixed whether the count is announced. The announcements are now frequent and give no stage context, which reduces their value for the a11y goal of CR-5 and CR-7. No functional impact.
    - Suggested fix: Prefix the status with the stage number ("Stage 2: 5 documents from a sample"), and consider leaving the loading state empty instead of "Loading preview…", so that only results and errors are announced. Update the live-region tests (`aggregation-view.spec.ts:1241` and the 14aed95 test) to expect the prefix.

- [ ] **CR-9 | In full-text mode, Run and Create view send preview requests whose results are never shown**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.ts:255-259`, `:348`
    - Category: Quality (resource use)
    - Problem: The preview effect runs in both modes. In text mode, `run()` and `createView()` call `applyText()`, which replaces every stage with a fresh id (`this.nextId++`, `:348`). The next scheduling pass then sees only new ids and sends one `agg.previewStage` per enabled, valid, non-writing stage. The stage list is not rendered in text mode, so these results are not shown. When the user returns to the stage list, `setMode('stages')` calls `applyText()` again with new ids. The text-mode results are then filtered out and every preview is requested again. Each Run in text mode therefore costs N hidden sample aggregations on the server.
    - Why it matters: These are wasted server round trips (each samples 100 documents) on every Run or Create view in text mode. This is small per call but grows with the pipeline length. With a slow or busy server, they also compete with the Run itself. Not a correctness problem.
    - Suggested fix: Skip scheduling previews while `mode() === 'text'`: read `mode()` in the effect and return early, after aborting the runs in flight. Alternatively, keep the existing ids in `applyText()` when the stage count is unchanged. Add a test that counts `agg.previewStage` requests across a text-mode Run.

## Review conclusion

No material issues found. CR-6 and CR-7 from round 2 are resolved, with tests that check the behavior. The spec-only delta in 14aed95 adds valid regression tests and changes no production code. Both acceptance criteria have matching tests in the committed code. Two P3 follow-ups remain open, and the parent has deferred both to a follow-up task: CR-8 (the live-region announcements give no stage context) and CR-9 (hidden preview requests in text mode). Neither blocks completion.

Note for the parent: `tasks/agg-ui.md` showed no recorded evidence for either criterion at review time. Criterion 1 needs `npm run test:e2e` (aggregation) run against the final code. The round-2 fix report says e2e was not re-run after 142f443. The code changes since then should not affect the e2e selectors.
