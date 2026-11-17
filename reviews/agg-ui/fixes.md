# Fix Report

Date: 2026-11-17

Task: agg-ui - M3: Aggregation pipeline builder

Scope: current task. Findings CR-1 to CR-5 from `reviews/agg-ui/review.md` and observations 1 to 3
from `reviews/agg-ui/tests.md`, as approved by the parent worker. Production base: HEAD 0da8653
(uncommitted changes, not staged).

## Fixed findings

### CR-1 — In full-text mode, Create view and Export used the stage list from before the text edits

Files changed:
- `packages/renderer/src/app/aggregation/aggregation-view.ts`
- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`

Problem:
`editText` updated only the `text` signal. `createView()` and the `code` computed read
`pipeline()`, which is built from `stages()`. That signal changed only through `applyText()`, so
Export and Create view used the earlier pipeline without any warning.

Fix:
- `createView()` now calls `applyText()` first in text mode (after the name check), the same way
  `run()` does. If the text doesn't parse, the text error shows under the text area, the form shows
  "Fix the pipeline text first: it has an error.", and nothing is sent.
- A new `exportPipeline` computed feeds `code`. In stage mode it uses `pipeline()` as before. In text
  mode it parses `text()` with `parsePipeline` and skips disabled `//- ` stages. If the text fails to
  parse, it shows the parse message (in `agg-code-error`, with Copy disabled) instead of code. Export
  does not apply the text to the stage list.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/aggregation/**/*.spec.ts'` — Pass
  (new tests "Export follows the text as typed, without disabled stages, and shows its parse error"
  and "Create view applies the text first and refuses text that does not parse")

### CR-2 — Missing tests for Export or Create view in text mode and for out-of-order preview responses

Files changed:
- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`

Problem:
No test covered Export or Create view after editing the full text. The out-of-order preview test was
also listed as missing.

Fix:
Added the two text-mode tests (see CR-1). The out-of-order preview case was already covered by the
test-writer's tests in "preview requests in flight": "an aborted preview that answers after the newer
one does not overwrite it", plus the cases where the late answer arrives first or fails. No duplicate
was added.

Validation:
- same command as CR-1 — Pass

### CR-3 / test-writer observation 1 — A failed preview could not be retried until its prefix changed

Files changed:
- `packages/renderer/src/app/aggregation/aggregation-view.ts`
- `packages/renderer/src/app/aggregation/aggregation-view.html`
- `packages/renderer/src/app/aggregation/aggregation-view.css`
- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`

Problem:
`previewRuns` kept the key of a failed request, so later scheduling passes skipped that stage.

Fix:
- A preview that fails without being aborted now removes its own `previewRuns` entry. The check
  compares the signal, so a newer run is never removed. The next scheduling pass, which any edit
  triggers, asks again.
- The preview error has a small "Retry" button (`agg-preview-retry`, with aria-label "Retry the
  preview of stage N"). It calls the new `retryPreview(id)`, which re-requests that stage's current
  plan right away. To support this, the request start was extracted into `startPreview`, and the key
  into `previewKey()`.
- The only CSS added is a `.retry` margin. No colors were added.

Validation:
- New tests: "the Retry button asks for the preview again", "the next edit anywhere asks for a
  failed preview again", and "a successful preview is still not asked again by an unrelated edit" —
  Pass

### CR-4 / test-writer observation 2 — Prev/Next re-ran the edited pipeline at the old page, and old results stayed after a Run error

Files changed:
- `packages/renderer/src/app/aggregation/aggregation-view.ts`
- `packages/renderer/src/app/aggregation/aggregation-view.html`
- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`

Problem:
The pager called `run(page ± 1)`, which reads the current, possibly edited, pipeline. A failed run
kept showing the previous result.

Fix:
- The shown result now stores the pipeline (the parsed enabled stages, sent as EJSON) and the target
  that produced it.
- `run()` takes no arguments and always starts at page 0 with the current pipeline. The pager calls
  `turnPage(±1)`, which pages through the stored pipeline and target. Both use the private
  `runPage(pipeline, target, page)`.
- Run errors go through `failRun()`, which sets `runError` and clears `result`. This covers the
  stream error, a refused approval (for example READ_ONLY; a user cancel still shows nothing), and
  "Fix stage N first".

Validation:
- New tests: "Prev/Next page the pipeline that produced the result; Run starts the edited one at
  page 0", "a failed run clears the earlier result", and "a Run refused for a stage error clears the
  earlier result" — Pass

### CR-5 — The whole preview region was aria-live, and the stage error re-announced on each keystroke

Files changed:
- `packages/renderer/src/app/aggregation/aggregation-view.html`
- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`

Problem:
`aria-live="polite"` was set on the whole preview container, documents included. The per-stage error
had `role="alert"`.

Fix:
- Removed `aria-live` from `agg-stage-preview`. Only `agg-preview-count` is now a polite live region.
- Removed `role="alert"` from `agg-stage-error`. `aria-invalid` and `aria-describedby` on the textarea
  are kept.
- Test ids are unchanged, so the existing unit and e2e selectors still work.

Validation:
- New test "announces only the preview count, and does not re-announce stage errors while typing"
  — Pass. The existing test "a syntax error blocks the preview of that stage only", which checks
  aria-describedby and aria-invalid, still passes.

### Test-writer observation 3 — Unused `readOnly` computed

Files changed:
- `packages/renderer/src/app/aggregation/aggregation-view.ts`

Problem:
`AggregationView.readOnly` was never read. The template uses `appWriteControl` (checked with grep
over the template and the TS file).

Fix:
Removed the computed, plus the `ProfileSafetyService` injection and import, which only it used.
`WriteGuard` and `appWriteControl` still enforce read-only. The read-only tests pass.

Validation:
- same command as CR-1 — Pass; `npm run check` (type check) — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/aggregation/**/*.spec.ts'` — Pass (2 files,
  69 tests; 9 of them new)

