---
title: M6 (Could): Server stats dashboard
status: in_progress
owner: dell26/agent-2
deps: [conn-manager,app-layout]
touches: [packages/backend/src/admin/stats,packages/renderer/src/app/admin/stats]
prio: 4
lease_until: 2026-11-17T07:01:11Z
---
## Goal
serverStatus, dbStats and replica set status with a few charts (ops/s, connections, memory) refreshing live.

## Acceptance criteria
- [ ] Integration test for the data methods
- [ ] Component tests with recorded serverStatus fixtures

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
