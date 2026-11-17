# Code Review

Date: 2026-11-17

Task: undo-last-save - M1 (Should): Undo last save

Scope: production code of the task commits e49f4b8f and 3e07e41b (`git diff 92135866..3e07e41b -- packages test`), plus the test files present in the working tree at review time (the test-writer was adding `history/apply-update.spec.ts`, `history/save-history.spec.ts` and changes to `history/undo-last-save.spec.ts` in parallel; those were not reviewed in depth).

Requirements:
- tasks/undo-last-save.md (acceptance criteria and the four recorded assumptions)
- SPEC.md "Editing and saving" ("Undo last save": keeps the pre-save version and writes it back with the same conflict check)
- docs/ARCHITECTURE.md, AGENTS.md, docs/QUALITY.md
- Parent instructions (focus: conflict filter, projection/partial handling, safety of the replace fallback, busy handling, history recorded only after success, integration with conflict view/Overwrite/Merge, write guard)

Git range:
- Branch: main
- HEAD: 3e07e41b
- Base/start: 92135866b7a38de086eb5412b793c93c16d39c7f
- Commits reviewed: 2

Summary: 0 P0, 1 P1, 1 P2, 1 P3

Commands run (read-only):
- `git log`, `git diff 92135866..3e07e41b`, reading the changed files in full plus `edit-session.ts`, `core/src/diff/diff.ts`, `collection-view.ts`
- `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'` -> 10 files, 313 tests passed (includes the test-writer's uncommitted spec files)
- `python tasks.py verify undo-last-save` -> both criteria still unverified (no evidence recorded yet; the e2e suite was not run by this review)

What was checked and found correct:
- Conflict filter: the undo is `send(after -> before)`, so `expected` comes from `after`'s values of exactly the fields the save changed (absent ones as `$exists: false`); confirmed in `diff.ts` `conflict()` and the unit test.
- History is recorded only inside the `saved` callback, which runs after the write and read-back succeeded (Save, Overwrite, Merge manually); a cancelled, refused or failed write records nothing. Reinsert of a deleted document does not record (matches the assumption). Delete drops the entry.
- Busy handling: `undoSave` returns early while the key is busy; `save`/`overwrite`/`delete` likewise check `isBusy`; the header button is disabled while busy or modified. Undo is refused with unsaved edits (entries exist only while modified, so no stale edit baseline remains after an undo).
- Write guard: both `docs.update` and `docs.replace` go through `WriteGuard.run`; read-only refuses (history kept), production confirms (unit-tested).
- Projection/partial: `last.partial`/`hidesSubFields` captured at save time; `keepingOrder` is skipped for partial documents (cut large documents are flagged partial by `collection-view.ts` `isPartial`), and `overwritesHiddenData`/`unsetsUnloaded` still apply.
- Conflict on undo bypasses the conflict view via `onConflict` and leaves no conflict entry; other failures go through `failed()` with the `Not undone` prefix; `CANCELLED` stays silent.
- Existing Save messages are unchanged (`Not saved: ` + text), existing spec assertions still pass.

## P0 Critical

None.

## P1 High

- [ ] **CR-1 | Field-order replace fallback silently overwrites server changes the conflict check does not cover, including fields the user never loaded**
    - File: `packages/renderer/src/app/document/document-actions.service.ts:426-427` and `:684-692` (`keepingOrder`)
    - Category: Correctness
    - Problem: When the save added or removed a non-trailing top-level field (for example it removed `status` from `{_id, status, total}`), `keepingOrder` turns the undo into `replaceOne(before)` but keeps the minimal update's `expected`, which only checks the fields the save changed. `before` is the document as it was loaded (possibly long before the save), not the server's current state. Concrete case: loaded `{_id, status, total}`; another client sets `total` or adds `extra` (before or after the user's save; neither is in the filter); user saves without `status` (`$unset status`, succeeds); user clicks Undo -> diff is `$set status`, which would append it, so a replace is sent with `expected {status: {$exists: false}}`; the filter matches and the replace writes the stale `total` and deletes `extra`, with the message "Undid the last save of 1.". The read-back after the save even showed the user the newer values, so they cannot tell they are being reverted. Save itself does not have this exposure here: it sent only `$unset status`.
    - Why it matters: Data loss of other clients' changes (and of fields added after the load that the user never saw), triggered automatically for a purely cosmetic goal (field order) that the task's assumption already accepts losing under a projection. It contradicts the intent of "the same conflict check": a change on the server since the save should be reported, not overwritten.
    - Suggested fix: Either drop the replace fallback and always send the minimal update (accept the appended field order, as the assumption already does for partial documents), or only replace when the whole server document is known to equal `after`: e.g. extend `expected` to every top-level field of `after` with `$eq` plus an `$expr` that the server document has exactly that many fields (`$size` of `$objectToArray: '$$ROOT'`), so any other change conflicts. Add a unit test (and ideally an e2e case against MongoDB) where an unrelated field is changed and a new field is added on the server between load/save and undo, asserting nothing is lost.

## P2 Medium

- [ ] **CR-2 | The replace (field-order) path is never exercised against a real MongoDB**
    - File: `test/e2e/undo-last-save.e2e.ts:104-110`
    - Category: Tests
    - Problem: Both e2e tests save value changes only (`total`, `qty`), so the undo is always a plain `$set` update. The `keepingOrder` replace path, its `$exists: false` filter on `docs.replace`, and the "same field order" claim in the first test's comment are only verified against the in-memory fake in `undo-last-save.spec.ts`, whose matcher and `$set` semantics are hand-written.
    - Why it matters: The replace fallback is the riskiest part of the change (see CR-1) and the one whose MongoDB semantics (append order, replace filter) the implementation relies on; the fake cannot show they hold on the real server.
    - Suggested fix: If the replace fallback is kept (after fixing CR-1), add an e2e case that removes or adds a non-trailing field, undoes, and compares canonical EJSON from the driver, plus the concurrent-unrelated-change case from CR-1.

## P3 Low

- [ ] **CR-3 | Undo's projection/partial refusal text tells the user to "edit again"**
    - File: `packages/renderer/src/app/document/document-actions.service.ts:433-437`, `:705-713`
    - Category: Quality
    - Problem: The refusal for an undo under a projection or partial load reuses Save's texts, producing e.g. "Not undone: with a projection active, this edit would replace data the projection hides. Clear the projection and edit again." For an undo there is no edit to redo, and clearing the projection does not help (the recorded `partial` flag sticks).
    - Why it matters: Misleading guidance in a rare path; the undo stays offered but cannot succeed.
    - Suggested fix: Use an undo-specific text for this case (e.g. that this save cannot be undone because the document was loaded only partly) and consider dropping the history entry when it can never succeed.

## Review conclusion

Material issues found; fix before completing the task. CR-1 (P1) can lose concurrent server data on a common undo path and must be fixed (or the replace fallback removed) with a regression test. Acceptance-criterion evidence (`tasks.py verify`) was not yet recorded at review time; the e2e tests named by criteria 1 and 2 must actually be run against the Electron app and MongoDB container before they are claimed.
