---
title: Core: BSON value model with lossless EJSON round trip
status: in_progress
owner: dell26/agent-3
deps: [scaffold]
touches: [packages/core/src/bson]
prio: 1
lease_until: 2026-11-16T18:43:38Z
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
