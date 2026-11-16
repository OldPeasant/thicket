# Code Review

Date: 2026-11-16

Task: paging-core - Core: collection paging strategy

Scope: re-review of the final revision of task `paging-core`, `git diff cd1dd9a..364355d -- packages/core` (`packages/core/src/paging/{sort,range,state,projection,index}.ts` and their specs, re-export in `packages/core/src/index.ts`). Focus: resolution of CR-1..CR-5 from the first review and the new code (null-inclusive lower bounds in `range.ts`, `projection.ts`, the collation flag, `canNext`). Current HEAD `6673d52` is a rebase of the same commits; `git diff 364355d 6673d52 -- packages/core` is empty. Uncommitted spec changes added concurrently by the test-writer (`projection.spec.ts`, `state.spec.ts`) were not reviewed.

Requirements:
- `tasks/paging-core.md` acceptance criteria and the four recorded assumptions (`python tasks.py assumptions`)
- `SPEC.md` "Paging" (line 90-92: first/previous/next/last/jump, range paging, estimated count by default) and the query bar (projection, collation)
- `docs/ARCHITECTURE.md` (`packages/core` is pure TS, strict, no Node/Electron APIs)
- `reviews/paging-core/fixes.md` (claimed fixes)
- MongoDB query semantics: type bracketing of `$gt`/`$lt`, `$eq: null` matching null and missing, null/missing sorting below other types, projection inclusion/exclusion rules (4.4+)

Git range:
- Branch: main
- HEAD: 364355d773c8c43163f4d8f15c120a1145b1c37c (reviewed revision; rebased as 6673d526ac91328c02d83e4fad45b716b76a3f41 with identical code)
- Base/start: cd1dd9a41a0767be0d4846e95bdd61763eecbcfa
- Commits reviewed: 3 (a96845b implementation, 0f020c1 tests and reports, 364355d fixes)

Commands run (read-only):
- `git log --oneline cd1dd9a..364355d`, `git diff --stat cd1dd9a..364355d`, `git diff 364355d HEAD --stat -- packages/core` (empty)
- `git diff a96845b 364355d -- packages/core/src/paging/range.ts packages/core/src/paging/state.ts`
- Reading all of `range.ts`, `state.ts`, `projection.ts`, `sort.ts`, `index.ts` and the spec files (including the fake server in `state.spec.ts`)
- `cd packages/core && npx vitest run src/paging` -> 4 files, 100 tests passed (working tree, including the test-writer's uncommitted spec additions)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Disposition of the earlier findings

- **CR-1 (P1, null/missing sort keys dropped by range bounds): resolved.** `rangeFilter` (`range.ts:78-87`) now adds an `{...prefix, k: {$eq: null}}` clause wherever a key must be "lower" than a non-null bound, and the top-level first-key bound is only `$gte` on the "greater" side (`range.ts:93-95`). Traced by hand for `after`/`before` on ascending and descending, single and compound keys, and for null bounds (`$ne: null, $not: {$type: 'minKey'}` / `$type: 'minKey'`): every clause matches exactly the rows strictly beyond the bound in MongoDB order for null/missing plus one non-null type per key. Mixed non-null BSON types remain out of scope by recorded assumption and are documented in the JSDoc. Covered by `range.spec.ts` and the fake-server walks in `state.spec.ts` "documents missing a sort key" (descending forward, ascending backward, ascending forward from the null rows).
- **CR-2 (P2, canNext false after a short `before` page): resolved** for the reported case: `canNext` (`state.ts:162-166`) relies on `page.isLast` and the exact count only; `pageLoaded` never sets `isLast` for a `before` read. Tested in `state.spec.ts:557-575` and `:610-628`. A remaining edge of the empty-`before` case is CR-1 below.
- **CR-3 (P2, sort keys projected away): resolved** as an explicit caller contract: `projectionWithSortKeys` (`projection.ts`) plus JSDoc on `rangeFilter` and `pageLoaded`, and a recorded assumption. Checked against MongoDB rules: `$slice`/`$meta` alone are neutral (exclusion-style), literals/expressions/`$elemMatch` make an inclusion projection, `_id` is returned by default unless excluded, overlapping child paths are replaced to avoid path collisions, exclusions of the field/parent/child are removed in exclusion mode. Tested in `projection.spec.ts` and a projected fake-server walk.
- **CR-4 (P3, collation ignored): resolved.** `PagingOptions.collation` / `PagingState.collation` force skip mode (`state.ts:96-98`), `setSort` carries the flag, `setPageSize`/`resetPaging` keep it via spread. Tested.
- **CR-5 (P3, lastPage for opaque sort without count; dead empty-sort branch): resolved.** Behaviour documented in the `lastPage` JSDoc; the empty-sort branch is now reachable (skip mode with a collation and no sort) and tested.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | After an empty `before` result, Next skips page 1's rows**
    - File: `packages/core/src/paging/state.ts:174-186` (`nextPage`), `:275-280` (`pageLoaded`), `:162-166` (`canNext`)
    - Category: Correctness
    - Problem: an empty `before` read becomes page index 0 with `rows: 0`, `first`/`last` `null` and `isLast: false`. Since the CR-2 fix, `canNext` is true there, and `nextPage` has no `last` bound, so it falls back to `skipRequest(state, 1)` (`skip = pageSize`). Reachable with the SPEC-default estimated count and a filter (the estimate is collection-wide): e.g. 100 matching rows, page size 50, estimate far higher; Last reads rows 50-99 at a high index, Previous reads rows 0-49 (full page, index not 0), Previous again returns 0 rows and shows an empty page 1; Next then shows rows 50-99 as page 2, so rows 0-49 never appear on page 1 until the user clicks First. The test `an empty "before" result becomes page 1 and is not the last page` (`state.spec.ts:610-621`) asserts `canNext` true but not what Next reads (it would read `_id` 5-9 and skip 0-4). The recorded assumption says the UI layer should reload `firstPage` in this case, but the module's API (JSDoc of `pageLoaded`/`nextPage`, no flag on the state) gives the integrating caller no signal; the fixer flagged this as a residual observation.
    - Why it matters: confusing navigation (an empty page 1 followed by page 2) in a reachable flow; no data is lost and First recovers, hence low priority.
    - Suggested fix: smallest options: in range mode make `nextPage` return `firstPage(state)` (or a request without skip) when the current page is empty at index 0, or have `pageLoaded` mark the state so the caller reloads `firstPage` (and state this in the `pageLoaded` JSDoc); add a test asserting the rows Next reads after an empty `before` result.

## Review conclusion

No material issues found.

All five earlier findings are resolved in the final code, and both acceptance criteria are met: criterion 1 (next/previous/jump/last in range and skip mode, sort switch resets to page 1) and criterion 2 (range bounds for compound and descending sorts, now including null/missing keys) have matching unit tests, which pass (`npx vitest run src/paging` -> 100 passed). The only new finding (CR-1, P3) is an edge case of the estimated-count misalignment that the recorded assumption already hands to the UI layer; the parent may fix it or accept it with that assumption.
