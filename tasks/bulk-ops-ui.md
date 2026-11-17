---
title: M3: Bulk update and delete from the query bar
status: in_progress
owner: dell26/agent-3
deps: [doc-edit-save,safety-ui]
touches: [packages/renderer/src/app/collection/bulk]
prio: 2
lease_until: 2026-11-17T04:36:59Z
---
## Goal
updateMany (update document in shell syntax) and deleteMany for the current filter with preview (count + sample) and confirmation; type-to-confirm above 1 000 documents.

## Acceptance criteria
- [x] e2e: updateMany on 1 500 docs requires typing the collection name and updates them
  - verified (2026-11-17 05:17+0100 by dell26/agent-3): npm run test:e2e -- test/e2e/bulk.e2e.ts (built renderer + Electron, Playwright _electron, real mongo container) at 0900a45 (merged main) -> 2 passed; updateMany test: filter {status:'open'}, preview 1 500, confirm-ok disabled until 'orders' typed (also with 'order'), nothing written while the dialog waits; after confirm DB has 1500 archived, 120 closed untouched
- [ ] Preview shows the same count the execution reports (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 04:57+0100 by dell26/agent-3): Type-to-confirm (collection name) applies to bulk updates over 1 000 documents too, not only deletes: the acceptance criterion demands it for updateMany on 1 500 docs; the panel passes typeToConfirm itself, WriteGuard's default stays deletes-only.
- ASSUMPTION (2026-11-17 04:57+0100 by dell26/agent-3): The bulk panel uses the applied query (last Run) filter + collation, like Export; sort/limit are ignored (updateMany/deleteMany have none) and the panel says so. A write is only enabled for a preview of the current mode/update/query.
