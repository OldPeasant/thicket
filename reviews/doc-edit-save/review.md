# Code Review

Date: 2026-11-17

Task: doc-edit-save - M1: Edit session and explicit save (round 2)

Scope: `git log b045ba5..HEAD`, limited to the doc-edit-save commits (50745e6, bc3bba6, d95b31a, 4c23981, 1710873, 225856c, 114f1ea, 7085ba7). The range also contains merged commits from other tasks (x509-proxy, connection-ui, conn-ui-m2 backend/contract/integration files). Those were not reviewed. Round-2 focus: whether round-1 findings CR-1..CR-6 and TW-1 are resolved, and the new code (`DocumentEdits.rebase`, the per-document `partial` flag, the projection guard `overwritesHiddenData`/`hasPath`, and Ctrl+S applying the focused field's value before saving).

Requirements:
- tasks/doc-edit-save.md (acceptance criteria and ASSUMPTION notes, including the accepted decision that under a projection a container field may be set to a scalar or unset)
- SPEC.md M1 "Editing and saving" (conflict filter = `_id` + original values of the changed top-level fields)
- docs/ARCHITECTURE.md, AGENTS.md
- reviews/doc-edit-save/review.md (round 1), fixes.md, tests.md (round 2)
- Out of scope (later tasks): conflict-ui, undo-last-save, multi-doc-edit

Git range:
- Branch: main
- HEAD: 7085ba7e4f649ce6727f85a92e5935fb5852c92e
- Base/start: b045ba5f0bde20b67fe9d0a1e97179a3ed1e5e3f
- Commits reviewed: 8 (doc-edit-save commits in the range; uncommitted changes: none)

Read in full: `packages/renderer/src/app/document/{edit-session,document-actions.service,edit-bar}.ts` and the collection-view/collection-results diff. Context read: `packages/core/src/diff/diff.ts` (ops, `conflict`, `queryFieldCheck`), `packages/backend/src/docs/write/write.ts` (conflict filter), `CollectionResults.run`/`load` (the page is cleared when a query is applied), and the new tests in `edit-session.spec.ts`, `document-actions.service.spec.ts`, `edit-bar.spec.ts`, `table-editing.spec.ts`, `document-editing.spec.ts`.

Command run: `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts'` -> 8 files, 218 tests passed. The e2e suite was not run by the reviewer.

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Round-1 findings: verification

- CR-1 (P0, replace under a projection deletes hidden fields): resolved. `save()` refuses a `replace` diff and a container `$set` at an existing path when `entry.partial || host.projection() !== undefined` (`document-actions.service.ts:116-120`). The `partial` flag is now stored per entry (`edit-session.ts:102-116`) and survives undo, redo and rebase. That closes the round-1 residual risk where the projection is cleared and the query re-run before Save. `docChanged` sets the flag from the applied query (`collection-view.ts:351`). `CollectionResults.run` clears the page when a query is applied, so a page loaded with one projection can't be edited under another query's flag. Tests cover both the service and the view.
- CR-2 / TW-1 (edits during an in-flight save dropped): resolved. The page is patched with the read-back (or with `sent`) before `rebase(key, sent)`. The entry stays in place until then, so the view never shows the pre-save version. Edits made later stay unsaved on top of `sent`.
- CR-3 (Ctrl+S in a field): resolved. `handleEditKeys` blurs the text field, then saves on the next macrotask and checks `modified()`/`busy()` again. On read-only profiles the field is not touched. A component test types into a real `bson-input` and presses Ctrl+S without blurring.
- CR-4 (table row add/delete untested): resolved by `table-editing.spec.ts` (cell edit, add row -> draft, delete with confirm/cancel, last row, projection flag).
- CR-5 (failure prefixes): resolved ("Not saved" / "Not deleted" / "Not inserted").
- CR-6 (read-only test checked the root EditModeService): resolved (`document-editing.spec.ts:380-382` uses the view's injector and asserts that it is not the root instance).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Under a nested or `$slice` projection, saving any edit inside a partially loaded top-level field fails with a false "changed on the server" conflict**
    - File: `packages/renderer/src/app/document/document-actions.service.ts:268-272` (message), with the guard comment at `:327-332`
    - Category: Correctness
    - Problem: The conflict filter checks each changed top-level field with `{field: {$eq: <loaded value>}}` (`diff.ts:195-223`, as SPEC.md requires). Under a projection such as `{ "addr.city": 1 }`, or `{ tags: { $slice: 2 } }`, the loaded `addr`/`tags` is only part of the server value. So every save that touches that field never matches: a scalar `$set addr.city`, a `$push` to `tags`, or the accepted "set the container to a scalar / unset it" case. The backend then answers `CONFLICT`, and the user sees "Not saved: the document was changed on the server since it was loaded", which is not true. The comment on `overwritesHiddenData` says these ops "are still sent". They are sent, but they can never succeed. No data is lost: the filter refuses the write, and the edits are kept.
    - Why it matters: The message sends the user looking for a concurrent change that does not exist, and editing nested fields under such projections is impossible without any explanation. It also leaves the "Changed on the server" marker and `conflicts` entry, which conflict-ui will later offer to "overwrite" from a partial document.
    - Suggested fix: When a save is refused with `CONFLICT` and the entry is `partial` (or a projection is active), say that the document was loaded with a projection, so the save could not be checked against the full server version, and ask the user to clear the projection. Alternatively, refuse up front when a changed top-level field is limited by a dotted or `$slice`/`$elemMatch` projection key. Correct the `overwritesHiddenData` comment to match. Add a test: projection `{ "a.b": 1 }`, an edit of `a.b`, a server `CONFLICT`, and the expected message.

## Review conclusion

No material issues found.

All round-1 findings (CR-1..CR-6, TW-1) are resolved in the final code. The new rebase, partial-flag, projection-guard and Ctrl+S code is correct and tested. The remaining finding is a P3 message and usability issue with no data-loss risk. Note for the parent: no acceptance-criterion evidence is recorded yet (`tasks.py verify doc-edit-save` lists all four unticked). The e2e criteria (#2, #3) must be run against the final code, because the save path changed after round 1: the read-back now comes before the rebase.
