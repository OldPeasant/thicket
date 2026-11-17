# Code Review

Date: 2026-11-17

Task: conflict-ui - M1: Conflict resolution view

Scope: committed changes `2a62fc45bc886a9153dc8258561d921c397d2606..8eab12704897517975b631f2ffee2d68bc8503a5`, excluding `tasks/` and `reviews/` (implementation, component tests and e2e, test-writer round 1 tests). No uncommitted changes.

Requirements:
- `tasks/conflict-ui.md` acceptance criteria and the two recorded assumptions in its Notes
- `SPEC.md` M1 "Conflict detection" (filter is `_id` plus the original values of changed top-level fields; reload the server version; side-by-side diff with overwrite / keep server version / merge manually), demo step 7
- `docs/ARCHITECTURE.md`, `docs/QUALITY.md`, `AGENTS.md`
- `reviews/conflict-ui/tests.md` (TW-1, O-1, O-2 validated independently below)

Git range:
- Branch: main
- HEAD: 8eab12704897517975b631f2ffee2d68bc8503a5
- Base/start: 2a62fc45bc886a9153dc8258561d921c397d2606
- Commits reviewed: 3 (98ddde5, cded8c1, 8eab127)

Summary: 0 P0, 1 P1, 2 P2, 3 P3

## P0 Critical

None.

## P1 High

- [ ] **CR-1 | Overwrite / merge under a nested (dotted) projection unsets hidden sub-fields**
    - File: `packages/renderer/src/app/document/document-actions.service.ts:240-250` (with `visibleFields` at `:417-420`, and the note in `packages/renderer/src/app/document/conflict/conflict-view.ts:58-63`)
    - Category: Correctness
    - Problem: With a projection active, `resolveWith` builds the baseline as `visibleFields(conflict.current, [original, local])`, which filters only top-level keys. The CONFLICT detail's `current` is the full server document (`packages/backend/src/docs/write/write.ts` `currentDocument`, no projection). With a dotted projection such as `{"addr.city": 1}` (a case the existing save tests use, `document-actions.service.spec.ts:250`), the loaded document has `addr: {city}` while the baseline keeps the full server `addr: {city, street, ...}`. `diffDocuments(base, local)` then emits `$unset addr.street` (nested removal → `$unset`, see `core/src/diff/diff.spec.ts:50-62`), and `overwritesHiddenData` only refuses `$set` of containers, so the update is sent and deletes data the user never loaded. The view's note says "Only the fields loaded with the query's projection are compared; the others stay as they are on the server", which is false here. This path is easy to reach: the pre-existing conflict filter checks the whole top-level value (`addr: {$eq: {city: ...}}`), so saving any nested-projected edit conflicts whenever `addr` has other sub-fields, and the user's natural next click is Overwrite. A related variant: with array projections (`$slice`, `$elemMatch`) the visible array differs from the server's full array, so Overwrite produces a `$set` of the array that save then refuses with `PROJECTION_REFUSED`, after the baseline was already moved (see CR-2).
    - Why it matters: Silent loss of server data hidden by the projection, contradicting the recorded assumption ("hidden fields are neither shown nor unset") and the UI text.
    - Suggested fix: Restrict the baseline to what was loaded at every depth, not only the top level (e.g. project the server version with the loaded original's shape, recursively for sub-documents; treat arrays from a projected document as non-comparable), or refuse Overwrite/Merge when a visible field's server value has sub-fields or items the loaded version lacked (as `PROJECTION_REINSERT_REFUSED` does for the re-insert). Add a service test with a dotted projection asserting that no `$unset` of a hidden sub-path is sent.

## P2 Medium

- [ ] **CR-2 | `resolveWith` moves the baseline before the write; a cancelled, refused or failed Overwrite leaves the edit session rebased onto the server version (O-1 confirmed)**
    - File: `packages/renderer/src/app/document/document-actions.service.ts:249-250` (`DocumentEdits.resolve` at `packages/renderer/src/app/document/edit-session.ts:172-177`)
    - Category: Correctness
    - Problem: `this.edits.resolve(key, base, local)` runs before `this.save(key)`. When the production confirm is cancelled, the write fails with a non-conflict error, or save refuses it (`PROJECTION_REFUSED`, CR-1 variant), the entry's `original` is already the server version and the document's undo/redo steps are already dropped. The conflict view still offers the choice, but the edit bar's change count now reflects the diff against the server, and a later plain "Save" from the edit bar sends exactly the overwrite the user just cancelled (conflict-checked only against the server version shown in the view).
    - Why it matters: A cancel in the production confirm dialog is meant to change nothing (SPEC "Safety"); here it silently turns the next ordinary Save into an overwrite of the other client's change, and it loses undo history for a write that never happened.
    - Suggested fix: Compute the diff from `(base, local)` without mutating the session and only call `edits.resolve`/`rebase` after the write succeeds (or snapshot the entry and undo stack and restore them in the failure/cancel path). Add a test that after a cancelled Overwrite the entry's `original` and undo history are unchanged.

- [ ] **CR-3 | Unreadable CONFLICT detail is shown and resolved as a server-side deletion; committed test fails (TW-1 confirmed)**
    - File: `packages/renderer/src/app/document/document-actions.service.ts:347-358`; `packages/renderer/src/app/document/conflict/conflict-view.ts:383`; test `packages/renderer/src/app/document/document-editing.spec.ts:546`
    - Category: Correctness / Tests
    - Problem: When `conflictDetail.safeParse` fails or `parseServerDoc` throws, `current` is `null`. The message then says "changed on the server", but the conflict view treats `current === null` as deleted: title "Deleted on the server since you loaded it", button "Insert your version again", and Keep server calls `documentChanged(key, null)`, removing a document that still exists from the page. The test-writer's regression test for this is committed and failing, so `npm run check` (`.taskcheck`) fails at HEAD and `tasks.py done` will be refused until it is fixed.
    - Why it matters: Inconsistent UI and a wrong action offered (the re-insert fails on duplicate `_id`, so no data loss, but the user is misled); the task cannot complete with a red check.
    - Suggested fix: Represent "server version unknown" separately from "deleted" in `SaveConflict` (e.g. `current: undefined` or a `state` field); for it, re-read the document with `docs.get` (SPEC: "reloads the server version") or offer only Keep server version/Revert with an explanatory message.

## P3 Low

- [ ] **CR-4 | Projection view shows the server version as `{}` once all edits are undone (O-2 confirmed)**
    - File: `packages/renderer/src/app/document/conflict/conflict-view.ts:375-377`
    - Category: Correctness
    - Problem: With a projection and no edit entry left, `visibleFields(server, [])` keeps no field, so the "Server version" column renders `{}` while the document on the server is not empty.
    - Why it matters: Misleading display in the one remaining choice (Keep server version).
    - Suggested fix: Without an entry, use the loaded page document's keys (or the query projection's keys), or show a short "No unsaved edits left" placeholder instead of a diff.

