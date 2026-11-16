# Fix Report

Date: 2026-11-17

Task: doc-edit-save - M1: Edit session and explicit save

Scope: findings CR-1..CR-6 from `reviews/doc-edit-save/review.md` and TW-1 from `reviews/doc-edit-save/tests.md` (TW-2 was already fixed by the test-writer), applied to HEAD 4e04b9d on `main`. Changes are left uncommitted for the parent worker.

## Fixed findings

### CR-1 — Saving a replace-type diff while a projection is active deletes the fields that were not projected

Files changed:
- `packages/renderer/src/app/document/document-actions.service.ts`
- `packages/renderer/src/app/document/document-actions.service.spec.ts`

Problem:
With a query projection the loaded document can be partial. Save could send `docs.replace` with the projected document, or `$set` a whole sub-document/array whose loaded value was partial. Either one deletes server data the user never saw.

Fix:
`save()` now checks `host.projection()`. When a projection is set and the diff is a `replace`, or has a `set` op whose value is a document or array at a path that exists in the loaded (original) document, it sends nothing. It shows "Not saved: with a projection active, this edit would replace data the projection hides. Clear the projection and edit again." and keeps the edits. Scalar `$set`, `$unset`, `$push`, and a container `$set` at a path the loaded document did not have are still sent. The check is in the module-level helpers `overwritesHiddenData` and `hasPath`. Diff paths only go through document keys, because arrays are never diffed item by item. The header/pendingSave were not changed (the minimum agreed with the parent).
New tests in "save with a projection active":
- top-level reorder: replace refused, no request, edits kept;
- object replaced by an array, and a changed array: container `$set` refused;
- scalar `$set` + `$unset` + `$push` + new sub-document: sent as one `docs.update`;
- no projection: `docs.replace` still sent.
The existing "reads the saved document back with the query projection" test (scalar set under a projection) still passes.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts'` — Pass

### CR-2 / TW-1 — Edits made while a save is running are dropped, and the page briefly shows the pre-save version

Files changed:
- `packages/renderer/src/app/document/edit-session.ts`
- `packages/renderer/src/app/document/document-actions.service.ts`
- `packages/renderer/src/app/document/document-actions.service.spec.ts`

Problem:
After a successful write, `save()` called `edits.discard(key)`. That dropped edits made while the request was running. It also showed the old loaded page document until the read-back finished.

Fix:
- New `DocumentEdits.rebase(key, saved)`. The saved document becomes the entry's `original`. If `current` equals it, the entry goes, so the document is no longer modified. Otherwise the newer edits stay unsaved. The key's undo/redo steps are dropped, as `discard` does.
- `save()` keeps the document it sent (`sent = entry.current`) and reads it back first: the page is patched by `_id` with the server version, or with `sent` if the read fails. Only then does it call `edits.rebase(key, sent)`. During the request and the read-back the entry still exists, so the view keeps showing the saved/edited version, not the pre-save one. Edits made during the read-back are kept too.
- The test-writer's test `keeps an edit made while the save was on its way` passes unchanged. I added assertions to it: the baseline is the saved version, history is cleared, and a second save sends only `$set qty` with `expected` `qty: 1`. I also added "keeps showing the saved version, not the loaded one, while it is read back".

Validation:
- `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts'` — Pass

### CR-3 — Ctrl+S in a field saves without the value being typed

Files changed:
- `packages/renderer/src/app/document/edit-bar.ts`
- `packages/renderer/src/app/document/edit-bar.spec.ts`
- `packages/renderer/src/app/document/document-editing.spec.ts`

Problem:
`bson-input` and `editable-value` fields apply their value on blur or Enter. Ctrl+S inside a field saved without that value, and saved nothing at all when it was the only edit.

Fix:
On a writable profile, Ctrl/Cmd+S with the key event's target in a text field now calls `target.blur()`, which applies the typed value through the explorer's existing blur handlers. `saveAll()` then runs on the next macrotask (`setTimeout`), still checking `modified()` and `!busy()`. Outside text fields it saves right away, as before. On read-only profiles Ctrl+S is still swallowed without doing anything.
Tests:
- `edit-bar.spec.ts`: the old "saves with Ctrl+S, also from a text field" test expected a synchronous save from an input. It is split into "saves with Ctrl+S" (outside a field) and "applies the value typed into a text field before saving with Ctrl+S" (the field loses focus, its blur applies the edit, and `saveAll` runs after the macrotask). The expectation changed because the required behavior changed, not to make the test pass.
- `document-editing.spec.ts` "saves the value still being typed in a field with Ctrl+S": focuses the `total` input, types 15, presses Ctrl+S without blurring, and expects one `docs.update` with `$set total: 15`.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts'` — Pass

### CR-5 — Failed deletes and inserts are reported as "Not saved: ..."

Files changed:
- `packages/renderer/src/app/document/document-actions.service.ts`
- `packages/renderer/src/app/document/document-actions.service.spec.ts`

Problem:
`failed()` put "Not saved:" in front of every write error.

Fix:
`write()`/`failed()` take a failure prefix: "Not saved", "Not deleted" or "Not inserted". The CONFLICT messages only happen on saves and are unchanged. Tests: new "says "Not deleted" when the delete fails". "keeps the draft when the insert fails" now also asserts the "Not inserted:" prefix.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts'` — Pass

### CR-6 — The read-only test checks a different EditModeService instance

Files changed:
- `packages/renderer/src/app/document/document-editing.spec.ts`

Problem:
The test asserted on the root `EditModeService`. The view provides its own instance, so the assertion always passed.

Fix:
The assertion now uses `fixture.debugElement.injector.get(EditModeService)`. A new check confirms this is not the root instance, so the test can't quietly fall back to it. The view's instance is `enabled() === false` on the read-only profile, and the test passes.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts'` — Pass

## Not fixed

### CR-4 — Row add and row delete in the table view have no tests

Status:
Invalid (no longer valid)

Reason:
The test-writer's `packages/renderer/src/app/document/table-editing.spec.ts`, added after the reviewed revision, already covers every path the finding asks for:
- cell edit: "records an edited row as an edit of that document only", including one `docs.update` for that `_id` on Save;
- row add: "turns an added row into a draft (not inserted yet)", with a new ObjectId `_id`;
- row delete: "asks before deleting the document of a removed row", which covers both cancel (row stays, no request) and confirm;
- last row: "deletes the last document when the last row is removed".
Nothing was missing, so no test was added.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts'` — Pass (8 files, 201 tests)

Full test suite:
- `npm run check` (repo root) — Pass. After `npx prettier --write` on `document-actions.service.ts`: lint and prettier pass, typecheck passes for core, backend and renderer, root vitest 48 files / 2920 tests passed, renderer `ng test` 60 files / 1438 tests passed.

Lint/type-check/build:
- Part of `npm run check` above — Pass

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check` when `package.json` exists; same run as above)

Remaining unresolved findings:
0

Residual risk for the parent to decide (not a supplied finding, not changed): the CR-1 guard uses the projection active at save time (`DocumentHost.projection()`), as instructed. Unsaved edits survive new queries. So a document loaded and edited under a projection, then saved after the projection was cleared and the query re-run, is still checked against the partial loaded version but no longer refused. To close this, the entry would need to record whether it was loaded with a projection.

E2E (`npm run test:e2e`) was not re-run. The changes are covered by component and unit tests. The e2e flows (edit two fields + Save button, production confirm) do not use Ctrl+S or projections.

## Final status

All validated findings fixed and validation passed.
