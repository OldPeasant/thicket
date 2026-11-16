---
title: M1: Connection profiles store (connections.json)
status: todo
owner:
deps: [secrets-store,contract]
touches: [apps/desktop/src/profiles]
prio: 1
---
## Goal
profiles.* in main: list/get/save/delete/duplicate, folders, color, read-only and production flags, 'ask for password each time'; versioned schema with migrations; no secrets in the file.

## Acceptance criteria
- [ ] Unit tests: CRUD, duplicate drops secrets, migration from a v0 fixture
- [ ] A saved profile with a password writes it only to secrets.bin (test inspects both files)
- [ ] Atomic writes as in app-settings (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
