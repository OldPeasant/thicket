---
title: Release: smoke-test installers in CI
status: in_progress
owner: dell26/agent-2
deps: [release-ci,e2e-harness]
touches: [.github/workflows/release.yml,test/e2e/smoke]
prio: 3
lease_until: 2026-11-17T05:26:12Z
---
## Goal
After building, each OS job starts the packaged app with Playwright: welcome screen shows; on Linux also connect to a containerized MongoDB.

## Acceptance criteria
- [ ] Smoke test passes locally against the Linux AppImage
- [~] CI run green on all three OSes — skip with reason if no remote yet
  - skipped (2026-11-17 06:03+0100 by dell26/agent-2): A release.yml run needs a pushed v* tag on the GitHub remote; agents must not push (done pushes main only, no tags) and gh is not usable here. macOS/Windows runners can't be reproduced on this Linux host. Needs a human to push a test tag and watch the build jobs.

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 06:02+0100 by dell26/agent-2): Windows smoke test installs the NSIS .exe silently (/S /D=<temp>) rather than unzipping the portable zip; macOS tests only the arm64 dmg (macos-latest is Apple Silicon), not the x64 one under Rosetta; Linux tests only the AppImage, not deb/rpm.
- ASSUMPTION (2026-11-17 06:02+0100 by dell26/agent-2): Linux CI sets kernel.apparmor_restrict_unprivileged_userns=0 so the AppImage runs with the Chromium sandbox (no --no-sandbox), and APPIMAGE_EXTRACT_AND_RUN=1 because the runners have no FUSE. The smoke test runs after the installers are uploaded as artifacts; a failure fails the build job and so blocks the draft release.
