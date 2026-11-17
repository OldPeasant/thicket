---
title: M1: Import/export dialogs
status: in_progress
owner: dell26/agent-1
deps: [io-basic-backend,collection-view,safety-ui]
touches: [packages/renderer/src/app/io]
prio: 2
lease_until: 2026-11-17T01:23:29Z
---
## Goal
Export current query results (JSON/JSONL, relaxed/canonical) and import a JSON/JSONL file with preview, options and progress.

## Acceptance criteria
- [ ] e2e: export the fixture, import into a new collection, counts match
- [ ] Import into a read-only profile is not offered (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 02:03+0100 by dell26/agent-1): Import/export live as panels under the pager of the collection tab (Export…/Import… buttons), not modal windows; export always uses the query applied in the tab (filter, projection, sort, collation, limit), all pages.
