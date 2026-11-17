---
title: M3: CSV import/export and BSON dump
status: in_progress
owner: dell26/agent-2
deps: [io-basic-ui]
touches: [packages/backend/src/io/csv,packages/backend/src/io/bson,packages/renderer/src/app/io]
prio: 3
lease_until: 2026-11-17T06:11:44Z
---
## Goal
CSV export with field selection/flattening; CSV import with field mapping and a BSON type per column; export and import a collection as mongodump-compatible `.bson` (+ metadata JSON).

## Acceptance criteria
- [ ] Integration tests: CSV round trip with types; `.bson` written by Thicket restores with `mongorestore` in the fixture container and vice versa
- [ ] e2e: CSV import with type mapping

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 06:43+0100 by dell26/agent-2): CSV types are MongoDB $type aliases (auto,string,int,long,double,decimal,bool,date,objectId,json); auto: integers->Int32/Int64, other numbers->Double, true/false->Boolean, else String. A blank cell leaves the field out, except type string (empty string). bool also accepts yes/no/1/0; date accepts ISO 8601 or epoch millis. Contract bsonType narrowed from string to this enum.
- ASSUMPTION (2026-11-17 06:43+0100 by dell26/agent-2): CSV export: without csvFields the columns are the flattened paths (nested docs -> a.b) of the first 1000 documents; the UI offers the paths of the page shown as checkable columns plus 'Add field'. Arrays, nested docs and non-CSV types are written as EJSON text (the ejsonMode choice). No spreadsheet formula escaping (it would break round trips of negative numbers).
- ASSUMPTION (2026-11-17 06:44+0100 by dell26/agent-2): BSON dump: export writes <name>.metadata.json next to the chosen .bson (options+indexes+uuid like mongodump; empty options/indexes for aggregation sources, views and time series). Import applies a metadata file found next to the .bson automatically: creates a new collection with its options, creates its indexes after the documents. Errors name the document number instead of a line. mongodump/mongorestore compatibility is tested with the tools of the mongo:8.2 fixture image on the host network, not inside the shared fixture container.
