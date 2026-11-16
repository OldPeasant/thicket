---
title: M0: electron-builder packaging for the current OS
status: in_progress
owner: felix/agent-1
deps: [electron-shell]
touches: [apps/desktop/electron-builder.yml,apps/desktop/build]
prio: 2
lease_until: 2026-11-16T19:44:47Z
---
## Goal
`npm run dist` produces unsigned installers for the current OS: AppImage/deb/rpm on Linux, dmg on macOS, NSIS + zip on Windows; native modules rebuilt for Electron.

## Acceptance criteria
- [ ] On Linux: `npm run dist` produces AppImage, deb and rpm; the AppImage starts and shows the window (`xvfb-run` + screenshot or log line)
- [ ] App id `io.github.oldpeasant.thicket`, product name Thicket, placeholder icon set in build/
- [ ] macOS/Windows targets configured; verifying them needs those OSes → skip with reason if not available here

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 20:27+0100 by felix/agent-1): @thicket/backend and @thicket/contract moved to devDependencies of apps/desktop: main/preload/backend are esbuild bundles, so the asar only needs dist/*.cjs; native modules added later must be externals + dependencies
- ASSUMPTION (2026-11-16 20:27+0100 by felix/agent-1): electron pinned to exact 45.3.3 (electron-builder refuses a range when electron is hoisted to the root node_modules)
- ASSUMPTION (2026-11-16 20:27+0100 by felix/agent-1): productName Thicket set in apps/desktop/package.json so app.getName() and the userData folder are 'Thicket' (was '@thicket/desktop'); desktopName thicket.desktop for WM_CLASS
- ASSUMPTION (2026-11-16 20:27+0100 by felix/agent-1): homepage https://github.com/oldpeasant/thicket and maintainer 'Thicket contributors <thicket@users.noreply.github.com>' guessed from the app id; deb/rpm need them
- ASSUMPTION (2026-11-16 20:27+0100 by felix/agent-1): Placeholder icon is a generated 1024px PNG (scripts/make-icon.mjs); electron-builder derives icns/ico from it
