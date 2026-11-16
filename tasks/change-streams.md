---
title: M6 (Could): Watch changes
status: todo
owner:
deps: [docs-query-backend,collection-view]
touches: [packages/backend/src/admin/watch,packages/renderer/src/app/watch]
prio: 4
---
## Goal
Watch a collection or database (replica set only) with a live event list; open the changed document.

## Acceptance criteria
- [ ] Integration test: insert/update/delete events received in order
- [ ] Standalone server shows a clear 'needs replica set' message (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
