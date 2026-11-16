---
title: M3: Index management backend
status: todo
owner:
deps: [browse-backend]
touches: [packages/backend/src/indexes]
prio: 2
---
## Goal
idx.list with size and `$indexStats` usage, create (compound, unique, sparse, partial, TTL, collation, hidden, text, 2dsphere, wildcard), drop, hide/unhide, through the guard.

## Acceptance criteria
- [ ] Integration tests for each index option and for hide/unhide
- [ ] Read-only refuses create/drop (int test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
