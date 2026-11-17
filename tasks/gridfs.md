---
title: M6 (Could): GridFS
status: in_progress
owner: dell26/agent-3
deps: [browse-backend,app-layout]
touches: [packages/backend/src/gridfs,packages/renderer/src/app/gridfs]
prio: 4
lease_until: 2026-11-17T06:53:29Z
---
## Goal
List buckets and files, download, upload with progress, delete with confirm.

## Acceptance criteria
- [ ] Integration test: upload 20 MB file, download identical (hash)
- [ ] e2e: upload and delete from the UI

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
