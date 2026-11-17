---
title: M3: Explain plan viewer
status: in_progress
owner: felix/agent-2
deps: [agg-ui]
touches: [packages/renderer/src/app/explain,packages/renderer/src/app/collection/explain-button,packages/renderer/src/app/aggregation/explain-button]
prio: 2
lease_until: 2026-11-17T03:44:19Z
---
## Goal
Explain button on the query bar and the pipeline builder; tree of stages with keys/docs examined, time, index used; raw explain output in the document viewer.

## Acceptance criteria
- [x] e2e: demo step 9 (COLLSCAN before index, IXSCAN after)
  - verified (2026-11-17 04:24+0100 by felix/agent-2): npm run build -w packages/renderer && npm run build -w apps/desktop && npx playwright test test/e2e/explain.e2e.ts (mongo8 fixture, mongo:8.2 via podman; real UI: query bar filter {status:'open',total:{$gt:100}} + sort, Explain -> verdict 'No index used: COLLSCAN', COLLSCAN stage, 3000 docs examined; idx.create {status:1,total:1}; Explain again -> 'Index used: status_1_total_1', IXSCAN stage, no COLLSCAN; builder Explain -> IXSCAN) -> 1 passed (with aggregation/collection e2e: 3 passed)
- [ ] Component test renders a captured 8.x explain fixture correctly

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 04:07+0100 by felix/agent-2): e2e demo step 9 creates the index through the backend's idx.create over the bridge, not through the Indexes tab UI: that tab is task index-ui (not done yet); the Explain part of step 9 runs through the real UI
- ASSUMPTION (2026-11-17 04:18+0100 by felix/agent-2): Query-bar Explain explains the query as typed (filter, projection, sort, collation, limit), not the paged read Run sends (extra _id tie-break sort, page-size limit): the user asks how their query runs, and the paging details would change the plan shown for a sort
