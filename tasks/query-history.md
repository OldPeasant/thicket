---
title: M1: Query history and favorites
status: in_progress
owner: dell26/agent-3
deps: [collection-view,app-settings]
touches: [packages/renderer/src/app/collection/history,apps/desktop/src/history]
prio: 2
lease_until: 2026-11-17T04:47:08Z
---
## Goal
Per-collection history of recent queries and named favorites, stored in main (history/ and favorites.json), re-run from a dropdown.

## Acceptance criteria
- [ ] Unit tests for the store (limit, dedupe, per collection)
- [ ] Component test: run → appears in history; save favorite; re-run fills the query bar

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 05:27+0100 by dell26/agent-3): History keeps the query bar text as typed (shell syntax) per collection, max 50 entries (HISTORY_LIMIT), dedupe = equal after trimming each field, newest first; all-empty queries, the tab's opening query and Reset are not recorded.
- ASSUMPTION (2026-11-17 05:27+0100 by dell26/agent-3): Favorites are per collection (profileId+db+coll); saving under an existing name (case-insensitive) replaces that favorite; deleting a profile does not remove its history/favorites (not specified).
