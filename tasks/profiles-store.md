---
title: M1: Connection profiles store (connections.json)
status: in_progress
owner: dell26/agent-2
deps: [secrets-store,contract]
touches: [apps/desktop/src/profiles]
prio: 1
lease_until: 2026-11-16T19:22:06Z
---
## Goal
profiles.* in main: list/get/save/delete/duplicate, folders, color, read-only and production flags, 'ask for password each time'; versioned schema with migrations; no secrets in the file.

## Acceptance criteria
- [ ] Unit tests: CRUD, duplicate drops secrets, migration from a v0 fixture
- [ ] A saved profile with a password writes it only to secrets.bin (test inspects both files)
- [ ] Atomic writes as in app-settings (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 20:05+0100 by dell26/agent-2): No v0 format existed; defined v0 as a bare JSON array of {id?,name,uri,color?,group?,readonly?,isProduction?,askPassword?}. Migration strips the URI password into secrets.bin (or switches to secretMode ask if secrets.bin can't take it), username in URI -> SCRAM-SHA-256 auth.
- ASSUMPTION (2026-11-16 20:05+0100 by dell26/agent-2): profiles.save with an id that does not exist -> NOT_FOUND (ids are assigned by main); duplicate names the copy '<name> (copy)', inserts it after the original and keeps secretMode; switching secretMode away from saved deletes the saved password; profiles.setSecret for an unknown profile -> NOT_FOUND.
