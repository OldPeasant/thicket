# Code Review

Date: 2026-11-17

Task: undo-last-save - M1 (Should): Undo last save (round 2, final code after the round-1 fixes)

Scope: `git diff 0442cdc7..HEAD -- packages test` (commits 4723b115, 01422a65, df47b4a4), committed changes only

Requirements:
- tasks/undo-last-save.md (2 acceptance criteria, 4 assumptions)
- SPEC.md "Undo last save" (Should: keep the pre-save version and write it back with the same conflict check)
- docs/ARCHITECTURE.md, AGENTS.md
- Parent instructions: focus on the whole-document conflict check of the order-restoring replace (MongoDB `$eq` semantics for arrays and embedded documents), the `savedVersion` model through `applyUpdate`, and whether the backend accepts the `expected` filter
- Round-1 report and reviews/undo-last-save/fixes.md (CR-1/TW-1, CR-3)

Git range:
- Branch: main
- HEAD: df47b4a4e0e42ec86d8e9eec4bb34573ecd103d1
- Base/start: 0442cdc7c2550cf32bb0a49c96e8b3af67687f6c
- Commits reviewed: 3
- Uncommitted changes: none at review start

Summary: 0 P0, 0 P1, 1 P2, 0 P3

## What was checked

- Read in full: `document-actions.service.ts` (save, overwrite, saveMerged, resolveWith, send, write, delete, readBack), `history/apply-update.ts`, `history/save-history.ts`, `document-header.ts`, the unit specs (`undo-last-save.spec.ts`, `apply-update.spec.ts`, `save-history.spec.ts`, `document-header.spec.ts`), `test/e2e/undo-last-save.e2e.ts`, `packages/core/src/diff/diff.ts` (the conflict check Save uses), and `packages/backend/src/docs/write/write.ts` / `packages/contract/src/docs.ts` (`docs.update` / `docs.replace`).
- CR-1 (round 1) is fixed: on the replace path the conflict check now covers every top-level field of the saved version plus the top-level field count, so a field changed, added or removed on the server since the save conflicts. The minimal-update path still uses Save's changed-fields check, which cannot overwrite fields it does not write, so it does not lose other server changes.
- `savedVersion` (`applyUpdate(before, ops)` when the save was an update, otherwise `after`) matches what MongoDB stores: `$set` of an existing path keeps its place, a new path is appended to its parent, `$unset` removes, `$push` appends. Top-level order does not matter to the check (one `$eq` per field); nested order does (`$eq` on embedded documents is order-sensitive), and the model gives MongoDB's nested order for a save from the loaded document. When the model is wrong, the check only conflicts when it should not (fails safe), it never lets an overwrite through.
- Backend: `replaceDocument` parses `expected` as any document and matches `{$and: [{_id: {$eq: id}}, expected]}`, so the `$expr` field count is accepted; the e2e replace-path tests ran against real MongoDB (fixes.md).
- CR-3 wording fixed (`UNDO_WITH_EDITS_REFUSED`, the header tooltip).
- Unit tests run by this review: `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'` -> 11 files, 330 passed.
- MongoDB semantics checked read-only on a mongo:8.2 container with `$documents` (no collection read or written): `{a: {$eq: [1,2]}}` matches `a: [1,2]` and `a: [[1,2],3]`; `{a: {$eq: 5}}` matches `a: [5,7]`; `{a: {$type: "null"}}` matches `a: [null,1]`; `{a: {$eq: {x:1}}}` matches `a: [{x:1},2]`; `{$expr: {$eq: ["$a", {$literal: [1,2]}]}}` matches only `a: [1,2]`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | The whole-document check of the order-restoring replace lets through a server change that turned a field into an array containing the saved value**
    - File: `packages/renderer/src/app/document/document-actions.service.ts:731` (`wholeDocumentCheck`, the `$eq` / `$type` per field at lines 735-742), used by `keepingOrder` at line 700
    - Category: Correctness
    - Problem: Each top-level field is checked as `{field: {$eq: value}}` (or `{$type: "null"/"undefined"}`). In a MongoDB query both operators also match an array field when one of its elements matches. Verified on mongo:8.2: `{a: {$eq: [1,2]}}` matches a server document with `a: [[1,2],3]`, `{a: {$eq: 5}}` matches `a: [5,7]`, `{a: {$type: "null"}}` matches `a: [null,1]`. The field count stays the same, so the `$expr` does not catch it either. If another client changes such a field between the save and the undo (a scalar becomes an array that contains it, an array gets wrapped or nested, a null becomes an array with a null), the replace matches and overwrites that change with the pre-save value without reporting a conflict. The doc comment ("matches only a document equal to `saved`") claims more than the query does. The unit spec's fake server (`undo-last-save.spec.ts:77-91`) compares `$eq` with `bsonEquals`, so it cannot show this behavior.
    - Why it matters: Acceptance criterion 2 says an undo must report a conflict instead of overwriting when the document changed on the server. The replace writes the whole document, so a wrong match here loses another client's change to a field neither the save nor the undo touched. That is the kind of loss CR-1 of round 1 fixed. The cases are narrow (the new value must be an array that contains the saved value), so this is P2, not P1. The minimal-update path inherits the same `$eq` semantics from Save's check in `packages/core/src/diff/diff.ts` (`queryFieldCheck`). There it only affects fields the undo itself writes, which is the "same conflict check" SPEC.md asks for, so it is outside this task. If the project wants that fixed too, it needs its own task.
    - Suggested fix: Build the per-field checks of `wholeDocumentCheck` as aggregation comparisons inside the `$expr` it already sends, e.g. `{$and: [{$eq: [{$getField: {field: {$literal: k}, input: "$$ROOT"}}, {$literal: v}]}, ..., <field count>]}`. Use `$type` comparisons for null and undefined, as `exprFieldCheck` in core diff already does. Aggregation `$eq` compares arrays and embedded documents as whole values, with no element matching. This also takes care of unaddressable top-level names, so the `isAddressableKey` fallback could go (duplicate keys still need it). Add a regression test against real MongoDB (e2e or `test:int`): save a removal that makes the undo a replace, change another field on the server from `x` to `[x, y]`, undo, and expect `Not undone` with the server document unchanged. The fake server's matcher cannot show this case.

## P3 Low

None.

## Review conclusion

Material issues found; fix before completing the task.

CR-1 is a P2 resilience gap in the conflict check added in round 1 (narrow cases, real data loss when it happens). The parent worker decides whether to fix it in this task or accept it with a recorded disposition. Both acceptance criteria are covered by unit tests and by e2e tests against MongoDB (see fixes.md). They have not been recorded with `tasks.py verify` yet. That is the parent worker's next step, not a finding.
