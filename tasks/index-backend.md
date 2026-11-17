---
title: M3: Index management backend
status: in_progress
owner: dell26/agent-3
deps: [browse-backend]
touches: [packages/backend/src/indexes]
prio: 2
lease_until: 2026-11-17T02:30:46Z
---
## Goal
idx.list with size and `$indexStats` usage, create (compound, unique, sparse, partial, TTL, collation, hidden, text, 2dsphere, wildcard), drop, hide/unhide, through the guard.

## Acceptance criteria
- [ ] Integration tests for each index option and for hide/unhide
- [ ] Read-only refuses create/drop (int test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
