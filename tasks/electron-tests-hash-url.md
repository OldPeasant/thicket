---
title: Fix npm run test:electron: 5 specs expect the URL without the router's #/ (pre-existing on main)
status: in_progress
owner: felix/agent-2
deps: []
touches: [apps/desktop/test]
prio: 2
lease_until: 2026-11-16T20:10:03Z
---
## Goal
`npm run test:electron` passes again. Since the renderer's hash router redirects to `#/`, the specs
that compare `page.url()` with `thicket://app/index.html` (or the dev server root) fail, and
"profiles.secretStorage reports the real safeStorage backend" sees empty output.
Found by packaging (2026-11-16) on main 64cb776: 5 failed | 17 passed.

## Acceptance criteria
- [ ] `npm run test:electron` (Linux, headless or xvfb-run) -> all specs pass

## Notes
Failing: app.electron.spec.ts (loads the renderer ... CSP header; profiles.secretStorage ...;
blocks window.open and navigation; will-frame-navigate ...), dev.electron.spec.ts (loads the
renderer from the dev server).
