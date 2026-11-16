---
title: Release: GitHub Actions builds installers on tag
status: in_progress
owner: felix/agent-1
deps: [packaging,ci-check]
touches: [.github/workflows/release.yml]
prio: 2
lease_until: 2026-11-16T20:10:15Z
---
## Goal
On a `v*` tag build AppImage/deb/rpm (x64, arm64), dmg (arm64, x64), NSIS + zip (x64), with SHA-256 checksums, and upload them to a draft GitHub release.

## Acceptance criteria
- [ ] Workflow validates locally (actionlint)
- [ ] A test tag on the GitHub repo produces all artefacts in a draft release — skip with reason if no remote yet

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 20:47+0100 by felix/agent-1): Release version comes from the tag (v1.2.3 -> 1.2.3) via electron-builder -c.extraMetadata.version; package.json versions stay 0.0.0
- ASSUMPTION (2026-11-16 20:47+0100 by felix/agent-1): Linux arm64 is built natively on GitHub's ubuntu-24.04-arm runner; both macOS dmgs (arm64+x64) on one macos-latest runner (no native modules, so cross-arch is fine)
- ASSUMPTION (2026-11-16 20:47+0100 by felix/agent-1): Release assets are only the installers + SHA256SUMS.txt (no blockmaps/latest*.yml, there is no auto-update); draft is created by gh in a separate job with contents:write, build jobs stay read-only
