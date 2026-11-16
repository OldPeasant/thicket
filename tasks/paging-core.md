---
title: Core: collection paging strategy
status: in_progress
owner: felix/agent-2
deps: [scaffold]
touches: [packages/core/src/paging]
prio: 1
lease_until: 2026-11-16T18:46:57Z
---
## Goal
Pure functions for paging state: page size, page index, range paging on an indexed unique sort key (default `_id`) with fallback to skip/limit, last page via reversed sort, estimated vs exact count.

## Acceptance criteria
- [ ] Unit tests: next/previous/jump/last in range mode and skip mode; switching sort resets to page 1
- [ ] Range bounds built correctly for compound sort keys and descending sorts (tests)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
