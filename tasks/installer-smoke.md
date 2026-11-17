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
