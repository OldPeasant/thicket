---
title: M2: Import from Compass and URIs, export without secrets
status: in_progress
owner: dell26/agent-2
deps: [conn-ui-m2,profiles-store]
touches: [apps/desktop/src/profiles/import,packages/renderer/src/app/connections/import]
prio: 2
lease_until: 2026-11-17T02:59:11Z
---
## Goal
Import Compass's exported connections JSON (plain and encrypted-without-passphrase skipped with a notice) and a list of connection strings; export selected profiles as JSON without secrets.

## Acceptance criteria
- [ ] Unit tests with Compass export fixtures (write them from Compass's documented format; record source with `assume`)
- [ ] Export file contains no password/passphrase/token (test greps the output)
- [ ] e2e: import → profiles appear in the sidebar

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
