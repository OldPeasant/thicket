---
title: M6 (Could): Watch changes
status: in_progress
owner: felix/agent-1
deps: [docs-query-backend,collection-view]
touches: [packages/backend/src/admin/watch,packages/renderer/src/app/watch]
prio: 4
lease_until: 2026-11-17T07:11:55Z
---
## Goal
Watch a collection or database (replica set only) with a live event list; open the changed document.

## Acceptance criteria
- [ ] Integration test: insert/update/delete events received in order
- [ ] Standalone server shows a clear 'needs replica set' message (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 07:36+0100 by felix/agent-1): admin.watch uses raw $changeStream aggregate + getMore loop on the primary (lossless EJSON like docs.find) instead of the driver's ChangeStream; no automatic resume after a network error/failover: the stream ends with the error and the user presses Start
- ASSUMPTION (2026-11-17 07:36+0100 by felix/agent-1): Standalone is refused at request time via hello (UNSUPPORTED, detail reason needsReplicaSet) rather than as a stream error; the renderer shows a dedicated notice for that detail
- ASSUMPTION (2026-11-17 07:36+0100 by felix/agent-1): 'Open the changed document' = load the current version with docs.get into a side panel of the watch tab (not opening the collection tab filtered by _id); fullDocument updateLookup is on by default, list keeps the newest 1000 events
