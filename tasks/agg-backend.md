---
title: M3: Aggregation run, stage preview, explain, views
status: todo
owner:
deps: [docs-query-backend]
touches: [packages/backend/src/agg]
prio: 2
---
## Goal
agg.run (streamed, paged), previewStage (pipeline up to stage n on a sample), explain for find and aggregate, createView; `$out`/`$merge` treated as writes through the guard.

## Acceptance criteria
- [ ] Integration tests: preview of stage 2 of 3 matches running the first 2 stages; explain returns winning plan
- [ ] `$out` on read-only refused; on production requires confirmed (int test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
