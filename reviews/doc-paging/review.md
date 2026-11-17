# Code Review

Date: 2026-11-17

Task: doc-paging - M1: Paging inside documents

Scope: re-review of the final code. Committed task change `git diff a068f5479b252045ad88e3ec77956e565e3eb45c..52ba7e02b8830716c87ee3b506e5a136905d7319`, excluding `tasks/` and `reviews/` (47 files). The fix commits 158b959, 32bf828 and 52ba7e0 were checked in detail (`git diff a4191c8..HEAD`). The working tree was clean.

Requirements:
- tasks/doc-paging.md acceptance criteria and the three recorded assumptions
- SPEC.md "Paging inside a document"
- docs/ARCHITECTURE.md "Paging inside documents"
- AGENTS.md, docs/QUALITY.md
- Previous review (CR-1..CR-6), reviews/doc-paging/fixes.md, reviews/doc-paging/tests.md
- Parent instructions

Git range:
- Branch: main
- HEAD: 52ba7e02b8830716c87ee3b506e5a136905d7319
- Base/start: a068f5479b252045ad88e3ec77956e565e3eb45c (`git merge-base HEAD origin/main`)
- Commits reviewed: 8 (dc1bf2b, 670ffdb, 6539f25, ea897c5, a4191c8, 158b959, 32bf828, 52ba7e0)

Commands run:
- `git log --oneline origin/main..HEAD` -> 8 commits, all starting with "doc-paging:"
- `git diff --stat a068f54..HEAD -- . ':!tasks' ':!reviews'` -> 47 files, +2773/-531
- `git diff a4191c8..HEAD` (production and spec changes of the fix commits) -> read in full
- `npx vitest run packages/backend/src/docs/query/query.spec.ts packages/contract/src/index.spec.ts` -> 2 files, 442 passed
- `cd packages/renderer && npx ng test --include src/app/explorer/doc-paging.spec.ts --include src/app/collection/collection-view.spec.ts --include src/app/collection/collection-results.service.spec.ts --include src/app/document/document-actions.service.spec.ts --include src/app/document/table-editing.spec.ts --include src/app/explorer/services/array-slice.service.spec.ts --include src/app/explorer/services/page.service.spec.ts --include src/app/raw-editor/raw-editor-collection.spec.ts` -> 8 files, 225 passed
- The reviewer did not re-run the e2e (`test/e2e/doc-paging.e2e.ts`; it needs a renderer/desktop build and the mongo8 container). tests.md records a run: 1 passed, the document opened in 227 ms, and the profiler showed the `$slice` reads `[100,100]`, `[39900,100]`, `[49900,100]`. The test file has not changed since the previous review, which found its design matches criterion 2.

Acceptance criteria assessment:
1. Component tests: `doc-paging.spec.ts` covers a 2 000-item array with a pager, first/previous/next/last, jumping to a page (including invalid input), an edit on page 7 that survives paging away and back, and a new test that deletes the right item on page 7. They passed locally (in the run above). Met.
2. e2e: the test design matches the criterion. The run is recorded by the test-writer (see above). The parent must record the evidence with `tasks.py verify`.

## Status of previous findings

- CR-1 (sparse-array memo miss on the first page): **Resolved.** `ArraySliceService.page()` now caches in-memory windows per registered array (`inMemory` WeakMap, `array-slice.service.ts:73-89`), so `JsonTableComponent.arr` (`json-table.component.ts:240`) hits its memo on the loaded first page. A regression test is in `array-slice.service.spec.ts`. Unregistered arrays still get a new object each time, but they don't go through the sparse path, so this doesn't matter.
- CR-2 (read-back after Save): **Resolved.** `readBack` asks `docs.get` with `sliceAbove` when `slicedOf(key)` reports cut arrays (`document-actions.service.ts:293-311`). It passes on the returned `sliced`, and keeps the previous `sliced` when the read-back fails. `patchDocument` stores the entry (`collection-results.service.ts:269-288`). Three view tests cover the successful cut read-back with paging afterwards, a small document read back whole, and a failed read-back that keeps the pager and the partial flag. A new edge case from this fix is CR-7.
- CR-3 (cut arrays without `_id`): **Resolved.** `sliceLargeArrays` returns documents without `_id` unchanged (`query.ts:338`). A unit test covers it with and without an `{_id: 0}` projection.
- CR-4 (missing wiring tests): **Resolved.** I checked the tests tests.md maps to each item: per-batch index and fromEnd in query.spec.ts, the batch-offset mapping across 3 batches and `slice` params in collection-results.service.spec.ts, `docs.getSlice` params in collection-view.spec.ts, the contract schema tests, and the new raw-editor partial test. All are present and passing.
- CR-5 (inner page state never reset): **Resolved** for new result pages and re-run queries. `pageLoads` is bumped in `pageArrived` only, and `CollectionView` clears `PageService` in an effect (`collection-view.ts:333-339`). `PageService.clear()` resets live signals before forgetting them. The view test shows no extra `docs.getSlice` after a re-run. When a document is deleted from the page, the rows below still take over the row-indexed page state. Collapse state, which was there before this task, behaves the same way, so this is not reported.
- CR-6 (refusal wording): **Resolved.** Without an active projection, Save now shows `PARTIAL_REFUSED` (`document-actions.service.ts:124-128, 340-344`). The optional "partly loaded" marker in the raw view and raw editor was not added. The previous review called it optional, so it is not reported again.

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-7 | The read-back with `sliceAbove` cuts arrays with all-digit field names, which `docs.getSlice` cannot page**
    - File: `packages/backend/src/docs/query/query.ts:524` (`getDocument`), reached through `packages/renderer/src/app/document/document-actions.service.ts:305`
    - Category: Integration
    - Problem: `sliceLargeArrays` (`docs.find`) skips top-level arrays whose field name is all digits, because `getSlice`'s `pathParts` refuses numeric components (`INVALID_PARAMS`). `getDocument` skips only names with `.` or a leading `$`. Since CR-2, saving a large document reads it back with `sliceAbove`. An array such as `"2024": [...]` with more than `above` items came whole and editable from `docs.find`, but after Save it comes back cut and is listed in `sliced`. `CollectionView.treeOf` then registers it, and every page past the first fails in `docs.getSlice` with `INVALID_PARAMS`. The array is also locked and read-only now. Before this task no renderer path called `docs.get` with `sliceAbove`, so this change is the first to reach this path.
    - Why it matters: Field names that are all digits are rare. Where they occur, an array becomes unpageable and read-only after a plain Save, and it behaved differently before the Save.
    - Suggested fix: Add the same `/^\d+$/` exclusion to `getDocument`'s slicing loop, matching `sliceLargeArrays`, and add a `getDocument` unit test for it. Alternatively, make `pathParts` accept numeric top-level names. The current restriction exists for array indexes, which do not apply to a top-level field.

## Notes for the parent (not findings)

- The scope lines in tests.md and fixes.md name commit hashes from before the latest rebase (`2656cdb..2ce5939`, `eb68a3a`/`05b3a3f`). The code they describe matches the current HEAD by content. Under docs/QUALITY.md "Freshness" this is fine, but `quality.json`'s `reviewed_revision` must name the current hash.

## Review conclusion

No material issues found.

All six previous findings are resolved in the current code, and the focused backend, contract and renderer suites pass (442 and 225 tests). The only new finding, CR-7, is a low-priority edge case for field names that are all digits. It can be fixed now or recorded as a follow-up. Before `done`, the parent still has to record evidence for both criteria with `tasks.py verify`.
