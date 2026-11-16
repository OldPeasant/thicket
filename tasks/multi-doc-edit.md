---
title: M1 (Should): Edit a field across selected rows
status: todo
owner:
deps: [doc-edit-save]
touches: [packages/renderer/src/app/collection/multi-edit]
prio: 3
---
## Goal
In the table view, select rows and set/unset one field for all; saved as one batch through WriteGuard with the document count in the confirmation; per-document conflict checks.

## Acceptance criteria
- [ ] e2e: select 3 rows, set a field, save → 3 docs updated
- [ ] One conflicting document is reported, the others saved (int/e2e test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
