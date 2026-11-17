---
title: M3: Save and reopen aggregation pipelines (pipelines.json)
status: in_progress
owner: dell26/agent-2
deps: [agg-ui]
touches: [packages/contract/src/pipelines.ts,apps/desktop/src/pipelines,packages/renderer/src/app/aggregation]
prio: 2
lease_until: 2026-11-17T04:55:56Z
---
## Goal
SPEC M3 "save pipelines": the aggregation builder (agg-ui, `packages/renderer/src/app/aggregation`) saves a pipeline under a name per namespace (stages incl. disabled ones, as canonical EJSON) and lists, reopens, renames and deletes saved ones. Stored by the main process in `userData/pipelines.json` (SPEC section 5), atomic writes like `settings.json`; new contract methods (e.g. `pipelines.list/save/delete`, route `main`).

## Acceptance criteria
- [ ] Unit tests for the store (missing/corrupt file, atomic write) and contract samples
- [ ] Component test: save a pipeline with a disabled stage, reopen it in a new builder tab: same stages and enabled flags

## Notes
