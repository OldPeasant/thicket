---
title: M5: OIDC authentication
status: in_progress
owner: felix/agent-1
deps: [x509-proxy]
touches: [packages/backend/src/auth/oidc,apps/desktop/src/oidc,test/integration/fixtures/oidc]
prio: 3
lease_until: 2026-11-17T03:14:45Z
---
## Goal
MONGODB-OIDC with authorization code flow in the system browser (main opens the URL, loopback redirect) and device flow fallback; tokens cached in the keychain and refreshed.

## Acceptance criteria
- [ ] Integration test with MongoDB Enterprise + Keycloak: automated code flow (headless browser drives Keycloak login) authenticates
- [ ] Token reuse: second connect does not open the browser (test)
- [ ] Device flow works (int test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
