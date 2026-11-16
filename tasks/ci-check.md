---
title: M0: GitHub Actions runs the check on Linux, macOS and Windows
status: in_progress
owner: felix/agent-1
deps: [scaffold]
touches: [.github/workflows/check.yml]
prio: 1
lease_until: 2026-11-16T18:29:03Z
---
## Goal
Every push and PR runs `npm ci && npm run check` on ubuntu-latest, macos-latest and windows-latest with the Node version from .nvmrc.

## Acceptance criteria
- [x] Workflow file passes `npx --yes @action-validator/cli .github/workflows/check.yml` (or actionlint) locally
  - verified (2026-11-16 19:06+0100 by felix/agent-1): npx --yes @action-validator/cli .github/workflows/check.yml -> exit 0 (VALID); npx prettier --check passes as part of npm run check
- [x] The check job uses the same Node major as `.nvmrc` and the same command as `.taskcheck` (diff shown in verify)
  - verified (2026-11-16 19:06+0100 by felix/agent-1): check.yml: actions/setup-node node-version-file: .nvmrc (.nvmrc = 24, same file so same major); step 'run: bash .taskcheck' executes the very .taskcheck file (if package.json -> npm run check), so command diff is empty; local npm run check -> all lint/typecheck/tests passed
- [x] Windows job runs the check in bash (Git for Windows), as TFP does
  - verified (2026-11-16 19:06+0100 by felix/agent-1): check.yml: jobs.check.defaults.run.shell: bash on all matrix OSes incl. windows-latest (GitHub's bash on Windows is Git for Windows bash); core.autocrlf=false before checkout so Prettier sees LF
- [~] A run on GitHub is green on all three OSes — if the repo has no remote yet, skip with reason and `assume`
  - skipped (2026-11-16 19:06+0100 by felix/agent-1): Workflow only reaches GitHub when done pushes to main (agents may not push; no wip backup yet), and no gh CLI/API access from this machine to read run results

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 19:06+0100 by felix/agent-1): Assumed the workflow is green on GitHub on all three OSes without seeing a run: validated with action-validator and npm run check on Linux only; first run after done pushes main needs a human look (Actions tab of OldPeasant/thicket)
