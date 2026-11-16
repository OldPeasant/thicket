---
title: M3: Code export (shell, Node, Python, Java)
status: done
owner: dell26/agent-3
deps: [shell-syntax]
touches: [packages/core/src/codegen]
prio: 2
lease_until: 
---
## Goal
Generate code for a find query or an aggregation pipeline in mongosh syntax, Node driver, PyMongo and Java driver, with correct BSON type constructors per language.

## Acceptance criteria
- [x] Snapshot tests for each language over 10 queries/pipelines including every BSON type
  - verified (2026-11-16 20:42+0100 by dell26/agent-3): npx vitest run --project core packages/core/src/codegen -> 130 passed; codegen.spec.ts snapshots shell/node/python/java x 10 samples (find + aggregate), a test asserts the samples contain all 21 BSON types
- [x] Generated Node and Python code for 3 samples actually runs against a fixture (int test; skip Java if no JDK, with reason)
  - verified (2026-11-16 20:43+0100 by dell26/agent-3): npm run test:int -- codegen (podman, mongo8 fixture) -> 13 passed: generated Node (host node + mongodb 7), Python (python:3.13-slim + pymongo 4.20) and Java (eclipse-temurin:21 + mongodb-driver-sync 5.14.0) programs for 4 samples run and print the same documents as the query run directly via the Node driver

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 20:22+0100 by dell26/agent-3): Code export API: generateCode(query, language, {uri}) in packages/core/src/codegen; Node/Python/Java output is a complete program (connect, run, print each result as one line of relaxed EJSON/JSON); shell output is one mongosh statement using db.getSiblingDB(...).getCollection(...).
- ASSUMPTION (2026-11-16 20:22+0100 by dell26/agent-3): Types without a faithful target: Python writes BSON undefined as None and Symbol as str (PyMongo has neither); Node writes dbPointer as DBRef and dates outside the JS Date range as new Date(NaN) with a comment; Java/Node/Python keep the last of duplicate keys except Python, which uses SON. Java throws CodegenError for unknown collation options (FindIterable.collation needs a Collation builder).
- ASSUMPTION (2026-11-16 20:22+0100 by dell26/agent-3): Integration test runs Python (python:3.13-slim + pip pymongo) and Java (eclipse-temurin:21-jdk + mongodb-driver-sync 5.14.0 jars from Maven Central) in containers with host networking, so it needs network access to PyPI/Maven and a Linux container host (Docker Desktop's host networking differs).
- ASSUMPTION (2026-11-16 20:36+0100 by dell26/agent-3): Correction to the earlier types assumption: Python (dict literal), Node and Java all keep only the last value of a duplicate key (no SON). Node also sends BSON undefined as null (driver default ignoreUndefined=false writes null), like Python's None; Node's DBRef splits 'db.coll' refs into $db/$ref while Python keeps $ref as given — deprecated types are best effort.
- done by dell26/agent-3: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 21s on 81054d652; criteria verified 2/2
