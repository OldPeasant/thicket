# Code Review

Date: 2026-11-17

Task: doc-paging - M1: Paging inside documents

Scope: committed task change `git diff f316c01..HEAD`, excluding `tasks/` and `reviews/` (34 files: backend `docs.find` slicing, contract, collection view/results, explorer pager, page/slice services, component and e2e tests, architecture notes). Uncommitted working-tree changes (new and modified spec files, apparently from the test-writer) are not part of this review.

Requirements:
- tasks/doc-paging.md acceptance criteria and recorded assumptions
- SPEC.md "Paging inside a document"
- docs/ARCHITECTURE.md "Paging inside documents" and conventions
- AGENTS.md, docs/QUALITY.md
- Parent instructions (design summary)

Git range:
- Branch: main
- HEAD: 3105a90
- Base/start: f316c01455bdefa19e021cd70e0ff9106c3a3b8b
- Commits reviewed: 4 (21e2923, 6e9a82e, 4079c19, 3105a90)

Commands run:
- `git log --oneline f316c01..HEAD`, `git diff --stat` / `git diff f316c01..HEAD -- <paths>` -> 4 commits, 34 files
- `npx vitest run packages/backend/src/docs/query/query.spec.ts` -> 106 passed
- `cd packages/renderer && npx ng test --include src/app/explorer/doc-paging.spec.ts` -> 12 passed
- `python tasks.py verify doc-paging` -> both criteria still unverified (no evidence recorded yet; the parent records it after review)
- e2e (`test/e2e/doc-paging.e2e.ts`) read, not run by the reviewer

Acceptance criteria assessment:
1. Component tests: `packages/renderer/src/app/explorer/doc-paging.spec.ts` covers a 2 000-item array with pager, first/prev/next/last, jump to page 7 (plus invalid and out-of-range input), and an edit on page 7 that survives paging away and back with the array intact. Met by the code; evidence still to be recorded.
2. e2e: `test/e2e/doc-paging.e2e.ts` seeds a 50 000-item document (~2 MB, above the 1 MiB threshold), asserts the first page shows within 2 s, and uses the server profiler as the command log to assert exactly the `$slice` reads `[100,100]`, `[39900,100]`, `[49900,100]`. A server-side profiler is a reasonable "network log". The test design matches the criterion; evidence of a run still has to be recorded.

Summary: 0 P0, 0 P1, 4 P2, 2 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Sparse-array memo never hits on the loaded first page; every `arr` access rebuilds a total-length array**
    - File: `packages/renderer/src/app/explorer/services/array-slice.service.ts:70` and `packages/renderer/src/app/explorer/json-table/json-table.component.ts:234-247`
    - Category: Quality
    - Problem: `ArraySliceService.page()` returns a new object (`{ items: arr.slice(start, end), error: null }`) on every call while the window lies within the loaded items. `JsonTableComponent.arr` memoises on `memo.page === page`, so on the first page (the page shown when a large document opens, and whenever the user returns to it) the memo always misses and `arr` allocates `new Array(total)` (50 000 slots in the e2e) and copies the loaded items again. The template reads `arr` many times per change detection (`arr[i]` per row and cell, `hasCell`, `cell`, `cellForceVisible` -> `arrForce`, `isArrayOfObjects`, `hasNonObjectItems`, `keyInfo`). Every rebuild also gives a new identity, so `keyMemo` and `arrForceMemo` miss as well, and `keyInfo` runs `for (const item of arr)` over all 50 000 slots, holes included.
    - Why it matters: Change detection on the very view this task optimises costs on the order of hundreds of total-length allocations and scans per pass. It grows with the array's total length, not the page size. The e2e only measures the first render with two columns, so it does not catch this.
    - Suggested fix: Cache the in-memory page in `ArraySliceService.page()` too (store it in `entry.pages` under its key, or memoise on `start`/`end`). Alternatively, memoise `arr` on `(loaded, start, end, page.items)` instead of the page object's identity.

- [ ] **CR-2 | After Save the large document is read back whole, and a failed read-back marks the cut document as whole**
    - File: `packages/renderer/src/app/collection/collection-results.service.ts:265-278` (with `packages/renderer/src/app/document/document-actions.service.ts:283-298`)
    - Category: Correctness / Integration
    - Problem: `patchDocument` assumes "the new version is the whole document" and clears `sliced[index]`. Two paths break that assumption:
        - Read-back succeeds: `readBack` calls `docs.get` without `sliceAbove`, so saving any field of a 50 000-item document sends the whole ~2 MB document to the renderer. The arrays then lose their getSlice paging and become fully editable. This contradicts SPEC ("instead of sending the whole document") for every saved large document.
        - Read-back fails: the catch shows `saved`, which is the cut document (100 items). Because `sliced[index]` is now `undefined`, the cut array is no longer registered or locked, `isPartial` turns false, and the UI presents a 100-item array as complete and editable. A later edit of that array is stopped only by the `$eq` conflict filter. The user then gets a confusing conflict instead of the read-only state.
    - Why it matters: The large-document protection is lost after the first save, and the failure path shows truncated data as if it were complete.
    - Suggested fix: Read back with `sliceAbove` (the same `nestedPageSize`) and carry the returned `sliced` into the page. Or keep `sliced[index]` when the read-back fails, or when the patched document still has the cut arrays. Add a test for both paths.

