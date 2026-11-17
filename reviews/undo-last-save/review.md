# Code Review

Date: 2026-11-17

Task: undo-last-save - M1 (Should): Undo last save (round 3, the final code after the round-2 fixes)

Scope: `git diff 0741bbd8..HEAD -- packages test` (all 5 task commits, dcfa39f9..654c83a0). Committed changes only. The test-writer's uncommitted test changes, made in parallel, are not reviewed.

Requirements:
- tasks/undo-last-save.md (2 acceptance criteria, 4 assumptions)
- SPEC.md "Undo last save" (Should: keep the pre-save version and write it back with the same conflict check)
- docs/ARCHITECTURE.md (supported MongoDB versions: the 7.0 and 8.x fixtures), AGENTS.md
- Parent instructions: check the round-2 fixes (CR-1 `$expr` whole-value check through the exported core `exprFieldCheck`, TW-2 MongoDB field order in `applyUpdate`, TW-3 saved version from the read-back), the core export change, and anything else in scope
- Round-2 reports: reviews/undo-last-save/review.md, tests.md, fixes.md

Git range:
- Branch: main
- HEAD: 654c83a006a864b8113b303461d629cf89e679ab
- Base/start: 0741bbd85a7d8fddfeb7dc317568640e56dc835e
- Commits reviewed: 5
- Uncommitted changes: test-writer files in progress (ignored as instructed)

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## What was checked

