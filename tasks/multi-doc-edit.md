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
- ASSUMPTION (2026-11-17 06:44+0100 by dell26/agent-1): One batch = one WriteGuard.approveAll() confirm (always asked, also on non-production profiles, showing the document count and the first 10 updateOne operations) followed by one conflict-checked docs.update per document, sent sequentially; no new backend method (a conflict on one document must not block the others, and docs.update already does the per-document conflict filter).
- ASSUMPTION (2026-11-17 06:44+0100 by dell26/agent-1): Row checkboxes appear in the table view only in edit mode on writable profiles (optional RowSelectionService in the explorer root table); selection is by row index and is cleared when the page's _id list changes (paging, new query) or edit mode ends; it is kept after a save so the user can apply another edit.
- ASSUMPTION (2026-11-17 06:44+0100 by dell26/agent-1): Field is a dotted path (set creates missing parent documents, a non-document parent is refused); value is shell syntax, plain numbers follow the integer-default setting. Rows with unsaved edits refuse the batch (save or revert first); partly loaded rows (projection/cut arrays) allow top-level fields only. Conflicting documents are listed in the panel and reloaded from the server, not added to the per-document conflict view.
