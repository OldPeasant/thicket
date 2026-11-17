---
title: M3: Save and reopen aggregation pipelines (pipelines.json)
status: in_progress
owner: dell26/agent-2
deps: [agg-ui]
touches: [packages/contract/src/pipelines.ts,apps/desktop/src/pipelines,packages/renderer/src/app/aggregation]
prio: 2
lease_until: 2026-11-17T05:16:06Z
---
## Goal
SPEC M3 "save pipelines": the aggregation builder (agg-ui, `packages/renderer/src/app/aggregation`) saves a pipeline under a name per namespace (stages incl. disabled ones, as canonical EJSON) and lists, reopens, renames and deletes saved ones. Stored by the main process in `userData/pipelines.json` (SPEC section 5), atomic writes like `settings.json`; new contract methods (e.g. `pipelines.list/save/delete`, route `main`).

## Acceptance criteria
- [ ] Unit tests for the store (missing/corrupt file, atomic write) and contract samples
- [ ] Component test: save a pipeline with a disabled stage, reopen it in a new builder tab: same stages and enabled flags

## Notes
- ASSUMPTION (2026-11-17 05:40+0100 by dell26/agent-2): Saved pipelines are per collection = profileId+db+coll (same scope as query favorites in query-history), not per db.coll across profiles; names unique per collection ignoring case; Save under a taken name replaces that pipeline (keeps its id), Rename to a taken name answers CONFLICT.
- ASSUMPTION (2026-11-17 05:40+0100 by dell26/agent-2): Contract: pipelines.list/save/rename/delete (route main, added to SPEC section 4); ids are named pipelineId and the result key is saved (contract test treats id/pipeline as document fields). Stages are stored as canonical EJSON, so reopening reprints each argument in shell syntax (original formatting/comments are not kept); a pipeline with any stage error (disabled too) cannot be saved.
- ASSUMPTION (2026-11-17 05:40+0100 by dell26/agent-2): pipelines.json: invalid entries make the whole file corrupt (renamed .corrupt-<time>, start empty) and newer versions are read-only, like connections.json, rather than dropping entries. UI: a Saved… panel in the builder header using existing panel styles; delete confirmed with an inline second click instead of the write-confirm dialog (local data). frontend-design skill not invoked for this small panel.
