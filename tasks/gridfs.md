---
title: M6 (Could): GridFS
status: in_progress
owner: dell26/agent-3
deps: [browse-backend,app-layout]
touches: [packages/backend/src/gridfs,packages/renderer/src/app/gridfs]
prio: 4
lease_until: 2026-11-17T07:13:39Z
---
## Goal
List buckets and files, download, upload with progress, delete with confirm.

## Acceptance criteria
- [ ] Integration test: upload 20 MB file, download identical (hash)
- [ ] e2e: upload and delete from the UI

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 07:35+0100 by dell26/agent-3): GridFS tab opens from the sidebar database menu ('GridFS files'), one tab per database with a bucket select; a database without buckets offers 'fs' (the driver default) for the first upload. No UI to name a new bucket.
- ASSUMPTION (2026-11-17 07:35+0100 by dell26/agent-3): Driver 7 has no contentType upload option, so uploads store none; listing shows top-level contentType or metadata.contentType. gridfs.files lists at most 1000 files (newest first, name filter) with a total instead of paging UI.
- ASSUMPTION (2026-11-17 07:35+0100 by dell26/agent-3): Upload is a write (write guard, confirm only on production profiles); delete always asks for confirmation. A cancelled/failed upload deletes its chunks and files doc; a cancelled download removes the partial local file.
