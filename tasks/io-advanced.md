---
title: M3: CSV import/export and BSON dump
status: in_progress
owner: dell26/agent-2
deps: [io-basic-ui]
touches: [packages/backend/src/io/csv,packages/backend/src/io/bson,packages/renderer/src/app/io]
prio: 3
lease_until: 2026-11-17T06:01:38Z
---
## Goal
CSV export with field selection/flattening; CSV import with field mapping and a BSON type per column; export and import a collection as mongodump-compatible `.bson` (+ metadata JSON).

## Acceptance criteria
- [ ] Integration tests: CSV round trip with types; `.bson` written by Thicket restores with `mongorestore` in the fixture container and vice versa
- [ ] e2e: CSV import with type mapping

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
