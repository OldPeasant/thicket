---
title: M3: Aggregation pipeline builder
status: in_progress
owner: felix/agent-1
deps: [agg-backend,collection-view,codegen,raw-editor]
touches: [packages/renderer/src/app/aggregation]
prio: 2
lease_until: 2026-11-17T02:13:58Z
---
## Goal
Stage list (add/remove/reorder/disable), each stage in shell syntax with live preview, full-text mode, run with paging, save pipelines, export code, create view. Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [ ] e2e: demo step 8 ($match → $group → $sort, preview per stage, export as shell and Node)
- [ ] Component tests: reorder/disable updates the pipeline; syntax error blocks preview of that stage only

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 02:55+0100 by felix/agent-1): The builder is its own tab kind 'aggregation' (one per collection, id aggregation:<profile>:<db>.<coll>), opened with 'Aggregate…' on the collection tab; drop/rename close it like the collection tab
