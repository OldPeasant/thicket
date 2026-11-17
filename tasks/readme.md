---
title: Release: README and user docs
status: in_progress
owner: dell26/agent-2
deps: [m1-e2e]
touches: [README.md,docs/user]
quality: exempt
quality_reason: documentation only
prio: 2
lease_until: 2026-11-17T04:45:50Z
---
## Goal
README with features, screenshots (both styles), install per OS including Gatekeeper and SmartScreen instructions for unsigned builds, build-from-source, contributing; trademark note.

## Acceptance criteria
- [x] README renders on GitHub (links checked with a link checker)
  - verified (2026-11-17 05:30+0100 by dell26/agent-2): podman run lycheeverse/lychee:latest --include-fragments README.md docs/user/install.md -> 31 links (27 unique: GitHub releases/json-canopy/gearlever/AppImageLauncher URLs, relative files, 4 screenshots, 13 #anchors) 31 OK, 0 errors; GFM render via pandoc/core -f gfm README.md -> 2 tables, [!IMPORTANT] alert, 4 images, all h2 anchors present (gh api /markdown not permitted in this sandbox)
- [ ] Install instructions followed on Linux by a human or agent from a fresh AppImage

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
