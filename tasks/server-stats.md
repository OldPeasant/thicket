---
title: M6 (Could): Server stats dashboard
status: todo
owner:
deps: [conn-manager,app-layout]
touches: [packages/backend/src/admin/stats,packages/renderer/src/app/admin/stats]
prio: 4
---
## Goal
serverStatus, dbStats and replica set status with a few charts (ops/s, connections, memory) refreshing live.

## Acceptance criteria
- [ ] Integration test for the data methods
- [ ] Component tests with recorded serverStatus fixtures

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
