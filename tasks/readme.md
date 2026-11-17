---
title: Release: README and user docs
status: in_progress
owner: dell26/agent-2
deps: [m1-e2e]
touches: [README.md,docs/user]
quality: exempt
quality_reason: documentation only
prio: 2
lease_until: 2026-11-17T04:50:54Z
---
## Goal
README with features, screenshots (both styles), install per OS including Gatekeeper and SmartScreen instructions for unsigned builds, build-from-source, contributing; trademark note.

## Acceptance criteria
- [x] README renders on GitHub (links checked with a link checker)
  - verified (2026-11-17 05:30+0100 by dell26/agent-2): podman run lycheeverse/lychee:latest --include-fragments README.md docs/user/install.md -> 31 links (27 unique: GitHub releases/json-canopy/gearlever/AppImageLauncher URLs, relative files, 4 screenshots, 13 #anchors) 31 OK, 0 errors; GFM render via pandoc/core -f gfm README.md -> 2 tables, [!IMPORTANT] alert, 4 images, all h2 anchors present (gh api /markdown not permitted in this sandbox)
- [x] Install instructions followed on Linux by a human or agent from a fresh AppImage
  - verified (2026-11-17 05:30+0100 by dell26/agent-2): Fedora 44 Wayland: built AppImage with electron-builder 26.18 (apps/desktop: electron-builder --linux AppImage -c.extraMetadata.version=0.1.0), copied as a fresh 0644 download to an empty dir with SHA256SUMS.txt, then followed docs/user/install.md AppImage steps via test-results script: sha256sum --check --ignore-missing -> OK; chmod +x -> 755; ./thicket-0.1.0-linux-x86_64.AppImage (THICKET_USER_DATA=fresh dir) -> window 'Thicket' shows welcome screen with 'New connection' and 'Import from Compass', process kept running

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 05:30+0100 by dell26/agent-2): Install was verified with a locally built AppImage (same electron-builder config as release.yml), not one downloaded from a GitHub release (no release published yet); macOS Gatekeeper and Windows SmartScreen steps are written from current OS behavior (macOS 15 removed Control-click Open) and were not run here
- ASSUMPTION (2026-11-17 05:30+0100 by dell26/agent-2): README feature list describes only done tasks; unfinished ones (schema analysis, CSV/BSON dump, multi-doc edit, query history, currentOp, update notice) are listed as Planned and must move up when they land
