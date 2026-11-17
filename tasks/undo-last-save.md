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
