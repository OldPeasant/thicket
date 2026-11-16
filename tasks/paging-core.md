---
title: Core: collection paging strategy
status: in_progress
owner: felix/agent-2
deps: [scaffold]
touches: [packages/core/src/paging]
prio: 1
lease_until: 2026-11-16T18:49:08Z
---
## Goal
Pure functions for paging state: page size, page index, range paging on an indexed unique sort key (default `_id`) with fallback to skip/limit, last page via reversed sort, estimated vs exact count.

## Acceptance criteria
- [ ] Unit tests: next/previous/jump/last in range mode and skip mode; switching sort resets to page 1
- [ ] Range bounds built correctly for compound sort keys and descending sorts (tests)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 19:31+0100 by felix/agent-2): Range paging applies when the sort keys include all fields of a plain unique index (_id implied); callers pass only non-sparse, non-partial unique indexes. Range bounds use $gt/$lt, so they assume one BSON type per sort key (type bracketing); null bounds handled specially ($ne null / $type minKey).
