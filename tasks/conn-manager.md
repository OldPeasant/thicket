---
title: M1: Connection manager: SCRAM, TLS, SRV, test, errors, write guard
status: in_progress
owner: dell26/agent-2
deps: [profiles-store,int-harness,uri-model]
touches: [packages/backend/src/connections,packages/backend/src/guard]
prio: 1
lease_until: 2026-11-16T19:46:25Z
---
## Goal
Backend conn.test/open/close/status/serverInfo; builds MongoClient options from profile + secrets (SCRAM-SHA-1/256, TLS with CA file, allow-invalid flags, SRV, directConnection); classifies errors (DNS, TLS, AUTH_FAILED, TIMEOUT); a guard every write handler uses: READ_ONLY on read-only profiles, confirmation required on production profiles.

## Acceptance criteria
- [ ] Integration tests (`npm run test:int`): SCRAM ok/wrong password → AUTH_FAILED, TLS without CA → TLS_ERROR, unknown host → DNS_ERROR, replica set and standalone fixtures
- [ ] Guard unit tests: read-only refuses every write method listed by the contract; production without `confirmed: true` refuses
- [ ] Logs mask passwords (test captures log output)
- [ ] Several connections open at once and close independently (int test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
