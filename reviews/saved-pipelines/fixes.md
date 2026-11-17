# Fix Report

Date: 2026-11-17

Task: saved-pipelines - M3: Save and reopen aggregation pipelines (pipelines.json)

Scope: findings CR-1, CR-2 and CR-3 of `reviews/saved-pipelines/review.md` (all P3), limited to the "Saved…" panel in `packages/renderer/src/app/aggregation/`.

## Fixed findings

### CR-1 — Panel messages and list errors from the previous collection stay visible after the tab's target changes

Files changed:
- `packages/renderer/src/app/aggregation/aggregation-view.ts`
- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`

Problem:
The target-change effect did not clear `savedListError` or `savedMessage`. A `pipelines.save`, `pipelines.rename` or `pipelines.delete` answer that arrived after the target changed still posted its message, set `savedName` and reloaded the list for the new collection. The "Replaced" wording was decided by name from a list that could still be unread (`null`).

Fix:
The target-change effect now also clears `savedListError` and `savedMessage`. `savePipeline`, `renameSaved` and `deleteSaved` capture the target before the request. After the await, on success and on failure, they return without changing the panel when `sameTarget(target)` is false. "Replaced" is now used only when the returned `saved.pipelineId` was already in the list before the save. Otherwise, including when the list was not read yet, the message says "Saved".

Validation:
- `npx ng test --include src/app/aggregation` (packages/renderer) — Pass (129 tests). New tests: "pointing the tab elsewhere clears the message and the list error of the previous collection", "a save, rename or delete answered after the tab points elsewhere leaves the new panel alone", "saving says "Saved" for a new pipeline and "Replaced" only for one already listed"

### CR-2 — Inline Rename and Delete lose keyboard focus, and Delete can be sent twice

Files changed:
- `packages/renderer/src/app/aggregation/aggregation-view.ts`
- `packages/renderer/src/app/aggregation/aggregation-view.html`
- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`

Problem:
"Rename" and "Delete…" swap the activated button for another control and focus was lost. The confirm Delete button (and the Rename submit) stayed enabled while the request ran, so a double click sent it twice.

Fix:
A private `savedFocus` signal names the control to focus (a `data-testid` inside the item marked with the new `data-pipeline-id` attribute, or anywhere in the panel). An `afterRenderEffect` focuses that control and falls back to the save name input when it is gone. This follows the pattern of `sidebar-tree.ts`. Focus behaviour:
- Rename moves focus to the rename input.
- Cancel and a successful rename return focus to the item's Rename button.
- A failed rename returns focus to the rename input.
- "Delete…" moves focus to the confirm Delete button.
- Keep returns focus to the item's "Delete…" button.
- A successful delete moves focus to the save name input.
- A failed delete returns focus to the confirm button.

The template handlers for these steps are now the methods `cancelRename`, `askDelete` and `cancelDelete`. A new `savedBusy` signal disables the confirm Delete and Rename submit buttons while their request runs. `renameSaved` and `deleteSaved` also ignore calls while it is set, which covers Enter in the rename field. `savedBusy` is reset in a `finally` block.

Validation:
- `npx ng test --include src/app/aggregation` (packages/renderer) — Pass. New tests: "Rename and Delete… move the focus to the control that replaces them, and back", "Delete and Rename are disabled while their request runs, so a second click sends nothing"

## Not fixed

### CR-3 — No component test for the stale-response guard on target change

Status:
Invalid (no longer valid)

Reason:
The test-writer already added "a list answer for the previous collection is ignored once the tab points elsewhere" (`aggregation-view.spec.ts`). It covers both a late success and a late failure of `pipelines.list`. This fix did not need any further change for CR-3.

## Validation summary

Focused tests:
- `npx ng test --include src/app/aggregation` (packages/renderer) — Pass, 2 files, 129 tests

Full test suite:
- `npm run check` (root) — Pass: vitest 77 files / 4198 tests; renderer `ng test` 98 files / 3237 tests

Lint/type-check/build:
- `npm run check` includes lint and type check (`tsc`, `ngc`) — Pass
- `npx prettier --write` on the three changed files — no changes needed

`.taskcheck`:
- Not run separately. It runs `npm run check`, which passed (see above).

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
