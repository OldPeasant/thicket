---
title: M6 (Should): currentOp and killOp
status: in_progress
owner: felix/agent-1
deps: [conn-manager,app-layout,safety-ui]
touches: [packages/backend/src/admin/currentop,packages/renderer/src/app/admin/currentop]
prio: 3
lease_until: 2026-11-17T05:56:17Z
---
## Goal
List running operations with filters (namespace, duration, type) and auto-refresh; kill with confirm.

## Acceptance criteria
- [ ] Integration test: a slow op is listed and killed
- [ ] e2e: kill from the UI with confirm

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 06:35+0100 by felix/agent-1): currentOp and killOp run on the primary (the connection's default server), not the profile's read preference: killOp must reach the server that listed the opid; ops on secondaries are not listed
- ASSUMPTION (2026-11-17 06:35+0100 by felix/agent-1): The namespace filter is a prefix on name boundaries (^ns(\.|$)): 'shop' matches shop and shop.orders but not shopping.x
- ASSUMPTION (2026-11-17 06:35+0100 by felix/agent-1): Current operations is a new tab kind 'currentop' opened from the connection's sidebar menu (not the generic 'admin' kind); auto-refresh defaults to 5 s, options never/2/5/10 s; Kill only for active operations
