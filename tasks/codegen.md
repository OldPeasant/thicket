---
title: M3: Code export (shell, Node, Python, Java)
status: todo
owner:
deps: [shell-syntax]
touches: [packages/core/src/codegen]
prio: 2
---
## Goal
Generate code for a find query or an aggregation pipeline in mongosh syntax, Node driver, PyMongo and Java driver, with correct BSON type constructors per language.

## Acceptance criteria
- [ ] Snapshot tests for each language over 10 queries/pipelines including every BSON type
- [ ] Generated Node and Python code for 3 samples actually runs against a fixture (int test; skip Java if no JDK, with reason)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
