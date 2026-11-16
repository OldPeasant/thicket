---
title: Release: GitHub Actions builds installers on tag
status: in_progress
owner: felix/agent-1
deps: [packaging,ci-check]
touches: [.github/workflows/release.yml]
prio: 2
lease_until: 2026-11-16T20:04:37Z
---
## Goal
On a `v*` tag build AppImage/deb/rpm (x64, arm64), dmg (arm64, x64), NSIS + zip (x64), with SHA-256 checksums, and upload them to a draft GitHub release.

## Acceptance criteria
- [ ] Workflow validates locally (actionlint)
- [ ] A test tag on the GitHub repo produces all artefacts in a draft release — skip with reason if no remote yet

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
