---
title: M1: Connection manager: SCRAM, TLS, SRV, test, errors, write guard
status: in_progress
owner: dell26/agent-2
deps: [profiles-store,int-harness,uri-model]
touches: [packages/backend/src/connections,packages/backend/src/guard]
prio: 1
lease_until: 2026-11-16T19:52:23Z
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
- ASSUMPTION (2026-11-16 20:33+0100 by dell26/agent-2): Added privileged method profiles.forConnect (contract backend.ts, served by main from ProfilesStore) so the backend can load a profile by id for conn.open/test and the write guard; the contract had no way for the backend to read profiles. Touches apps/desktop/src/main + profiles/handlers.ts beyond the task's touches.
- ASSUMPTION (2026-11-16 20:33+0100 by dell26/agent-2): Write guard reloads the profile from main on every write (not the copy cached at conn.open), so toggling read-only/production applies immediately; costs one privileged round trip per write.
- ASSUMPTION (2026-11-16 20:34+0100 by dell26/agent-2): conn.close of a profile that is not open succeeds silently (idempotent); a failed conn.open keeps state 'error' with the classified error in conn.status until the next open/close; conn.open answers the error as an RpcError rather than a status with state 'error'.
- ASSUMPTION (2026-11-16 20:34+0100 by dell26/agent-2): A saved/ask profile with a username but no password (none stored, none sent) answers AUTH_FAILED 'No password for user ...' before connecting; SSH and auth mechanisms other than NONE/SCRAM answer UNSUPPORTED until their tasks (ssh-tunnel, x509-proxy, ldap/oidc/aws-auth). Driver default timeouts are kept when the profile sets none.
