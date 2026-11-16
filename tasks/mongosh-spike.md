---
title: M4: Spike: embedding mongosh in the backend process
status: todo
owner:
deps: [electron-shell]
touches: [docs/mongosh.md,spikes/mongosh]
quality: exempt
quality_reason: research spike: produces a decision document and throwaway prototype, no product code
prio: 2
---
## Goal
Find out how to host the real mongosh runtime in the utilityProcess (packages, versions, eval API, autocompletion, output types, interrupt), with a throwaway prototype in spikes/mongosh.

## Acceptance criteria
- [ ] docs/mongosh.md answers: packages and versions, how eval/complete/interrupt work, how output is typed, packaging impact (size, native modules), licence
- [ ] The prototype evaluates `db.runCommand({ping:1})` against a fixture (command and output in verify)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
