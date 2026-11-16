---
title: M1: Databases and collections (db.*, coll.*)
status: todo
owner:
deps: [conn-manager]
touches: [packages/backend/src/browse]
prio: 1
---
## Goal
listDatabases, list collections/views/time series, stats on demand, create/drop/rename database and collection, through the write guard.

## Acceptance criteria
- [ ] Integration tests for each method against the 8.x replica set fixture
- [ ] Drop/rename refused on a read-only profile (int test)
- [ ] Listing works for a user with only `read` on one database (`authorizedDatabases`) (int test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
