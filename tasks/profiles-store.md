---
title: M1: Connection profiles store (connections.json)
status: done
owner: dell26/agent-2
deps: [secrets-store,contract]
touches: [apps/desktop/src/profiles]
prio: 1
lease_until: 
---
## Goal
profiles.* in main: list/get/save/delete/duplicate, folders, color, read-only and production flags, 'ask for password each time'; versioned schema with migrations; no secrets in the file.

## Acceptance criteria
- [x] Unit tests: CRUD, duplicate drops secrets, migration from a v0 fixture
  - verified (2026-11-16 20:23+0100 by dell26/agent-2): npx vitest run apps/desktop/src/profiles -t 'CRUD|duplicate|migrat|v0' -> 38 passed (create/list/get/update/delete, unknown ids NOT_FOUND, duplicate copies no secrets checked against real SecretsStore, v0 fixture fixtures/connections.v0.json migrated with password moved to secrets.bin and file rewritten as v1)
- [x] A saved profile with a password writes it only to secrets.bin (test inspects both files)
  - verified (2026-11-16 20:23+0100 by dell26/agent-2): npx vitest run apps/desktop/src/profiles -t 'secrets stay out' -> passed: profiles.save + profiles.setSecret via handlers on a temp userData dir; connections.json text lacks the password, secrets.bin raw bytes lack it and decrypt (FakeSafeStorage) to {version:1,profiles:{<id>:{password}}}; profiles.get returns only storedSecrets kinds
- [x] Atomic writes as in app-settings (test)
  - verified (2026-11-16 20:23+0100 by dell26/agent-2): npx vitest run apps/desktop/src/profiles -t 'atomic' -> passed: writes go to connections.json.tmp with flush=true then rename over connections.json (same as app-settings SettingsStore); simulated crash between write and rename keeps previous file and in-memory state; stale .tmp removed on next load

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 20:05+0100 by dell26/agent-2): No v0 format existed; defined v0 as a bare JSON array of {id?,name,uri,color?,group?,readonly?,isProduction?,askPassword?}. Migration strips the URI password into secrets.bin (or switches to secretMode ask if secrets.bin can't take it), username in URI -> SCRAM-SHA-256 auth.
- ASSUMPTION (2026-11-16 20:05+0100 by dell26/agent-2): profiles.save with an id that does not exist -> NOT_FOUND (ids are assigned by main); duplicate names the copy '<name> (copy)', inserts it after the original and keeps secretMode; switching secretMode away from saved deletes the saved password; profiles.setSecret for an unknown profile -> NOT_FOUND.
- ASSUMPTION (2026-11-16 20:05+0100 by dell26/agent-2): connections.json with any invalid profile or duplicate id is treated as corrupt as a whole (renamed .corrupt-<time>, start empty) instead of silently dropping entries; unreadable (EACCES) fails operations; newer version read-only (UNSUPPORTED on change). defaultSecretMode is left to the renderer form via profiles.secretStorage; the store does not rewrite secretMode.
- ASSUMPTION (2026-11-16 20:24+0100 by dell26/agent-2): Review CR-4 accepted: if secrets.bin is locked (v11 keyring file, weak session) during a v0 migration, the migrated profile switches to secretMode ask and the v0 password is not kept. v0 is a pre-release layout no shipped build wrote, so this is not worth a separate locked-state path.
- done by dell26/agent-2: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 19s on ea295d204; criteria verified 3/3
