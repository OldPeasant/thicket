# Fix Report

Date: 2026-11-17

Task: multi-doc-edit - M1 (Should): Edit a field across selected rows

Scope: current task. Findings CR-1 / TW-1, CR-2, CR-3, CR-5 and CR-6 from `reviews/multi-doc-edit/review.md` and `reviews/multi-doc-edit/tests.md`, passed on by the parent worker. Base: the working tree at `cadda676`. Nothing is committed.

## Fixed findings

### CR-1 / TW-1 - The batch result disappears when a conflicting document was deleted on the server

Files changed:
- `packages/renderer/src/app/collection/multi-edit/multi-edit.service.ts`
- `packages/renderer/src/app/collection/multi-edit/multi-edit-panel.ts`
- `packages/renderer/src/app/collection/multi-edit/multi-edit-panel.html`
- `packages/renderer/src/app/collection/collection-view.ts`
- `packages/renderer/src/app/collection/collection-view.html`
- `packages/renderer/src/app/explorer/services/row-selection.service.ts`
- tests: `multi-edit-selection.spec.ts`, `multi-edit.service.spec.ts`, `row-selection.service.spec.ts`

Problem:
`documentChanged(key, null)` removed the row from the page. That changed the page's `_id` list, so the selection was cleared and the `@if` destroyed `MultiEditPanel` during the save. The batch report was lost with it. The summary also said "changed on the server" for deleted documents.

Fix:
- `MultiEdit` now keeps the last report in a `result` signal, with `clearResult()`. `save()` clears the report when a batch starts and sets it when the batch ends. The panel reads the report from there, so the report outlives the panel's own state.
- `CollectionView.showMultiEdit` shows the panel in any of these cases:
  - rows are selected (as before);
  - `MultiEdit.busy()` is true;
  - a report exists.
- When a row is deleted from the page (`documentChanged(key, null)`), the selection moves with the rows instead of being cleared. The new `RowSelectionService.removeRow(index)` unselects that row and moves the rows below it up one. The page's `_id` baseline is updated at the same moment, so the page-change effect doesn't treat the deletion as paging. This avoids the index-shift problem that TW-1 describes.
- These still clear the selection and the report, through the new `endSelection()`:
  - paging or a new query (a different `_id` list);
  - leaving edit mode, switching views, or a read-only profile.
  
  A report is not cleared while a batch is still running.
- "Clear selection" clears both. When no row is selected, the button reads "Close" and Save is disabled ("No rows selected").
- Conflicts carry `deleted: true` when the document was deleted. The summary now reports the two kinds separately:
  - "N not saved: changed on the server since they were loaded (reloaded, …)";
  - "M not saved: deleted on the server since they were loaded (removed from the page)".

Validation:
- The failing test `a conflicting document deleted on the server is still reported after the batch` now passes. It is unchanged except for added assertions: the summary wording, and that the 2 remaining rows stay selected.
- New tests:
  - `when every selected row was deleted on the server the report stays until closed`;
  - `a page with other documents also ends the report of the last batch`;
  - `keeps the last result until clearResult or the next batch` (service);
  - `removeRow …` (RowSelectionService).
- The service test for a deleted document now also expects `deleted: true` and `multi.result()`.
- `cd packages/renderer && npx ng test --include='src/app/collection/multi-edit/**/*.spec.ts' --include='src/app/safety/write-guard.service.spec.ts' --include='src/app/explorer/services/row-selection.service.spec.ts'` - Pass (118 tests)

### CR-2 - Partly loaded rows: "remove" claims success, "set" always conflicts

Files changed:
- `packages/renderer/src/app/collection/multi-edit/multi-edit.service.ts`
- tests: `multi-edit.service.spec.ts`, `multi-edit-selection.spec.ts`

Problem:
Under a projection, a top-level field the loaded row lacks may only be hidden by the projection. "remove" then counted the row as unchanged and sent nothing. "set" used `$exists: false` as the conflict filter, so every such row conflicted. A top-level cut array also always conflicted.

Fix:
A new `partialRefusal()` runs for partial rows, after the existing check that refuses nested paths. It refuses the whole batch before any dialog in two cases:
- the query has a projection and the loaded document has no top-level field with that name. Message: "<_id> was loaded only partly: <field> isn't loaded, clear the projection to change it across rows."
- the field is, or contains, a cut array (`host.slicedOf(key).arrays`). Message: "<_id> was loaded only partly: <field> was loaded cut (a long array), open the document to change it."

Top-level fields that are loaded whole work as before.

Design note for the parent: the "field is missing" refusal applies only when a projection is set. A row that is partial only because of cut arrays was loaded whole apart from those arrays, so a missing field there really is missing, and setting it stays allowed (a test covers this). This is narrower than "any partial row", and it is deliberate: it avoids refusing legitimate adds. You may want to record it as an assumption.

