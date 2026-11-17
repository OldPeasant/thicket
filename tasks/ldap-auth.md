---
title: M5: LDAP (PLAIN) authentication
status: done
owner: felix/agent-2
deps: [x509-proxy]
touches: [packages/backend/src/auth/ldap,test/integration/fixtures/ldap]
prio: 3
lease_until: 
---
## Goal
PLAIN auth against MongoDB Enterprise configured for LDAP, with an OpenLDAP container fixture.

## Acceptance criteria
- [x] Integration test: LDAP user authenticates; wrong password → AUTH_FAILED (Enterprise + OpenLDAP fixtures)
  - verified (2026-11-17 03:39+0100 by felix/agent-2): npm run test:int -- ldap (Podman; mongodb-enterprise-server:8.0 + osixia/openldap:1.5.0 containers, test/integration/fixtures/ldap.ts) -> 8 passed: LDAP user alice authenticates as alice@$external (saved, typed, URI user, authSource override); wrong password (saved and typed) and unknown user -> AUTH_FAILED, password not logged

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 03:32+0100 by felix/agent-2): PLAIN always authenticates against $external (profile authSource ignored), like X.509/AWS: LDAP users live in $external on Enterprise and Atlas
- ASSUMPTION (2026-11-17 03:32+0100 by felix/agent-2): LDAP fixture images: mongodb/mongodb-enterprise-server:8.0-ubuntu2204 (no 8.2 Enterprise tag; 8.0 runs on this 7.1 kernel) and osixia/openldap:1.5.0 (bitnami/openldap no longer on Docker Hub); plain LDAP on the private network, user-to-DN mapping, no LDAP authz query (roles from $external users)
- done by felix/agent-2: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 78s on 9f8e373ba; criteria verified 1/1
