---
title: M6 (Could): Edit users and roles
status: in_progress
owner: dell26/agent-1
deps: [users-roles-view,safety-ui]
touches: [packages/backend/src/admin/users/edit,packages/renderer/src/app/admin/users/edit]
prio: 4
lease_until: 2026-11-17T07:12:10Z
---
## Goal
Create/edit/drop users and roles, grant/revoke, through the guard.

## Acceptance criteria
- [ ] Integration tests for each operation
- [ ] e2e: create user, grant role, connect as that user

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
