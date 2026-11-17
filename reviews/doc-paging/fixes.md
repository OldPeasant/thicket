# Fix Report

Date: 2026-11-17

Task: doc-paging - M1: Paging inside documents

Scope: current task; findings CR-1, CR-2, CR-3, CR-5, CR-6 of `reviews/doc-paging/review.md` (CR-4 is handled by the test-writer, as the parent instructed). Task base commit eb68a3a92955b2530da23d97d663ba33b7304037, fixes applied on top of 05b3a3f.

## Fixed findings

### CR-1 — Sparse-array memo never hits on the loaded first page

Files changed:
- `packages/renderer/src/app/explorer/services/array-slice.service.ts`
- `packages/renderer/src/app/explorer/services/array-slice.service.spec.ts`

Problem:
`ArraySliceService.page()` returned a new object on every call when the window lay within the loaded items. `JsonTableComponent.arr` memoises on the page's identity, so it rebuilt a total-length sparse array on every access of the first page.

Fix:
In-memory pages of a registered array are now cached per array identity (a weak map from the array to its pages by `start:end`), so the same window returns the same page object and the table's memo hits. The cache is per array, not per shared `Entry`, so a tree rebuilt from the same document version gets pages holding its own items. Regression test: the same window gives the same object, a different window or a rebuilt array a different one.

Validation:
- `cd packages/renderer && npx ng test --include src/app/explorer/services/array-slice.service.spec.ts` (with the other touched specs) — Pass

### CR-2 — After Save the large document is read back whole; a failed read-back marks the cut document as whole

Files changed:
- `packages/renderer/src/app/document/document-actions.service.ts`
- `packages/renderer/src/app/collection/collection-results.service.ts`
- `packages/renderer/src/app/collection/collection-view.ts`
- `packages/renderer/src/app/collection/collection-view.spec.ts`
- `packages/renderer/src/app/collection/collection-results.service.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
`readBack` called `docs.get` without `sliceAbove`, so a saved large document came back whole, and `patchDocument` always cleared `sliced[index]`. On a read-back failure the saved (cut) document was shown as complete and editable.

Fix:
`DocumentHost` gets an optional `slicedOf(key)` (the cut arrays of the shown document and the `above` size), and `documentChanged` takes an optional `sliced` list. `readBack` sends `sliceAbove` when the shown document was cut. It passes the returned `sliced` on, or keeps the previous `sliced` entry if the read-back fails. `CollectionResults.patchDocument(index, doc, docSliced?)` stores that entry, creating or dropping the list as needed. `CollectionResults.sliceAbove()` gives the nested page size used for `docs.find`. Small documents are still read back without `sliceAbove`. Tests cover these cases:
- read-back with `sliceAbove: 100`, after which paging still uses `docs.getSlice`;
- a small document is read back without `sliceAbove`;
- after a failed read-back, the pager still spans 50 000 items and a new edit is still partial;
- `patchDocument` with and without `docSliced`.

Validation:
- `cd packages/renderer && npx ng test --include src/app/collection/collection-view.spec.ts --include src/app/collection/collection-results.service.spec.ts` (with the other touched specs) — Pass
- Mutation check: with `slicedOf` bypassed, both CR-2 view tests fail — confirmed, then restored

### CR-3 — Arrays are cut even when the renderer cannot page them (result without `_id`)

Files changed:
- `packages/backend/src/docs/query/query.ts`
- `packages/backend/src/docs/query/query.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
`sliceLargeArrays` cut arrays of documents without `_id` (e.g. projection `{_id: 0}`). The renderer cannot register or page them, so it showed truncated data as complete.

Fix:
`sliceLargeArrays` returns documents without `_id` unchanged. The doc comment and the architecture note say so. A unit test covers this (with and without an `{_id: 0}` projection).

Validation:
- `npx vitest run packages/backend/src/docs/query/query.spec.ts` — Pass (110 tests)

### CR-5 — Page state keyed by row index is never reset

Files changed:
- `packages/renderer/src/app/collection/collection-results.service.ts`
- `packages/renderer/src/app/collection/collection-view.ts`
- `packages/renderer/src/app/explorer/services/page.service.ts`
- `packages/renderer/src/app/collection/collection-view.spec.ts`
- `packages/renderer/src/app/collection/collection-results.service.spec.ts`

Problem:
`PageService.clear()` had no caller, so a new result page or a re-run query inherited the previous row's inner page, and a `docs.getSlice` was fired for it.

Fix:
`CollectionResults` exposes `pageLoads`, a counter bumped in `pageArrived` but not by `patchDocument`, so a Save does not reset the pages. `CollectionView` clears `PageService` in an effect on it. `PageService.clear()` now first sets each existing page signal to 0, so views reading them update, and then forgets them. Tests:
- a re-run query shows the cut array on its first page again, with no extra `docs.getSlice` call;
- `pageLoads` counts page reads but not patches.

Validation:
- `cd packages/renderer && npx ng test --include src/app/collection/collection-view.spec.ts --include src/app/explorer/services/page.service.spec.ts` — Pass
- Mutation check: with the clear removed, the view test fails — confirmed, then restored

### CR-6 — Save refusal message speaks only of projections

Files changed:
- `packages/renderer/src/app/document/document-actions.service.ts`
- `packages/renderer/src/app/document/document-actions.service.spec.ts`
- `packages/renderer/src/app/document/table-editing.spec.ts`

Problem:
A partial document without an active projection (a cut large document, or one edited under a projection that has since been cleared) got the advice "Clear the projection and edit again".

Fix:
With a projection active, the message is unchanged. Without one, Save now says: "Not saved: this document was loaded only partly (with a projection, or a large document whose long arrays are read page by page), and this edit would replace data that was not loaded. Edit single values instead, or run the query without a projection and edit again." The two cleared-projection unit tests and the table-editing test now expect the new text. Their assertions are not weaker: they still check the exact or substring text, and that nothing is sent.

Validation:
- `cd packages/renderer && npx ng test --include src/app/document/document-actions.service.spec.ts --include src/app/document/table-editing.spec.ts` — Pass

## Not fixed

### CR-4 — No tests for the docs.find slice wiring

Status:
Out of scope (for this fixer run)

Reason:
The parent assigned this to the test-writer. The tests added here for CR-2, CR-3 and CR-5 cover part of the wiring (`patchDocument` with `sliced`, read-back params, `sliceLargeArrays` without `_id`).

## Validation summary

Focused tests:
- `npx vitest run packages/backend/src/docs/query/query.spec.ts` — 110 passed
- `cd packages/renderer && npx ng test --include src/app/collection/collection-view.spec.ts --include src/app/collection/collection-results.service.spec.ts --include src/app/document/document-actions.service.spec.ts --include src/app/document/table-editing.spec.ts --include src/app/explorer/services/array-slice.service.spec.ts --include src/app/explorer/services/page.service.spec.ts --include src/app/explorer/doc-paging.spec.ts` — 7 files, 217 passed

Full test suite:
- `npm run check` — Pass (lint, type check, unit tests: 53 files / 3175 tests in the Node packages, 76 files / 2097 tests in the renderer)

Lint/type-check/build:
- Included in `npm run check` — Pass

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check`)

Remaining unresolved findings:
1 (CR-4, assigned to the test-writer)

## Final status

All validated findings fixed and validation passed.
