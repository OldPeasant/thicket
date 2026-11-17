---
title: M3: Index management backend
status: in_progress
owner: dell26/agent-3
deps: [browse-backend]
touches: [packages/backend/src/indexes]
prio: 2
lease_until: 2026-11-17T02:35:48Z
---
## Goal
idx.list with size and `$indexStats` usage, create (compound, unique, sparse, partial, TTL, collation, hidden, text, 2dsphere, wildcard), drop, hide/unhide, through the guard.

## Acceptance criteria
- [x] Integration tests for each index option and for hide/unhide
  - verified (2026-11-17 03:18+0100 by dell26/agent-3): npx vitest run --config test/integration/vitest.config.ts test/integration/indexes.int.spec.ts (mongo8rs fixture, rootless Podman) -> 26 passed: compound, unique, sparse, partial, TTL, collation, hidden, text, 2dsphere, wildcard each created via idx.create and checked on the server; idx.hide hides (explain COLLSCAN) and unhides (IXSCAN)
- [ ] Read-only refuses create/drop (int test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 03:11+0100 by dell26/agent-3): idx.drop refuses name '*' (INVALID_PARAMS): the contract drops one index by name and '*' would drop every index
- ASSUMPTION (2026-11-17 03:11+0100 by dell26/agent-3): idx.stats: a user without the indexStats privilege gets sizes without accesses/since (contract: 'absent where $indexStats is not allowed'); on sharded clusters sizes and accesses are summed and since is the earliest
- ASSUMPTION (2026-11-17 03:11+0100 by dell26/agent-3): idx.create without options.name uses the driver's default name (<field>_<value> joined by _) and returns it
