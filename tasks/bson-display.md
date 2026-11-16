---
title: M1: Explorer shows BSON types
status: in_progress
owner: felix/agent-2
deps: [explorer-copy,bson-model,themes]
touches: [packages/renderer/src/app/explorer]
prio: 1
lease_until: 2026-11-16T20:25:14Z
---
## Goal
Adapt the explorer to the BSON model: type badges and colors per type, Date in local time with timezone and UTC toggle, Int64/Decimal128 exact display, Binary/UUID display, deprecated types read-only.

## Acceptance criteria
- [ ] Component tests render the all-types fixture from bson-model with correct badge per value
- [ ] Numbers never lose precision on display (Int64 9007199254740993, Decimal128 with 34 digits) (test)
- [ ] Search still works across BSON values (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
