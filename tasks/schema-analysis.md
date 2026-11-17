---
title: M3: Schema analysis
status: in_progress
owner: felix/agent-2
deps: [docs-query-backend,collection-view]
touches: [packages/backend/src/schema,packages/renderer/src/app/schema-analysis]
prio: 2
lease_until: 2026-11-17T04:56:05Z
---
## Goal
Sample-based (default 1 000) analysis with mongodb-schema: fields, types and shares, missing ratio, examples; shown in the table view; click a value to use it as a filter.

## Acceptance criteria
- [ ] Integration test on a fixture with mixed types per field gives the expected shares
- [ ] e2e: open analysis, click a value → query bar filter set

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
