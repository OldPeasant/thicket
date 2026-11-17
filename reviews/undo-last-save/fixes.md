# Fix Report

Date: 2026-11-17

Task: undo-last-save - M1 (Should): Undo last save

Scope: current task. Findings from `reviews/undo-last-save/review.md` (CR-1 P1, CR-2 P2, CR-3 P3) and `reviews/undo-last-save/tests.md` (TW-1 High, same defect as CR-1). Base 92135866, HEAD 3e07e41b plus the uncommitted test-writer tests (kept unchanged except where noted below).

## Fixed findings

### CR-1 / TW-1 — The field-order replace fallback of Undo overwrote server changes its conflict check did not cover

Files changed:
- `packages/renderer/src/app/document/document-actions.service.ts`
- `packages/renderer/src/app/document/history/undo-last-save.spec.ts`

Problem:
`keepingOrder` turned the undo into `replaceOne(before)` but kept the minimal update's `expected`, which checks only the fields the save changed. A field the save did not touch that was changed on the server since (or a field added there) was silently reset or deleted.

Fix:
The replace fallback is kept (it restores the exact field order), but whenever the undo is sent as a replace, its `expected` now covers the whole version the save wrote: every top-level field except `_id` (which the filter already matches) with `$eq`, null and BSON undefined with `$type` (as core's `queryFieldCheck`), plus `$expr: {$eq: [{$size: {$objectToArray: '$$ROOT'}}, <field count>]}` so a field added on the server conflicts too. The saved version is modelled as the server stored it (`savedVersion`: `applyUpdate(before, saveOps)` when the save was an update, so fields MongoDB appended are in the order the server has them). When the check cannot be built safely (repeated top-level keys, or a field name that is not addressable per core `isAddressableKey`), no replace is sent: the undo falls back to the minimal update diff (the field order may then differ). The same whole-document check is also applied when the undo's own diff is already a replace (undo of a top-level reorder), since that writes every field too; if it can't be built there, the diff's own (Save's) check stays.
The backend accepts this `expected`: `replaceDocument` in `packages/backend/src/docs/write/write.ts` parses `expected` as any document and matches `{$and: [{_id: {$eq: id}}, expected]}`, so `$expr` is allowed; the real-MongoDB e2e test of the replace path passes.
Unit spec: the fake server's matcher now also evaluates `$type` and the field-count `$expr` (it throws on any other `$expr`, so the semantics stay strict). The first test's assertion of the replace's `expected` was updated from the old changed-fields-only check to the new whole-document check (that assertion pinned the defective behavior). New regression tests: a field added on the server between save and undo conflicts and nothing is overwritten; a saved `null` is checked by `$type` and the undo succeeds; an unaddressable field name (`a.b`) falls back to the minimal `$set` with no replace. The test-writer's TW-1 unit test and e2e test pass unchanged.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'` — Pass (11 files, 330 tests)
- `npm run test:e2e -- test/e2e/undo-last-save.e2e.ts` (Electron + MongoDB container) — Pass (4 passed, including "Undo last save of a removed field restores it in its original place" on the replace path and the TW-1 test "Undo last save of a removed field does not overwrite a newer change to another field")

### CR-3 — Undo's projection/partial refusal told the user to "edit again"

Files changed:
- `packages/renderer/src/app/document/document-actions.service.ts`

Problem:
Undo reused Save's projection/partial refusal texts, which advise clearing the projection and editing again.

Fix:
`SendOptions.partialRefused` (optional full refusal text); undo passes `UNDO_PARTIAL_REFUSED`: "Not undone: this document was loaded only partly, so restoring the old version could change data that was not loaded." Save's texts are unchanged. The undo entry is not dropped in this case (kept as small as the parent requested). No unit test: as the test-writer reported, no realistic UI sequence reaches this refusal for an undo.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'` — Pass
- `npm run check` — Pass

## Not fixed

### CR-2 — The replace path is never exercised against a real MongoDB

Status:
Invalid (already resolved)

Reason:
The test-writer's new e2e tests ("Undo last save of a removed field restores it in its original place", "... does not overwrite a newer change to another field") exercise the replace path against the MongoDB container; both pass after the fix. No code change needed.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'` — Pass, 330 tests in 11 files
- `npm run test:e2e -- test/e2e/undo-last-save.e2e.ts` — Pass, 4 passed
- `npx prettier --check` and `npx eslint packages/renderer/src/app/document/` on the changed files — Pass

Full test suite:
- `npm run check` — Pass (lint, format, type check; root vitest 4771 tests in 91 files; renderer 3758 tests in 114 files)

Lint/type-check/build:
- Included in `npm run check` — Pass

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check`, run directly as above)

Remaining unresolved findings:
0

Known limitation (not a finding, same as Save's existing check): query `$eq` traverses arrays, so a scalar saved value also matches an array containing it on the server; the field-count check does not catch such a change of a single field's type to an array. This is identical to the conflict check Save uses.

## Final status

All validated findings fixed and validation passed.
