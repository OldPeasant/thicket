---
title: M2: Import from Compass and URIs, export without secrets
status: in_progress
owner: dell26/agent-2
deps: [conn-ui-m2,profiles-store]
touches: [apps/desktop/src/profiles/import,packages/renderer/src/app/connections/import]
prio: 2
lease_until: 2026-11-17T03:04:41Z
---
## Goal
Import Compass's exported connections JSON (plain and encrypted-without-passphrase skipped with a notice) and a list of connection strings; export selected profiles as JSON without secrets.

## Acceptance criteria
- [ ] Unit tests with Compass export fixtures (write them from Compass's documented format; record source with `assume`)
- [ ] Export file contains no password/passphrase/token (test greps the output)
- [ ] e2e: import → profiles appear in the sidebar

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 03:49+0100 by dell26/agent-2): Compass export format written from memory of Compass's connection-storage export (type 'Compass Connections', version {$numberInt:'1'}, connections[].connectionOptions.connectionString/sshTunnel, favorite.name/color, connectionSecrets when a passphrase is used); fixtures in apps/desktop/src/profiles/import/fixtures are hand-written from that, not real Compass output. favorite.color keys color1..color10 mapped to approximate hex values. Legacy (pre-1.39) Compass exports, oidc/fleOptions/useSystemCA are ignored.
