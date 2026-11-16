---
title: M1: Import/export dialogs
status: todo
owner:
deps: [io-basic-backend,collection-view,safety-ui]
touches: [packages/renderer/src/app/io]
prio: 2
---
## Goal
Export current query results (JSON/JSONL, relaxed/canonical) and import a JSON/JSONL file with preview, options and progress.

## Acceptance criteria
- [ ] e2e: export the fixture, import into a new collection, counts match
- [ ] Import into a read-only profile is not offered (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
