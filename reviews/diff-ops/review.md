# Code Review

Date: 2026-11-16

Task: diff-ops - Core: edit diff → update operations and conflict filter

Scope: Final re-review at HEAD ba52caf. The previous review covered the whole task diff (47ace47..27c090b) at 27c090b and found no issues. This review covers the delta 27c090b..ba52caf and checks that production code has not changed since 27c090b.

Requirements:
- tasks/diff-ops.md acceptance criteria and recorded assumptions
- SPEC.md "Documents" (minimal `$set`/`$unset`/`$push` update, conflict filter on `_id` plus the original values of changed top-level fields)
- packages/contract/src/docs.ts `docs.update` / `docs.replace`
- docs/ARCHITECTURE.md, AGENTS.md
- the previous review at 27c090b

Git range:
- Branch: main
- HEAD: ba52caf
- Base/start: 47ace471e394cdd872f6045a03d410b73abf14e8 (task base); delta reviewed from 27c090b
- Commits reviewed: 1 (ba52caf) on top of the 27c090b review. No uncommitted changes.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Delta verification

- **Production code unchanged:** `git diff --stat 27c090b ba52caf` lists only `packages/core/src/diff/diff.spec.ts`, `packages/core/src/diff/fixtures.ts`, `reviews/diff-ops/review.md` and `reviews/diff-ops/tests.md`. `diff.ts`, `equals.ts` and the `index.ts` files are untouched. `test/integration/diff-ops.int.spec.ts` was not changed in ba52caf either, although the parent's scope note listed it. It still runs every changing `DIFF_CASES` entry, so the new fixtures reach the integration tests through the shared table.
- **No weakening:** the commit only adds lines (57 in diff.spec.ts, 32 in fixtures.ts). No test, assertion or fixture was removed, skipped or loosened.
- **New fixtures (fixtures.ts):** the expected values match the production behavior reviewed at 27c090b.
  - Null field removed: emits `$unset` with `{$type:"null"}`. This checks the CR-1 fix through a removal, not only through a value change.
  - Null dotted key with a new dotted key: produces a replace with `$expr` `$type` checks for `"null"` and `"missing"`.
  - An unchanged top-level `$k` alongside a `$set`.
  - A top-level reorder with a nested `$x`: produces a replace.

  All of these are valid server inputs. MongoDB permits inserting `$`-prefixed fields, and a replacement may contain nested `$`-prefixed fields. tests.md reports `npm run test:int -- diff-ops` with 308/308 passing on MongoDB 8 and 7. This review did not re-run it.
- **New unit tests (diff.spec.ts):** they cover the following:
  - a replace that is forced by a changed top-level `$k`;
  - a replace that is forced by another unaddressable change while `$k` is kept;
  - de-duplication of a repeated `$k` in the error message;
  - no throw when the only `$` keys are nested;
  - the null-removal filter;
  - `$eq` being kept when the original is an array containing null.

  These assertions check observable output (ops, canonical filter/expected EJSON, error message), not implementation details. Some cases overlap with the shared fixtures. This is intentional, because the unit test pins the exact filter and the fixture adds the server check.
- **Run:** `npm run --prefix packages/core test -- src/diff` passed 112/112 (1 file).

## Review conclusion

No material issues found.
