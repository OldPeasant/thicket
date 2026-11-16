---
title: M1: Connection editor and manager
status: todo
owner:
deps: [app-layout,api-client,profiles-store,uri-model,safety-ui]
touches: [packages/renderer/src/app/connections]
prio: 1
---
## Goal
Profile list (folders, colors), editor with form and connection-string tabs kept in sync, SCRAM and TLS fields, secrets options (save / ask each time, weak-keychain warning), read-only and production flags, Test connection with explained errors. Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [ ] Component tests: editing the form updates the URI and vice versa; masked password
- [ ] e2e: create a profile for the int-harness fixture, Test connection succeeds; wrong password shows AUTH_FAILED text
- [ ] Ask-each-time prompts for the password on connect and does not store it (e2e checks secrets.bin unchanged)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
