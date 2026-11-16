---
title: M0: Settings store in main (settings.json, app.* methods)
status: todo
owner:
deps: [electron-shell]
touches: [apps/desktop/src/settings]
prio: 1
---
## Goal
Persist app settings (style, mode, page size, number default, update check on/off …) in userData/settings.json with schema version and defaults; serve `app.settings.get/set` and push `app.settings.changed` events.

## Acceptance criteria
- [ ] Unit tests: defaults, unknown keys dropped, corrupt file → defaults + backup of the bad file
- [ ] Writes are atomic (temp file + rename) — test simulates a crash between write and rename
- [ ] Renderer gets `app.settings.changed` after a set (integration test from electron-shell's harness)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
