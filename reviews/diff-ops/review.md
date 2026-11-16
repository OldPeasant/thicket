# Code Review

Date: 2026-11-16

Task: diff-ops - Core: edit diff → update operations and conflict filter

Scope: Re-review of the whole task diff on the final code at HEAD 27c090b (`git merge-base HEAD origin/main`..27c090b): `packages/core/src/diff/*` (diff.ts, equals.ts, fixtures.ts, diff.spec.ts, index.ts), `packages/core/src/index.ts`, `test/integration/diff-ops.int.spec.ts`. Includes checking the fixes for CR-1 and CR-2 (earlier review) and TW-2 (reviews/diff-ops/tests.md), described in reviews/diff-ops/fixes.md. Shell/git access was denied in this session, so the files were read directly from the working tree, which was clean at 27c090b at session start. A test-writer may be editing test files at the same time. Production code (diff.ts, equals.ts, index.ts files) is the authoritative subject.

Requirements:
- tasks/diff-ops.md acceptance criteria and the recorded assumptions #1-#5 (Notes section)
- SPEC.md "Documents" (Save = one `updateOne` with minimal `$set`/`$unset`, `$push` for pure appends; conflict filter = `_id` + original values of every changed top-level field)
- packages/contract/src/docs.ts `docs.update` (`update` + `expected`, ANDed to the `_id` filter) and `docs.replace` (`doc` + optional `expected`)
- docs/ARCHITECTURE.md conventions, AGENTS.md
- reviews/diff-ops/fixes.md, reviews/diff-ops/review.md (previous revision)

Git range:
- Branch: main
- HEAD: 27c090b
- Base/start: `git merge-base HEAD origin/main` (could not be resolved here because git commands were denied; the previous review used 47ace47 before a rebase)
- Commits reviewed: 4 code/test commits (ca0dc56, 3a14f33, f9cd936, 27c090b) plus `assume:` commits that touch only `tasks/diff-ops.md` (e.g. 5fd2f44). No uncommitted changes at session start.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Verification of earlier findings

- **CR-1 (null original misses a concurrent removal): fixed.** `queryFieldCheck` (`packages/core/src/diff/diff.ts:218-224`) now emits `{field: {$type: "null"}}` for a null original, so a field removed on the server no longer matches. The `$expr` branch (`exprFieldCheck`, `diff.ts:231-248`) compares `$type` of `$getField` with `"null"`, and aggregation `$type` returns `"missing"` for an absent field, so that branch is also exact. A null nested inside a changed document still uses `$eq` with exact document equality, which is correct because document `$eq` does not treat missing as null (unit test at `diff.spec.ts:176`). Coverage: fixtures `null → value (top-level)` and `null → value for a top-level key with a dot` (`fixtures.ts:259-274`) run through the unit test and all three integration tests, including the new "conflict filter detects a concurrent removal" test (`diff-ops.int.spec.ts:101-117`), which removes each changed field that existed in the original.
- **CR-2 (BSON undefined original rejected by the server): fixed.** Both branches now use a `$type` check with `"undefined"`, which is a valid (deprecated) `$type` query alias and a valid aggregation `$type` result. The unit test at `diff.spec.ts:154` covers both branches. No integration test covers this because the driver turns EJSON `undefined` into null on insert. That limitation is stated in fixes.md and is acceptable.
- **TW-2 (replace with a top-level `$` key cannot be written): fixed as decided by the parent.** `diffDocuments` throws `BsonModelError` on the replace path when the edited document has top-level `$`-prefixed keys (`diff.ts:89-96`). The update path is unaffected, and an unchanged `$k` still produces an update (`diff.spec.ts:128`). A removed `$k` still produces a valid replace, because the replacement has no `$` key (fixture `fixtures.ts:362-369`). The module and type doc comments match the behavior, and assumption #5 records the decision. The unsaveable fixture was correctly removed from the shared `DIFF_CASES`, since it has no server result, and replaced by unit tests (`diff.spec.ts:110-126`).

## Whole-diff re-check

- AC 1: every case the criterion names is in the table-driven `DIFF_CASES`: nested set, unset, rename = unset+set, type changes, array append → `$push` with `$each`, array item change → whole-array `$set`, and field reorder only → `$set` of the parent (or `replace` at top level). `diff.spec.ts:13-35` asserts the update, `expected` and `filter` for each case.
- AC 2 and AC 3: `diff-ops.int.spec.ts` applies every changing case against mongo 8 and 7. It checks the stored document (with the documented field order for new fields, assumption #1), shows that the filter matches the unchanged document and a document with an unrelated concurrent change, and shows that it matches nothing after a concurrent modification or removal of any changed top-level field. A separate stale-save test runs a real `updateOne` and checks `matchedCount` 0. This review did not re-run the integration suite. The parent must record that run with `tasks.py verify`; fixes.md reports `npm run test:int -- diff-ops` with 284 passed on both servers.
- Contract: `expected` contains only the per-field checks and `filter` is `{_id, ...expected}`, which matches `docs.update`'s "ANDed to the `_id` filter". The `replace` result returns `replacement` together with the same `expected` for `docs.replace`.
- Architecture: core stays pure TypeScript with no Node APIs and no `any`. The new exports go through `diff/index.ts` → `core/src/index.ts` and do not collide with existing names.
- Known `$eq`/`$type` query limits: a scalar original also matches a server array that contains it, and numbers match across numeric types. Assumption #3 records these limits, and they are not defects of this task.

## Review conclusion

No material issues found.
