---
title: M1: Databases and collections (db.*, coll.*)
status: in_progress
owner: felix/agent-2
deps: [conn-manager]
touches: [packages/backend/src/browse]
prio: 1
lease_until: 2026-11-16T21:00:34Z
---
## Goal
listDatabases, list collections/views/time series, stats on demand, create/drop/rename database and collection, through the write guard.

## Acceptance criteria
- [ ] Integration tests for each method against the 8.x replica set fixture
- [ ] Drop/rename refused on a read-only profile (int test)
- [ ] Listing works for a user with only `read` on one database (`authorizedDatabases`) (int test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 21:32+0100 by felix/agent-2): coll.validator.get/set are left to the validator task (its touches name browse/validator); this task implements db.listDatabases/create/drop/stats and coll.list/create/drop/rename/stats.
- ASSUMPTION (2026-11-16 21:32+0100 by felix/agent-2): The authorizedDatabases test runs against its own mongo:8.2 standalone with --auth (startFixture gains an 'auth' option; root user via the image's MONGO_INITDB_* env, passwords generated per run): the shared 8.x replica set fixture runs without access control, where privileges aren't enforced, and an auth replica set would need a key file.
- ASSUMPTION (2026-11-16 21:32+0100 by felix/agent-2): db.listDatabases relies on the server's authorizedDatabases default and additionally lists databases the user holds privileges on (connectionStatus) that hold no data yet; if listDatabases is refused (Unauthorized) those privileged databases are the list.
- ASSUMPTION (2026-11-16 21:32+0100 by felix/agent-2): coll.list returns everything listCollections returns (system.views, system.* included) except system.buckets.<name> when its time series <name> is listed; coll.stats uses $collStats storageStats (collStats command is deprecated) and answers NOT_FOUND when there is no stats document / NamespaceNotFound; NamespaceNotFound maps to NOT_FOUND, other server errors to SERVER_ERROR with codeName.
- ASSUMPTION (2026-11-16 21:32+0100 by felix/agent-2): ClientLike.db().command gained an optional options arg (passed RAW: no BSON promotion) so raw outputs are lossless canonical EJSON; abortable() in connections/manager.ts is now exported for reuse by browse handlers.
