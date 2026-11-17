---
title: CSV edge cases: one-column blank rows, dates beyond year 9999, dotted field names; ARCHITECTURE.md io section
status: todo
owner:
deps: [io-advanced]
touches: [packages/backend/src/io/csv,packages/backend/src/io/export.ts,docs/ARCHITECTURE.md]
prio: 2
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