Full test suite:
- `npm run check` (repository root) — Pass. Root Vitest: 55 files, 3264 tests. Renderer: 73 files,
  2094 tests.

Lint/type-check/build:
- Included in `npm run check` (eslint `--max-warnings 0`, `prettier --check`, typecheck of every
  workspace including the renderer specs) — Pass

`.taskcheck`:
- Pass. `.taskcheck` runs `npm run check`, which passed (above).

Not run: `npm run test:e2e -- aggregation`. The e2e test uses only test ids, and all of them are
unchanged.

Notes for the parent:
- The coverage numbers in `tests.md` are now stale because production code changed. A new
  test-writer and code-reviewer pass is needed on the final code.
- The new tests were not run against the pre-fix code here, because copying files outside the
  clone needs approval. They assert behavior and elements that did not exist before: the Retry
  button, the remembered pipeline sent by Next, text-mode Export output, and the absence of
  aria-live and role on the preview and the error.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

# Round 2

Date: 2026-11-17

Task: agg-ui (aggregation builder UI), second review round (`reviews/agg-ui/review.md`, CR-6 and CR-7)

Scope: the two approved P3 findings CR-6 and CR-7 of the current task

## Fixed findings

### CR-6 — In text mode, a Run refused for a text parse error keeps the earlier result and run error

Files changed:
- `packages/renderer/src/app/aggregation/aggregation-view.ts`
- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`

Problem:
`run()` returned early when `applyText()` failed. The result of an earlier, different pipeline and any
earlier `agg-run-error` stayed on screen, unlike every other refused or failed Run.

Fix:
When `applyText()` fails, `run()` now sets `runError` and `result` to `null` before it returns. It adds
no second message, because the text error under the text area is already shown. New spec test
"a Run refused for a full-text parse error clears the earlier result and run error", placed next to
"a Run refused for a stage error clears the earlier result". It covers both an earlier result and an
earlier run error.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/aggregation/**/*.spec.ts'` — Pass

### CR-7 — The preview-count live region is created together with its text

Files changed:
- `packages/renderer/src/app/aggregation/aggregation-view.html`
- `packages/renderer/src/app/aggregation/aggregation-view.ts`
- `packages/renderer/src/app/aggregation/aggregation-view.css`
- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`

Problem:
`aria-live="polite"` was on `agg-preview-count`, which exists only inside `@case ('ok')`. Each preview
goes through `loading`, so Angular recreated the region together with its text, and screen readers
usually do not announce that.

Fix:
- Each `agg-stage-preview` now starts with a persistent, visually hidden
  `<p class="sr-only" data-testid="agg-preview-live" aria-live="polite">`, placed outside the `@if`/`@switch`.
- Its text comes from the new `previewStatus(id)`. It holds the count ("N documents from a sample"),
  "Loading preview…" or "Preview failed: <message>". For stages without a preview (disabled, invalid,
  `$out`/`$merge`), the text is empty.
- The document `<pre>` list and the visible count are outside the live region.
- `aria-live` was removed from `agg-preview-count`.
- The visible count and the live text use the same new `countText(docs)` helper.
- No global visually-hidden class exists in the renderer. Components each define their own `.sr-only`
  (`sidebar-tree.css`, `tab-bar.css`, `connection-editor.css`). The same rule was copied into
  `aggregation-view.css`, and `.preview` got `position: relative` to contain it. There are no color
  literals.
- The spec test was renamed to "announces the preview status in a live region that persists across
  preview reloads". It checks:
  - there is exactly one live region per preview;
  - it contains no documents;
  - it is the same DOM element across the loading, ok (count) and error states of a reload;
  - its text in each of those states.
  The stage-error part of the old test is now its own test, "does not re-announce stage errors while
  typing", and is unchanged.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/aggregation/**/*.spec.ts'` — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/aggregation/**/*.spec.ts'` — Pass (2 files,
  78 tests)
- `npx eslint src/app/aggregation/` (renderer) — Pass. `npx prettier --check src/app/aggregation/` first
  reported formatting in the spec file. After `prettier --write` on that file, it passes.

Full test suite:
- `npm run check` (repository root) — Pass. Renderer: 74 files, 2243 tests.

Lint/type-check/build:
- Included in `npm run check` (eslint `--max-warnings 0`, `prettier --check`, typecheck) — Pass

`.taskcheck`:
- Pass. `.taskcheck` runs `npm run check`, which passed (above).

Not run: `npm run test:e2e`. No existing test id was changed or removed. The only new test id is
`agg-preview-live`.

Notes for the parent:
- Production code changed after the second review. A new test-writer and code-reviewer pass is
  needed on the final code.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
