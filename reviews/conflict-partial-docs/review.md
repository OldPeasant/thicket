# Code Review

Date: 2026-11-17

Task: conflict-partial-docs - Conflict view for partly loaded (cut-array) documents

Scope: production code of the task commit, `git diff 98cd4aa..b005e6f -- packages` (`packages/renderer/src/app/document/document-actions.service.ts`, `packages/renderer/src/app/document/conflict/conflict-view.ts`), with the specs changed in the same commit (`collection-view.spec.ts`, `document-actions.service.spec.ts`). HEAD 6da97d9 is the same change rebased: `git diff b005e6f 6da97d9` touches only `tasks/conflict-partial-docs.md`. The untracked `conflict-view.spec.ts` (a concurrent test-writer's work in progress) is not part of this review.

Requirements:
- tasks/conflict-partial-docs.md acceptance criteria 1-3 and its recorded assumption (resolveBlocker 'partial' only for documents with cut arrays; since-cleared projection keeps the projection wording)
- reviews/doc-paging/tests.md TW-1, TW-2; reviews/doc-paging/review.md CR-8 (background)
- SPEC.md M1 "Conflict detection"
- docs/ARCHITECTURE.md "Paging inside documents"
- AGENTS.md

Git range:
- Branch: main
- HEAD: 6da97d997578d55ee1e6223f501f7e653ce48cfb
- Base/start: 98cd4aaf93fcad419bd6149f972aeaf74bbb3283
- Commits reviewed: 1 (b005e6f8e0c5b5b366f44b4b1324c63d6cd46328, rebased as 6da97d9)

Summary: 0 P0, 1 P1, 0 P2, 2 P3

Verification run by the reviewer: `cd packages/renderer && npx ng test --include src/app/collection/collection-view.spec.ts --include src/app/document/document-actions.service.spec.ts` -> 2 files, 218 tests passed.

What I checked and found correct:
- Criterion 1: `conflict.cut` is read from `slicedOf(key)` before the `serverVersion` await in `failed()`, so it is captured for the document that conflicted. `item()` cuts the server's array at each cut path to the local array's length (`truncateArray`). Locked arrays keep that length equal to `loaded`. Never-loaded items are not diffed or rendered. The collection-view test with 300 server items and 100 loaded asserts this, and also checks the count and the cut note.
- Criterion 2 (changed case): `resolveBlocker` returns `'partial'` for a cut document. The blocked note, `PARTIAL_RESOLVE_REFUSED`, and `PARTIAL_REINSERT_REFUSED` name the partial load. Overwrite and Merge manually are still not offered, and direct calls are refused before any write.
- Criterion 3: `keepServer` passes `savedWhole = true`. The fallback calls `documentChanged(key, whole, undefined)`, and `CollectionResults.patchDocument` then clears the page's `sliced` entry. The updated collection-view test asserts the pager reads "of 300", no `docs.getSlice` happens, the items are editable inputs, and `partial` is false. The successful read-back path still uses `sliceAbove`.
- No new data-loss path: every write path for a cut document (Overwrite, Merge, re-insert) is still refused.

## P0 Critical

None.

## P1 High

- [ ] **CR-1 | A cut document deleted on the server still gets a conflict note about a projection**
    - File: `packages/renderer/src/app/document/conflict/conflict-view.ts:112-122`
    - Category: Correctness
    - Problem: When the server version is deleted, `resolveBlocker` returns `null` (`conflict.current === null`), so `item.blocked` is `null`. The new cut-note branch needs `item.state === 'changed'`, so it is skipped too. That leaves the `@else if (item.partial && item.local !== null)` branch. `isPartial(key)` is true for a cut document because the edit session's `partial` flag is set from the page's `sliced`. So the view renders `conflict-note` "Only the fields loaded with the query's projection are compared; the others stay as they are on the server." for a large document loaded without any projection. The "Insert again" (`conflict-overwrite`) button is still offered (line 219: `blocked === null`), but it is always refused with `PARTIAL_REINSERT_REFUSED`. The new test `refuses to insert the cut document again when it was deleted, naming the partial load` checks only the service message, not the rendered note or button.
    - Why it matters: Criterion 2 requires the conflict note for a partly loaded document without a projection to name the partial load, not a projection. The deleted branch is exactly the situation the re-insert part of that criterion covers, and the user sees a note about a projection that does not exist, next to a button that can only fail.
    - Suggested fix: For a deleted conflict whose `conflict.cut` is set, show a partial-load note, for example by having the view take `conflict.cut !== undefined` into account in the deleted state. Either hide "Insert again" for it, or keep the button and have the note say that re-inserting is not possible for a partly loaded document. Add a view assertion on `conflict-note` (and on the button) to the deleted cut-document test.

## P2 Medium

None.

## P3 Low

- [ ] **CR-2 | Template restructuring now shows a second note under a projection block**
    - File: `packages/renderer/src/app/document/conflict/conflict-view.ts:97-122`
    - Category: Correctness
    - Problem: Before this change, "Only the fields loaded with the query's projection are compared" was the last `@else if` of the blocked chain, so it never showed when the document was blocked. It now belongs to the separate cut-note `@if` block. A document blocked by `'projection'` (always partial, with edits) therefore renders two `data-testid="conflict-note"` paragraphs: the "not available" note and the "Only the fields ... compared" note. The reverse also happens: with a cut array and a top-level projection, the cut note replaces the projection-compare note, even though `visibleFields` was applied. The existing tests read only the first `conflict-note`, so none of them catches this.
    - Why it matters: It is an unrequested behavior change in conflict-ui's view, it duplicates a test id, and it adds noise to the blocked case.
    - Suggested fix: Show the projection-compare note only when `item.blocked === null`, as before. Decide whether it should appear alongside the cut note, either in the same `@if` or as an extra list entry.

- [ ] **CR-3 | Re-insert refusal for a cut document suggests something that cannot work**
    - File: `packages/renderer/src/app/document/document-actions.service.ts:593-596`
    - Category: Quality
    - Problem: `PARTIAL_REINSERT_REFUSED` ends with "Keep it deleted, or run the query without a projection and edit again." For a cut document, no projection was involved, and running the query again returns it cut again. In any case, the document was deleted on the server, so the query will not return it at all.
    - Why it matters: The user is told to try something that cannot succeed. This is minor because nothing is written.
    - Suggested fix: Remove that alternative from the partial-load re-insert message, for example "... so inserting it would lose the data that was not loaded. Keep it deleted.", or say how to recreate the document some other way.

## Review conclusion

Material issues found; fix before completing the task.
