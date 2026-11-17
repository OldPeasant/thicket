# Code Review

Date: 2026-11-17

Task: index-ui-type-clears-errors - Indexes form: changing a key type clears collation/wildcard projection errors (CR-6 of index-ui)

Scope: final revision, all task commits (`git diff 3d59b41..0cfdcc0`): b69601f (production fix and first test), 870d6f8 (the earlier review report only), 0cfdcc0 (3 more component tests and `reviews/index-ui-type-clears-errors/tests.md`). Committed changes only; the working tree was clean when reviewed.

Requirements:
- tasks/index-ui-type-clears-errors.md acceptance criterion (component test: a collation error after Create with a text key disappears when the key type changes to ascending)
- reviews/index-ui/review.md CR-6 (origin finding and suggested fix)
- docs/ARCHITECTURE.md, docs/QUALITY.md, AGENTS.md project notes; existing conventions in `index-create-form.ts` and its spec

Git range:
- Branch: main
- HEAD: 0cfdcc05971efae3b4c703af5bfac174ae1e0578
- Base/start: 3d59b41cc9b3ec1fbc394621b3c991730a0e4128
- Commits reviewed: 3

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Review notes

- Production change (`packages/renderer/src/app/indexes/index-create-form.ts:122-130`, commit b69601f; unchanged by 0cfdcc0): `setType` now also passes `'collation'` and `'wildcardProjection'` to `clearError`, exactly as CR-6 suggested. Both are valid `DraftErrorKey`s (already used in `create()`'s `advanced` list). It follows the existing pattern for type-dependent errors (`ttl`, `unique`, `weights`, `defaultLanguage`): the error is dropped on edit and the whole draft is checked again on the next Create, so a collation error unrelated to the key type is not lost, it returns on the next Create.
- Test from b69601f (`index-create-form.spec.ts:402-420`): wildcard text key `$**` with a collation and a wildcard projection; both errors shown after Create, both gone after switching to ascending, and the next Create sends `{"$**":1}`.
- Tests from 0cfdcc0 (`index-create-form.spec.ts:422-484`), checked against the production code:
  - `clears the collation error of a text key when the key type changes to ascending` (line 422): the criterion literally, on a plain text key. Also asserts `aria-invalid` on the collation input is set, then removed, and the exact `idx.create` params sent afterwards (`{ title: 1 }` with the collation). Would fail without the fix.
  - `clears the collation error of a 2d key when the type of the second field changes` (line 445): covers the 2d variant of the collation error, documents that any key type change clears it and that the next Create shows it again while the 2d key remains, then that switching to `2dsphere` lets the index be sent. Matches the intended "cleared on edit, re-checked on Create" behavior.
  - `keeps unrelated option errors when a key type changes` (line 469): guards that the clearing stays targeted; the `name` error survives a type change. Consistent with `setType`'s key list (no `name`).
  - The tests assert behavior through the DOM and the fake bridge, reuse the spec's existing helpers and test ids, and no existing test was changed or removed.
- `reviews/index-ui-type-clears-errors/tests.md` matches what is in the repository (3 tests added, 29 in the spec).
- Ran `cd packages/renderer && npx ng test --include='src/app/indexes/index-create-form.spec.ts'` on 0cfdcc0 -> 1 file, 29 tests passed (29 `it(` blocks in the spec).
- No security, integration or architecture impact: renderer-only, no new contracts, writes still go through `WriteGuard`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found.
