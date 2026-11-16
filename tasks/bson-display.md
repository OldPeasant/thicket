---
title: M1: Explorer shows BSON types
status: in_progress
owner: felix/agent-2
deps: [explorer-copy,bson-model,themes]
touches: [packages/renderer/src/app/explorer]
prio: 1
lease_until: 2026-11-16T20:40:22Z
---
## Goal
Adapt the explorer to the BSON model: type badges and colors per type, Date in local time with timezone and UTC toggle, Int64/Decimal128 exact display, Binary/UUID display, deprecated types read-only.

## Acceptance criteria
- [x] Component tests render the all-types fixture from bson-model with correct badge per value
  - verified (2026-11-16 21:23+0100 by felix/agent-2): cd packages/renderer && npx ng test --include='src/app/explorer/bson-*.spec.ts' -> 58 passed; bson-display.spec.ts 'shows the correct badge for every value of the all-types fixture' renders @thicket/core/testing ALL_TYPES_EJSON (49 fields, all 21 types) in JsonExplorerComponent and asserts each field's badge (ObjectId, Double, Binary 0xNN, UUID, Int64, Decimal128, Code w/ scope, deprecated ...); plus tables layout and color-token tests
- [x] Numbers never lose precision on display (Int64 9007199254740993, Decimal128 with 34 digits) (test)
  - verified (2026-11-16 21:23+0100 by felix/agent-2): same run -> 'never loses precision on Int64 and Decimal128' shows 9007199254740993, 1234567890123456789012345678901234 and 0.1234567890123456789012345678901234 exactly; 'fixture extremes' shows int64 min/max and 9.999999999999999999999999999999999E+6144 exactly
- [x] Search still works across BSON values (test)
  - verified (2026-11-16 21:23+0100 by felix/agent-2): same run -> 'finds BSON values by their exact text' (Int64, Decimal128, ObjectId, UUID, Date local then after UTC toggle), 'finds BSON values in context mode and is case-insensitive', 'finds values nested in documents and arrays' pass; full npx ng test 571 passed

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 21:09+0100 by felix/agent-2): Explorer keeps walking plain JS trees: toExplorerValue() maps documents/arrays to plain objects/arrays, String/Boolean/Null to JS values and every other BSON value to a frozen BsonLeaf (typeOf 'bson'). Consequence: JS objects list integer-like keys first and keep the last of repeated keys; an order-preserving container is left to bson-inputs/doc views.
- ASSUMPTION (2026-11-16 21:09+0100 by felix/agent-2): BSON leaves are shown read-only in edit mode for now (typed editors are bson-inputs); deprecated types (Undefined, Symbol, DBPointer, Code w/ scope) carry a dashed badge and a lock in edit mode.
- ASSUMPTION (2026-11-16 21:09+0100 by felix/agent-2): Display formats: Date local = ISO with offset and IANA zone ('2023-11-14T23:13:20.000+01:00 Europe/Zurich'), UTC = toISOString; dates beyond JS range show '<ms> ms since 1970 (out of date range)'; Binary badge 'Binary 0xNN' with base64 text, subtype 4 badge 'UUID' with the UUID text; Timestamp 'Timestamp(t, i)'; search matches the shown text. UTC toggle is a toolbar button (BsonDisplayService, not persisted).
- ASSUMPTION (2026-11-16 21:09+0100 by felix/agent-2): Moved the all-types fixture from core ejson.spec.ts to packages/core/src/bson/fixtures.ts, exported as @thicket/core/testing, so renderer tests use the same fixture. Renderer now depends on @thicket/core; fixed core paging/projection.ts '_id' index access for the renderer's noPropertyAccessFromIndexSignature.
- ASSUMPTION (2026-11-16 21:09+0100 by felix/agent-2): JSON-Schema features (ajv validation, schema types) are not adapted to BsonLeaf values; schema-driven views of BSON documents are out of scope here.
- ASSUMPTION (2026-11-16 21:19+0100 by felix/agent-2): CR-1 deferred to bson-inputs: explorer trees from toExplorerValue are plain JS objects (integer-like keys first, repeated keys collapse); saving edits through fromExplorerValue would reorder such fields, so bson-inputs (which owns field reorder) must give the explorer an order-preserving container before edits are saved.
