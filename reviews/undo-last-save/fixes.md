# Fix Report

Date: 2026-11-17

Task: undo-last-save - M1 (Should): Undo last save (round 2 fixes)

Scope: current task. Round-2 findings from `reviews/undo-last-save/review.md` (CR-1, P2) and `reviews/undo-last-save/tests.md` (TW-2 and TW-3, Medium). The code reviewed was HEAD `79270617` on `main`, which holds all task work. The fixes are left uncommitted in the working tree for the parent worker.

## Fixed findings

### CR-1 — The replace path's whole-document check let through a field turned into an array that contains the saved value

Files changed:
- `packages/renderer/src/app/document/document-actions.service.ts`
- `packages/core/src/diff/diff.ts`. The only change: `exprFieldCheck` is now exported, and its doc comment says it is used for any field name.
- `packages/renderer/src/app/document/history/undo-last-save.spec.ts`
- `test/e2e/undo-last-save.e2e.ts`

Problem:
`wholeDocumentCheck` checked each top-level field with query `{field: {$eq: v}}` or `{$type: ...}`. In a query, both operators also match an array that contains the value. So the order-restoring replace could overwrite a server change such as `qty: 1` becoming `qty: [1, 7]`.

Fix:
`wholeDocumentCheck` now returns a single `{$expr: {$and: [...]}}`. It reuses core's `exprFieldCheck` for each top-level field except `_id`, plus the existing field-count condition. `exprFieldCheck` uses aggregation `$eq` of `$getField` (with a `$literal` name) against `$literal` value. Null and undefined are checked by `$type`. Aggregation `$eq` compares arrays and embedded documents as whole values. Because `$getField` works with any name, the `isAddressableKey` fallback was removed. The fallback for repeated keys stays. Save's own check (`queryFieldCheck`) is unchanged.

Unit spec: the fake server now evaluates `$expr` with a strict evaluator that throws on anything unsupported. It handles `$and`, `$eq` (whole values via `bsonEquals`), `$literal`, `$getField` of `$$ROOT`, `$type`, the `$size`/`$objectToArray` field count, and constants. The assertions that pinned the old `expected` shape now use helpers that build the new `$expr`. The dotted-name test (`a.b`) used to expect a fallback to the minimal update. It now expects the replace that restores the original order, checked by the literal name. New unit regression test: `reports a conflict on the replace path when a field became an array containing its saved value`. New e2e regression test against real MongoDB: one more row in `SERVER_CHANGES`, `... reports a conflict for a field turned into an array containing its saved value` (`$set: {qty: [Int32(1), Int32(7)]}` after the save). The undo conflicts and nothing is overwritten.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'` — Pass (11 files, 347 tests)
- `npm run test:e2e -- test/e2e/undo-last-save.e2e.ts` — Pass (12 passed, including the new CR-1 row)

### TW-2 — Undo of a save that removed the last two fields restored them in the wrong order

Files changed:
- `packages/renderer/src/app/document/history/apply-update.ts`
- `packages/renderer/src/app/document/history/apply-update.spec.ts`
- `packages/renderer/src/app/document/history/undo-last-save.spec.ts`

Problem:
`applyUpdate` predicts the order an update leaves fields in. It appended new fields in operation order. MongoDB 5.0 and later applies an update's fields in field-name order, so `keepingOrder` wrongly expected `$set {total, qty}` to restore `total, qty`.

Fix:
Before applying the operations, `applyUpdate` now sorts them by path in MongoDB's update order. Paths are compared part by part. Names are compared by code point, which is UTF-8 byte order. Two all-digit names of different length are compared numerically by length. The result for the undo is that the minimal `$set` is predicted to give `qty, total`, so the undo is sent as the replace and the original order comes back. New unit tests: several new fields in name order, numeric names in numeric order, and new sub-fields of one parent in name order. Also a `DocumentActions` test: removing the last two fields gives an undo by replace that restores the original.

Validation:
- Focused unit suite — Pass
- e2e `Undo last save of the last two fields restores them in their original order` — Pass

### TW-3 — Undo after adding two sub-fields to an embedded document reported a false conflict

Files changed:
- `packages/renderer/src/app/document/document-actions.service.ts`
- `packages/renderer/src/app/document/history/undo-last-save.spec.ts`

Problem:
The undo's conflict check compared against `last.after`, the document as the client sent it (`addr: {city, zip, apt}`). MongoDB stored `addr: {city, apt, zip}`, and query `$eq` on an embedded document is order-sensitive, so the undo always conflicted.

Fix:
- `readBack` now returns the document it read back, but only when it is whole: no projection, nothing cut, nothing sliced, and the document parses. `send` passes that document to its `saved` callback.
- `recordSave` keeps this read-back as the history's `after` only when it equals what was sent, ignoring field order at every level. Otherwise it uses `savedVersion(before, sent)`, the MongoDB-order model from TW-2. So a change another client made right after the save is never taken as the saved version, and the undo still conflicts with it.
- `keepingOrder` now builds the whole-document check from `after` directly, because `after` already holds the server's version.

Regression tests:
- `checks the version the server stored (read back after the save), not the one sent`: the undo's minimal `$unset` expects `addr` in the stored order.
- `does not take a read-back with other values as the saved version, so a newer change conflicts`: a field added on the server between the write and the read-back makes the replace conflict, and nothing is dropped.

Validation:
- Focused unit suite — Pass
- e2e `Undo last save of two sub-fields added to an embedded document restores the original` — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'` — Pass (11 files, 347 tests)
- `npm run test:e2e -- test/e2e/undo-last-save.e2e.ts` (Electron + MongoDB container) — Pass (12 passed, including TW-2, TW-3 and the new CR-1 regression)
- `npx prettier --check` and `npx eslint` on the changed files — Pass

Full test suite:
- `npm run check` — Pass (eslint `--max-warnings 0`, prettier, type check, root Vitest 4856 tests in 92 files, renderer 3800 tests in 115 files)

Lint/type-check/build:
- Included in `npm run check` — Pass. The e2e run also builds the renderer and desktop app — Pass.

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check`; run directly as above)

Remaining unresolved findings:
0

Notes:
- Coverage was not measured again by the fixer. The test-writer's round-2 report says it must be re-measured after these fixes.
- The new evidence in `undo-last-save.spec.ts` is the unit side. The fake server compares with `bsonEquals`, so it cannot show query-`$eq` array matching. The real-MongoDB e2e row is the regression test for CR-1.
- Save's own check (`queryFieldCheck`, minimal-update path) still has query-`$eq` semantics, as the review scoped. The test-writer's note that Save may share the TW-3 embedded-order behavior for a second edit right after such a save is unchanged and outside this task.

## Final status

All validated findings fixed and validation passed.
