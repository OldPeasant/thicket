---
title: M5: Connection editor for LDAP, OIDC and AWS
status: in_progress
owner: felix/agent-1
deps: [ldap-auth,oidc-auth,aws-auth,conn-ui-m2,profiles-import-export]
touches: [packages/renderer/src/app/connections]
prio: 3
lease_until: 2026-11-17T04:25:26Z
---
## Goal
Auth mechanism choices and their fields in the connection editor; OIDC 'sign in' state.

## Acceptance criteria
- [ ] Component tests for each mechanism's fields and URI sync
- [ ] e2e: LDAP profile connects against the fixture

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 04:41+0100 by felix/agent-1): AWS IAM in the editor: 'Access key ID' = auth.username, 'Secret access key' = the password field/secret (saved or ask, like aws-auth's backend), session token = awsSessionToken secret stored on save (Test of an unsaved draft can't use a typed token). No key ID = default credential chain, saved with secretMode none. The key ID never goes into the connection string (driver refuses it); editing the URI tab keeps the form's key/secret, a pasted URI with user:password replaces them
- ASSUMPTION (2026-11-17 04:41+0100 by felix/agent-1): LDAP, OIDC and AWS hide the authentication database field and drop authSource from the connection string (backend always uses $external), like X.509. Switching to/from AWS clears user name and password (an access key is no DB user)
- ASSUMPTION (2026-11-17 04:41+0100 by felix/agent-1): OIDC sign-in state = non-modal panel docked bottom right (app-shell), fed by the oidc.prompt broadcast: browser flow says 'finish in the browser' with a Copy link button (the renderer has no method to open URLs; main already opened it), device flow shows the user code large with the verification page, expiry countdown, copy buttons; 'Hide' only hides it (no cancel method in the contract); a short 'Signed in' / 'did not finish' note after 'finished'. Editor exposes oidcFlow (auto/authCode/deviceCode) and oidcTrustedEndpoint
