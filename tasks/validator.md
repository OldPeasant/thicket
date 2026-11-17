---
title: M3 (Should): Collection validator
status: in_progress
owner: dell26/agent-1
deps: [browse-backend,doc-edit-save]
touches: [packages/backend/src/browse/validator,packages/renderer/src/app/validator]
prio: 3
lease_until: 2026-11-17T03:54:58Z
---
## Goal
View/edit `$jsonSchema` validator, validation level and action; mark documents in the editor that fail the validator (backend check with `$jsonSchema` query, not client-side Ajv).

## Acceptance criteria
- [ ] Integration test: set validator, invalid doc flagged by the check method
- [ ] e2e: edit validator; failing document shows a marker

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
