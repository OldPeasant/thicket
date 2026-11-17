---
title: M3: Bulk update and delete from the query bar
status: in_progress
owner: dell26/agent-3
deps: [doc-edit-save,safety-ui]
touches: [packages/renderer/src/app/collection/bulk]
prio: 2
lease_until: 2026-11-17T04:21:53Z
---
## Goal
updateMany (update document in shell syntax) and deleteMany for the current filter with preview (count + sample) and confirmation; type-to-confirm above 1 000 documents.

## Acceptance criteria
- [ ] e2e: updateMany on 1 500 docs requires typing the collection name and updates them
- [ ] Preview shows the same count the execution reports (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 04:57+0100 by dell26/agent-3): Type-to-confirm (collection name) applies to bulk updates over 1 000 documents too, not only deletes: the acceptance criterion demands it for updateMany on 1 500 docs; the panel passes typeToConfirm itself, WriteGuard's default stays deletes-only.
- ASSUMPTION (2026-11-17 04:57+0100 by dell26/agent-3): The bulk panel uses the applied query (last Run) filter + collation, like Export; sort/limit are ignored (updateMany/deleteMany have none) and the panel says so. A write is only enabled for a preview of the current mode/update/query.
