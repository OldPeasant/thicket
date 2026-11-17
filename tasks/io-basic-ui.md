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
- [x] e2e: export the fixture, import into a new collection, counts match
  - verified (2026-11-17 02:05+0100 by dell26/agent-1): npm run test:e2e -- test/e2e/io.e2e.ts (mongo8 fixture via Podman, headless Electron, native dialogs stubbed in main) -> 1 passed: 1,234 fixture docs exported as canonical JSON, imported through the panel into new collection orders_copy: count 1234 = 1234 and documents deep-equal; JSONL relaxed export of {group:1} imported into group1, counts match
- [ ] Import into a read-only profile is not offered (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 02:03+0100 by dell26/agent-1): Import/export live as panels under the pager of the collection tab (Export…/Import… buttons), not modal windows; export always uses the query applied in the tab (filter, projection, sort, collation, limit), all pages.
- ASSUMPTION (2026-11-17 02:03+0100 by dell26/agent-1): Import targets a collection in the tab's database (default: the tab's collection, any new name creates it); defaults ordered=true, stopOnError=true; the preview shows 5 of 20 sampled documents.
- ASSUMPTION (2026-11-17 02:03+0100 by dell26/agent-1): Read-only profiles: the Import button is not rendered (not just disabled) and an open import panel closes when the profile turns read-only; export stays available (it is a read).
