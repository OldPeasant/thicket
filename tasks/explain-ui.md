---
title: M3: Explain plan viewer
status: done
owner: felix/agent-2
deps: [agg-ui]
touches: [packages/renderer/src/app/explain,packages/renderer/src/app/collection/explain-button,packages/renderer/src/app/aggregation/explain-button]
prio: 2
lease_until: 
---
## Goal
Explain button on the query bar and the pipeline builder; tree of stages with keys/docs examined, time, index used; raw explain output in the document viewer.

## Acceptance criteria
- [x] e2e: demo step 9 (COLLSCAN before index, IXSCAN after)
  - verified (2026-11-17 04:24+0100 by felix/agent-2): npm run build -w packages/renderer && npm run build -w apps/desktop && npx playwright test test/e2e/explain.e2e.ts (mongo8 fixture, mongo:8.2 via podman; real UI: query bar filter {status:'open',total:{$gt:100}} + sort, Explain -> verdict 'No index used: COLLSCAN', COLLSCAN stage, 3000 docs examined; idx.create {status:1,total:1}; Explain again -> 'Index used: status_1_total_1', IXSCAN stage, no COLLSCAN; builder Explain -> IXSCAN) -> 1 passed (with aggregation/collection e2e: 3 passed)
  - verified (2026-11-17 04:41+0100 by felix/agent-2): final HEAD 7a06a56 (rebased on ef8927e): npm run build -w packages/renderer && npm run build -w apps/desktop && npx playwright test test/e2e/explain.e2e.ts test/e2e/collection.e2e.ts test/e2e/aggregation.e2e.ts (mongo8 fixture, mongo:8.2 via podman; real query bar Explain -> COLLSCAN verdict, idx.create, Explain again -> IXSCAN status_1_total_1; builder Explain -> IXSCAN) -> 3 passed
- [x] Component test renders a captured 8.x explain fixture correctly
  - verified (2026-11-17 04:24+0100 by felix/agent-2): cd packages/renderer && npx ng test --include 'src/app/explain/**/*.spec.ts' (explain-plan.spec.ts renders fixtures find-ixscan/find-collscan/agg-group captured from mongo:8.2 by explain/fixtures/capture.mjs: verdict, totals, FETCH>IXSCAN tree, index, COLLSCAN flow bar, SBE stages, raw output in explorer) -> all passed
  - verified (2026-11-17 04:41+0100 by felix/agent-2): final HEAD 7a06a56: cd packages/renderer && npx ng test --include 'src/app/explain/**/*.spec.ts' --include 'src/app/collection/**/*.spec.ts' --include 'src/app/aggregation/**/*.spec.ts' (explain-plan.spec.ts renders mongo:8.2 captured fixtures find-ixscan/find-collscan/agg-group: verdict, totals, FETCH>IXSCAN tree, COLLSCAN flow bar, SBE stages, raw output) -> 8 files, 307 tests passed

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 04:07+0100 by felix/agent-2): e2e demo step 9 creates the index through the backend's idx.create over the bridge, not through the Indexes tab UI: that tab is task index-ui (not done yet); the Explain part of step 9 runs through the real UI
- ASSUMPTION (2026-11-17 04:18+0100 by felix/agent-2): Query-bar Explain explains the query as typed (filter, projection, sort, collation, limit), not the paged read Run sends (extra _id tie-break sort, page-size limit): the user asks how their query runs, and the paging details would change the plan shown for a sort
- done by felix/agent-2: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 83s on b739b5e39; criteria verified 2/2
