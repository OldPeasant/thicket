---
title: M3: Indexes tab
status: in_progress
owner: dell26/agent-1
deps: [index-backend,collection-view]
touches: [packages/renderer/src/app/indexes]
prio: 2
lease_until: 2026-11-17T03:44:54Z
---
## Goal
Indexes tab per collection: list with stats, create dialog with all options, drop with confirm, hide/unhide. Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [x] e2e: create a TTL index and a partial index, see them listed with options
  - verified (2026-11-17 04:09+0100 by dell26/agent-1): npm run test:e2e -- test/e2e/indexes.e2e.ts (built renderer + Electron bundles, mongo8 Testcontainers fixture via Podman) -> 1 passed: TTL index createdAt_1 listed with 'TTL 3600 s', partial index open_status listed with 'unique','partial' and its filter; server listIndexes confirms expireAfterSeconds and partialFilterExpression; hide/unhide and drop-with-confirm exercised too
- [ ] Component tests for the create form validation

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 04:09+0100 by dell26/agent-1): Indexes is its own workspace tab (kind indexes, opened with 'Indexes…' on the collection tab, like Aggregate…), not a sub-tab inside the collection view: matches the aggregation pattern and keeps collection-view changes small. The create dialog is an inline panel at the top of the tab.
- ASSUMPTION (2026-11-17 04:09+0100 by dell26/agent-1): Client-side create validation mirrors server rules (sparse+partial, TTL on one asc/desc non-_id field, unique not on hashed/wildcard, at most one hashed/2d/wildcard field, collation needs locale, weights/language only with text, wildcardProjection only with the field $**); other refusals are left to the server, whose error is shown in the form.
