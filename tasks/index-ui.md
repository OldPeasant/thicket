---
title: M3: Indexes tab
status: in_progress
owner: dell26/agent-1
deps: [index-backend,collection-view]
touches: [packages/renderer/src/app/indexes]
prio: 2
lease_until: 2026-11-17T03:29:44Z
---
## Goal
Indexes tab per collection: list with stats, create dialog with all options, drop with confirm, hide/unhide. Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [ ] e2e: create a TTL index and a partial index, see them listed with options
- [ ] Component tests for the create form validation

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 04:09+0100 by dell26/agent-1): Indexes is its own workspace tab (kind indexes, opened with 'Indexes…' on the collection tab, like Aggregate…), not a sub-tab inside the collection view: matches the aggregation pattern and keeps collection-view changes small. The create dialog is an inline panel at the top of the tab.
