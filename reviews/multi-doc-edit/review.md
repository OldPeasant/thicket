# Code Review

Date: 2026-11-17

Task: multi-doc-edit - M1 (Should): Edit a field across selected rows

Scope: `git diff 2e67f6a1..9d8e036d` (committed changes only; the untracked spec file the test-writer is adding concurrently is not part of this review)

Requirements:
- tasks/multi-doc-edit.md (goal, 2 acceptance criteria, 3 ASSUMPTION lines)
- SPEC.md M1 "Editing and saving" (Should: edit several documents in the table view; Must: conflict detection) and "Safety"
- docs/ARCHITECTURE.md "Collection tab" and "Write safety in the renderer"
- AGENTS.md (quality gate, evidence rules)
- Existing conventions in DocumentActions / DocumentEdits / BulkPanel

Git range:
- Branch: main
- HEAD: 9d8e036d67ff134a3459beed84b8b5ce269e0798
- Base/start: 2e67f6a10c9f05790847ea154daee3dd1ceef52e
- Commits reviewed: 3 (020bb288, 06120087, 9d8e036d)

Summary: 0 P0, 1 P1, 3 P2, 2 P3

Verified as correct (no finding):
- Never sends without approval: `MultiEdit.save` only calls `docs.update` with the params `WriteGuard.approveAll` returns, and `approveAll` checks read-only first (`READ_ONLY`), drops any caller-supplied `confirmed`, always asks here (`alwaysConfirm: true`), and rejects with `CANCELLED` on cancel or abort. The dialog shows the document count (title, confirm label, detail) and the first 10 `updateOne` operations.
- Per-document conflict filter: each document gets `diffDocuments(loaded, edited)`, so the filter is `_id` plus the original value of the changed top-level field (`$exists: false` when it was absent), the same as a single Save. A conflict on one document does not stop the others; the e2e checks this against MongoDB.
- Interaction with DocumentEdits: a selected row with unsaved edits refuses the whole batch before anything is sent; `selectedDocs` uses the loaded documents, not the edited ones.
- Selection lifecycle: it is cleared when edit mode ends, the view leaves the table, the profile turns read-only, or the page's `_id` list changes (paging, a new query). A read-back after a save keeps the `_id` list, so the selection stays, as the assumption says.
- Double submit: `busy` is checked and set with no await in between, and the panel controls are disabled while busy.

## P0 Critical

None.

## P1 High

- [ ] **CR-1 | A document deleted on the server makes the whole batch result disappear**
    - File: `packages/renderer/src/app/collection/multi-edit/multi-edit.service.ts:166`, `packages/renderer/src/app/collection/collection-view.ts:432`, `packages/renderer/src/app/collection/collection-view.html:398`
    - Category: Correctness
    - Problem: When a selected document was deleted on the server (`CONFLICT` with `current: null`), `host.documentChanged(p.key, null)` makes `CollectionResults.patchDocument` remove that row from the page (`docs.splice`). That changes `pageKeys`, so the effect at collection-view.ts:432 clears the row selection. Then `selectedDocs().length` is 0, and the `@if` at collection-view.html:398 destroys `MultiEditPanel` while the panel is still awaiting `multi.save(...)`. The `MultiEditResult` is then written to a destroyed component and never shown. That result includes the saved count, the "deleted on the server" conflict entry the service builds for this case, other conflicts, and failures. Turning edit mode off during a save loses the result the same way.
    - Why it matters: Acceptance criterion 2 and the task goal require conflicting documents to be reported. A deleted document is the other kind of conflict, which the service tells apart on purpose (`'deleted on the server since it was loaded'`), but the user never sees that message, and the batch's whole outcome is lost too. The e2e only covers a document that was changed, not one that was deleted.
    - Suggested fix: Keep the last batch result outside the panel's lifetime, for example in a `MultiEdit` signal or in `CollectionView`, and show it even after the selection is cleared. Another option is to stop removing deleted rows until the batch ends, or to map the selection to `_id`s so removing a row doesn't clear it. Add a test (unit or e2e) where one selected document is deleted on the server before Save.

## P2 Medium

- [ ] **CR-2 | Under a projection, "remove" claims success without sending anything, and "set" always gives false conflicts**
    - File: `packages/renderer/src/app/collection/multi-edit/multi-edit.service.ts:99`, `packages/renderer/src/app/collection/multi-edit/multi-edit.service.ts:106`
    - Category: Correctness
    - Problem: For partial documents (`isPartial` is true whenever a projection is set), only dotted paths are refused. With a projection that hides a top-level field, for example `{name: 1}`, the user can type a field that isn't loaded:
      - "remove status": the loaded document lacks `status`, so `planFieldEdit` returns `unchanged`. Nothing is sent, and the panel says "Saved 0 documents. N already had this value." The server documents still have `status`.
      - "set status": the diff's `expected` is `{status: {$exists: false}}`. Every document that has `status` on the server fails as "changed on the server since it was loaded", and that keeps happening every time the user retries.
      The same false conflict happens when a top-level set targets a long array that was loaded cut (`expected` is the cut array). Single-document Save avoids these cases because the user can only edit what is loaded, and `overwritesHiddenData`/`unsetsUnloaded` refuse the rest.
    - Why it matters: The UI says a removal worked when nothing changed. Conflict reports that aren't real undermine the conflict reporting this task adds. The third ASSUMPTION ("partly loaded rows allow top-level fields only") doesn't cover a top-level field the projection hides.
    - Suggested fix: For a partial document, refuse the batch (or that document) when the top-level field on the path isn't in the loaded document, or when it is a cut array. Use a message like the existing `PROJECTION_REFUSED`/`PARTIAL_REFUSED` ones. Add a unit test for both actions under a projection.

