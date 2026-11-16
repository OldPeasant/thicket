---
title: M1: Query documents with paging, counts, cancel and slices
status: done
owner: felix/agent-2
deps: [conn-manager,paging-core]
touches: [packages/backend/src/docs/query]
prio: 1
lease_until: 
---
## Goal
docs.find (filter, projection, sort, collation, limit) streaming pages as EJSON, using paging-core; count/estimatedCount; cancel kills the cursor; docs.get and docs.getSlice (`$slice` projection for a path of a large document).

## Acceptance criteria
- [x] Integration tests: 10 000-doc fixture paged forward/backward/last in range and skip mode give the same docs as a plain sorted find
  - verified (2026-11-16 22:48+0100 by felix/agent-2): npm run test:int -- test/integration/docs-query.int.spec.ts (MongoDB container via int-harness) at fd4b4de -> 35/35 passed; 'docs.find paging in range mode / skip mode (10 000 docs)': forward over every page, backward from the last page (3 sorts incl. compound with missing keys), and jump-to-middle next/previous all equal a plain sorted find
- [x] Cancelling a slow query (`$where` sleep or large sort) ends with CANCELLED and the server op is gone (currentOp check in the test)
  - verified (2026-11-16 22:48+0100 by felix/agent-2): npm run test:int -- test/integration/docs-query.int.spec.ts (MongoDB container via int-harness) at fd4b4de -> 35/35 passed; 'cancel' suite: slow $where find stream ends CANCELLED and currentOp shows no op with the thicket comment; also immediate cancel after the docs.find response, cancel between batches (cursor killed), slow count cancel
- [x] getSlice returns items n..m of a 50 000-item array without sending the whole document (assert response size)
  - verified (2026-11-16 22:48+0100 by felix/agent-2): npm run test:int -- test/integration/docs-query.int.spec.ts (MongoDB container via int-harness) at fd4b4de -> 35/35 passed; 'getSlice returns items n..m and the total without sending the whole document': items 30000..30049 of a 50 000-item array, total 50000, response < 10 000 bytes and < 1/100 of the full document size

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 22:16+0100 by felix/agent-2): docs.find gets an optional fromEnd flag (last page with the reversed sort): paging-core's lastPage needs it and the contract had no way to express it; the backend reverses rows read backwards (before/fromEnd) so batches always arrive in display order
- ASSUMPTION (2026-11-16 22:16+0100 by felix/agent-2): docs.find always widens the projection with projectionWithSortKeys when the sort has plain directions (the backend can't tell range from skip mode on page 1), so an excluded sort field is shown
- ASSUMPTION (2026-11-16 22:16+0100 by felix/agent-2): Stream support added to the shared serve() (context.openStream, optional on HandlerContext); the CANCELLED error event of a cancelled stream is sent after the producer's cleanup (killOp/killCursors), at most 5 s later, so the server op is gone when the UI sees CANCELLED
- ASSUMPTION (2026-11-16 22:16+0100 by felix/agent-2): Cancel finds the server op by a per-operation comment (thicket:<random>) on every command incl. getMore and kills it with killOp; a user's own comment is not supported by the contract anyway
- ASSUMPTION (2026-11-16 22:16+0100 by felix/agent-2): docs.get sliceAbove only slices top-level arrays (sizes read on the server with $objectToArray); docs.getSlice paths can't contain array indexes (aggregation paths don't index arrays)
- ASSUMPTION (2026-11-16 22:42+0100 by felix/agent-2): docs.find refuses before/fromEnd without limit > 0 (INVALID_PARAMS): rows read backwards are buffered until the page is complete; a previous/last page without a page size has no meaning (review CR-5)
- ASSUMPTION (2026-11-16 22:42+0100 by felix/agent-2): A docs.find stream whose connection conn.close closed ends CANCELLED (detected when the stream fails and the manager no longer holds that client), rather than registering streams with the ConnectionManager (review CR-3)
- ASSUMPTION (2026-11-16 22:49+0100 by felix/agent-2): docs.getSlice refuses all-digit path components (INVALID_PARAMS) even after a document parent (e.g. byYear.2024); kept conservative, review round 2 CR-1 accepted
- done by felix/agent-2: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 55s on 7e0b3ebe4; criteria verified 3/3
