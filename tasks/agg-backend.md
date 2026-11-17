---
title: M3: Aggregation run, stage preview, explain, views
status: done
owner: dell26/agent-1
deps: [docs-query-backend]
touches: [packages/backend/src/agg]
prio: 2
lease_until: 
---
## Goal
agg.run (streamed, paged), previewStage (pipeline up to stage n on a sample), explain for find and aggregate, createView; `$out`/`$merge` treated as writes through the guard.

## Acceptance criteria
- [x] Integration tests: preview of stage 2 of 3 matches running the first 2 stages; explain returns winning plan
  - verified (2026-11-17 02:37+0100 by dell26/agent-1): npx vitest run --config test/integration/vitest.config.ts agg.int (mongo 8 replica set container via Podman) -> 15 passed; 'preview of stage 2 of 3 matches running the first 2 stages' compares agg.previewStage output with a direct driver aggregate of STAGES[0..1]; explain tests assert queryPlanner.winningPlan (find: IXSCAN) and aggregate winningPlan
- [x] `$out` on read-only refused; on production requires confirmed (int test)
  - verified (2026-11-17 02:37+0100 by dell26/agent-1): same run, guard via guardWrites(aggHandlers): $out on read-only profile -> READ_ONLY with and without confirmed, no collection created; $out and $merge on production -> CONFIRMATION_REQUIRED without confirmed, written with confirmed:true -> tests pass

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 02:23+0100 by dell26/agent-1): previewStage samples the first sampleSize input docs in natural order ($limit, inserted after a must-be-first stage like $geoNear), not $sample: deterministic, so a preview matches running the stages; same as docs.previewMany
- ASSUMPTION (2026-11-17 02:23+0100 by dell26/agent-1): agg.explain defaults to verbosity executionStats (SPEC wants docs/keys examined and time); a pipeline with $out/$merge is explained only with queryPlanner (INVALID_PARAMS otherwise) because other modes execute it and agg.explain is not a guarded write
- ASSUMPTION (2026-11-17 02:23+0100 by dell26/agent-1): agg.previewStage refuses $out/$merge with INVALID_PARAMS (contract summary says refused); pipeline stages must be plain documents with exactly one key
- done by dell26/agent-1: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 33s on fce0ed0ad; criteria verified 2/2
