---
title: M3: Indexes tab
status: todo
owner:
deps: [index-backend,collection-view]
touches: [packages/renderer/src/app/indexes]
prio: 2
---
## Goal
Indexes tab per collection: list with stats, create dialog with all options, drop with confirm, hide/unhide. Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [ ] e2e: create a TTL index and a partial index, see them listed with options
- [ ] Component tests for the create form validation

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
