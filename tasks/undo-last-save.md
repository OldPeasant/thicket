---
title: M1 (Should): Undo last save
status: in_progress
owner: felix/agent-2
deps: [doc-edit-save]
touches: [packages/renderer/src/app/document/history]
prio: 3
lease_until: 2026-11-17T07:46:35Z
extended: felix/agent-2
---
## Goal
Keep the pre-save version of the last save per document; 'Undo last save' writes it back with the same conflict check.

## Acceptance criteria
- [x] Component/e2e test: save, undo last save → server doc equals original
  - verified (2026-11-17 08:23+0100 by felix/agent-2): npm run test:e2e -- test/e2e/undo-last-save.e2e.ts (Playwright+Electron against the MongoDB 8 container fixture; server doc read with the driver as EJSON text) -> 12 passed, incl. 'save, then Undo last save: the server document equals the original', removed-field/typed-values/embedded-subfields/field-order restore cases; plus unit undo-last-save.spec.ts via npx ng test
- [x] If the document changed on the server since, undo reports a conflict instead of overwriting (test)
  - verified (2026-11-17 08:23+0100 by felix/agent-2): npm run test:e2e -- test/e2e/undo-last-save.e2e.ts (MongoDB 8 container) -> 12 passed, incl. 'reports a conflict instead of overwriting a newer server change' and 6 replace-path conflict cases (field added, nested sub-field changed, untouched field removed, Date changed, field turned into array); server doc verified unchanged; plus unit conflict tests in undo-last-save.spec.ts

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 07:30+0100 by felix/agent-2): Undo last save is kept per document per collection tab (in DocumentActions, not persisted). One level only: after an undo it is no longer offered, and the undo itself is not undoable. Save, conflict Overwrite and Merge manually all count as saves; re-inserting a document deleted on the server does not. Delete drops it.
- ASSUMPTION (2026-11-17 07:30+0100 by felix/agent-2): Undo is refused while the document has unsaved edits (button disabled, message: save or revert first), to avoid mixing the restored version with pending edits.
- ASSUMPTION (2026-11-17 07:30+0100 by felix/agent-2): A conflicting undo (document changed or deleted on the server since the save) writes nothing, shows 'Not undone: ...' and drops the undo. It does not open the conflict view, because there are no local edits to resolve.
- ASSUMPTION (2026-11-17 07:30+0100 by felix/agent-2): To restore the original field order, the undo of a whole (non-projected) document is sent as replaceOne of the pre-save version, with the same expected-values filter, when the minimal update would leave fields in another order (MongoDB appends a re-added field). Under a projection or for a partial document it stays the minimal update with Save's projection rules, so the order may differ.
- extended by felix/agent-2: Implementation complete; round-2 fixes (CR-1 $expr whole-value check, TW-2 field order, TW-3 read-back) committed (925eed62). Round-3 code review committed: no material issues (2 optional P3s: multi-edit save leaves undo offered; SavedVersion.after doc comment). Round-3 test-writer added unit tests (apply-update.spec.ts, undo-last-save.spec.ts, committed) but did not write its tests.md, which is still round 2. npm run check passes (3883 tests). Left: re-run test-writer for round 3 on the final code to write tests.md (with coverage); decide the P3s (fix comment or record dispositions + assumption for multi-edit); run e2e test/e2e/undo-last-save.e2e.ts and record tasks.py verify for #1 and #2; write reviews/undo-last-save/quality.json (reviewed_revision = final hash); commit; tasks.py done.
- ASSUMPTION (2026-11-17 08:22+0100 by felix/agent-2): Table multi-edit saves (multi-edit.service) are not tracked by Undo last save and do not drop an earlier single-document undo entry; undoing it afterwards writes only the earlier save's fields with their conflict check, so nothing of the multi-edit is lost (review CR-1, P3). Wiring multi-edit into SaveHistory would touch the collection/multi-edit code outside this task's scope.