Validation:
- New tests:
  - `under a projection, a top-level field the loaded row lacks is refused (set and remove)`;
  - `a top-level field that is a cut array is refused; other fields of the row are fine` (service);
  - the projection view test now also checks the refusal for an unloaded `priority`.
- Focused command above - Pass

### CR-3 - "Select all rows" selected rows hidden by the search or on other explorer pages

Files changed:
- `packages/renderer/src/app/explorer/services/row-selection.service.ts`
- `packages/renderer/src/app/explorer/json-table/json-table.component.ts`
- tests: `row-selection.service.spec.ts`, `multi-edit-selection.spec.ts`

Problem:
Select-all and its checked/mixed state used `arr.length`, not the rows actually shown.

Fix:
- `RowSelectionService.setAll(indices, on)`: on selects exactly the given rows, so rows that are hidden are dropped. Off unselects only the given rows.
- The json-table passes `visibleArrayIndices`: the search filter and the current explorer page are both applied.
- The header box is checked only when every shown row is selected and no other row is. It is mixed when some rows are selected but not "all". A selected row that is hidden therefore shows as mixed.

Validation:
- New tests:
  - `select all takes only the rows the explorer search shows`;
  - `select all takes only the rows on the explorer page shown` (nested page size 2);
  - RowSelectionService tests for `setAll` on and off.
- Focused command above - Pass

### CR-5 - The batch result live region was created along with its content

Files changed:
- `packages/renderer/src/app/collection/multi-edit/multi-edit-panel.html`
- `packages/renderer/src/app/collection/multi-edit/multi-edit-panel.css`

Problem:
The `role="status"` element existed only while a result was shown.

Fix:
A `<div class="status" role="status">` is now always in the panel. The report (`multi-edit-result`) is rendered inside it. While the region is empty, `.status:empty` cancels the flex gap, so the empty region takes no space. It is not hidden, so screen readers still see it.

Validation:
- New test `the result live region is in the DOM before there is a result`: the same element later holds the summary.
- Focused command above - Pass

### CR-6 - docs/ARCHITECTURE.md didn't describe multi-edit / approveAll

Files changed:
- `docs/ARCHITECTURE.md`

Fix:
Added one bullet after "Bulk update/delete" in "Write safety in the renderer". It covers:
- the `RowSelectionService` checkbox column (table view, edit mode, writable profiles, select-all on the shown rows);
- when the selection is cleared or moved;
- the `MultiEditPanel` and `MultiEdit` refusals;
- `WriteGuard.approveAll`: one confirm, always asked, with the count and the first `BATCH_SHOWN` = 10 operations;
- one conflict-checked `docs.update` per document, sent in order without a cancel signal;
- how conflicts are listed and reloaded or removed;
- the report kept in `MultiEdit.result`;
- the e2e test `test/e2e/multi-edit.e2e.ts`.

Validation:
- `npm run check` (prettier --check covers the file) - Pass

## Not fixed

### CR-4 - No unit tests for the new safety-relevant code

Status:
Not fixed - finding no longer valid. Not in the list the parent passed on.

Reason:
The test-writer's specs at `cadda676` already cover what the finding asks for:
- `write-guard.service.spec.ts` for `approveAll`;
- `multi-edit.service.spec.ts`;
- `multi-edit-selection.spec.ts`;
- `row-selection.service.spec.ts`.

The tests listed above extend them for the fixes.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/collection/multi-edit/**/*.spec.ts' --include='src/app/safety/write-guard.service.spec.ts' --include='src/app/explorer/services/row-selection.service.spec.ts'` - Pass (5 files, 118 tests)
- `cd packages/renderer && npx ng test --include='src/app/collection/multi-edit/**/*.spec.ts'` - Pass (3 files, 70 tests, after the explorer-page test was added)

Full test suite:
- `npm run check` (repo root) - Pass:
  - eslint + prettier clean;
  - typecheck;
  - root vitest: 87 files, 4457 tests;
  - renderer ng test: 106 files, 3485 tests.
- `npm run test:e2e -- test/e2e/multi-edit.e2e.ts --output=/tmp/me-out` (rebuilds the renderer and the desktop app, then runs Playwright/Electron against the MongoDB container fixture) - Pass (2 passed)

Lint/type-check/build:
- Included in `npm run check` - Pass. The e2e command rebuilt the renderer and desktop app - Pass.

`.taskcheck`:
- Pass. `.taskcheck` runs `npm run check`, which passed (see above).

Coverage:
- Not re-measured by the fixer. The test-writer's coverage run needs repeating on the final code.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
