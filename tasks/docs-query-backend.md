---
title: M1: Query documents with paging, counts, cancel and slices
status: in_progress
owner: felix/agent-2
deps: [conn-manager,paging-core]
touches: [packages/backend/src/docs/query]
prio: 1
lease_until: 2026-11-16T21:46:02Z
---
## Goal
docs.find (filter, projection, sort, collation, limit) streaming pages as EJSON, using paging-core; count/estimatedCount; cancel kills the cursor; docs.get and docs.getSlice (`$slice` projection for a path of a large document).

## Acceptance criteria
- [ ] Integration tests: 10 000-doc fixture paged forward/backward/last in range and skip mode give the same docs as a plain sorted find
- [ ] Cancelling a slow query (`$where` sleep or large sort) ends with CANCELLED and the server op is gone (currentOp check in the test)
- [ ] getSlice returns items n..m of a 50 000-item array without sending the whole document (assert response size)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 22:16+0100 by felix/agent-2): docs.find gets an optional fromEnd flag (last page with the reversed sort): paging-core's lastPage needs it and the contract had no way to express it; the backend reverses rows read backwards (before/fromEnd) so batches always arrive in display order
- ASSUMPTION (2026-11-16 22:16+0100 by felix/agent-2): docs.find always widens the projection with projectionWithSortKeys when the sort has plain directions (the backend can't tell range from skip mode on page 1), so an excluded sort field is shown
- ASSUMPTION (2026-11-16 22:16+0100 by felix/agent-2): Stream support added to the shared serve() (context.openStream, optional on HandlerContext); the CANCELLED error event of a cancelled stream is sent after the producer's cleanup (killOp/killCursors), at most 5 s later, so the server op is gone when the UI sees CANCELLED
- ASSUMPTION (2026-11-16 22:16+0100 by felix/agent-2): Cancel finds the server op by a per-operation comment (thicket:<random>) on every command incl. getMore and kills it with killOp; a user's own comment is not supported by the contract anyway
- ASSUMPTION (2026-11-16 22:16+0100 by felix/agent-2): docs.get sliceAbove only slices top-level arrays (sizes read on the server with $objectToArray); docs.getSlice paths can't contain array indexes (aggregation paths don't index arrays)
