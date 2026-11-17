---
title: M6 (Should): Users and roles viewer
status: in_progress
owner: dell26/agent-2
deps: [conn-manager,app-layout]
touches: [packages/backend/src/admin/users,packages/renderer/src/app/admin/users]
prio: 3
lease_until: 2026-11-17T04:05:22Z
---
## Goal
Per database: users with roles, roles with privileges and inherited roles (read-only).

## Acceptance criteria
- [x] Integration test against a fixture with custom roles
  - verified (2026-11-17 04:46+0100 by dell26/agent-2): npm run test:int -- users-roles (mongo8 fixture via Podman; custom roles orderReader/orderClerk inheriting a custom and built-in role, users alice/bob/carol) -> 10 passed
- [ ] Component tests for the views

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 04:26+0100 by dell26/agent-2): Users and roles open as their own tab kind 'users' (id users:<profile>:<db>), from a new 'Users and roles' item in the sidebar's database context menu; the 'admin' kind is left for currentop/server stats
- ASSUMPTION (2026-11-17 04:26+0100 by dell26/agent-2): admin.users runs usersInfo:1 for names, then an exact-match usersInfo list with showPrivileges (the server refuses showPrivileges for usersInfo:1); credentials are never requested and dropped defensively; users and roles are sorted by name
- ASSUMPTION (2026-11-17 04:26+0100 by dell26/agent-2): The integration fixture is the plain mongo8 standalone (no --auth): users and custom roles can be created and read there; an unauthorized caller (viewUser/viewRole missing) is covered by a unit test of the SERVER_ERROR mapping, not against a server
