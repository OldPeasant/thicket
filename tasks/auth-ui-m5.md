---
title: M5: Connection editor for LDAP, OIDC and AWS
status: todo
owner:
deps: [ldap-auth,oidc-auth,aws-auth,conn-ui-m2,profiles-import-export]
touches: [packages/renderer/src/app/connections]
prio: 3
---
## Goal
Auth mechanism choices and their fields in the connection editor; OIDC 'sign in' state.

## Acceptance criteria
- [ ] Component tests for each mechanism's fields and URI sync
- [ ] e2e: LDAP profile connects against the fixture

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
