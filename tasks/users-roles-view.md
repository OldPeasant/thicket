---
title: M6 (Should): Users and roles viewer
status: in_progress
owner: dell26/agent-2
deps: [conn-manager,app-layout]
touches: [packages/backend/src/admin/users,packages/renderer/src/app/admin/users]
prio: 3
lease_until: 2026-11-17T03:45:11Z
---
## Goal
Per database: users with roles, roles with privileges and inherited roles (read-only).

## Acceptance criteria
- [ ] Integration test against a fixture with custom roles
- [ ] Component tests for the views

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 04:26+0100 by dell26/agent-2): Users and roles open as their own tab kind 'users' (id users:<profile>:<db>), from a new 'Users and roles' item in the sidebar's database context menu; the 'admin' kind is left for currentop/server stats
