# Code Review

Date: 2026-11-17

Task: doc-edit-save - M1: Edit session and explicit save

Scope: `git diff 012dcc2..5a439fe -- packages test` (task commits 4e3a1a3, 2c5e2f1, 5a439fe). Committed production code at 5a439fe and the tests committed there. An untracked `edit-session.spec.ts` from the concurrent test-writer was not reviewed.

Requirements:
- tasks/doc-edit-save.md (acceptance criteria and ASSUMPTION notes)
- SPEC.md M1 "Editing and saving" and "Safety"
- docs/ARCHITECTURE.md "Collection tab" and "Write safety in the renderer"
- AGENTS.md, docs/QUALITY.md
- Out of scope (later tasks): tasks/conflict-ui.md, tasks/undo-last-save.md, tasks/multi-doc-edit.md

Git range:
- Branch: main
- HEAD: 5a439feb8de6e41f26b31626609e3fb34aa86725
- Base/start: 012dcc23789dcf24427a1648cb38503ba4c65431
- Commits reviewed: 3

Commands run (read-only):
- `git log`, `git diff --stat 012dcc2..5a439fe`, `git diff 012dcc2..5a439fe -- packages/renderer/src/app/collection packages/core`
- Read in full: `packages/renderer/src/app/document/{edit-session,document-actions.service,edit-bar,document-header,draft-documents}.ts`, `document-editing.spec.ts`, `test/e2e/document-edit.e2e.ts`
- Context: `packages/core/src/diff/diff.ts`, `packages/contract/src/docs.ts`, `packages/backend/src/docs/write/write.ts` (`replaceDocument`), explorer `json-explorer`, `json-form` (`moveField`, `addEntry`), `json-table` (`addItem`, `onItemDelete`), `bson-input` (commit on Enter/blur), `edit-mode.service.ts`, `layout/app-shell.ts` (global keys)
- No tests were run by the reviewer. The implementer reports the e2e run as 3 passed against a MongoDB container.

Summary: 1 P0, 0 P1, 3 P2, 2 P3

## P0 Critical

- [ ] **CR-1 | Saving a replace-type diff while a projection is active deletes the fields that were not projected**
    - File: `packages/renderer/src/app/document/document-actions.service.ts:122`
    - Category: Correctness
    - Problem: Documents are loaded with the query's projection (`collection-view.ts:254`), so `entry.original` and `entry.current` hold only the projected fields. `diffDocuments` returns `kind: 'replace'` in these cases: a top-level field is moved (the json-form "Move up/down" buttons, `json-form.component.ts:349`), a top-level key that cannot be used as a path is added (for example `a.b`, which `addEntry` allows), or the document has repeated keys. The save code then sends `docs.replace` with `doc` set to the projected document. `expected` only checks the changed fields, or for a pure reorder the projected fields, and those still match on the server. The backend's `replaceDocument` (`write.ts:258-268`) then runs `replaceOne` and overwrites the stored document, so every field the projection excluded is deleted on the server. On a non-production profile there is no confirm dialog first.
    - Why it matters: A normal action (moving a field up while a projection such as `{name: 1}` is set) can silently delete server data that the user never saw.
    - Suggested fix: Do not offer a whole-document replace for documents loaded with a projection. Either refuse the save with a clear message ("Reordering top-level fields needs the full document: clear the projection"), or load the full document with `docs.get` without a projection and build the replacement from it. Add a test for each case: projection plus replace is refused, and the plain replace path sends `docs.replace`.

## P1 High

None.

## P2 Medium

- [ ] **CR-2 | Edits made while a save is running are dropped, and the page briefly shows the pre-save version**
    - File: `packages/renderer/src/app/document/document-actions.service.ts:129`
    - Category: Correctness
    - Problem: `save()` takes a snapshot of the diff, waits for `docs.update`, then calls `this.edits.discard(key)`, which deletes the entry along with any edits made while the request was running. During the save, only the buttons and the undo keys are disabled; the `app-json-form` and the table stay editable (outside the production dialog, where the window is inert). After the discard, the page still holds the old loaded text until `readBack` finishes (`documentChanged` is only called after `docs.get`), so `shownDocs` shows the pre-save values. An edit made in that window uses the stale version as its `original`, and its next save fails with a false "changed on the server" conflict.
    - Why it matters: Unsaved edits are lost without notice, and a slow `docs.get` shows the old values under a "Saved" message.
    - Suggested fix: Before discarding, patch the shown document with the saved version (`host.documentChanged(key, stringifyEJson(entry.current))`), then read it back. Discard only when `edits.get(key)?.current` is still the saved snapshot. Otherwise rebase the remaining edits onto the saved version. Alternatively, make the document's form read-only while its key is busy.

