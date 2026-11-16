# Code Review

Date: 2026-11-16

Task: paging-core - Core: collection paging strategy

Scope: committed changes of task `paging-core`, `git diff cd1dd9a..48dbb37 -- packages/core` (new `packages/core/src/paging/{sort,range,state,index}.ts`, `range.spec.ts`, `state.spec.ts`, re-export in `packages/core/src/index.ts`). Uncommitted test files added concurrently by the test-writer were ignored.

Requirements:
- `tasks/paging-core.md` acceptance criteria and the three recorded assumptions (`python tasks.py assumptions`)
- `SPEC.md` "Paging" (line 90-92), "Collection view" query bar (line 88: filter, projection, sort, collation, limit)
- `docs/ARCHITECTURE.md` (`packages/core` is pure TS paging math, no Node/Electron APIs, strict, no `any`)
- `packages/contract/src/docs.ts` (`docs.find` with `skip`/`limit`/`after`/`before`)
- `docs/QUALITY.md` (report contract)

Git range:
- Branch: main
- HEAD: 861507151e86b1ff2d5f27169e6c459f4bdc7ec8 (48dbb37 is the code commit; later commits touch only `tasks/`)
- Base/start: cd1dd9a41a0767be0d4846e95bdd61763eecbcfa
- Commits reviewed: 1 (48dbb37376281e0f7b5b19eeb867a6877572ae88; the `assume:` commits change only `tasks/paging-core.md`)

Commands run (read-only):
- `git log --oneline cd1dd9a..HEAD`, `git diff --stat cd1dd9a..48dbb37`, `git show 48dbb37:<spec files>`
- `python tasks.py assumptions`
- Reading `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/QUALITY.md`, `packages/contract/src/docs.ts`, all changed sources
- Running `npx vitest run src/paging/...` and `tsc --noEmit` was attempted but denied by the sandbox; findings below are from static analysis and hand-traced examples.

Summary: 0 P0, 1 P1, 2 P2, 2 P3

## P0 Critical

None.

## P1 High

- [ ] **CR-1 | Range paging silently drops rows whose sort key is null/missing (descending sorts) or of another BSON type**
    - File: `packages/core/src/paging/range.ts:130-137` and `:171-174`; mode choice in `packages/core/src/paging/sort.ts:78-89`
    - Category: Correctness
    - Problem: `strictBeyond` only special-cases a *null bound*. For a non-null bound it emits a plain `$gt`/`$lt`, which in MongoDB only matches values of the same BSON type (type bracketing). In a descending sort, null/missing values sort *after* all strings/numbers, so they can never be reached. Example: sort `{lastName: -1, _id: 1}` (range pageable because `_id` is included) on a collection where some documents lack `lastName`. Bound from the last row of a string page `{lastName: "Adams", _id: X}` gives `{lastName: {$lte: "Adams"}, $or: [{lastName: {$lt: "Adams"}}, {lastName: {$eq: "Adams"}, _id: {$gt: X}}]}`: no clause matches `lastName: null`/missing, so after the last string page the result comes back short, `pageLoaded` marks it `isLast`, and every document without `lastName` is never shown. The same happens for `before` in ascending sorts (going back from strings into the leading null region, e.g. after a far jump) and for any real mixed-type field (numbers and strings, ObjectId and string `_id`). `isRangePageable` selects range mode for any sort containing `_id` without any way to know the key types, so the "one BSON type per sort key" assumption cannot be upheld by callers. Missing optional fields are the normal case in MongoDB, so this is reachable in ordinary use of the collection view.
    - Why it matters: AC 2 requires range bounds to be built correctly for descending and compound sorts; a database explorer that silently omits documents (and reports the shortened page as the last page) is a data-visibility defect the user cannot detect.
    - Suggested fix: at minimum, add the null region in the direction where it lies beyond the bound: for "later" in descending order (`after` on a `-1` key, `before` on a `1` key) include `{field: {$eq: null}}` (and MinKey where applicable) as an extra disjunct, and drop the top-level `$gte`/`$lte` prefix narrowing in that case or widen it. For full type safety, either add disjuncts for the BSON types that sort beyond the bound's type (`$type` lists in canonical type order), or restrict range mode to sorts on `_id` only / fall back to skip mode for secondary keys. Add `walk` tests whose fixture contains documents with a missing secondary sort key, in ascending and descending order (the in-memory server in `state.spec.ts` already models type bracketing, so such a test would fail today).

## P2 Medium

