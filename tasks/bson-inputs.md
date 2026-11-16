---
title: M1: Explorer edits BSON values without changing types
status: in_progress
owner: felix/agent-2
deps: [bson-display]
touches: [packages/renderer/src/app/explorer]
prio: 1
lease_until: 2026-11-16T22:16:14Z
---
## Goal
Typed inputs per BSON type (ObjectId with validation/generate, date-time picker, Int32/Int64 with range check, Double, Decimal128, Binary/UUID, Regex with flags, Timestamp), type dropdown with all creatable types using bson-model conversions, number default from settings, field reorder.

## Acceptance criteria
- [ ] Component tests: editing an Int64 keeps Int64; overflow shows an error; invalid ObjectId rejected
- [ ] Type dropdown conversions follow the bson-model table; impossible conversions disabled (test)
- [ ] New numeric value defaults per setting (Int32/Double) (test); fields can be moved (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 22:59+0100 by felix/agent-2): Type dropdown lists all creatable types (String, Int32, Int64, Double, Decimal128, Boolean, Date, ObjectId, UUID, Binary, Regex, Code, Timestamp, Object, Array, Null, MinKey, MaxKey); an option is enabled iff core convert() succeeds. Exception: empty values (null, MinKey, MaxKey, '', {}, []) may become any type's empty value (new ObjectId/UUID, now for Date), so a new field (added as '') can be given a type. Timestamp is reachable only this way since convert() refuses it.
