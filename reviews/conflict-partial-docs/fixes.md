# Fix Report

Date: 2026-11-17

Task: conflict-partial-docs - Conflict view for partly loaded (cut-array) documents

Scope: current task. Findings CR-1, CR-2 and CR-3 from `reviews/conflict-partial-docs/review.md`, and TW-1 plus observation O-1 from `reviews/conflict-partial-docs/tests.md`. The fixes follow the approach the parent worker approved. Base: HEAD 0c9a13e (the task commits 6da97d9 and 0c9a13e on top of 98cd4aa). The changes are uncommitted; the parent worker commits them.

## Fixed findings

### CR-1 - A cut document deleted on the server still gets a conflict note about a projection

Files changed:
- `packages/renderer/src/app/document/conflict/conflict-view.ts`
- `packages/renderer/src/app/document/conflict/conflict-view.spec.ts`
- `packages/renderer/src/app/collection/collection-view.spec.ts`

Problem:
`resolveBlocker` returns `null` for a deleted document. For a cut document deleted on the server, the view therefore fell through to the "Only the fields loaded with the query's projection are compared" note, which names a projection that does not exist. It also offered "Insert your version again", a button that `resolveWith` always refuses.

Fix:
`ConflictView.item()` now sets `blocked: 'partial'` when `conflict.current === null && conflict.cut !== undefined`. `DocumentActions.resolveBlocker` is unchanged and still returns null for deleted documents, and the refusal in `resolveWith` stays as it was. The template has a new `@else if (item.blocked === 'partial' && item.state === 'deleted')` note: "Inserting your version again is not available: the document was loaded only partly (with a projection, or a large document whose long arrays are read page by page), so inserting it again would lose the items that were not loaded. Keep it deleted." This uses the same parenthetical as the other partial-load messages. Because `blocked` is no longer null, the insert-again button is hidden, and only "Keep it deleted" is offered.

Validation:
- `conflict-view.spec.ts` `a deleted server version: the partial-load note, no insert-again, and re-inserting is refused` checks: exactly one `conflict-note`, partial-load wording, no projection wording, no `conflict-overwrite`, Keep it deleted, and a direct `overwrite` still refused with no `docs.insert`. Result: Pass.
- `collection-view.spec.ts` `refuses to insert the cut document again when it was deleted, naming the partial load` gained the same view assertions through the real collection view. Result: Pass.

### CR-2 - Template restructuring shows a second note under a projection block

Files changed:
- `packages/renderer/src/app/document/conflict/conflict-view.ts`
- `packages/renderer/src/app/document/conflict/conflict-view.spec.ts`

Problem:
The task commit had moved the projection-compare note into the separate cut-note block. A document blocked by `'projection'` then rendered two `conflict-note` paragraphs.

Fix:
The projection-compare note is the last `@else if (item.partial && item.local !== null)` of the unknown/projection/partial chain again, as it was before b005e6f. The cut-array note (`conflict-cut-note`) is a separate `@if` of its own.

Validation:
- New test `a document blocked by a projection shows only the projection note (review CR-2)` uses a dotted projection with no cut arrays and checks for exactly one `conflict-note`, the projection wording, and neither Overwrite nor Merge. Result: Pass.
- New test `a partial document under a top-level projection (not blocked) keeps the compare note` checks that the unblocked case still shows the single compare note and Overwrite. Result: Pass.

### CR-3 - Re-insert refusal for a cut document suggests something that cannot work

Files changed:
- `packages/renderer/src/app/document/document-actions.service.ts`
- `packages/renderer/src/app/document/document-actions.service.spec.ts`

Problem:
`PARTIAL_REINSERT_REFUSED` ended with "or run the query without a projection and edit again". That cannot work: the document was deleted on the server, and a cut document has no projection to begin with.

Fix:
The message now ends "... so inserting it would lose the data that was not loaded. Keep it deleted." The constant is also used for a non-cut document edited under a projection that has since been cleared. That alternative cannot work there either, because the document is deleted, so the same wording applies.

Validation:
- `document-actions.service.spec.ts` `re-inserting a large document deleted on the server is refused (it is partial)` now also checks that the message ends with `Keep it deleted.` and does not contain `run the query`. Result: Pass.

### TW-1 - Appended local items expose never-loaded server items in the conflict diff (also resolves O-1)

Files changed:
- `packages/renderer/src/app/document/conflict/conflict-view.ts`
- `packages/renderer/src/app/document/conflict/conflict-view.spec.ts`

Problem:
The server's cut array was shortened to the local array's current length. Appending items locally revealed never-loaded server items (TW-1). Removing loaded items locally hid them on the server side and lowered the "first N items" count (O-1).

Fix:
The server array is now cut to `array.loaded` from `conflict.cut`, and the cut note reports `array.loaded`.

Validation:
- The test writer's `longer: never-loaded server items are neither shown nor counted as differences` was kept intact and now passes. I added assertions: two server-side gaps for the appended items, 4 differing rows (the name, the last loaded item's line gaining a comma locally, and the two appended items), and the cut note says 100 items. Result: Pass.
- `shorter: shows no never-loaded server items` now also checks that the two loaded items removed locally (`SKU-000098`, `SKU-000099`) still show on the server side, and that the note says "first 100 items" (O-1). Result: Pass.

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include src/app/document/conflict/conflict-view.spec.ts --include src/app/collection/collection-view.spec.ts --include src/app/document/document-actions.service.spec.ts --include src/app/document/document-editing.spec.ts`: 4 files, 288 tests passed.

Full test suite:
- `npm run check` (repo root): root vitest 75 files / 4100 tests passed; renderer `ng test` 93 files / 2980 tests passed.

Lint/type-check/build:
- `npm run check` lint (eslint `--max-warnings 0` and `prettier --check`) and typecheck: Pass. The first run flagged formatting in `conflict-view.ts` and `conflict-view.spec.ts`. I fixed that with `npx prettier --write` on those two files and re-ran.

`.taskcheck`:
- Pass. `.taskcheck` runs `npm run check` (see above). It was not run separately as `.taskcheck`.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
