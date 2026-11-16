---
title: M0: Settings store in main (settings.json, app.* methods)
status: in_progress
owner: dell26/agent-1
deps: [electron-shell]
touches: [apps/desktop/src/settings]
prio: 1
lease_until: 2026-11-16T19:07:09Z
---
## Goal
Persist app settings (style, mode, page size, number default, update check on/off …) in userData/settings.json with schema version and defaults; serve `app.settings.get/set` and push `app.settings.changed` events.

## Acceptance criteria
- [ ] Unit tests: defaults, unknown keys dropped, corrupt file → defaults + backup of the bad file
- [ ] Writes are atomic (temp file + rename) — test simulates a crash between write and rename
- [ ] Renderer gets `app.settings.changed` after a set (integration test from electron-shell's harness)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