- [ ] **CR-2 | A short `before` page becomes page 1 but disables Next and can leave an empty page 1**
    - File: `packages/core/src/paging/state.ts:240-243` together with `:134-140`
    - Category: Correctness
    - Problem: when a `before` request returns fewer rows than `limit`, `pageLoaded` sets `pageIndex = 0` and `isLast = false`, but `canNext` then returns `false` because of the "short page means the end" rule (`state.page.rows >= state.pageSize`). Rows still follow (the page the user came from). Concrete flows: estimated count of 120 with 70 real rows (or no count): Last reads rows 20-69 at index 2 (or 1), Previous returns 20 rows, the state says page 1 and Next is disabled. With a filter and the (collection-wide) estimated count, Last reads the few matching rows at a large index; Previous issues `before` from the first row, gets 0 rows, and the view shows an empty page 1 with `first/last = null` and Next disabled, recoverable only via First. The committed test `a short "before" page means the start was reached` asserts the index and `canPrevious` but not `canNext` or the row content of page 1.
    - Why it matters: SPEC requires first/previous/next/last/jump paging; the state machine reaches a state where valid navigation is blocked and page 1 shows the wrong (or no) rows. Estimated counts are the SPEC default, so approximate indexes are common.
    - Suggested fix: when a `before` read is short, don't present it as page 1; either have the caller re-read `firstPage` (e.g. return a state flag / follow-up request), or record that the start was reached separately from `isLast` and make `canNext` ignore the short-page heuristic for `before` results. Add tests for `canNext` after a short `before` and for an empty `before` result.

- [ ] **CR-3 | Sort keys excluded by the user's projection become `null` bounds, breaking range paging**
    - File: `packages/core/src/paging/state.ts:237-239`, `packages/core/src/paging/range.ts:111-120`
    - Category: Integration
    - Problem: `pageLoaded` derives `first`/`last` with `sortKeyValues` from the displayed documents, and `valueAtPath` maps an absent field to `null`. SPEC line 88 makes projection a Must in the query bar; with a projection such as `{_id: 0, name: 1}` on the default `{_id: 1}` sort, every bound is `{_id: null}`, so Next sends `{_id: {$ne: null, $not: {$type: "minKey"}}}` and re-reads page 1 forever; with a projection excluding a secondary key, bounds are silently wrong. `PagingOptions` has no projection input and nothing documents that the caller must keep the sort keys in the projection, so the backend/renderer task that integrates this module has no signal.
    - Why it matters: wrong pages (repeated page 1 or skipped rows) for a normal query-bar combination, with no error.
    - Suggested fix: either accept the projection (or a "sort keys available" flag) and fall back to skip mode when any sort key may be projected away, or make `pageLoaded`/`sortKeyValues` distinguish an absent key from a null value and fall back to skip for the next request; at least document the requirement on `pageLoaded` and add a test.

## P3 Low

- [ ] **CR-4 | Range mode ignores collation**
    - File: `packages/core/src/paging/sort.ts:78-89`, `packages/core/src/paging/state.ts:66-73`
    - Category: Correctness
    - Problem: the query bar supports a collation (SPEC line 88). With a non-simple collation (e.g. strength 2), distinct string `_id`s or unique-index values (`"A"` and `"a"`) compare equal, so the sort-key tuple is no longer unique and `$gt "a"` skips `"A"`. `isRangePageable`/`createPaging` have no collation input.
    - Why it matters: niche, but silently skips documents in range mode.
    - Suggested fix: add a collation (or `simpleCollation: boolean`) option and use skip mode when a non-simple collation is set and any range key may hold strings; or record it as an assumption for the integrating task.

- [ ] **CR-5 | `lastPage` without a count for an opaque sort is just "next page"**
    - File: `packages/core/src/paging/state.ts:185-191`
    - Category: Quality
    - Problem: with `sort === null` and `count === null`, `lastPage` returns `skipRequest(state, pageIndex + 1)`, i.e. the next page, and `pageLoaded` does not mark it last unless it happens to be short. The docstring only describes the reversed-sort case. Also, the `sort.length === 0` branch is unreachable through `createPaging`/`setSort` (an empty sort always becomes range mode with `DEFAULT_SORT`), so recorded assumption #3 ("natural order in skip mode") describes dead code.
    - Why it matters: a caller wiring a "Last" button gets surprising behaviour for `$meta` sorts before a count is known.
    - Suggested fix: expose a `canLast(state)` (false for an opaque sort without a count) or document the behaviour; drop or test the empty-sort branch.

## Review conclusion

Material issues found; fix before completing the task.

Acceptance criterion 1 (next/previous/jump/last in range and skip mode, sort switch resets to page 1) has matching unit tests in `state.spec.ts` (`walk`, `last page`, `jump to page`, `resets`), but I could not execute them here (test run denied by the sandbox), so their passing state is unverified by this review. Acceptance criterion 2 is not fully met: compound/descending bounds are correct for single-type, non-null data, but CR-1 shows descending (and ascending `before`) bounds lose null/missing and other-type rows, and no test covers such data.
