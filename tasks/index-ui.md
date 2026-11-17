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
