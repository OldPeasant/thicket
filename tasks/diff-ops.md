---
title: Core: edit diff → update operations and conflict filter
status: in_progress
owner: felix/agent-2
deps: [bson-model]
touches: [packages/core/src/diff]
prio: 1
lease_until: 2026-11-16T19:34:44Z
---
## Goal
From original and edited documents compute the minimal update (`$set`/`$unset`, `$push` for pure appends, whole-array replace otherwise) and the conflict filter (`_id` + original values of changed top-level fields).

## Acceptance criteria
- [x] Table-driven tests: nested set, unset, rename (= unset+set), type change, array append → $push, array item change → replace, field reorder only → replace of the parent object
  - verified (2026-11-16 20:13+0100 by felix/agent-2): npx vitest run --root packages/core src/diff -> 112 passed; table DIFF_CASES (packages/core/src/diff/fixtures.ts) covers nested set, unset, rename (unset+set), type changes, array append -> push with each, array item change -> set of whole array, field reorder only -> set of parent object
- [x] Applying the produced update to the original (mongodb-memory-free simulation or int test) yields the edited doc for every case — run against a real server in test/integration (`npm run test:int`)
  - verified (2026-11-16 20:13+0100 by felix/agent-2): npm run test:int -- diff-ops (Podman, testcontainers mongo:8.2 and mongo:7.0 standalone) -> 308 passed; each case inserts the original, runs updateOne/replaceOne with the produced update and filter (matched 1, modified 1) and compares the stored doc (promoteValues false, canonical EJSON) with the edited doc
- [x] Conflict filter matches the unchanged server document and not one where a changed field was modified (int test)
  - verified (2026-11-16 20:13+0100 by felix/agent-2): npm run test:int -- diff-ops (mongo 8.2 and 7.0) -> 308 passed; per case the filter matches the unchanged doc and a doc with an unrelated field changed (count 1), and matches 0 when any changed top-level field is modified or removed on the server; a stale updateOne matches nothing

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 19:57+0100 by felix/agent-2): Fields new to the original (incl. the new name of a rename) end up at the end of their parent after the update (MongoDB $set semantics), so 'applied == edited' is checked with those fields last; only a reorder of fields both sides share forces replacing the parent.
- ASSUMPTION (2026-11-16 19:57+0100 by felix/agent-2): A top-level reorder, or a changed top-level key that is not a valid path (dot, $ prefix, empty, repeated keys), cannot be expressed with update operators: diffDocuments returns kind 'replace' (for docs.replace with the same expected filter) instead of an update.
- ASSUMPTION (2026-11-16 19:57+0100 by felix/agent-2): Conflict filter uses {field: {$eq: original}} per changed top-level field, {$exists: false} for fields absent in the original, and $expr/$getField for non-path keys. Known limit of $eq query semantics: a scalar/array original also matches a server array containing it, and numbers match across int/long/double.
- ASSUMPTION (2026-11-16 19:57+0100 by felix/agent-2): diffDocuments throws BsonModelError when _id is missing or changed (MongoDB rejects _id changes); the editor must create a new document for that.
- ASSUMPTION (2026-11-16 20:08+0100 by felix/agent-2): Null and BSON-undefined originals are checked with $type ($eq null would also match a field removed on the server). A replace whose edited document has a top-level $-prefixed key cannot be written (server rejects replaceOne), so diffDocuments throws BsonModelError for it.
