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

# Code Review (round 2)

Date: 2026-11-17

Task: conflict-ui - M1: Conflict resolution view

Scope: the task's final code at HEAD `a5c421e`: `git diff 2a62fc45..a5c421e -- packages/renderer test/e2e`, limited to the task's commits (18731a9, 58079e8, 409217e, 983eded, de37747, d43641b, a3fb370, 3859765, 5bb379c, a5c421e). Changes merged from main by other tasks (the `io-basic-ui` import/export panels in `packages/renderer/src/app/io`, the io lines of `collection-view.ts`/`.html`, `test/e2e/io.e2e.ts`, backend aggregation files) are excluded. No uncommitted changes.

Reviewed revision: a5c421e

Requirements:
- `tasks/conflict-ui.md` acceptance criteria and the three recorded assumptions in its Notes
- `SPEC.md` M1 "Conflict detection", demo step 7
- `docs/ARCHITECTURE.md`, `docs/QUALITY.md`, `AGENTS.md`
- Round-1 findings above; `reviews/conflict-ui/fixes.md` rounds 1-3 (CR-1..CR-6, TW-2, TW-3); `reviews/conflict-ui/tests.md` rounds 1-4 (including observation O-R4-1)

Git range:
- Branch: main
- HEAD: a5c421e
- Base/start: 2a62fc45bc886a9153dc8258561d921c397d2606
- Commits reviewed: 10 task commits (listed in Scope)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Status of round-1 findings

- CR-1 (P1, dotted projection unsets hidden sub-fields): Resolved. `isTopLevelProjection` (`document-actions.service.ts:597-621`) accepts only whole top-level 0/1/boolean projections; `resolveBlocker` (`:212-220`) returns `'projection'` for any partial document whose active projection is not top-level-only, that was edited under such a projection (`hidesSubFields`, sticky in `edit-session.ts:123-124` and carried through undo, redo and rebase), or whose projection was cleared. `overwrite` and `saveMerged` refuse via `refuseResolve` (`:167`, `:260`), and the view hides both actions and explains why (`conflict-view.ts:70-75`, `:165`, `:177`). Both production edit call sites pass the flag (`collection-view.ts:401`, `raw-editor.ts:284`). The TW-2 variant (dotted projection replaced by a top-level one before resolving) is covered by the sticky flag, and TW-3 (server-added sub-field inside a field loaded whole is unset, matching assumption 1) by `5bb379c`. The re-insert path is still refused under any projection (`:244-248`).
- CR-2 (P2, baseline moved before the write): Resolved. `send` (`:289-339`) computes the diff with `pendingSave` without touching the session and calls `saved()` (rebase or discard) only after the write and read-back succeeded. `DocumentEdits.resolve` was removed. Service tests cover a production cancel, a read-only refusal, SERVER_ERROR and a new CONFLICT leaving original, current and undo history unchanged.
- CR-3 (P2, unreadable detail shown as deleted): Resolved. `SaveConflict.current` is `undefined` for unknown; `failed` (awaited inside `write`, so the key stays busy) re-reads with `docs.get` without a projection, mapping `doc: null`/`NOT_FOUND` to deleted and other failures to unknown (`:429-471`). The view has a distinct "unknown" state offering only Keep server version; `readBack` no longer clears the page when it has nothing to fall back to.
- CR-4 (P3, `{}` server version without edits): Resolved. Without an entry the server version is shown unfiltered (`conflict-view.ts:418-422`) and the projection note is hidden.
- CR-5 (P3, merge id per tab): Resolved. `uid` input, `collection-view.html` passes `uid + '-conflicts'`, ids built as `uid() + '-merge-' + $index`.
- CR-6 (P3, differences not exposed to assistive technology): Resolved. Visually hidden "Changed: ", "Only in your version: ", "Only on the server: " prefixes per differing cell (`conflict-view.ts:361-371`).

O-R4-1 (test-writer round 4): confirmed. In `save` the `loaded` argument equals `original`, so `unsetsUnloaded` cannot be true; in `resolveWith` the `hidesSubFields` arm is unreachable because `refuseResolve` runs first. The check is inert defense in depth, does no harm and matches the assumptions; keeping it is acceptable and is not reported as a finding.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-7 | The merge editor's open state is not reset when its conflict goes away or changes to "deleted"**
    - File: `packages/renderer/src/app/document/conflict/conflict-view.ts:343-345` (state), `:112`, `:136` (template), `:403-412` (`saveMerged`); conflicts dropped outside the view in `packages/renderer/src/app/document/document-actions.service.ts:135-145` (`revert`, `revertAll`) and `:334` (a plain Save succeeding); silent refusal at `:166`
    - Category: Correctness
    - Problem: `mergeKey` and `mergeText` are reset only by Cancel merge, Keep server version and a successful Save merged. Two reachable states follow from that. (a) With the merge editor open, the user reverts the document from the document header or the edit bar (or saves it from the edit bar and that succeeds); the conflict disappears but `mergeKey` stays. If the same document conflicts again later, its conflict view opens with the merge editor already open and prefilled with the old text (based on the edits the user reverted), and Keep server version / Overwrite are hidden behind Cancel merge. (b) With the merge editor open, Save merged gets a new CONFLICT because the document was deleted meanwhile; the view switches to "Deleted on the server" but keeps the merge editor and its Save button, and `saveMerged` then returns `false` at `document-actions.service.ts:166` without any message, so clicking it does nothing; "Keep it deleted" and "Insert your version again" stay hidden until the user clicks Cancel merge.
    - Why it matters: Stale content offered for a write, and a button that silently does nothing. The user sees the text before saving and can cancel, so no silent data loss; it is a usability and consistency defect in the resolution flow.
    - Suggested fix: Derive the open editor from the current conflicts (e.g. close it in `items`/an effect when `mergeKey` is no longer a conflict key or its state is not `changed`), or reset it when the conflict for `mergeKey` changes; add a component test for revert-while-merging and for a deletion reported by Save merged.

## Review conclusion

No material issues found.

Notes: all round-1 findings and the test-writer findings TW-2 and TW-3 are resolved in the code at a5c421e, and their tests assert behaviour (requests sent, session state, rendered actions) rather than implementation details. Acceptance criterion 1 is covered by `test/e2e/conflict.e2e.ts` (Electron app and a MongoDB container; the driver changes the document between load and save and the side-by-side view is asserted); criterion 2 by that e2e (Overwrite, Keep server version, Merge manually, each checked against the stored document) plus service and component tests. The test-writer's round-4 report records an e2e run on the final code. I re-ran `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts' --include='src/app/raw-editor/**/*.spec.ts'` at a5c421e: 13 files, 693 tests passed. I did not run the e2e or `npm run check` myself. Evidence for both criteria must still be recorded by the parent with `tasks.py verify`; the criteria in `tasks/conflict-ui.md` are not yet checked off. CR-7 is optional to fix before completion. No secrets, unsafe rendering (all output uses Angular interpolation), or write paths bypassing `WriteGuard`/`WriteControl` were found.
