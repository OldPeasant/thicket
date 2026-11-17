---
title: M3: Aggregation run, stage preview, explain, views
status: in_progress
owner: dell26/agent-1
deps: [docs-query-backend]
touches: [packages/backend/src/agg]
prio: 2
lease_until: 2026-11-17T01:53:49Z
---
## Goal
agg.run (streamed, paged), previewStage (pipeline up to stage n on a sample), explain for find and aggregate, createView; `$out`/`$merge` treated as writes through the guard.

## Acceptance criteria
- [ ] Integration tests: preview of stage 2 of 3 matches running the first 2 stages; explain returns winning plan
- [ ] `$out` on read-only refused; on production requires confirmed (int test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 02:23+0100 by dell26/agent-1): previewStage samples the first sampleSize input docs in natural order ($limit, inserted after a must-be-first stage like $geoNear), not $sample: deterministic, so a preview matches running the stages; same as docs.previewMany
- ASSUMPTION (2026-11-17 02:23+0100 by dell26/agent-1): agg.explain defaults to verbosity executionStats (SPEC wants docs/keys examined and time); a pipeline with $out/$merge is explained only with queryPlanner (INVALID_PARAMS otherwise) because other modes execute it and agg.explain is not a guarded write
- ASSUMPTION (2026-11-17 02:23+0100 by dell26/agent-1): agg.previewStage refuses $out/$merge with INVALID_PARAMS (contract summary says refused); pipeline stages must be plain documents with exactly one key
