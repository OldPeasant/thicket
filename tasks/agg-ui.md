---
title: M3: Aggregation pipeline builder
status: todo
owner:
deps: [agg-backend,collection-view,codegen,raw-editor]
touches: [packages/renderer/src/app/aggregation]
prio: 2
---
## Goal
Stage list (add/remove/reorder/disable), each stage in shell syntax with live preview, full-text mode, run with paging, save pipelines, export code, create view. Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [ ] e2e: demo step 8 ($match → $group → $sort, preview per stage, export as shell and Node)
- [ ] Component tests: reorder/disable updates the pipeline; syntax error blocks preview of that stage only

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
