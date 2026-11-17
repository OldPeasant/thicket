---
title: M6 (Should): currentOp and killOp
status: in_progress
owner: felix/agent-1
deps: [conn-manager,app-layout,safety-ui]
touches: [packages/backend/src/admin/currentop,packages/renderer/src/app/admin/currentop]
prio: 3
lease_until: 2026-11-17T05:51:15Z
---
## Goal
List running operations with filters (namespace, duration, type) and auto-refresh; kill with confirm.

## Acceptance criteria
- [ ] Integration test: a slow op is listed and killed
- [ ] e2e: kill from the UI with confirm

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
