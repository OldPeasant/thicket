---
title: M1: Explorer edits BSON values without changing types
status: todo
owner:
deps: [bson-display]
touches: [packages/renderer/src/app/explorer]
prio: 1
---
## Goal
Typed inputs per BSON type (ObjectId with validation/generate, date-time picker, Int32/Int64 with range check, Double, Decimal128, Binary/UUID, Regex with flags, Timestamp), type dropdown with all creatable types using bson-model conversions, number default from settings, field reorder.

## Acceptance criteria
- [ ] Component tests: editing an Int64 keeps Int64; overflow shows an error; invalid ObjectId rejected
- [ ] Type dropdown conversions follow the bson-model table; impossible conversions disabled (test)
- [ ] New numeric value defaults per setting (Int32/Double) (test); fields can be moved (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
