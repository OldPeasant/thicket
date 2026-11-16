---
title: M5: LDAP (PLAIN) authentication
status: todo
owner:
deps: [x509-proxy]
touches: [packages/backend/src/auth/ldap,test/integration/fixtures/ldap]
prio: 3
---
## Goal
PLAIN auth against MongoDB Enterprise configured for LDAP, with an OpenLDAP container fixture.

## Acceptance criteria
- [ ] Integration test: LDAP user authenticates; wrong password → AUTH_FAILED (Enterprise + OpenLDAP fixtures)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
