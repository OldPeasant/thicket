---
title: Core: edit diff → update operations and conflict filter
status: in_progress
owner: felix/agent-2
deps: [bson-model]
touches: [packages/core/src/diff]
prio: 1
lease_until: 2026-11-16T19:14:28Z
---
## Goal
From original and edited documents compute the minimal update (`$set`/`$unset`, `$push` for pure appends, whole-array replace otherwise) and the conflict filter (`_id` + original values of changed top-level fields).

## Acceptance criteria
- [ ] Table-driven tests: nested set, unset, rename (= unset+set), type change, array append → $push, array item change → replace, field reorder only → replace of the parent object
- [ ] Applying the produced update to the original (mongodb-memory-free simulation or int test) yields the edited doc for every case — run against a real server in test/integration (`npm run test:int`)
- [ ] Conflict filter matches the unchanged server document and not one where a changed field was modified (int test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
