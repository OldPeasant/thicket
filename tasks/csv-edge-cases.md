---
title: CSV edge cases: one-column blank rows, dates beyond year 9999, dotted field names; ARCHITECTURE.md io section
status: in_progress
owner: dell26/agent-2
deps: [io-advanced]
touches: [packages/backend/src/io/csv,packages/backend/src/io/export.ts,docs/ARCHITECTURE.md]
prio: 2
lease_until: 2026-11-17T06:41:58Z
---
## Goal
Fix the P3 findings deferred from io-advanced (reviews/io-advanced/review.md CR-1..CR-4).

## Acceptance criteria
- [ ] A one-column CSV export of a document with an empty value round-trips (no silently dropped row), unit tested
- [ ] Dates outside years 0000-9999 export in a form the `date` CSV type imports back, unit tested
- [ ] A field name containing a dot is exported with its value (or the behavior is defined and documented), unit tested
- [ ] docs/ARCHITECTURE.md io section describes the CSV/BSON scanners instead of `UNSUPPORTED`

## Notes
See SPEC.md, docs/ARCHITECTURE.md and reviews/io-advanced/review.md.
- ASSUMPTION (2026-11-17 07:23+0100 by dell26/agent-2): CSV export of field names containing a dot: a top-level dotted key is its own column (valueAt reads the literal key first); a top-level document colliding with such a key in the same document, or a nested document holding a dotted key, is written whole as one Extended JSON column instead of being flattened. No value is lost; a document flattened elsewhere may then also appear whole in that column (duplicate, not loss). CSV import still treats dots as nesting.
- ASSUMPTION (2026-11-17 07:23+0100 by dell26/agent-2): The CSV date type accepts the ISO 8601 extended year form ±YYYYYY (what toISOString writes outside years 0-9999), refusing -000000 and results outside the JS Date range; chosen over exporting such dates as epoch millis so the export text stays readable.
