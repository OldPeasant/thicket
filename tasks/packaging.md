---
title: M0: electron-builder packaging for the current OS
status: in_progress
owner: felix/agent-1
deps: [electron-shell]
touches: [apps/desktop/electron-builder.yml,apps/desktop/build]
prio: 2
lease_until: 2026-11-16T19:39:47Z
---
## Goal
`npm run dist` produces unsigned installers for the current OS: AppImage/deb/rpm on Linux, dmg on macOS, NSIS + zip on Windows; native modules rebuilt for Electron.

## Acceptance criteria
- [ ] On Linux: `npm run dist` produces AppImage, deb and rpm; the AppImage starts and shows the window (`xvfb-run` + screenshot or log line)
- [ ] App id `io.github.oldpeasant.thicket`, product name Thicket, placeholder icon set in build/
- [ ] macOS/Windows targets configured; verifying them needs those OSes → skip with reason if not available here

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
