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
- ASSUMPTION (2026-11-16 22:59+0100 by felix/agent-2): New-number default: 'new numeric values' are numbers typed into a plain-number input (schema seeds/defaults); they become Int32 (or Int64/Double per the existing defaultIntegerType setting) when integers fit 32 bits, else Double (Int64 for safe integers when the setting is int64). NumberDefaultService reads app.settings.get and follows app.settings.changed. Values with a BSON type keep that type when edited.
- ASSUMPTION (2026-11-16 22:59+0100 by felix/agent-2): Field order (bson-display CR-1): explorer objects carry their real key order in a hidden non-enumerable symbol when it differs from Object.keys (integer-like keys); withEntry/withoutEntry/moveEntry keep it, fromExplorerValue and the form use it. Repeated keys still collapse to one (last value, first position). Fields move with up/down buttons in the form layout's edit mode; the tables layout keeps Canopy's column order.
- ASSUMPTION (2026-11-16 22:59+0100 by felix/agent-2): Typed inputs commit on blur/Enter, Escape reverts; invalid text stays with an inline error and is not applied. Dates: ISO text (trailing zone name ignored, no offset = wall time in the shown zone) plus a datetime-local picker in the shown zone. Regex options limited to MongoDB's ilmsux, stored sorted; pattern not validated (PCRE differs from JS). frontend-design not invoked: small inputs inside the existing explorer styles and tokens.
