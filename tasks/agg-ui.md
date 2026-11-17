---
title: M3: Aggregation pipeline builder
status: in_progress
owner: felix/agent-1
deps: [agg-backend,collection-view,codegen,raw-editor]
touches: [packages/renderer/src/app/aggregation]
prio: 2
lease_until: 2026-11-17T02:44:24Z
---
## Goal
Stage list (add/remove/reorder/disable), each stage in shell syntax with live preview, full-text mode, run with paging, save pipelines, export code, create view. Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [ ] e2e: demo step 8 ($match → $group → $sort, preview per stage, export as shell and Node)
- [ ] Component tests: reorder/disable updates the pipeline; syntax error blocks preview of that stage only

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 02:55+0100 by felix/agent-1): The builder is its own tab kind 'aggregation' (one per collection, id aggregation:<profile>:<db>.<coll>), opened with 'Aggregate…' on the collection tab; drop/rename close it like the collection tab
- ASSUMPTION (2026-11-17 02:55+0100 by felix/agent-1): Saving pipelines (pipelines.json) needs a main-process store and new contract methods; left to the new task saved-pipelines instead of growing agg-ui (not in its acceptance criteria)
- ASSUMPTION (2026-11-17 02:55+0100 by felix/agent-1): A stage with a syntax error blocks only its own preview: later stages are previewed without it and say so ('Without stage N: it has an error'); Run, Export and Create view refuse until it is fixed or disabled
- ASSUMPTION (2026-11-17 02:55+0100 by felix/agent-1): Full-text mode prints disabled stages as lines starting with '//- ' (comments for the parser), so they survive the round trip and come back disabled
- ASSUMPTION (2026-11-17 02:55+0100 by felix/agent-1): Run pages by appending $skip/$limit (20 per page, one extra doc to know if there is a next page); pipelines with $out/$merge run unpaged and always open the confirm dialog (SPEC: they ask first), not only on production
- ASSUMPTION (2026-11-17 02:56+0100 by felix/agent-1): Exported Node/Python/Java code uses the profile's connectionString (profiles.get; it never holds a password), else codegen's localhost default
- ASSUMPTION (2026-11-17 02:56+0100 by felix/agent-1): Stage arguments and the full text are edited in plain monospace textareas (errors under them with line/column), not CodeMirror, to keep the tab light; CodeMirror can come later
