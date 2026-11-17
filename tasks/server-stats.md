---
title: M6 (Could): Server stats dashboard
status: in_progress
owner: dell26/agent-2
deps: [conn-manager,app-layout]
touches: [packages/backend/src/admin/stats,packages/renderer/src/app/admin/stats]
prio: 4
lease_until: 2026-11-17T07:12:22Z
---
## Goal
serverStatus, dbStats and replica set status with a few charts (ops/s, connections, memory) refreshing live.

## Acceptance criteria
- [ ] Integration test for the data methods
- [ ] Component tests with recorded serverStatus fixtures

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 07:53+0100 by dell26/agent-2): Replica set status needs a contract method the SPEC table lacks: added admin.replSetStatus ({profileId} -> {status: EJSON | null}, null on standalone/mongos) instead of overloading admin.serverStatus; dbStats reuses db.stats.
- ASSUMPTION (2026-11-17 07:53+0100 by dell26/agent-2): admin.serverStatus drops fields named $... at any depth (metrics.operatorCounters.match.$regex etc.): canonical EJSON of them cannot be parsed back (EJSON reads {$regex:..} as a RegExp). Those counters are not dashboard data.
- ASSUMPTION (2026-11-17 07:53+0100 by dell26/agent-2): Dashboard UI choices: new tab kind 'serverstats' from the connection menu ('Server stats'); live refresh default 2 s (1/2/5/10/never), 120 points; charts = ops/s by type, connections, resident memory (virtual only as a tile, it flattens resident), network bytes/s; dbStats of all databases loaded on open/Reload, not live. Hand-written inline SVG charts, no chart library.
