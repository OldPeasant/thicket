---
title: M6 (Could): Edit users and roles
status: in_progress
owner: dell26/agent-1
deps: [users-roles-view,safety-ui]
touches: [packages/backend/src/admin/users/edit,packages/renderer/src/app/admin/users/edit]
prio: 4
lease_until: 2026-11-17T07:42:28Z
---
## Goal
Create/edit/drop users and roles, grant/revoke, through the guard.

## Acceptance criteria
- [x] Integration tests for each operation
  - verified (2026-11-17 08:18+0100 by dell26/agent-1): npx vitest run --config test/integration/vitest.config.ts test/integration/users-edit.int.spec.ts (mongo8 container fixture; create/update/drop user+role, grant/revoke to user and role, SCRAM sign-in of new password, guard read-only/production) at f9a32cf8 -> 16 passed
- [x] e2e: create user, grant role, connect as that user
  - verified (2026-11-17 08:18+0100 by dell26/agent-1): npm run build -w packages/renderer && npm run build -w apps/desktop && npx playwright test test/e2e/users-edit.e2e.ts (Electron app against MongoDB 8 --auth container, generated root password) at f9a32cf8 -> 1 passed (create user, grant read, connect as that user)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 07:56+0100 by dell26/agent-1): Contract: 8 write methods admin.createUser/updateUser/dropUser/createRole/updateRole/dropRole/grantRoles/revokeRoles; grant/revoke take kind 'user'|'role' + name; roles as {role,db} objects (roleRef is exempted from the EJSON-text doc-field rule in index.spec as names, not documents)
- ASSUMPTION (2026-11-17 07:56+0100 by dell26/agent-1): Confirm dialog shows passwords as pwd: "<hidden>"; drops always confirm (alwaysConfirm), other changes follow the normal guard rules (confirm on production only)
- ASSUMPTION (2026-11-17 07:56+0100 by dell26/agent-1): UI scope: no editing of authenticationRestrictions or mechanisms; built-in roles are not editable; updateUser replaces roles (roles diffed against the current ones, only changed fields are sent); emptying custom data sends {}
- ASSUMPTION (2026-11-17 07:56+0100 by dell26/agent-1): e2e uses its own MongoDB 8 standalone with --auth (startMongoSpec auth, generated root password); integration runs on the shared no-auth mongo8 fixture and checks new passwords by SCRAM sign-in, which the server verifies even without --auth
