---
title: M3: Bulk update and delete from the query bar
status: todo
owner:
deps: [doc-edit-save,safety-ui]
touches: [packages/renderer/src/app/collection/bulk]
prio: 2
---
## Goal
updateMany (update document in shell syntax) and deleteMany for the current filter with preview (count + sample) and confirmation; type-to-confirm above 1 000 documents.

## Acceptance criteria
- [ ] e2e: updateMany on 1 500 docs requires typing the collection name and updates them
- [ ] Preview shows the same count the execution reports (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
