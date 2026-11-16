---
title: M6 (Should): Users and roles viewer
status: todo
owner:
deps: [conn-manager,app-layout]
touches: [packages/backend/src/admin/users,packages/renderer/src/app/admin/users]
prio: 3
---
## Goal
Per database: users with roles, roles with privileges and inherited roles (read-only).

## Acceptance criteria
- [ ] Integration test against a fixture with custom roles
- [ ] Component tests for the views

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
