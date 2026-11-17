---
title: M1: Conflict resolution view
status: in_progress
owner: dell26/agent-2
deps: [doc-edit-save]
touches: [packages/renderer/src/app/document/conflict]
prio: 1
lease_until: 2026-11-17T01:18:40Z
---
## Goal
On CONFLICT show local vs server side by side with differences highlighted; actions overwrite (replace with conflict check on the new server version), keep server version, merge manually.

## Acceptance criteria
- [ ] e2e reproduces demo step 7: external change between load and save → conflict view appears
- [ ] Overwrite writes the local version; keep-server discards local edits; manual merge saves the merged doc (tests)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
