---
title: M2: Connection editor for SSH, X.509, proxy and read preference
status: in_progress
owner: dell26/agent-2
deps: [ssh-tunnel,x509-proxy,connection-ui]
touches: [packages/renderer/src/app/connections]
prio: 2
lease_until: 2026-11-17T02:54:31Z
---
## Goal
Extend the connection editor with SSH tab, certificate fields, proxy and read preference/write concern; host-key trust dialog; copyable connection string with masked password. Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [x] e2e: SSH-tunnelled profile created and connected, host key dialog accepted
  - verified (2026-11-17 03:36+0100 by dell26/agent-2): npm run test:e2e -- ssh.e2e.ts (Playwright _electron, built app, Podman: SSH fixture = openssh-server in front of 2-member replica set rs3 reachable only via tunnel) on b34b61a -> 1 passed (not skipped): profile created in editor with SSH password, saved, sidebar connect -> host key dialog (host:port, ssh-ed25519, SHA256 fingerprint) -> Trust and connect -> data-state connected; known_hosts written; reconnect without dialog; Test connection ok (replicaSet). connections.e2e.ts also 2 passed
- [x] Component tests for field validation and URI sync of the new options
  - verified (2026-11-17 03:36+0100 by dell26/agent-2): cd packages/renderer && npx ng test --include src/app/connections (form model M2 validation and URI-sync tests, editor M2 and M2-gaps tests, host-key-dialog spec) + app-shell.spec on b34b61a -> 236 passed; npm run check -> lint/typecheck ok, 3465 + 2228 tests passed. Covers SSH, proxy, X.509, key file without certificate (CR-2), tags with primary (CR-3), write concern validation and form-to-URI sync both ways

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
From x509-proxy review (CR-2, CR-3): the form must not allow `tls.keyFile` without
`tls.certificateKeyFile` (the backend ignores such a key file) nor `readPreferenceTags` with
`readPreference` `primary` or unset (the driver ignores the tags). Proxy password = secret kind
`proxyPassword`; tag sets are `{ name, value }` pairs.
- ASSUMPTION (2026-11-17 03:23+0100 by dell26/agent-2): Extra secrets (sshPassword, sshKeyPassphrase, tlsKeyPassphrase, proxyPassword) are typed in the editor and always stored with profiles.setSecret on save (the backend reads them only from stored secrets); only the kinds the current settings use are stored. So Test connection of an unsaved SSH draft can't use a typed SSH password: the form says to save first. A pasted proxyPassword/tlsCertificateKeyFilePassword is still dropped from the URI (note points to the fields).
- ASSUMPTION (2026-11-17 03:23+0100 by dell26/agent-2): Host key dialog lives in AppShell (HostKeyService listens to the ssh.hostKey broadcast for every connect: sidebar, editor Test), modal like the confirm dialog; 'Don't trust' is focused and Escape rejects. Copy button copies the connection string as shown (password masked). Tag sets are edited as 'name:value, ...' text per set. test/integration/fixtures/ssh.ts now default-imports ssh2 so Playwright's ESM loader can use it in e2e.
