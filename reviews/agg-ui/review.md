# Code Review

Date: 2026-11-17

Task: agg-ui (M3: Aggregation pipeline builder). Second review round, on the final code after the fixes.

Scope: `git diff 8f353ab..HEAD`, excluding `tasks/` and `reviews/`. Committed changes only. This round focused on the fix commit 2b0cf0e (text-mode Export and Create view, preview retry, forgetting failed preview runs, paging of the remembered pipeline, a11y changes) and on how it interacts with the rest of the builder. Production code was the focus because test-writer may be editing spec files at the same time.

Requirements:
- tasks/agg-ui.md acceptance criteria and recorded assumptions
- SPEC.md M3 and demo step 8
- docs/ARCHITECTURE.md "Aggregation builder" and "Write safety in the renderer"
- AGENTS.md project notes (theme tokens only, no secrets, no eval)
- Earlier review (round 1, CR-1 to CR-5) and reviews/agg-ui/fixes.md
- Parent instructions for this round

Git range:
- Branch: main
- HEAD: 2b0cf0e0af11d41b630f7023f82c98c6d3eefe92
- Base/start: 8f353abe0a3372ad3e5add2a759591d3cc073684 (`git merge-base HEAD origin/main`)
- Commits reviewed: 8 (05546e1, 52fa993, 6d32586, 27f4f9e, 6802bb6, 8ac20ee, f3cfcf4, 2b0cf0e). Of these, 6d32586 and 27f4f9e touch only `tasks/`.
- Uncommitted changes: none at review time.

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## Disposition of earlier findings

- **CR-1 (P1), text mode: Create view and Export used the stale stage list. Resolved.** `createView()` now runs `applyText()` in text mode and stops if it fails (`aggregation-view.ts:586-589`). Then it reads `pipeline()`, so the view gets the text as typed. Export goes through the new `exportPipeline` computed (`:210-227`). In text mode it parses `text()` and skips disabled stages. If the text has an error, it shows that error, and Copy is disabled because `code().ok` is false. The `$out`/`$merge` refusal and `WriteGuard.run` still apply after the text is applied.
- **CR-2 (P2), tests missing. Resolved.** The spec has tests for text-mode Export and Create view. The out-of-order preview cases are under "preview requests in flight" (test-writer).
- **CR-3 (P3), a failed preview could not be retried. Resolved.** A failed preview that was not aborted deletes its own `previewRuns` entry. The check `previewRuns.get(id)?.abort.signal === signal` (`:421`) means a newer run is never removed. `retryPreview` (`:390-396`) uses `startPreview`, which aborts any run in flight before it starts a new one. A pending debounced pass then finds the same key and skips the stage, so no duplicate request is sent.
- **CR-4 (P3), paging used the edited pipeline, and old results stayed after errors. Resolved, with one gap (see CR-6).** The result now stores its `pipeline` and `target`. `turnPage` pages through those (`:457-461`), and `run()` always starts the current pipeline at page 0. The stream error, a refused approval and "Fix stage N first" now go through `failRun`, which clears `result`. A user cancel still leaves everything unchanged. `cancelRun()` at the start of `runPage` keeps an older stream from overwriting a newer one.
- **CR-5 (P3), the whole preview region was aria-live, and errors used `role="alert"`. Mostly resolved.** The document list is no longer announced, and stage errors are no longer alerts. However, the new live region on the count is likely not announced at all (see CR-7).

Checked this round with no findings:
- The fix commit changes only aggregation files. It adds no new API calls and changes no contract fields.
- Removing `ProfileSafetyService` and `readOnly` keeps read-only enforcement. `appWriteControl` stays on both Create view buttons, and `WriteGuard` still handles both writes.
- The CSS adds only `.retry { margin-left }`. It has no color literals.
- In text mode, a text that `parsePipeline` accepts can still fail `parseStage` only when a body is empty or an operator is invalid. `parsePipeline` rejects those inputs, so the vague "Fix stage N first" message in text mode cannot be reached in practice.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-6 | In text mode, a Run refused for a text parse error keeps the earlier result and any earlier run error**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.ts:447`
    - Category: Correctness
    - Problem: The CR-4 fix sends every refused or failed Run through `failRun`, which clears `result`. The one exception is the first line of `run()`: `if (this.mode() === 'text' && !this.applyText()) return;`. When the full text does not parse, Run returns early. `result` and `runError` are left unchanged. The text error appears under the text area, but the results of an earlier, different pipeline stay on screen, and so does an unrelated `agg-run-error` from an earlier failed run. For comparison, "Fix stage N first" in stage mode clears the earlier result.
    - Why it matters: Failed runs behave differently depending on the mode, which is the misleading state that CR-4 was meant to remove. No data is affected.
    - Suggested fix: When `applyText()` fails in `run()`, clear `result` and `runError`. Do not set a second message: the text error is already shown and announced. Alternatively, document that the earlier result stays. Add a test next to "a Run refused for a stage error clears the earlier result".

- [ ] **CR-7 | The new preview-count live region is created together with its text, so screen readers are unlikely to announce it**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.html:170`
    - Category: Quality (accessibility)
    - Problem: `aria-live="polite"` is now on `<p data-testid="agg-preview-count">`, which only exists inside `@case ('ok')`. Each preview first sets `state: 'loading'` (`aggregation-view.ts:404`), so Angular removes the paragraph and inserts a new one, live attribute and text included, when the result arrives. Screen readers generally announce changes only inside a live region that was already in the DOM. A region inserted together with its content is often not read (WAI-ARIA live-region guidance, MDN "ARIA live regions"). Before the fix, the live attribute sat on the persistent `agg-stage-preview` container. The new test (`aggregation-view.spec.ts:1083`) checks only that the attribute is present, not that the region persists.
    - Why it matters: The fix removed the noisy announcements but probably also removed the useful one, the preview count after an edit, which the parent asked about for a11y.
    - Suggested fix: Put a persistent, small live element in `agg-stage-preview` outside the `@switch`, for example a visually hidden `<p aria-live="polite">`. Fill it with the count, "Loading preview…" or the preview error text, and keep the document `<pre>` list outside it.

## Review conclusion

No material issues found. The earlier findings CR-1 to CR-5 are resolved in substance. Two P3 follow-ups remain: CR-6 (a text-mode Run with a parse error leaves the earlier result) and CR-7 (the live region is recreated on every preview). Neither blocks completion. The parent decides whether to fix them now or record them.
