# Fix Report

Date: 2026-11-17

Task: undo-last-save - M1 (Should): Undo last save (round 3 fixes)

Scope: current task; approved findings TW-1 (`reviews/undo-last-save/tests.md`, round 3) and CR-2 (`reviews/undo-last-save/review.md`, round 3, P3)

## Fixed findings

### TW-1 — Undo of a document with repeated top-level keys overwrites a server change to a field the save did not touch

Files changed:
- `packages/renderer/src/app/document/document-actions.service.ts`
- `packages/renderer/src/app/document/history/undo-last-save.spec.ts`

Problem:
Repeated top-level keys make core's diff a `replace`. `keepingOrder` could not build the whole-document check (`wholeDocumentCheck` returns `null` for repeated keys) and returned the diff unchanged, so the undo replaced every field under a check of only the changed field. A server change to another field (`status: "shipped"`) was silently overwritten (AC2).

Fix:
Per the parent worker's decision, such an undo is refused. `keepingOrder` now returns `null` when the whole-document check can't be built and the diff is a `replace`; a minimal `update` diff is still returned as before (it writes only the changed fields under their own check). `send` refuses on `null` before any write with the new text `UNDO_REPEATED_KEYS_REFUSED`: "Not undone: this document has repeated field names, so the old version can not be written back safely." Like the partial/projection refusal, nothing is written and the undo entry is kept (nothing changed on the server, the user can still see why). The `keepingOrder` and `undoSave` doc comments say so.

Tests in `describe('a document with repeated top-level keys')`:
- the first test (previously expected a second replace with only the `total` check, the unsafe behavior) is now `save, undo last save: refused, nothing written, the server keeps the saved version`: exact refusal message, server still `SAVED`, one replace (the save) and no update sent, undo still offered;
- the second test (`total` changed on the server) expects the same refusal, server unchanged, nothing written;
- the TW-1 test (`does not replace over a server change to a field the save did not touch`) now asserts the undo returns false, the exact refusal message, the server keeps `status: "shipped"`, nothing written. Its message expectation changed from the conflict text to the refusal text because refusing before the write is what protects the server change; the server-unchanged assertion (the requirement) is kept.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'` — Pass (11 files, 365 tests)

### CR-2 — `SavedVersion.after` doc comment no longer describes what it holds

Files changed:
- `packages/renderer/src/app/document/history/save-history.ts`

Problem:
The comment said "The document as the save wrote it", but `after` holds the version the server stored (read-back or `applyUpdate` model of MongoDB's order).

Fix:
Comment now reads "The document as the server stored it after the save (see `DocumentActions.recordSave`)."

Validation:
- `npm run check` — Pass (comment only)

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'` — Pass, 11 files, 365 passed
- `npx prettier --check` on the three changed files — Pass

Full test suite:
- `npm run check` (eslint, Prettier, type check, root Vitest, renderer `ng test`) — Pass: root 95 files / 4972 passed; renderer 120 files / 3958 passed

Lint/type-check/build:
- included in `npm run check` — Pass

`.taskcheck`:
- Not run separately; it runs `npm run check`, which passed as above. E2E (`test/e2e/undo-last-save.e2e.ts`) not run by the fixer; it has no repeated-key case.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
