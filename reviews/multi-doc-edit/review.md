# Code Review

Date: 2026-11-17

Task: multi-doc-edit - M1 (Should): Edit a field across selected rows (round 2, on the fixed code)

Scope: `git diff 1602276b2f753f0f95f7d2bbc1eb75c845dd5e74..6bf4da7cd39c7fef3e3e283f8c0741c63540f663` (committed changes only; working tree clean). Reviewed revision: `6bf4da7cd39c7fef3e3e283f8c0741c63540f663`. The parent named the round-1 fix commit as 2cb13cce and the round-2 test commit as 2f1a3ac8. In the current history these are 20dfa5d9 and 6bf4da7c, and `git diff --stat` between each pair shows no change under `packages/`, `test/` or `docs/`, so this is the same code after a rebase.

Requirements:
- tasks/multi-doc-edit.md: goal, 2 acceptance criteria and 5 ASSUMPTION lines, including the CR-2 projection/cut-array rule and the sub-field projection note
- SPEC.md M1 "Editing and saving" (Should: edit several documents in the table view; confirm lists the document count) and "Safety"
- docs/ARCHITECTURE.md "Write safety in the renderer" (including the new multi-edit bullet) and "Collection tab"
- AGENTS.md (quality gate, evidence rules)
- reviews/multi-doc-edit/review.md (round 1), fixes.md, tests.md (round 2)

Git range:
- Branch: main
- HEAD: 6bf4da7cd39c7fef3e3e283f8c0741c63540f663
- Base/start: 1602276b2f753f0f95f7d2bbc1eb75c845dd5e74
- Commits reviewed: 6 task commits (0ce6dd9c, 7aaa7785, 0b2707b6, d22db389, 20dfa5d9, 6bf4da7c). The other commits in the range are heartbeat/assume commits for other tasks and touch only `tasks/`.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

Round-1 findings re-checked against the current code:
- CR-1 (report lost when a conflicting document was deleted): fixed. `MultiEdit` keeps the report in a `result` signal (multi-edit.service.ts:71-99). `CollectionView.showMultiEdit` keeps the panel while rows are selected, while a batch is busy, or while a report exists (collection-view.ts:267-271). `documentChanged(key, null)` calls `RowSelectionService.removeRow(index)` and sets `selectionKeys` from the fresh `pageKeys()` in the same step (collection-view.ts:682-693), so the page-change effect does not see a deleted row as paging. Deleted conflicts carry `deleted: true`, and the summary reports them separately. The backend sends `current: null` for a deleted document (contract `conflictDetail`). The e2e test `one document deleted on the server: …` checks this against MongoDB, including that the selection moves with the rows.
- CR-2 (projection/cut arrays): fixed as the 4th ASSUMPTION describes. `partialRefusal` (multi-edit.service.ts:243-257) refuses a top-level field that the loaded row lacks under a projection, and a cut array at or below the field (`a.path === top || a.path.startsWith(top + '.')`, matching the dotted `SlicedArray.path` contract). Rows that are partial only because of cut arrays may still set a field that is really missing. The sub-field-projection case that remains is recorded as an assumption, and it is safe: the conflict filter stops any overwrite.
- CR-3 (select-all): fixed. Select-all and its checked/mixed state use `visibleArrayIndices` (json-table.component.ts:101-116), which applies both the search filter and the explorer page window. `setAll(indices, true)` replaces the selection with exactly the rows shown.
- CR-4 (missing unit tests): resolved. Specs exist for `approveAll`, `MultiEdit`, `RowSelectionService`, the util and the view lifecycle. `ng test` on these 5 files passes with 125 tests (run during this review).
- CR-5 (live region): fixed. The `role="status"` container is always in the DOM (multi-edit-panel.html:68).
- CR-6 (docs): fixed. ARCHITECTURE.md has a new bullet that matches the implementation: `approveAll`, `BATCH_SHOWN` = 10, the selection lifecycle, the refusals, and that the report outlives the selection.

Regression checks on the fixes (no finding):
- Double submit: `MultiEdit.save` checks `busy`, and `run` sets it with no `await` in between. The panel's Save and Clear/Close buttons are disabled while busy, and Save is also disabled when `count() === 0`. A form submit with no rows is caught in `MultiEditPanel.save`.
- Batch running while the page changes or edit mode ends: `endSelection` clears the selection but keeps a running batch's report. A read-back or delete for a key that is no longer on the page is a no-op (`documentChanged` returns when the index is -1). The tests `leaving edit mode while the batch is sent …` and `a new page while the batch is sent …` cover this.
- A refused batch (an `Error` thrown before sending) leaves `result` at `null`, because `save` clears it first. A cancelled confirm is not shown as an error. `busy` is reset in `finally`.
- Single-document deletes through `DocumentActions` use the same `documentChanged`, so they now move the selection instead of clearing it. This is consistent with the new behavior and harmless.
- `approveAll` is unchanged since round 1: read-only is checked first, a caller-supplied `confirmed` is dropped, the confirm is always asked here, and cancel or abort throws `CANCELLED`.

Evidence note for the parent (not a finding): `python tasks.py verify multi-doc-edit` still shows both criteria unrecorded. The e2e runs in tests.md (Playwright/Electron against the MongoDB container fixture, 3 passed) are the evidence these criteria need. Record them before `done`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found.
