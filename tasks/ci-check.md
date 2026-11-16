---
title: M0: GitHub Actions runs the check on Linux, macOS and Windows
status: in_progress
owner: felix/agent-1
deps: [scaffold]
touches: [.github/workflows/check.yml]
prio: 1
lease_until: 2026-11-16T18:24:04Z
---
## Goal
Every push and PR runs `npm ci && npm run check` on ubuntu-latest, macos-latest and windows-latest with the Node version from .nvmrc.

## Acceptance criteria
- [x] Workflow file passes `npx --yes @action-validator/cli .github/workflows/check.yml` (or actionlint) locally
  - verified (2026-11-16 19:06+0100 by felix/agent-1): npx --yes @action-validator/cli .github/workflows/check.yml -> exit 0 (VALID); npx prettier --check passes as part of npm run check
- [ ] The check job uses the same Node major as `.nvmrc` and the same command as `.taskcheck` (diff shown in verify)
- [ ] Windows job runs the check in bash (Git for Windows), as TFP does
- [ ] A run on GitHub is green on all three OSes — if the repo has no remote yet, skip with reason and `assume`

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
