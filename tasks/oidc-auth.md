---
title: M5: OIDC authentication
status: in_progress
owner: felix/agent-1
deps: [x509-proxy]
touches: [packages/backend/src/auth/oidc,apps/desktop/src/oidc,test/integration/fixtures/oidc]
prio: 3
lease_until: 2026-11-17T03:50:04Z
---
## Goal
MONGODB-OIDC with authorization code flow in the system browser (main opens the URL, loopback redirect) and device flow fallback; tokens cached in the keychain and refreshed.

## Acceptance criteria
- [x] Integration test with MongoDB Enterprise + Keycloak: automated code flow (headless browser drives Keycloak login) authenticates
  - verified (2026-11-17 04:31+0100 by felix/agent-1): npm run test:int -- oidc (Podman: MongoDB Enterprise + Keycloak fixture, headless Chromium) on c88f053 merged with main (de208f5) -> 6/6 passed, incl. 'authorization code flow: the browser signs in on Keycloak and the connect succeeds'
- [x] Token reuse: second connect does not open the browser (test)
  - verified (2026-11-17 04:31+0100 by felix/agent-1): npm run test:int -- oidc (Podman: MongoDB Enterprise + Keycloak) on de208f5 -> 6/6 passed, incl. 'token reuse: a second connect (also after a restart) does not open the browser'
- [x] Device flow works (int test)
  - verified (2026-11-17 04:31+0100 by felix/agent-1): npm run test:int -- oidc (Podman: MongoDB Enterprise + Keycloak) on de208f5 -> 6/6 passed, incl. 'device flow: the user code is shown, approved on Keycloak, and the connect succeeds' and 'auto flow falls back to the device flow when no browser can be opened'

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 03:54+0100 by felix/agent-1): Added optional profile field auth.oidcFlow ('auto'|'authCode'|'deviceCode', default auto = browser, device flow when the browser/loopback port is unavailable): SPEC says device flow is a fallback but a browser that 'opens' on the wrong machine (remote desktop) needs an explicit choice; auth-ui-m5 should expose it
- ASSUMPTION (2026-11-17 03:55+0100 by felix/agent-1): Default redirect URI is http://localhost:27097/redirect (mongosh/Compass's), so IdP apps registered for MongoDB tools work unchanged; not configurable in the profile yet
- ASSUMPTION (2026-11-17 03:55+0100 by felix/agent-1): Token cache: a cached refresh token is always used first (refresh, no browser) instead of reusing the cached access token, because the driver does not retry a rejected access token in its two-step conversation; an access token alone is reused only while valid >60s
- ASSUMPTION (2026-11-17 03:55+0100 by felix/agent-1): OIDC tokens are persisted (oidcTokens secret) only when secret storage is 'secure' (OS keychain) and the profile exists; with weak/unavailable storage they stay in backend memory for the session. Persisted regardless of the profile's secretMode
- ASSUMPTION (2026-11-17 03:55+0100 by felix/agent-1): New privileged methods oidc.openBrowser (http/https only, shell.openExternal) and oidc.saveTokens, and broadcast oidc.prompt (browser URL / device user code / finished) for the auth-ui-m5 'sign in' state
- ASSUMPTION (2026-11-17 03:55+0100 by felix/agent-1): The IdP is trusted with Node's default CAs (no per-profile CA for the IdP yet); tests inject the fixture CA via OidcEnvironment.ca. Headless Chromium for the int test needs 'npx playwright install chromium-headless-shell'
- ASSUMPTION (2026-11-17 04:14+0100 by felix/agent-1): Added optional profile field auth.oidcTrustedEndpoint (default false; like mongosh --oidcTrustedEndpoint): when true ALLOWED_HOSTS = the connection string's hosts (SRV: *.<parent domain>), otherwise driver default (Atlas/localhost only); auth-ui-m5 should expose it
- ASSUMPTION (2026-11-17 04:14+0100 by felix/agent-1): Cached/refreshed OIDC tokens are forgotten (memory + keychain) when the server refuses them with AUTH_FAILED, so the next connect signs in interactively
