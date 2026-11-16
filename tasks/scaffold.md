---
title: M0: Monorepo scaffold with npm workspaces and the check
status: in_progress
owner: dell26/agent-1
deps: []
touches: [package.json,package-lock.json,tsconfig.base.json,eslint.config.mjs,vitest.workspace.ts,apps,packages,README.md]
prio: 1
lease_until: 2026-11-16T17:31:01Z
---
## Goal
Create the npm-workspaces monorepo described in docs/ARCHITECTURE.md (apps/desktop, packages/contract, packages/core, packages/backend, packages/renderer as empty but buildable workspaces) with TypeScript strict, ESLint, Prettier, Vitest and V8 coverage.

## Acceptance criteria
- [ ] `npm ci && npm run check` on a clean clone runs lint + type check + unit tests of every workspace and passes (each workspace has at least one trivial spec); time it, must be < 2 min
- [ ] `npm run coverage` writes `coverage/coverage-summary.json` and lcov per workspace; the task-scoped command in docs/ARCHITECTURE.md "Coverage" works as written (run it on one file)
- [ ] `sh .taskcheck` passes (it switches to `npm run check` now that package.json exists)
- [ ] Node version pinned (`engines` + `.nvmrc` = 24); README.md has a 5-line dev quick start
- [ ] `dashboard/` (TFP tooling, own Angular app) and the TFP Python files are excluded from workspaces, ESLint, Prettier and Vitest (grep the configs; `npm run check` does not touch them)
- [ ] Library versions chosen are recorded in docs/ARCHITECTURE.md "Stack" if they differ from the plan

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 18:14+0100 by dell26/agent-1): TypeScript pinned to ~6.0.3, not 7.x: Angular 22 compiler-cli and typescript-eslint 8 require <6.1
- ASSUMPTION (2026-11-16 18:14+0100 by dell26/agent-1): typescript-eslint pinned ~8.72.2: 8.73.0 is published but its @typescript-eslint/types@8.73.0 is not resolvable from the registry yet
