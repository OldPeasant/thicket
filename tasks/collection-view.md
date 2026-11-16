---
title: M1: Collection tab: query bar, pager and result views
status: in_progress
owner: felix/agent-1
deps: [sidebar-tree,docs-query-backend,bson-display,paging-core,shell-syntax]
touches: [packages/renderer/src/app/collection]
prio: 1
lease_until: 2026-11-16T22:42:12Z
---
## Goal
Query bar (filter, projection, sort, collation, limit in shell syntax with validation), pager (sizes 20/50/100/500, first/prev/next/last/jump, estimated count with exact on request), cancel, and three result views: table (one row per document), document list, raw. Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [ ] Component tests with the fake API: invalid filter shows the parse error and does not run
- [ ] e2e against a 10 000-doc fixture: filter + sort, go to page 3, jump to last, exact count
- [ ] Cancel button stops a slow query (e2e or component test with fake stream)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 23:22+0100 by felix/agent-1): With a non-empty filter no count is fetched until 'Count exactly' (docs.estimatedCount only describes the whole collection; counting a filter can be slow). The pager then shows no total and the last page is named 'Last N' until counted.
- ASSUMPTION (2026-11-16 23:22+0100 by felix/agent-1): Collection tabs show the explorer read-only (EditModeService.setReadOnly(true)): editing and saving documents is doc-edit-save's task; the button then reads 'Read-only'.
