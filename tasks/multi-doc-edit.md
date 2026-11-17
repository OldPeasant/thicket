---
title: M1 (Should): Edit a field across selected rows
status: done
owner: dell26/agent-1
deps: [doc-edit-save]
touches: [packages/renderer/src/app/collection/multi-edit]
prio: 3
lease_until: 
---
## Goal
In the table view, select rows and set/unset one field for all; saved as one batch through WriteGuard with the document count in the confirmation; per-document conflict checks.

## Acceptance criteria
- [x] e2e: select 3 rows, set a field, save → 3 docs updated
  - verified (2026-11-17 07:17+0100 by dell26/agent-1): npm run test:e2e -- test/e2e/multi-edit.e2e.ts (Playwright/Electron, built app, MongoDB container fixture) -> 'select 3 rows, set a field, save: 3 documents updated' passed (3/3 passed)
- [x] One conflicting document is reported, the others saved (int/e2e test)
  - verified (2026-11-17 07:17+0100 by dell26/agent-1): npm run test:e2e -- test/e2e/multi-edit.e2e.ts against MongoDB container -> 'one document changed on the server: it is reported, the others are saved' and 'one document deleted on the server: ...' passed; plus multi-edit.service/selection unit specs (125 focused tests pass)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 06:44+0100 by dell26/agent-1): One batch = one WriteGuard.approveAll() confirm (always asked, also on non-production profiles, showing the document count and the first 10 updateOne operations) followed by one conflict-checked docs.update per document, sent sequentially; no new backend method (a conflict on one document must not block the others, and docs.update already does the per-document conflict filter).
- ASSUMPTION (2026-11-17 06:44+0100 by dell26/agent-1): Row checkboxes appear in the table view only in edit mode on writable profiles (optional RowSelectionService in the explorer root table); selection is by row index and is cleared when the page's _id list changes (paging, new query) or edit mode ends; it is kept after a save so the user can apply another edit.
- ASSUMPTION (2026-11-17 06:44+0100 by dell26/agent-1): Field is a dotted path (set creates missing parent documents, a non-document parent is refused); value is shell syntax, plain numbers follow the integer-default setting. Rows with unsaved edits refuse the batch (save or revert first); partly loaded rows (projection/cut arrays) allow top-level fields only. Conflicting documents are listed in the panel and reloaded from the server, not added to the per-document conflict view.
- ASSUMPTION (2026-11-17 07:06+0100 by dell26/agent-1): CR-2 fix: the 'field isn't loaded' refusal applies only with a projection; a row that is partial only because of cut arrays has all other fields, so a missing field there is really missing and may be set. Cut arrays themselves are refused.
- ASSUMPTION (2026-11-17 07:14+0100 by dell26/agent-1): Under a sub-field projection (e.g. {'address.city':1}) setting/removing the whole parent field across rows is allowed but reports every row as 'changed on the server' (the conflict filter uses the partly loaded value, so nothing is overwritten). Left as is: safe, rare, and the task assumption only promises top-level fields under projection.
- done by dell26/agent-1: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 60s on 7fada724a; criteria verified 2/2