- [ ] **CR-5 | Merge textarea id is only unique within one tab**
    - File: `packages/renderer/src/app/document/conflict/conflict-view.ts:94,101`
    - Category: Quality (accessibility)
    - Problem: The label/textarea id is `'merge-' + $index`. All workspace tabs stay in the DOM (`layout/app-shell.ts:95-105`, hidden with `[hidden]`), so two collection tabs with an open merge editor both have `merge-0`; the label of the second tab then points to the first tab's (hidden) textarea. `DraftDocuments` avoids this with the view's `uid` input (`collection-view.html` passes `uid + '-drafts'`).
    - Why it matters: Broken label association for assistive technology and label clicks.
    - Suggested fix: Take a `uid` input as `DraftDocuments` does and build the id from it and the conflict key.

- [ ] **CR-6 | Differing lines are not exposed to assistive technology**
    - File: `packages/renderer/src/app/document/conflict/conflict-view.ts:79,86`
    - Category: Quality (accessibility)
    - Problem: The `+`/`−` markers are `aria-hidden` and the difference is otherwise only a background colour and a `data-kind` attribute, so a screen-reader user reading the table cannot tell which rows differ or which side is missing a line.
    - Why it matters: The core purpose of the view ("differences highlighted") is unavailable non-visually.
    - Suggested fix: Add visually hidden text (e.g. "changed", "only in your version", "only on the server") per differing row, or an `aria-label` on the row.

## Review conclusion

Material issues found; fix before completing the task.

Notes: acceptance criterion 1 is covered by `test/e2e/conflict.e2e.ts` (real Electron app and MongoDB container, driver changes the document between load and save, asserts the side-by-side view and the stored result); criterion 2 is covered by service, component and e2e tests for Overwrite, Keep server version and Merge manually. Neither criterion has `tasks.py verify` evidence recorded yet; the parent must record it. The line diff (`line-diff.ts`), `DocumentEdits.resolve`, the deleted-document re-insert path, `_id` check for merges, read-only/production gating via `WriteControl`/`WriteGuard`, and busy handling were reviewed and found consistent with existing code.
