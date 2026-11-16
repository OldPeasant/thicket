---
title: Core: shell syntax ⇄ EJSON (safe parser and printer)
status: in_progress
owner: dell26/agent-3
deps: [bson-model]
touches: [packages/core/src/shellsyntax]
prio: 1
lease_until: 2026-11-16T19:09:01Z
---
## Goal
Parse mongosh-style literals (`ObjectId("…")`, `ISODate`, `NumberLong`, `NumberDecimal`, `UUID`, `BinData`, `Timestamp`, regex literals, unquoted keys) into the BSON model without eval, and print the model back in that syntax with stable formatting.

## Acceptance criteria
- [ ] Parser rejects code (`function`, calls other than the known constructors, `this`) with a position (tests)
- [ ] print(parse(x)) round-trips for a corpus of 30+ queries/documents (test)
- [ ] Errors carry line/column for the raw editor and query bar

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