- [ ] **CR-3 | Arrays are cut even when the renderer cannot page them (result without `_id`)**
    - File: `packages/backend/src/docs/query/query.ts:328-352` and `packages/renderer/src/app/collection/collection-view.ts:446-452`
    - Category: Correctness / Integration
    - Problem: `sliceLargeArrays` cuts long top-level arrays regardless of whether the document carries `_id`. With a projection such as `{"_id": 0}`, `_id` is not mentioned for `items`, so the array is still cut. In the renderer, `documentKey(loaded)` is then `null`, so `treeOf` registers nothing. The explorer shows a plain 100-item array with no pager total, no slice note and no lock, as if it were the whole array. The raw view shows the same truncated data.
    - Why it matters: Data is silently misrepresented: the user sees 100 of 50 000 items with nothing indicating truncation, and `docs.getSlice` (which needs `_id`) cannot recover the rest.
    - Suggested fix: Do not cut documents without `_id` in `sliceLargeArrays` (simplest; `getSlice` cannot address them anyway). Or show a "partly loaded" marker in the renderer when `sliced` is set but no source can be registered. Add a test.

- [ ] **CR-4 | No tests for the `docs.find` slice wiring between backend, contract and renderer**
    - File: `packages/backend/src/docs/query/query.ts:372-389`, `packages/renderer/src/app/collection/collection-results.service.ts:359-372`, `packages/renderer/src/app/collection/collection-view.ts:262-269,436-473`, `packages/contract/src/docs.ts:41-48,91-102`
    - Category: Tests
    - Problem: The committed tests cover `sliceLargeArrays` alone, the explorer with a hand-registered `ArraySliceService`, and the e2e happy path. Nothing tests these parts:
        - `streamFind` with `slice`: the per-chunk `index` with `batchSize`, the reverse/`fromEnd` path, and omitting `sliced` when nothing was cut.
        - `CollectionResults`: mapping `sliced` across several stream batches (`docs.length + s.index`), `findParams` sending `slice`, and `patchDocument` keeping `sliced` aligned on delete.
        - `CollectionView.treeOf` / `sliceSource`: registration and the `docs.getSlice` params.
        - `isPartial`: feeding Save and the raw editor.
        - The contract schemas: `slice` params and `sliced` batch entries (valid and invalid).
    - Why it matters: These off-by-one and index-alignment paths are what the e2e (one document, one batch) cannot exercise. A regression would silently attach slices to the wrong document.
    - Suggested fix: Add focused unit tests for the paths above. Uncommitted spec changes in the working tree, such as `collection-results.service.spec.ts`, may already cover part of this. Make sure they are committed and cover the batch-offset mapping.

## P3 Low

- [ ] **CR-5 | Page state keyed by row index is never reset, so a new result page inherits the previous document's inner page**
    - File: `packages/renderer/src/app/explorer/services/page.service.ts:9-39` (uids from `packages/renderer/src/app/collection/collection-view.html:368` and the table's `cellUid(i, k)`)
    - Category: Correctness
    - Problem: Keys are row-index based (`uid + '-' + $index`, `cellUid(i, 'items')`). `PageService.clear()` has no caller, and the collection view keeps one instance across result pages and query re-runs. After paging the result to the next documents, or re-running the query, row *i*'s array opens on the page the previous document in that row was on. For a large document this also fires a `docs.getSlice` immediately.
    - Why it matters: The user sees an unexpected mid-array page on a different document, and an unnecessary server read happens.
    - Suggested fix: Call `pages.clear()` when a new result page arrives (for example from `CollectionView` on `results.page()` changes), or key page state by document `_id` plus path.

- [ ] **CR-6 | Large-document refusal and raw views are worded for projections only**
    - File: `packages/renderer/src/app/document/document-actions.service.ts:323-325`
    - Category: Quality
    - Problem: When `partial` comes from cut arrays (no projection active), Save refuses with "with a projection active ... Clear the projection and edit again", which is wrong advice. The raw editor and raw view also show the cut array (first 100 items) with no marker that it is incomplete.
    - Why it matters: Misleading guidance; the user cannot act on it.
    - Suggested fix: Use a message that covers large documents ("this document was loaded partly ..."). Optionally, add a note in the raw editor/view when the document has cut arrays.

## Review conclusion

Material issues found; fix before completing the task.

Both acceptance criteria are addressed by the committed tests (the component spec passes locally; the e2e design matches the criterion, and its run evidence must still be recorded with `tasks.py verify`). The P2 findings concern resilience and performance of the large-document path: the first-page memo miss (CR-1), the post-save read-back defeating slicing and losing the partial marker (CR-2), cut arrays that cannot be paged without `_id` (CR-3), and missing tests for the find/slice wiring (CR-4). They should be fixed or explicitly dispositioned before `done`.
