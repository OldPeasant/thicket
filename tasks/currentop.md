---
title: M6 (Should): currentOp and killOp
status: todo
owner:
deps: [conn-manager,app-layout,safety-ui]
touches: [packages/backend/src/admin/currentop,packages/renderer/src/app/admin/currentop]
prio: 3
---
## Goal
List running operations with filters (namespace, duration, type) and auto-refresh; kill with confirm.

## Acceptance criteria
- [ ] Integration test: a slow op is listed and killed
- [ ] e2e: kill from the UI with confirm

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
