---
title: M1: Collection tab: query bar, pager and result views
status: in_progress
owner: felix/agent-1
deps: [sidebar-tree,docs-query-backend,bson-display,paging-core,shell-syntax]
touches: [packages/renderer/src/app/collection]
prio: 1
lease_until: 2026-11-16T23:17:22Z
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
- ASSUMPTION (2026-11-16 23:23+0100 by felix/agent-1): Any collation typed in the query bar counts as non-default for paging (skip mode, per paging-core); a user .limit(n) caps the whole result and makes the last page a skip read.
- ASSUMPTION (2026-11-16 23:23+0100 by felix/agent-1): Query history and favorites are left to the query-history task; the query bar has no history yet. Added the './paging' subpath export to @thicket/core so the renderer can use paging-core without the Node-only root.
