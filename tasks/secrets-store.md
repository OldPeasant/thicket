---
title: M1: Secrets in the OS keychain via safeStorage
status: todo
owner:
deps: [electron-shell]
touches: [apps/desktop/src/secrets]
prio: 1
---
## Goal
secrets.bin encrypted with safeStorage, keyed by profile id; detection of Linux `basic_text` backend; served to the backend over the privileged port only.

## Acceptance criteria
- [ ] Unit tests with a fake safeStorage: set/get/delete, file corruption handled
- [ ] On `basic_text` the status API reports `weak` and profiles default to not saving passwords (test)
- [ ] Renderer cannot request a secret: contract test shows no renderer-routable method returns a secret

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