- [ ] **CR-3 | Ctrl+S in a field saves without the value being typed**
    - File: `packages/renderer/src/app/document/edit-bar.ts:172`
    - Category: Correctness
    - Problem: `handleEditKeys` handles `s` before it checks for text fields, so Ctrl+S runs while focus is still in a `bson-input`. Those inputs apply their value only on Enter or blur (`bson-input.component.ts:40`), so the save leaves out the value shown in the field. When that value is the only edit, `edits.modified()` is false and nothing is saved at all. The value is applied later on blur as a new edit.
    - Why it matters: The user sees a value in the field, presses the documented Save shortcut, and that value is not saved.
    - Suggested fix: Before saving, commit the focused input: call `blur()` on `document.activeElement` when it is a text field inside the view (as the explorer's Enter does), then run `saveAll` on the next tick. Add a test that types into a field and presses Ctrl+S without blurring.

- [ ] **CR-4 | Row add and row delete in the table view have no tests**
    - File: `packages/renderer/src/app/collection/collection-view.ts:321`
    - Category: Tests
    - Problem: `tableChanged` works out the change from the length difference and element identity of the trees. A row whose tree differs is an edit, an added row becomes a draft (`cloneDocument`), and a removed row runs `delete` with the confirm dialog. It also depends on `treeOf`'s WeakMap returning the same tree for unchanged documents. `document-editing.spec.ts` only covers the document list view. None of the table paths is tested: cell edit, row add to draft, row delete with confirm, and row delete cancelled with the row still shown.
    - Why it matters: The task's assumption names these table behaviors, and identity-based detection breaks quietly when the explorer or `docs()` recomputation changes.
    - Suggested fix: Add component tests that drive the root `app-json-table` in edit mode: edit a cell (one `docs.update` with the right `_id`), add a row (a draft appears with a new ObjectId), and delete a row (delete only after confirm; the row stays when cancelled).

## P3 Low

- [ ] **CR-5 | Failed deletes and inserts are reported as "Not saved: ..."**
    - File: `packages/renderer/src/app/document/document-actions.service.ts:265`
    - Category: Quality
    - Problem: `failed()` puts "Not saved:" in front of every error, including those from `delete` and `insertDraft` (for example a duplicate-key insert or a delete refused by the server).
    - Why it matters: The message names the wrong action, which is confusing when a delete fails.
    - Suggested fix: Pass a verb or prefix to `write()`/`failed()` ("Not deleted", "Not inserted").

- [ ] **CR-6 | The read-only test checks a different EditModeService instance**
    - File: `packages/renderer/src/app/document/document-editing.spec.ts:364`
    - Category: Tests
    - Problem: `CollectionView` provides its own `EditModeService` (`collection-view.ts:91`), but the test checks `TestBed.inject(EditModeService).enabled()`, which is the root instance. That instance is never enabled, so the assertion always passes. The `afterEach` reset also targets the root instance. The DOM checks next to it (no inputs, disabled toggle) do test the behavior.
    - Why it matters: The assertion gives false confidence and would not catch a regression.
    - Suggested fix: Get the service from the view's injector (`fixture.debugElement.injector.get(EditModeService)`), or remove the assertion.

## Review conclusion

Material issues found; fix before completing the task.

CR-1 (data loss through `docs.replace` while a projection is active) must be fixed. The rest of the reviewed behavior matches the acceptance criteria and recorded assumptions:
- The `$set` diff and `expected` sent to `docs.update` are correct.
- Undo/redo, revert and the change count work as specified.
- Edits are keyed by `_id`.
- Every write goes through WriteGuard.
- Production profiles get the confirm dialog, and read-only profiles disable the write controls.
- The keyboard handler is scoped to each tab's own section.
