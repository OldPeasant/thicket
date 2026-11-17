---
title: M1 (Should): Edit a field across selected rows
status: in_progress
owner: dell26/agent-1
deps: [doc-edit-save]
touches: [packages/renderer/src/app/collection/multi-edit]
prio: 3
lease_until: 2026-11-17T06:01:21Z
---
## Goal
In the table view, select rows and set/unset one field for all; saved as one batch through WriteGuard with the document count in the confirmation; per-document conflict checks.

## Acceptance criteria
- [ ] e2e: select 3 rows, set a field, save → 3 docs updated
- [ ] One conflicting document is reported, the others saved (int/e2e test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
