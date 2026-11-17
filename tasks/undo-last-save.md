---
title: M1 (Should): Undo last save
status: in_progress
owner: felix/agent-2
deps: [doc-edit-save]
touches: [packages/renderer/src/app/document/history]
prio: 3
lease_until: 2026-11-17T06:46:04Z
---
## Goal
Keep the pre-save version of the last save per document; 'Undo last save' writes it back with the same conflict check.

## Acceptance criteria
- [ ] Component/e2e test: save, undo last save → server doc equals original
- [ ] If the document changed on the server since, undo reports a conflict instead of overwriting (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 07:30+0100 by felix/agent-2): Undo last save is kept per document per collection tab (in DocumentActions, not persisted). One level only: after an undo it is no longer offered, and the undo itself is not undoable. Save, conflict Overwrite and Merge manually all count as saves; re-inserting a document deleted on the server does not. Delete drops it.
- ASSUMPTION (2026-11-17 07:30+0100 by felix/agent-2): Undo is refused while the document has unsaved edits (button disabled, message: save or revert first), to avoid mixing the restored version with pending edits.
