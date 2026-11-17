---
title: M3 (Should): Collection validator
status: in_progress
owner: dell26/agent-1
deps: [browse-backend,doc-edit-save]
touches: [packages/backend/src/browse/validator,packages/renderer/src/app/validator]
prio: 3
lease_until: 2026-11-17T04:10:06Z
---
## Goal
View/edit `$jsonSchema` validator, validation level and action; mark documents in the editor that fail the validator (backend check with `$jsonSchema` query, not client-side Ajv).

## Acceptance criteria
- [ ] Integration test: set validator, invalid doc flagged by the check method
- [ ] e2e: edit validator; failing document shows a marker

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 04:35+0100 by dell26/agent-1): Added contract method coll.validator.check (ids + optional draft validator -> failing _ids) as the 'check method'; the server evaluates it with {_id:{$in}, $nor:[validator]}, not Ajv.
- ASSUMPTION (2026-11-17 04:35+0100 by dell26/agent-1): Failing documents are marked in the Documents (list) view with a tag and red edge; the table view only shows a summary line with a link to the list view (explorer rows have no per-row marker hook).
- ASSUMPTION (2026-11-17 04:35+0100 by dell26/agent-1): Marks reflect documents as stored on the server (checked per page, after save, after validator change), not unsaved edits.
