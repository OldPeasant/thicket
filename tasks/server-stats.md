---
title: M6 (Could): Server stats dashboard
status: done
owner: dell26/agent-2
deps: [conn-manager,app-layout]
touches: [packages/backend/src/admin/stats,packages/renderer/src/app/admin/stats]
prio: 4
lease_until: 
---
## Goal
serverStatus, dbStats and replica set status with a few charts (ops/s, connections, memory) refreshing live.

## Acceptance criteria
- [x] Integration test for the data methods
  - verified (2026-11-17 07:56+0100 by dell26/agent-2): npm run test:int -- server-stats (testcontainers mongo:8.2 standalone + mongo:8.2 replica set, served through serve() with contract validation) -> 7 passed: admin.serverStatus fields + counters grow, admin.replSetStatus null on standalone / members on RS, serverStatus repl section, db.stats sizes, NOT_CONNECTED
- [x] Component tests with recorded serverStatus fixtures
  - verified (2026-11-17 07:56+0100 by dell26/agent-2): cd packages/renderer && npx ng test --include='src/app/admin/stats/**/*.spec.ts' -> server-stats-view.spec.ts (14) + server-stats.model.spec.ts (16) passed, using serverStatus/replSetGetStatus recorded from mongo:8.2 by fixtures/capture.mjs; plus npm run test:e2e -- server-stats -> 1 passed (Electron, real mongo:8.2)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 07:53+0100 by dell26/agent-2): Replica set status needs a contract method the SPEC table lacks: added admin.replSetStatus ({profileId} -> {status: EJSON | null}, null on standalone/mongos) instead of overloading admin.serverStatus; dbStats reuses db.stats.
- ASSUMPTION (2026-11-17 07:53+0100 by dell26/agent-2): admin.serverStatus drops fields named $... at any depth (metrics.operatorCounters.match.$regex etc.): canonical EJSON of them cannot be parsed back (EJSON reads {$regex:..} as a RegExp). Those counters are not dashboard data.
- ASSUMPTION (2026-11-17 07:53+0100 by dell26/agent-2): Dashboard UI choices: new tab kind 'serverstats' from the connection menu ('Server stats'); live refresh default 2 s (1/2/5/10/never), 120 points; charts = ops/s by type, connections, resident memory (virtual only as a tile, it flattens resident), network bytes/s; dbStats of all databases loaded on open/Reload, not live. Hand-written inline SVG charts, no chart library.
- done by dell26/agent-2: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 70s on 8704e3380; criteria verified 2/2
