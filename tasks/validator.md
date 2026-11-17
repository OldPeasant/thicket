---
title: M3 (Should): Collection validator
status: done
owner: dell26/agent-1
deps: [browse-backend,doc-edit-save]
touches: [packages/backend/src/browse/validator,packages/renderer/src/app/validator]
prio: 3
lease_until: 
---
## Goal
View/edit `$jsonSchema` validator, validation level and action; mark documents in the editor that fail the validator (backend check with `$jsonSchema` query, not client-side Ajv).

## Acceptance criteria
- [x] Integration test: set validator, invalid doc flagged by the check method
  - verified (2026-11-17 04:53+0100 by dell26/agent-1): npx vitest run --config test/integration/vitest.config.ts test/integration/validator.int.spec.ts (8.x replica set + 7.0 standalone containers) -> 14 passed; 'set validator, then the invalid documents are flagged by the check method' sets a $jsonSchema via coll.validator.set and coll.validator.check returns exactly the 3 failing _ids
- [x] e2e: edit validator; failing document shows a marker
  - verified (2026-11-17 04:53+0100 by dell26/agent-1): npm run test:e2e -- test/e2e/validator.e2e.ts (renderer + desktop build, Playwright Electron, real mongo container) -> 1 passed: edits the validator in the Validator tab and saves it (server listCollections confirms); the collection tab shows the doc-invalid marker on the 2 failing documents, cleared after one is fixed

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 04:35+0100 by dell26/agent-1): Added contract method coll.validator.check (ids + optional draft validator -> failing _ids) as the 'check method'; the server evaluates it with {_id:{$in}, $nor:[validator]}, not Ajv.
- ASSUMPTION (2026-11-17 04:35+0100 by dell26/agent-1): Failing documents are marked in the Documents (list) view with a tag and red edge; the table view only shows a summary line with a link to the list view (explorer rows have no per-row marker hook).
- ASSUMPTION (2026-11-17 04:35+0100 by dell26/agent-1): Marks reflect documents as stored on the server (checked per page, after save, after validator change), not unsaved edits.
- done by dell26/agent-1: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 59s on 6954b73cf; criteria verified 2/2
