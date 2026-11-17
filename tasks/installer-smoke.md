---
title: Release: smoke-test installers in CI
status: in_progress
owner: dell26/agent-2
deps: [release-ci,e2e-harness]
touches: [.github/workflows/release.yml,test/e2e/smoke]
prio: 3
lease_until: 2026-11-17T05:21:08Z
---
## Goal
After building, each OS job starts the packaged app with Playwright: welcome screen shows; on Linux also connect to a containerized MongoDB.

## Acceptance criteria
- [ ] Smoke test passes locally against the Linux AppImage
- [ ] CI run green on all three OSes — skip with reason if no remote yet

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 06:02+0100 by dell26/agent-2): Windows smoke test installs the NSIS .exe silently (/S /D=<temp>) rather than unzipping the portable zip; macOS tests only the arm64 dmg (macos-latest is Apple Silicon), not the x64 one under Rosetta; Linux tests only the AppImage, not deb/rpm.
