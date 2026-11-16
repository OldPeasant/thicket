---
title: M1: Edit session and explicit save
status: in_progress
owner: felix/agent-1
deps: [collection-view,docs-write-backend,bson-inputs,safety-ui]
touches: [packages/renderer/src/app/document]
prio: 1
lease_until: 2026-11-16T23:27:28Z
---
## Goal
Edit session per document: modified marker and change count, undo/redo within unsaved edits, Revert, Save via diff-ops + docs.update through WriteGuard; insert (empty/copy), clone and delete.

## Acceptance criteria
- [ ] Component tests: change count, undo/redo, revert
- [ ] e2e: edit two fields and save; server document matches (verified by a driver query in the test)
- [ ] e2e: production profile shows the confirm dialog with the `$set` operation before saving
- [ ] Read-only profile: edit controls disabled (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
