---
title: M4: Spike: embedding mongosh in the backend process
status: in_progress
owner: felix/agent-1
deps: [electron-shell]
touches: [docs/mongosh.md,spikes/mongosh]
quality: exempt
quality_reason: research spike: produces a decision document and throwaway prototype, no product code
prio: 2
lease_until: 2026-11-16T19:29:43Z
---
## Goal
Find out how to host the real mongosh runtime in the utilityProcess (packages, versions, eval API, autocompletion, output types, interrupt), with a throwaway prototype in spikes/mongosh.

## Acceptance criteria
- [x] docs/mongosh.md answers: packages and versions, how eval/complete/interrupt work, how output is typed, packaging impact (size, native modules), licence
  - verified (2026-11-16 20:12+0100 by felix/agent-1): docs/mongosh.md written from the installed packages (cd spikes/mongosh && npm ci: @mongosh/* 5.6.2-5.11.9, mongodb 7.9.0, npm query licence survey, node bundle.mjs -> 22.4 MiB esbuild bundle that runs ping.cjs's full scenario) -> sections: packages/versions, eval, output types, autocompletion, interrupt, packaging (size, native kerberos/mongocrypt N-API), licence (all permissive, Apache-2.0 core)
- [ ] The prototype evaluates `db.runCommand({ping:1})` against a fixture (command and output in verify)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
