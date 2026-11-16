# Fix Report

Date: 2026-11-16

Task: paging-core - Core: collection paging strategy

Scope: current task `paging-core`, base `cd1dd9a41a0767be0d4846e95bdd61763eecbcfa`, fixes applied on top of HEAD `dac5358` (uncommitted working-tree changes in `packages/core/src/paging/`). Findings from `reviews/paging-core/review.md` (CR-1..CR-5) and `reviews/paging-core/tests.md` (TW-1, TW-2), as approved by the parent worker.

## Fixed findings

### CR-1 / TW-2 — Range bounds skip documents whose sort key is null/missing

Files changed:
- `packages/core/src/paging/range.ts`
- `packages/core/src/paging/range.spec.ts`

Problem:
For a non-null bound, a key condition that means "lower in BSON order" was a plain `$lt: v`, which does not match null/missing values (type bracketing), although they sort below every other value. Descending sorts paging forward (`after` on a `-1` key) and ascending sorts paging back (`before` on a `1` key) never reached documents without the field. The top-level `$lte` prefix bound on the first key excluded them as well.

Fix:
`rangeFilter` now emits two alternatives in the outer `$or` for such a key: `{...prefixEq, k: {$lt: v}}` and `{...prefixEq, k: {$eq: null}}` (a single-key range on the "lower" side therefore also becomes an `$or`). The first-key prefix bound is only added on the "greater" side (`$gte`); on the "lower" side it is dropped. Null bounds keep their special cases (`$ne: null, $not: {$type: 'minKey'}` / `$type: 'minKey'`) and are not split again. Mixed non-null BSON types remain out of scope (recorded assumption); the JSDoc says so. `range.spec.ts` expectations were updated to the new filter shape (the previous expectations encoded the defect) and a test for a null bound on a descending key was added.

Validation:
- `cd packages/core && npx vitest run` — Pass (the two TW-2 tests in `state.spec.ts` "documents missing a sort key" now pass, unchanged)

### CR-2 / TW-1 — canNext false after a short "before" page became page 1

Files changed:
- `packages/core/src/paging/state.ts`
- `packages/core/src/paging/state.spec.ts`

Problem:
`canNext` treated every short page as the end, so a short (or empty) `before` page that `pageLoaded` turned into page 1 with `isLast: false` blocked Next although rows follow.

Fix:
`canNext` no longer uses the short-page heuristic; it relies on `page.isLast` (set by `pageLoaded` for `fromEnd` reads and for short pages not read `before` a bound) and on the exact-count check. JSDoc added. New tests: an empty `before` result becomes page 1 with `canNext` true; a short page read forward is still the end.

Validation:
- `cd packages/core && npx vitest run` — Pass (TW-1 test "next stays available after a short before page became page 1" passes, unchanged)

### CR-3 — Sort keys excluded by the user's projection break range bounds

Files changed:
- `packages/core/src/paging/projection.ts` (new)
- `packages/core/src/paging/projection.spec.ts` (new)
- `packages/core/src/paging/index.ts`
- `packages/core/src/paging/range.ts`, `packages/core/src/paging/state.ts` (JSDoc only)
- `packages/core/src/paging/state.spec.ts`

Problem:
Bounds come from the sort-key values of the loaded rows; a projection that drops a sort key (e.g. `{_id: 0, name: 1}`) made every bound `null` and produced wrong pages without an error. Nothing told the integrating caller to keep the sort keys.

Fix:
New exported pure helper `projectionWithSortKeys(projection, sort)`: undefined/empty projection or a null/empty sort is returned unchanged. Inclusion projection: missing sort fields are added as `1`, skipped when the field or a parent path is already included, included child paths are replaced by the field, and exclusions/operators on the field or a parent (e.g. `_id: 0`) are removed. Exclusion projection (including `_id: 0` alone): exclusions equal to, parent of or child of a sort field are removed. Operators (`$slice`, `$elemMatch`, `$meta`, expressions) on non-sort fields are kept. The JSDoc of `projectionWithSortKeys`, `rangeFilter` and `pageLoaded` states that range paging callers must use it. Tests in `projection.spec.ts` (9 tests) and a fake-server walk in `state.spec.ts` with a projected collection.

Validation:
- `cd packages/core && npx vitest run` — Pass

### CR-4 — Range mode ignores collation

Files changed:
- `packages/core/src/paging/state.ts`
- `packages/core/src/paging/state.spec.ts`

Problem:
With a non-default collation the sort-key tuple may not be unique ("A" = "a"), so range bounds can skip rows; there was no collation input.

Fix:
`PagingOptions.collation?: boolean` (true for a non-default collation) and a `collation: boolean` field on `PagingState`. `createPaging` chooses skip mode when it is true (an empty sort then keeps natural order); `setSort` carries the flag from the state. Tests: mode selection with and without the flag, `setSort` keeps it, paging by skip with a collation.

Validation:
- `cd packages/core && npx vitest run` — Pass

### CR-5 — lastPage without a count for an opaque sort; empty-sort branch

Files changed:
- `packages/core/src/paging/state.ts` (JSDoc only)
- `packages/core/src/paging/state.spec.ts`

Problem:
The `sort.length === 0` branch in `lastPage` was unreachable, and the behavior for an opaque sort without a count was undocumented.

Fix:
The empty-sort branch is reachable now (CR-4: an empty sort with a collation stays in skip mode with natural order), so it was kept and covered by a test. The `lastPage` JSDoc now documents that for an opaque sort or natural order without a count, "last" reads the next page (`pageIndex + 1`) and is only marked last if it comes back short. Test added for that case.

Validation:
- `cd packages/core && npx vitest run` — Pass

## Not fixed

None of the supplied findings is left unfixed.

Residual observation for the parent (not a supplied finding, no code change): after an empty `before` result became page 1 (CR-2 scenario with an empty result), the page has no `last` bound, so `nextPage` falls back to `skipRequest` for index 1 (`skip = pageSize`) and would skip the first `pageSize` rows. Re-reading `firstPage` is the correct recovery; the parent may decide whether this edge case needs handling in this task.

## Validation summary

Focused tests:
- `cd packages/core && npx vitest run` — Pass, 5 files, 95 tests
- `cd packages/core && npx vitest run --coverage --coverage.include=src/paging/*.ts --coverage.reporter=text` — Pass; paging files 195/196 statements, 229/230 branches, 51/51 functions, 155/155 lines (only `projection.ts` line 11, the `null`/array guard in `isNeutral`, has an uncovered branch)

Full test suite:
- `npm run check` (repo root, via `sh .taskcheck`) — Pass: root vitest 9 files, 693 tests passed; renderer `ng test` 5 files, 181 tests passed

Lint/type-check/build:
- `npx prettier --write packages/core/src` — applied
- `npm run lint` (part of `npm run check`) — Pass (an initial `@typescript-eslint/no-dynamic-delete` error in `projection.ts` was fixed by building the result from filtered entries)
- `npm run typecheck` (part of `npm run check`) — Pass

`.taskcheck`:
- Pass (`sh .taskcheck` runs `npm run check`)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