- I read the full production diff: `document-actions.service.ts` (save, resolveWith, send, write, delete, readBack, recordSave, keepingOrder, savedVersion, wholeDocumentCheck, unordered, parseWhole), `history/apply-update.ts`, `history/save-history.ts`, `document-header.ts`, and the `exprFieldCheck` export in `packages/core/src/diff/diff.ts`. Context read: `edit-session.ts` (rebase, discard), `collection-view.ts` (documentChanged), `multi-edit.service.ts`, backend `docs/write/write.ts` (`conflictFilter` = `{$and: [{_id}, expected]}` for update and replace), and the e2e spec `test/e2e/undo-last-save.e2e.ts`.
- **CR-1 fix (round 2): correct.** `wholeDocumentCheck` now sends a single `$expr: {$and: [exprFieldCheck(k, v)..., fieldCount]}`. Aggregation `$eq` compares arrays and embedded documents as whole values, so a field turned into an array that contains the saved value no longer matches. Null and undefined are checked by `$type`, and a missing field by `"missing"`. The field count (`$size` of `$objectToArray: "$$ROOT"`, `_id` included) catches added fields. Duplicate keys still fall back to the minimal update. The e2e `SERVER_CHANGES` row for this case covers it against real MongoDB.
- **`$getField` with dotted / `$`-prefixed names: supported.** `$getField` needs MongoDB 5.0. The project supports 7.0 and 8.x (`test/integration/fixtures/mongo.ts`). The field name is wrapped in `$literal`, which the operator requires for `$`-prefixed names. Core already used this exact construct for unaddressable keys, and it runs against real 8.x and 7.0 servers through `DIFF_CASES` in `test/integration/diff-ops.int.spec.ts`: `"a.b"` (core `fixtures.ts:232`), `""` (line 360), `"$k"` (line 368). The renderer reuses the core function instead of a copy, so there is no duplication. The export changes no behavior (the doc comment is now more general), and `@thicket/core/diff` re-exports it through `export *`.
- **TW-2 fix (`applyUpdate` order): matches MongoDB 5.0+.** MongoDB documents that update operators process string field names in lexicographic order and numeric names in numeric order. All operators of one update build one field tree: `$set`, `$unset` and `$push` are not processed separately. Each subtree is applied as a unit. So sorting all ops by path, part by part, models this, including nested `$set` (new sub-fields are appended to their parent in name order, and missing parents are created and appended). `$unset` does not affect order. A `$push` to a missing field creates the array at the end. Code-point order equals UTF-8 byte order, which is how the server compares names. The only path I couldn't confirm against a server is numeric names (length first). A wrong prediction there is harmless: in `keepingOrder` it only means a replace (with the full check) instead of an update, or an update that leaves another field order; in `savedVersion` it only means a false conflict. The e2e test "the last two fields restores them in their original order" (`total`, `qty`) passed against real MongoDB per fixes.md. It fails under the old operation-order model, so it confirms the lexicographic model.
- **TW-3 fix (read-back as the saved version): safe under concurrency.** `readBack` returns the document only when it was read whole: no projection, no cut, nothing sliced, not null, and it parses. `recordSave` uses it only when it equals what was sent, ignoring field order at every level (array item order is kept). If another client changes values between the write and the read-back, the values differ and the code falls back to the `savedVersion` model, so the undo's check still conflicts with that change. A unit test pins this. The only concurrent change it can miss is a pure field reorder by another client. The undo then writes the same values in the original order, which loses no data. The check and the replace both use `after`, so in the embedded-document case the check now expects the server's nested order (e2e "two sub-fields added to an embedded document").
- Acceptance criteria: criterion 1 is covered by unit tests and e2e against MongoDB (`storedText` compares the driver's EJSON text before and after, so field order and types count). Criterion 2 is covered by unit tests and e2e on the minimal-update path and on the replace path (5 server-change kinds). Recording them with `tasks.py verify` is the parent worker's step.
- Other paths checked: a refusal while modified, busy guards (service and button), history dropped on delete, on undo success and on undo conflict, `resolveWith` recording `base` (the server version) as `before`, the partial / projection refusal with its own text, and the e2e tests asserting the exact message texts.
- Unit tests run by this review: `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'` -> 11 files, 347 passed. (The working tree may include uncommitted test-writer files. Those files can only add tests, so the result still covers the committed code.)
- Not done: I could not run my own MongoDB probes, because starting a container was denied in this session. The MongoDB claims above rest on the documented semantics, the existing integration tests and the e2e results recorded in fixes.md.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | "Undo last save" stays offered after a table multi-edit save of the same document, and then undoes the earlier single save**
    - File: `packages/renderer/src/app/collection/multi-edit/multi-edit.service.ts:181` (multi-edit `docs.update`, which does not record or drop history), `packages/renderer/src/app/document/document-actions.service.ts:109` (`saveHistory` is only updated by DocumentActions)
    - Category: Correctness
    - Problem: After a single-document save of document 1, a multi-edit save that changes another field of document 1 leaves the history entry in place. The header still offers "Undo last save". Clicking it sends the minimal update for the earlier save's fields. Its changed-fields check matches, so it succeeds and reports "Undid the last save of 1.", although the last save was the multi-edit one. No data is lost: the multi-edit's field is not written, and on the replace path the whole-document check conflicts. The task's first assumption lists which writes count as saves (Save, Overwrite, Merge manually) but does not mention multi-edit.
    - Why it matters: The button label and message promise to undo the last save, but this undoes an older one. It is a small expectation gap in a rare sequence. It does not affect the acceptance criteria.
    - Suggested fix: Either drop the history entry of each document a multi-edit writes (for example, a `DocumentActions` method that MultiEdit or the collection view calls), or record an assumption that multi-edit saves are not tracked and leave the earlier undo in place.

- [ ] **CR-2 | `SavedVersion.after` doc comment no longer describes what it holds**
    - File: `packages/renderer/src/app/document/history/save-history.ts:9-10`
    - Category: Quality
    - Problem: The comment says "The document as the save wrote it". Since the TW-3 fix, `after` holds the version the server stored: the whole read-back (server field order), or the `applyUpdate` model of MongoDB's order. It is not what the save sent. The conflict check depends on exactly this distinction (embedded-document `$eq` is order-sensitive).
    - Why it matters: A later change could build `after` from the sent document again and bring back the TW-3 false conflict.
    - Suggested fix: Say "The document as the server stored it after the save (see `DocumentActions.recordSave`)".

## Review conclusion

No material issues found.

The round-2 fixes (CR-1, TW-2, TW-3) are correct and covered by unit tests and real-MongoDB e2e tests. The two P3 findings are optional cleanups. The parent worker decides their disposition.
