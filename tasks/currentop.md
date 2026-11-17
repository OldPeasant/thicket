---
title: M6 (Should): currentOp and killOp
status: in_progress
owner: felix/agent-1
deps: [conn-manager,app-layout,safety-ui]
touches: [packages/backend/src/admin/currentop,packages/renderer/src/app/admin/currentop]
prio: 3
lease_until: 2026-11-17T06:41:39Z
---
## Goal
List running operations with filters (namespace, duration, type) and auto-refresh; kill with confirm.

## Acceptance criteria
- [x] Integration test: a slow op is listed and killed
  - verified (2026-11-17 07:16+0100 by felix/agent-1): npx vitest run --config test/integration/vitest.config.ts test/integration/currentop.int.spec.ts (Podman MongoDB container) at 0fecf7d2 -> 3 passed (slow $where find listed with filters, killed, ends Interrupted, gone from list; read-only refused)
- [x] e2e: kill from the UI with confirm
  - verified (2026-11-17 07:16+0100 by felix/agent-1): npm run test:e2e -- test/e2e/currentop.e2e.ts (Playwright Electron harness, MongoDB container) at 0fecf7d2 -> 1 passed (cancel sends nothing, confirm kills, query Interrupted, row disappears)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 06:35+0100 by felix/agent-1): currentOp and killOp run on the primary (the connection's default server), not the profile's read preference: killOp must reach the server that listed the opid; ops on secondaries are not listed
- ASSUMPTION (2026-11-17 06:35+0100 by felix/agent-1): The namespace filter is a prefix on name boundaries (^ns(\.|$)): 'shop' matches shop and shop.orders but not shopping.x
- ASSUMPTION (2026-11-17 06:35+0100 by felix/agent-1): Current operations is a new tab kind 'currentop' opened from the connection's sidebar menu (not the generic 'admin' kind); auto-refresh defaults to 5 s, options never/2/5/10 s; Kill only for active operations
