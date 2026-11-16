---
title: Fix npm run test:electron: 5 specs expect the URL without the router's #/ (pre-existing on main)
status: done
owner: felix/agent-2
deps: []
touches: [apps/desktop/test]
prio: 2
lease_until: 
---
## Goal
`npm run test:electron` passes again. Since the renderer's hash router redirects to `#/`, the specs
that compare `page.url()` with `thicket://app/index.html` (or the dev server root) fail, and
"profiles.secretStorage reports the real safeStorage backend" sees empty output.
Found by packaging (2026-11-16) on main 64cb776: 5 failed | 17 passed.

## Acceptance criteria
- [x] `npm run test:electron` (Linux, headless or xvfb-run) -> all specs pass
  - verified (2026-11-16 21:00+0100 by felix/agent-2): npm run test:electron on Linux, headless (no DISPLAY -> --ozone-platform=headless; xvfb-run not installed) at c307e38 -> 5 files, 26/26 passed (was 7 failed on main before)

## Notes
Failing: app.electron.spec.ts (loads the renderer ... CSP header; profiles.secretStorage ...;
blocks window.open and navigation; will-frame-navigate ...), dev.electron.spec.ts (loads the
renderer from the dev server).
- ASSUMPTION (2026-11-16 20:52+0100 by felix/agent-2): Secrets spec now saves a real profile before profiles.setSecret (main rejects unknown ids with NOT_FOUND since profiles-store); the 'secret storage:' log line is checked on a separate direct Electron start (startupOutput helper) because Playwright attaches stdout after main already printed it; the task listed 5 failures, 7 failed here (2 extra in secrets spec), all fixed in tests only
- done by felix/agent-2: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 31s on 440512a95; criteria verified 1/1
