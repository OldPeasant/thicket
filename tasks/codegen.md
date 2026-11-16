---
title: M3: Code export (shell, Node, Python, Java)
status: in_progress
owner: dell26/agent-3
deps: [shell-syntax]
touches: [packages/core/src/codegen]
prio: 2
lease_until: 2026-11-16T19:48:46Z
---
## Goal
Generate code for a find query or an aggregation pipeline in mongosh syntax, Node driver, PyMongo and Java driver, with correct BSON type constructors per language.

## Acceptance criteria
- [ ] Snapshot tests for each language over 10 queries/pipelines including every BSON type
- [ ] Generated Node and Python code for 3 samples actually runs against a fixture (int test; skip Java if no JDK, with reason)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 20:22+0100 by dell26/agent-3): Code export API: generateCode(query, language, {uri}) in packages/core/src/codegen; Node/Python/Java output is a complete program (connect, run, print each result as one line of relaxed EJSON/JSON); shell output is one mongosh statement using db.getSiblingDB(...).getCollection(...).
- ASSUMPTION (2026-11-16 20:22+0100 by dell26/agent-3): Types without a faithful target: Python writes BSON undefined as None and Symbol as str (PyMongo has neither); Node writes dbPointer as DBRef and dates outside the JS Date range as new Date(NaN) with a comment; Java/Node/Python keep the last of duplicate keys except Python, which uses SON. Java throws CodegenError for unknown collation options (FindIterable.collation needs a Collation builder).
- ASSUMPTION (2026-11-16 20:22+0100 by dell26/agent-3): Integration test runs Python (python:3.13-slim + pip pymongo) and Java (eclipse-temurin:21-jdk + mongodb-driver-sync 5.14.0 jars from Maven Central) in containers with host networking, so it needs network access to PyPI/Maven and a Linux container host (Docker Desktop's host networking differs).
