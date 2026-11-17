---
title: M6 (Could): Watch changes
status: in_progress
owner: felix/agent-1
deps: [docs-query-backend,collection-view]
touches: [packages/backend/src/admin/watch,packages/renderer/src/app/watch]
prio: 4
lease_until: 2026-11-17T06:46:42Z
---
## Goal
Watch a collection or database (replica set only) with a live event list; open the changed document.

## Acceptance criteria
- [ ] Integration test: insert/update/delete events received in order
- [ ] Standalone server shows a clear 'needs replica set' message (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
