---
title: Core: BSON value model with lossless EJSON round trip
status: in_progress
owner: dell26/agent-3
deps: [scaffold]
touches: [packages/core/src/bson]
prio: 1
lease_until: 2026-11-16T18:48:05Z
---
## Goal
Typed, order-preserving value tree for all BSON types (SPEC M1 'Documents and BSON'), parsed from and serialized to canonical EJSON v2 with the `bson` package; explicit conversions between types with validation; no Node APIs (runs in the renderer).

## Acceptance criteria
- [ ] Round trip test: a fixture document with every BSON type (incl. deprecated ones, Binary subtypes, UUID, negative zero, NaN/Infinity doubles, Int64 beyond 2^53) → model → EJSON is byte-identical
- [ ] Field order preserved, including duplicate-looking keys like `$`-prefixed names (test)
- [ ] Conversion table tested: String→ObjectId (valid/invalid), Int32→Int64, Int64→Int32 overflow error, Double→Decimal128, String↔Date ISO, Binary(4)↔UUID
- [ ] Path API (get/set/insert/remove/move field) with tests; 100% branch coverage on conversions

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 19:30+0100 by dell26/agent-3): EJSON parsing uses an own order-preserving JSON tokenizer (JSON.parse/bson EJSON reorder integer-like keys, drop repeated keys, turn Undefined into null and DBPointer into DBRef); bson is used for Decimal128 normalization and the canonical Double format.
- ASSUMPTION (2026-11-16 19:31+0100 by dell26/agent-3): Model: Int64 and Date ms are bigint (dates beyond JS Date range survive); Decimal128 stored as bson's canonical string; Binary as subtype+base64; UUID is Binary subtype 4 with 'uuid' as a pseudo conversion target, not a separate type.
- ASSUMPTION (2026-11-16 19:31+0100 by dell26/agent-3): Legacy {$regex,$options} is NOT decoded as a regex (it is also the query operator); legacy {$binary,$type} and {$date:<number>} are accepted. Wrapper keys with invalid values are errors, per the EJSON spec.
