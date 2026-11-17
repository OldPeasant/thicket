# Code Review

Date: 2026-11-17

Task: docs-get-numeric-slice - docs.get sliceAbove skips arrays with all-digit field names (like docs.find)

Scope: task commits d5e0840 (fix and test) and 3be0d7e (test-writer: 3 more tests, test report) on top of task base 85db64d (`git diff 85db64d..3be0d7e`)

Requirements:
- tasks/docs-get-numeric-slice.md (acceptance criterion 1)
- reviews/doc-paging/review.md CR-7 (background, referenced by the task)
- AGENTS.md, docs/ARCHITECTURE.md conventions
- Existing behavior of `sliceLargeArrays` and `getSlice`/`pathParts` in packages/backend/src/docs/query/query.ts

Git range:
- Branch: main
- HEAD (reviewed revision): 3be0d7eb276c66307cf4e854e9b2eec2e2f4d58b
- Base/start: 85db64d4f7fe71120e4e5899cba0eee60a489944
- Commits reviewed: 2 (d5e0840 "docs.get sliceAbove: leave all-digit top-level arrays whole"; 3be0d7e "docs-get-numeric-slice: more getDocument tests, test report")

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Verification performed

- Read the full diff and `getDocument`, `sliceLargeArrays`, `pathParts` and `getSlice` in full. Production code changed only in d5e0840; `git diff --stat d5e0840..3be0d7e -- packages` shows only `query.spec.ts` (+61). The rest of 3be0d7e is `reviews/docs-get-numeric-slice/tests.md`.
- `getDocument` (query.ts:526) now skips paths matching `/^\d+$/`. This is the same expression `sliceLargeArrays` uses (query.ts:343), and it matches `pathParts` (query.ts:555), which rejects all-digit components with INVALID_PARAMS. Skipped arrays get no `$slice` projection entry and no `sliced` record, so they come back whole and can still be edited. The JSDoc above `getDocument` was updated to match.
- Implementer test (query.spec.ts:1255-1267): `"2024"` and `"0"` next to `items`. It checks the find projection (only `{ items: { $slice: 10 } }`) and `sliced`, and it fails on the old code.
- Test-writer tests added in 3be0d7e (reviewed):
  - `names with digits that are not all digits are still sliced` (`2024a`, `a1`, `-1`): pins the rule to "all digits" rather than "contains a digit". All three names pass `pathParts`, so `docs.getSlice` can page them, which makes slicing correct.
  - `inclusion projection: an included all-digit array stays whole and included`: `2024` stays `1` in the projection and is not turned into a `$cond`/`$slice` expression, while `items` is still sliced. The expectations match the code path (`inclusion` is true and the digit check runs before `sliceable`).
  - `exclusion projection: an unmentioned all-digit array is not sliced`: the projection stays `{ secret: 0, items: { $slice: 10 } }`.
  - The new tests check behavior (the command sent and the result), not internals, and they reuse the existing `docClient`/`findOf` helpers. No existing test was changed or removed.
- `npx vitest run src/docs/query/query.spec.ts` in packages/backend at 3be0d7e: 1 file, 114 tests passed.

Acceptance criterion 1 is satisfied by the code and the unit tests.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Rule for sliceable field names is duplicated in two places**
    - File: `packages/backend/src/docs/query/query.ts:526` (copy of `packages/backend/src/docs/query/query.ts:343`)
    - Category: Quality
    - Problem: The condition `field.includes('.') || field.startsWith('$') || /^\d+$/.test(field)` is written out separately in `sliceLargeArrays` and in `getDocument`. The new comment says "Same rule as sliceLargeArrays" instead of sharing the code.
    - Why it matters: The bug this task fixes (doc-paging CR-7) happened because these two copies drifted apart. If the rule in `pathParts` changes again, both copies have to be updated by hand.
    - Suggested fix: Optional: move the check into one small module-level helper (for example `pageableField(name)`) that both functions call. Not required for the acceptance criterion.

## Review conclusion

No material issues found.
