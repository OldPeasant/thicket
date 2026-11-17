---
title: M6 (Could): Watch changes
status: in_progress
owner: dell26/agent-3
deps: [docs-query-backend,collection-view]
touches: [packages/backend/src/admin/watch,packages/renderer/src/app/watch]
prio: 4
lease_until: 2026-11-17T07:54:52Z
extended: 
releases: 1
---
## Goal
Watch a collection or database (replica set only) with a live event list; open the changed document.

## Acceptance criteria
- [x] Integration test: insert/update/delete events received in order
  - verified (2026-11-17 08:19+0100 by felix/agent-1): npx vitest run --config test/integration/vitest.config.ts test/integration/change-streams.int.spec.ts (Podman, mongo8rs replica-set fixture) -> 10 passed, incl. 'receives insert, update and delete events of a collection in order' (order, documentKeys, clusterTime order) and cursor-pinning/cleanup tests
- [x] Standalone server shows a clear 'needs replica set' message (test)
  - verified (2026-11-17 08:19+0100 by felix/agent-1): same integration run against mongo8 standalone fixture -> 'refuses with a clear needs replica set message' passed (UNSUPPORTED, detail needsReplicaSet); cd packages/renderer && npx ng test --include='src/app/watch/**/*.spec.ts' -> 29 passed incl. WatchView 'shows a clear needs replica set message for a standalone server'

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 07:36+0100 by felix/agent-1): admin.watch uses raw $changeStream aggregate + getMore loop on the primary (lossless EJSON like docs.find) instead of the driver's ChangeStream; no automatic resume after a network error/failover: the stream ends with the error and the user presses Start
- ASSUMPTION (2026-11-17 07:36+0100 by felix/agent-1): Standalone is refused at request time via hello (UNSUPPORTED, detail reason needsReplicaSet) rather than as a stream error; the renderer shows a dedicated notice for that detail
- ASSUMPTION (2026-11-17 07:36+0100 by felix/agent-1): 'Open the changed document' = load the current version with docs.get into a side panel of the watch tab (not opening the collection tab filtered by _id); fullDocument updateLookup is on by default, list keeps the newest 1000 events
- ASSUMPTION (2026-11-17 08:19+0100 by felix/agent-1): Re-review finding CR-1 (P3): re-selecting 'Watch changes' for an already open watch tab restarts the stream (the tab object is replaced, so the effect re-runs), overriding Stop. Deferred as optional polish outside the acceptance criteria; fix: restart only when profileId/db/coll change.
- extended by felix/agent-1: Implementation done, both criteria verified, merged with latest main (server-stats, users-roles-edit; conflicts were parallel additions, all kept) at b6e298b8; npm run check passed after the server-stats merge. quality.json committed but REFUSED as stale (reviewed_revision 1577c362, merge resolutions changed the code diff). Left: re-run test-writer and code-reviewer on the current HEAD (focus: merged sidebar-tree.ts/.service.ts, workspace TabKind, app.config, backend.ts), update reviewed_revision in reviews/change-streams/quality.json, npm run check, tasks.py done. Open P3 CR-1 accepted (see assumption).
- release by felix/agent-1: over budget after 2 sessions (~60 min) and a review that decided nothing; still resumable: continue from wip/change-streams (see git log)
