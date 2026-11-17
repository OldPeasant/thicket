---
title: M1: Query history and favorites
status: in_progress
owner: dell26/agent-3
deps: [collection-view,app-settings]
touches: [packages/renderer/src/app/collection/history,apps/desktop/src/history]
prio: 2
lease_until: 2026-11-17T04:39:30Z
---
## Goal
Per-collection history of recent queries and named favorites, stored in main (history/ and favorites.json), re-run from a dropdown.

## Acceptance criteria
- [ ] Unit tests for the store (limit, dedupe, per collection)
- [ ] Component test: run → appears in history; save favorite; re-run fills the query bar

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