- [ ] **CR-3 | "Select all rows" also selects rows hidden by the explorer search or on other explorer pages**
    - File: `packages/renderer/src/app/explorer/json-table/json-table.component.ts:101`, `packages/renderer/src/app/explorer/json-table/json-table.component.ts:111`
    - Category: Correctness
    - Problem: `selectAllRows` calls `setAll(this.arr.length, ...)`, and `allRowsSelected`/`someRowsSelected` compare with `arr.length`. The table only shows `visibleArrayIndices`, which the explorer's "Search names and values" box filters, and which is paged at `nestedPageSize` (default 100) while the collection page size can be 500. So after searching for 3 matching rows and clicking the header checkbox, every document on the page is selected, including ones the user can't see. Rows selected earlier also stay selected after the search hides them.
    - Why it matters: A batch write can update documents the user didn't see when selecting. The count in the panel and in the confirm dialog makes this visible, but it is easy to miss, and it doesn't match what the header checkbox appears to do.
    - Suggested fix: Make select-all, and its checked/indeterminate state, work on the visible rows (`visibleArrayIndices`, or at least the filtered indices). Alternatively, say in the panel how many selected rows are hidden. Add a test.

- [ ] **CR-4 | No unit tests for the new safety-relevant code in the reviewed commits**
    - File: `packages/renderer/src/app/safety/write-guard.service.ts:128`, `packages/renderer/src/app/collection/multi-edit/multi-edit.service.ts`, `packages/renderer/src/app/explorer/services/row-selection.service.ts`
    - Category: Tests
    - Problem: The range adds no spec files. `WriteGuard.approveAll` has no tests for its safety checks: read-only refusal before any dialog, a mixed-profile batch, a dropped caller `confirmed`, cancel and abort, more than `BATCH_SHOWN` operations, and confirmation on production versus non-production profiles. `MultiEdit.save` has no tests for refusing unsaved edits or partial nested paths, the invalid/unchanged paths, a deleted-document conflict, or non-conflict failures. The selection-clearing effects have no tests either. The two e2e tests cover only the happy path and a changed-document conflict.
    - Why it matters: `approveAll` is a new way past the write guard. A regression there could send writes without confirmation or on read-only profiles. CR-1 and CR-2 are the kind of gaps that unit tests would have found.
    - Suggested fix: Add `write-guard.service.spec.ts` cases for `approveAll`, a `multi-edit.service.spec.ts` with a stubbed `ApiService`/`ConfirmService`, and a test for the selection lifecycle. The test-writer may already be adding some of these, but at the reviewed HEAD none exist.

## P3 Low

- [ ] **CR-5 | The batch result live region is created along with its content**
    - File: `packages/renderer/src/app/collection/multi-edit/multi-edit-panel.html:68`
    - Category: Quality
    - Problem: The `role="status"` container exists only while `result()` is set, and `save()` resets `result` to `null` first. Screen readers often don't announce a live region that is added to the DOM together with its text, so the "Saved N documents / M not saved" outcome may not be read out. `BulkPanel` keeps its `role="status"` element in the DOM all the time (bulk-panel.html:77).
    - Why it matters: Accessibility. Screen reader users may not hear the outcome of the batch save.
    - Suggested fix: Keep the `role="status"` container in the DOM all the time, empty while there is no result, and render only the summary inside it.

- [ ] **CR-6 | docs/ARCHITECTURE.md doesn't describe `WriteGuard.approveAll` or the multi-row edit**
    - File: `docs/ARCHITECTURE.md:727`
    - Category: Quality
    - Problem: "Write safety in the renderer" says every write UI uses `WriteGuard.run` or `approve()`. It doesn't mention the new `approveAll` (one dialog for a batch, the first `BATCH_SHOWN` operations listed, sent without a cancel signal after confirmation). The bulk panel has its own paragraph there; the row selection (`RowSelectionService`, root table only, enabled in edit mode on writable profiles, cleared on a page change) and `collection/multi-edit` have none.
    - Why it matters: The next agent who adds a batch write, or changes the explorer table, has no documented contract to follow.
    - Suggested fix: Add one short paragraph to "Write safety in the renderer" (`approveAll`) and one to "Collection tab" (row selection and multi-edit, e2e `test/e2e/multi-edit.e2e.ts`).

## Review conclusion

Material issues found; fix before completing the task.
