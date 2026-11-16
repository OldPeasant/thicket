---
title: Core: collection paging strategy
status: done
owner: felix/agent-2
deps: [scaffold]
touches: [packages/core/src/paging]
prio: 1
lease_until: 
---
## Goal
Pure functions for paging state: page size, page index, range paging on an indexed unique sort key (default `_id`) with fallback to skip/limit, last page via reversed sort, estimated vs exact count.

## Acceptance criteria
- [x] Unit tests: next/previous/jump/last in range mode and skip mode; switching sort resets to page 1
  - verified (2026-11-16 19:49+0100 by felix/agent-2): cd packages/core && npx vitest run src/paging -> 100 passed; state.spec.ts walks next/previous over all pages in range mode (_id asc/desc, compound with desc keys, non-_id unique index) and skip mode (non-unique sort) against an in-memory server evaluating the generated filters; jump (far jump via skip then range, neighbours, clamp) and last (reversed sort, exact/estimated count) tests; setSort resets to page 1 tests
- [x] Range bounds built correctly for compound sort keys and descending sorts (tests)
  - verified (2026-11-16 19:49+0100 by felix/agent-2): cd packages/core && npx vitest run src/paging -> 100 passed; range.spec.ts asserts exact $or/$gte bounds for compound and descending sorts incl. null bounds; state.spec.ts uses every row as bound on both sides for six compound/descending sorts incl. docs missing the sort field, results checked against the fake server

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 19:31+0100 by felix/agent-2): Range paging applies when the sort keys include all fields of a plain unique index (_id implied); callers pass only non-sparse, non-partial unique indexes. Range bounds use $gt/$lt, so they assume one BSON type per sort key (type bracketing); null bounds handled specially ($ne null / $type minKey).
- ASSUMPTION (2026-11-16 19:31+0100 by felix/agent-2): Jump to a non-adjacent page in range mode reads that page once with skip/limit, then next/previous continue by range. Last page uses the reversed sort with limit = remainder of an exact count, or a full page with an estimated count (page index then approximate). Changing page size or filter also resets to page 1.
- ASSUMPTION (2026-11-16 19:31+0100 by felix/agent-2): Opaque sorts (e.g. $meta textScore) page with skip/limit only; natural order (no sort) in skip mode reaches the last page via skip from the count.
- ASSUMPTION (2026-11-16 19:42+0100 by felix/agent-2): Range paging callers must apply projectionWithSortKeys (sort keys forced into results); a non-default collation always uses skip mode. An empty 'before' page (only after an estimated-count last-page misalignment) leaves an empty page 1; the UI layer should reload firstPage then.
- done by felix/agent-2: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 23s on 1d7232c63; criteria verified 2/2
