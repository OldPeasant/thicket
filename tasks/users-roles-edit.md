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
- ASSUMPTION (2026-11-17 07:56+0100 by dell26/agent-1): Contract: 8 write methods admin.createUser/updateUser/dropUser/createRole/updateRole/dropRole/grantRoles/revokeRoles; grant/revoke take kind 'user'|'role' + name; roles as {role,db} objects (roleRef is exempted from the EJSON-text doc-field rule in index.spec as names, not documents)
- ASSUMPTION (2026-11-17 07:56+0100 by dell26/agent-1): Confirm dialog shows passwords as pwd: "<hidden>"; drops always confirm (alwaysConfirm), other changes follow the normal guard rules (confirm on production only)
- ASSUMPTION (2026-11-17 07:56+0100 by dell26/agent-1): UI scope: no editing of authenticationRestrictions or mechanisms; built-in roles are not editable; updateUser replaces roles (roles diffed against the current ones, only changed fields are sent); emptying custom data sends {}
