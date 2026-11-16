---
title: M1: Query documents with paging, counts, cancel and slices
status: in_progress
owner: felix/agent-2
deps: [conn-manager,paging-core]
touches: [packages/backend/src/docs/query]
prio: 1
lease_until: 2026-11-16T21:30:53Z
---
## Goal
docs.find (filter, projection, sort, collation, limit) streaming pages as EJSON, using paging-core; count/estimatedCount; cancel kills the cursor; docs.get and docs.getSlice (`$slice` projection for a path of a large document).

## Acceptance criteria
- [ ] Integration tests: 10 000-doc fixture paged forward/backward/last in range and skip mode give the same docs as a plain sorted find
- [ ] Cancelling a slow query (`$where` sleep or large sort) ends with CANCELLED and the server op is gone (currentOp check in the test)
- [ ] getSlice returns items n..m of a 50 000-item array without sending the whole document (assert response size)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
