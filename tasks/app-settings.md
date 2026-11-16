---
title: M0: Settings store in main (settings.json, app.* methods)
status: in_progress
owner: dell26/agent-1
deps: [electron-shell]
touches: [apps/desktop/src/settings]
prio: 1
lease_until: 2026-11-16T19:22:23Z
---
## Goal
Persist app settings (style, mode, page size, number default, update check on/off …) in userData/settings.json with schema version and defaults; serve `app.settings.get/set` and push `app.settings.changed` events.

## Acceptance criteria
- [x] Unit tests: defaults, unknown keys dropped, corrupt file → defaults + backup of the bad file
  - verified (2026-11-16 20:04+0100 by dell26/agent-1): cd apps/desktop && npx vitest run src/settings/store.spec.ts -> 56 passed (defaults, unknown keys dropped incl. __proto__, corrupt layouts -> defaults + settings.json.corrupt-<time> backup with the original content, also when that rename fails at load: backup before first write)
- [x] Writes are atomic (temp file + rename) — test simulates a crash between write and rename
  - verified (2026-11-16 20:04+0100 by dell26/agent-1): cd apps/desktop && npx vitest run src/settings/store.spec.ts -t 'atomic|crash' -> 10 passed: writes settings.json.tmp (flush) then renames; injected fs fails the rename (crash between write and rename) -> previous settings.json byte-identical, next start loads it and removes the stale temp file
- [x] Renderer gets `app.settings.changed` after a set (integration test from electron-shell's harness)
  - verified (2026-11-16 20:04+0100 by dell26/agent-1): npm run test:electron (Linux, built Electron app via Playwright _electron, THICKET_USER_DATA=tmpdir) after merging main -> 22 passed; settings.electron.spec.ts: renderer thicket.on('app.settings.changed') gets one data event with the full settings after app.settings.set; file written; persists across restart

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 19:48+0100 by dell26/agent-1): Defaults: style business, mode system (follow OS), pageSize 50, nestedPageSize 100, defaultIntegerType int32, dateDisplay local, checkForUpdates true, schemaSampleSize 1000. SPEC fixes only business/100/int32; the rest are my picks.
- ASSUMPTION (2026-11-16 19:48+0100 by dell26/agent-1): settings.json layout {version:1, settings:{...}}. Invalid values of known keys fall back to that key's default (not treated as corrupt); only unparseable JSON or a wrong top-level layout counts as corrupt and is renamed to settings.json.corrupt-<ISO time>. A newer version is read leniently (known keys only).
- ASSUMPTION (2026-11-16 19:48+0100 by dell26/agent-1): Added BROADCAST_STREAMS.settingsChanged='app.settings.changed' and the SettingsChanged payload {settings} to the contract; the event is only sent when a set actually changes a value. Env THICKET_USER_DATA overrides userData (for tests).
