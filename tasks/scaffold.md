---
title: M0: Monorepo scaffold with npm workspaces and the check
status: in_progress
owner: dell26/agent-1
deps: []
touches: [package.json,package-lock.json,tsconfig.base.json,eslint.config.mjs,vitest.workspace.ts,apps,packages,README.md]
prio: 1
lease_until: 2026-11-16T17:40:57Z
---
## Goal
Create the npm-workspaces monorepo described in docs/ARCHITECTURE.md (apps/desktop, packages/contract, packages/core, packages/backend, packages/renderer as empty but buildable workspaces) with TypeScript strict, ESLint, Prettier, Vitest and V8 coverage.

## Acceptance criteria
- [x] `npm ci && npm run check` on a clean clone runs lint + type check + unit tests of every workspace and passes (each workspace has at least one trivial spec); time it, must be < 2 min
  - verified (2026-11-16 18:21+0100 by dell26/agent-1): fresh git clone of ef8b880 into out/clean-clone, Node v24.21.0 npm 11.19.0: npm ci -> 24.1 s; npm run check (eslint+prettier, tsc root + 5 workspaces, vitest 5 projects) -> 5 files/5 tests passed in 3.5 s; total ~28 s < 2 min
- [x] `npm run coverage` writes `coverage/coverage-summary.json` and lcov per workspace; the task-scoped command in docs/ARCHITECTURE.md "Coverage" works as written (run it on one file)
  - verified (2026-11-16 18:21+0100 by dell26/agent-1): npm run coverage at ef8b880 -> 5 workspace summaries; apps/desktop, packages/{contract,core,backend,renderer}/coverage/{coverage-summary.json,lcov.info} written; npm --prefix packages/core run coverage -- --coverage.include=src/index.ts (= ARCHITECTURE 'cd packages/core; npx vitest run --coverage --coverage.include=...', also run literally in packages/core) -> 1 test, src/index.ts 1/1 statements 1/1 lines
- [x] `sh .taskcheck` passes (it switches to `npm run check` now that package.json exists)
  - verified (2026-11-16 18:21+0100 by dell26/agent-1): sh .taskcheck in fresh clone of ef8b880 -> runs npm run check, exit 0
- [ ] Node version pinned (`engines` + `.nvmrc` = 24); README.md has a 5-line dev quick start
- [ ] `dashboard/` (TFP tooling, own Angular app) and the TFP Python files are excluded from workspaces, ESLint, Prettier and Vitest (grep the configs; `npm run check` does not touch them)
- [ ] Library versions chosen are recorded in docs/ARCHITECTURE.md "Stack" if they differ from the plan

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 18:14+0100 by dell26/agent-1): TypeScript pinned to ~6.0.3, not 7.x: Angular 22 compiler-cli and typescript-eslint 8 require <6.1
- ASSUMPTION (2026-11-16 18:14+0100 by dell26/agent-1): typescript-eslint pinned ~8.72.2: 8.73.0 is published but its @typescript-eslint/types@8.73.0 is not resolvable from the registry yet
- ASSUMPTION (2026-11-16 18:14+0100 by dell26/agent-1): Vitest projects live in root vitest.config.ts (test.projects) instead of the vitest.workspace.ts named in touches; the workspace file is deprecated since Vitest 3.2
- ASSUMPTION (2026-11-16 18:14+0100 by dell26/agent-1): Workspace packages are named @thicket/<folder> and export src/index.ts directly (no build step) until a build/packaging task needs compiled output
- ASSUMPTION (2026-11-16 18:14+0100 by dell26/agent-1): Prettier check is part of npm run lint and ignores *.md (human-written docs keep their formatting), tasks/, reviews/, .claude/, dashboard/
- ASSUMPTION (2026-11-16 18:14+0100 by dell26/agent-1): ESLint uses typescript-eslint strict+stylistic without type-aware rules to keep the check well under 2 min; core gets a no-restricted-imports rule for node:* and electron
