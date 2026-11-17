---
title: M1: Query history and favorites
status: in_progress
owner: dell26/agent-3
deps: [collection-view,app-settings]
touches: [packages/renderer/src/app/collection/history,apps/desktop/src/history]
prio: 2
lease_until: 2026-11-17T05:02:18Z
---
## Goal
Per-collection history of recent queries and named favorites, stored in main (history/ and favorites.json), re-run from a dropdown.

## Acceptance criteria
- [x] Unit tests for the store (limit, dedupe, per collection)
  - verified (2026-11-17 05:46+0100 by dell26/agent-3): npx vitest run apps/desktop/src/history -> 40 passed (store.spec.ts: 50-entry default + custom limit, dedupe moves equal query to top, per collection/profile history and favorites, corrupt/unreadable files)
- [x] Component test: run → appears in history; save favorite; re-run fills the query bar
  - verified (2026-11-17 05:46+0100 by dell26/agent-3): cd packages/renderer && npx ng test --watch=false --include src/app/collection/history -> 31 passed (query-history.spec.ts on the real CollectionView with faked history.*: run -> appears in History; save favorite; picking entry/favorite fills the query bar and re-runs); npm run check -> pass

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 05:27+0100 by dell26/agent-3): History keeps the query bar text as typed (shell syntax) per collection, max 50 entries (HISTORY_LIMIT), dedupe = equal after trimming each field, newest first; all-empty queries, the tab's opening query and Reset are not recorded.
- ASSUMPTION (2026-11-17 05:27+0100 by dell26/agent-3): Favorites are per collection (profileId+db+coll); saving under an existing name (case-insensitive) replaces that favorite; deleting a profile does not remove its history/favorites (not specified).
- ASSUMPTION (2026-11-17 05:27+0100 by dell26/agent-3): New contract group history.* (list/add/clear/saveFavorite/deleteFavorite) routed to main; history text fields are exempt from the EJSON doc-field rule like profiles.*/app.*. UI follows the existing query-bar styles; frontend-design skill not invoked for this small dropdown.
