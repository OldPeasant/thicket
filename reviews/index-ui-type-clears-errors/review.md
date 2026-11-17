# Code Review

Date: 2026-11-17

Task: index-ui-type-clears-errors - Indexes form: changing a key type clears collation/wildcard projection errors (CR-6 of index-ui)

Scope: the task commit only (`git diff 3d59b41..b69601f`: b69601f). Committed changes only; the working tree was clean when reviewed.

Requirements:
- tasks/index-ui-type-clears-errors.md acceptance criterion (component test: a collation error after Create with a text key disappears when the key type changes to ascending)
- reviews/index-ui/review.md CR-6 (origin finding and suggested fix)
- docs/ARCHITECTURE.md, docs/QUALITY.md, AGENTS.md project notes; existing conventions in `index-create-form.ts`

Git range:
- Branch: main
- HEAD: b69601ff2ed2b85caf23bd0b74d365abaa0ddf7a
- Base/start: 3d59b41cc9b3ec1fbc394621b3c991730a0e4128
- Commits reviewed: 1

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Review notes

- Production change (`packages/renderer/src/app/indexes/index-create-form.ts:122-130`): `setType` now also passes `'collation'` and `'wildcardProjection'` to `clearError`, exactly as CR-6 suggested. Both are valid `DraftErrorKey`s (they are already used in `create()`'s `advanced` list). The change follows the existing pattern for type-dependent errors (`ttl`, `unique`, `weights`, `defaultLanguage`): the error is dropped on edit and the whole draft is checked again on the next Create, so a collation error that does not depend on the key type (e.g. a missing locale) is not lost permanently, it comes back on the next Create. No other behavior changed.
- Test (`index-create-form.spec.ts:402-420`): builds a `$**` text key with a collation and a wildcard projection, submits, asserts both errors, switches the key type to ascending (`1`) and asserts no errors remain, then submits again and asserts the index is sent with key `{"$**":1}`. This meets the acceptance criterion (collation error after Create with a text key disappears when the type changes to ascending) and also covers the wildcard projection error. It asserts behavior through the DOM and the fake bridge, not implementation details.
- Ran `cd packages/renderer && npx ng test --include='src/app/indexes/index-create-form.spec.ts'` -> 1 file, 29 tests passed.
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
