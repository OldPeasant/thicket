---
title: M0: electron-builder packaging for the current OS
status: done
owner: felix/agent-1
deps: [electron-shell]
touches: [apps/desktop/electron-builder.yml,apps/desktop/build]
prio: 2
lease_until: 
---
## Goal
`npm run dist` produces unsigned installers for the current OS: AppImage/deb/rpm on Linux, dmg on macOS, NSIS + zip on Windows; native modules rebuilt for Electron.

## Acceptance criteria
- [x] On Linux: `npm run dist` produces AppImage, deb and rpm; the AppImage starts and shows the window (`xvfb-run` + screenshot or log line)
  - verified (2026-11-16 20:42+0100 by felix/agent-1): podman run node:24-bookworm (+apt rpm) on rev 88c6803 (patch-identical to final): npm run dist -> release/thicket-0.0.0-linux-x86_64.AppImage, thicket-0.0.0-linux-amd64.deb, thicket-0.0.0-linux-x86_64.rpm; host Fedora 44 (Wayland, no xvfb): node apps/desktop/scripts/smoke-packaged.mjs release/thicket-0.0.0-linux-x86_64.AppImage -> smoke OK (window visible 1280x800, thicket://app/#/, name Thicket, isPackaged, app.ping=main, backend.ping=backend, screenshot shows the Thicket page). Host npm run dist without rpmbuild builds AppImage+deb then fails at rpm (needs package rpm)
- [x] App id `io.github.oldpeasant.thicket`, product name Thicket, placeholder icon set in build/
  - verified (2026-11-16 20:42+0100 by felix/agent-1): apps/desktop/electron-builder.yml appId io.github.oldpeasant.thicket, productName Thicket (+package.json productName); apps/desktop/build/icon.png 1024x1024 placeholder (scripts/make-icon.mjs); asserted by apps/desktop/src/packaging.spec.ts (21 passed in npm run check); dpkg-deb -f -> Package thicket, rpm -qip -> Name thicket, icon at usr/share/icons/hicolor/1024x1024/apps/thicket.png; app.getName()=Thicket in the AppImage smoke run
- [~] macOS/Windows targets configured; verifying them needs those OSes → skip with reason if not available here
  - skipped (2026-11-16 20:42+0100 by felix/agent-1): mac (dmg arm64+x64, ad-hoc signed) and win (nsis+zip x64) targets configured and schema-validated by packaging.spec.ts; no macOS here for dmg; on Linux electron-builder --win built thicket-0.0.0-win-x64.zip but NSIS needs wine (not installed); no installer started on those OSes

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 20:27+0100 by felix/agent-1): @thicket/backend and @thicket/contract moved to devDependencies of apps/desktop: main/preload/backend are esbuild bundles, so the asar only needs dist/*.cjs; native modules added later must be externals + dependencies
- ASSUMPTION (2026-11-16 20:27+0100 by felix/agent-1): electron pinned to exact 45.3.3 (electron-builder refuses a range when electron is hoisted to the root node_modules)
- ASSUMPTION (2026-11-16 20:27+0100 by felix/agent-1): productName Thicket set in apps/desktop/package.json so app.getName() and the userData folder are 'Thicket' (was '@thicket/desktop'); desktopName thicket.desktop for WM_CLASS
- ASSUMPTION (2026-11-16 20:27+0100 by felix/agent-1): homepage https://github.com/oldpeasant/thicket and maintainer 'Thicket contributors <thicket@users.noreply.github.com>' guessed from the app id; deb/rpm need them
- ASSUMPTION (2026-11-16 20:27+0100 by felix/agent-1): Placeholder icon is a generated 1024px PNG (scripts/make-icon.mjs); electron-builder derives icns/ico from it
- ASSUMPTION (2026-11-16 20:27+0100 by felix/agent-1): rpm verified by running npm run dist in podman node:24-bookworm with apt rpm installed (host has no rpmbuild and no sudo); host lacks rpmbuild so npm run dist on this host fails at the rpm step
- ASSUMPTION (2026-11-16 20:42+0100 by felix/agent-1): macOS/Windows installers unverified here; release-ci / installer-smoke must build and start them on macOS (Gatekeeper with ad-hoc signing) and Windows runners
- done by felix/agent-1: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 38s on 7ccd17b09; criteria verified 2/3, skipped #3
