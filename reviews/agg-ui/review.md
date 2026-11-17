# Code Review

Date: 2026-11-17

Task: agg-ui (M3: Aggregation pipeline builder)

Scope: `git diff e08080a..HEAD`, excluding `tasks/` changes. Committed changes only. Production code was reviewed first because test-writer may be adding tests in the same folder at the same time.

Requirements:
- tasks/agg-ui.md acceptance criteria and recorded assumptions
- SPEC.md M3 and demo step 8
- docs/ARCHITECTURE.md "Aggregation builder" and "Write safety in the renderer"
- AGENTS.md project notes, which require theme tokens only, no secrets and no eval
- Parent instructions: write safety, accessibility, races in previews and Run, and whether the core codegen import is renderer-safe

Git range:
- Branch: main
- HEAD: 1d21e962c97222111dbd8fc9c5b57351b81c86ba
- Base/start: e08080a659e944cf9af39b5c463e389a224d9481
- Commits reviewed: 6 (c2d00c8, d5eb68f, 871b7d7, 695dcaa, 1a06ba6, 1d21e96)

Summary: 0 P0, 1 P1, 1 P2, 3 P3

Checked with no findings:
- No eval. `parseStage` and `parsePipeline` use core's `parseShellSyntax`.
- Codegen import is renderer-safe. `@thicket/core/codegen` (`src/codegen/*`) imports only `../bson/*`, `../shellsyntax` and local modules. It has no Node built-ins.
- Theme tokens only. No hex, rgb, hsl or named colors appear in `aggregation-view.css`. The only literal values are `transparent` and `currentColor`.
- `$out`/`$merge` ask first. They use `WriteGuard.approve` with `alwaysConfirm`, and the stream is sent with `confirmed: true`. They are excluded from previews.
- `agg.createView` goes through `WriteGuard.run`.
- Contract fields match `packages/contract/src/agg.ts`.
- When a stage's preview plan changes, the older request is aborted, and aborted results are dropped.
- Drop and rename close aggregation tabs.

Acceptance criteria evidence: both criteria are still unverified in `python tasks.py verify agg-ui`. The parent must record them before `done`. The e2e test (`test/e2e/aggregation.e2e.ts`) and the component tests (`aggregation-view.spec.ts`: reorder, disable and syntax-error cases) cover the criteria in substance.

## P0 Critical

None.

## P1 High

- [ ] **CR-1 | In full-text mode, Create view and Export use the stage list from before the text was edited**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.ts:506` (`createView`), `:201` (`code`), `:307` (`editText`)
    - Category: Correctness
    - Problem: `editText` updates only the `text` signal. `stages()` changes only when `applyText()` runs. `run()` calls `applyText()` first (line 399), but `createView()` and the `code` computed do not. Both read `this.pipeline()`, which is built from `stages()`. The Export and Create view panels stay visible in text mode (they are outside the `@if (mode() === 'stages')` block in the template). As a result, after editing the full text:
        - Export shows and copies code for the earlier pipeline.
        - Create view sends `agg.createView` with the earlier pipeline. On a non-production profile, `WriteGuard` sends it with no dialog, so the user never sees the pipeline that is written.
    - Why it matters: A write (the view definition) is created with a pipeline other than the one on screen, with no prompt to catch it. Exported code also silently does not match the text.
    - Suggested fix: Use one rule for every action. In text mode, `createView` should call `applyText()` first and stop if it fails, as `run()` does. The `code` computed should parse `text()` in text mode, for example from a `parsePipeline(text())`-based computed, or show "apply the text first". Add a component test that edits the text and then exports or creates a view.

## P2 Medium

- [ ] **CR-2 | No component test for Export or Create view in full-text mode, or for out-of-order preview responses**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`
    - Category: Tests
    - Problem: The spec covers export and create view only in stage mode, which is how CR-1 went unnoticed. No test resolves an older `agg.previewStage` after a newer one to show that the aborted result is dropped. The abort guard at `aggregation-view.ts:370`/`:373` is untested.
    - Why it matters: Both are regression-prone paths that the parent explicitly asked about (races, write safety).
    - Suggested fix: Add a test that edits the text and then runs Export and Create view, checking the sent `pipeline`. Add a test with two deferred preview responses for the same stage, resolved out of order, checking that only the newer result is shown.

## P3 Low

- [ ] **CR-3 | A failed preview cannot be retried without changing the pipeline**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.ts:343`, `:372-375`
    - Category: Correctness
    - Problem: Entries in `previewRuns` are never removed after a request finishes. If the request fails (for example a timeout or a lost connection), later scheduling skips the stage because `previewRuns.get(id)?.key === key`. The error stays until the stage's prefix text changes, and the template has no retry control.
    - Why it matters: A transient error leaves a preview stuck with no way to recover except editing the stage.
    - Suggested fix: Remove the `previewRuns` entry (or its key) when a request fails, so the next scheduling pass tries again. Alternatively, add a "Retry" button next to `agg-preview-error`.

- [ ] **CR-4 | Next and Previous run the current, possibly edited pipeline with the old page number, and old results stay visible after a Run error**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.ts:398-451`, `aggregation-view.html:330`/`:341`
    - Category: Correctness
    - Problem: The pager calls `run(r.page ± 1)`, which reads `this.pipeline()` at click time. If the user edits stages after a Run, "Next" shows page 2 of a different pipeline. `resultRange()` then shows "21–40", which looks like a continuation of the earlier run. When a run fails, `runError` is set but `result` keeps the previous result, so an error and unrelated documents appear together.
    - Why it matters: The results can be misleading. No data is affected.
    - Suggested fix: Keep the pipeline used by the last Run with its result and page through that pipeline. Alternatively, reset to page 0 or clear `result` when the pipeline changes. Clear `result` when a run fails.

- [ ] **CR-5 | Each preview region is `aria-live`, so screen readers read out whole documents on every update**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.html:157`
    - Category: Quality (accessibility)
    - Problem: The whole preview container of every stage, including up to 20 `<pre>` documents, has `aria-live="polite"`. One edit to stage 1 re-runs the previews of all later stages. Each region then announces "Loading preview…" followed by every document. The stage error (`role="alert"`, line 149) also re-announces on each keystroke while the text stays invalid.
    - Why it matters: Screen-reader users get long, repeated announcements while typing.
    - Suggested fix: Make only the count line (`agg-preview-count`) or the error line live, not the document list. Consider `aria-live="polite"` instead of `role="alert"` for errors that change while the user types.

## Review conclusion

Material issues found; fix before completing the task.
