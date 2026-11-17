---
title: M3: Explain plan viewer
status: in_progress
owner: felix/agent-2
deps: [agg-ui]
touches: [packages/renderer/src/app/explain,packages/renderer/src/app/collection/explain-button,packages/renderer/src/app/aggregation/explain-button]
prio: 2
lease_until: 2026-11-17T03:24:07Z
---
## Goal
Explain button on the query bar and the pipeline builder; tree of stages with keys/docs examined, time, index used; raw explain output in the document viewer.

## Acceptance criteria
- [ ] e2e: demo step 9 (COLLSCAN before index, IXSCAN after)
- [ ] Component test renders a captured 8.x explain fixture correctly

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 04:07+0100 by felix/agent-2): e2e demo step 9 creates the index through the backend's idx.create over the bridge, not through the Indexes tab UI: that tab is task index-ui (not done yet); the Explain part of step 9 runs through the real UI
