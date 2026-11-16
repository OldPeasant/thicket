---
title: M3: Code export (shell, Node, Python, Java)
status: in_progress
owner: dell26/agent-3
deps: [shell-syntax]
touches: [packages/core/src/codegen]
prio: 2
lease_until: 2026-11-16T19:38:41Z
---
## Goal
Generate code for a find query or an aggregation pipeline in mongosh syntax, Node driver, PyMongo and Java driver, with correct BSON type constructors per language.

## Acceptance criteria
- [ ] Snapshot tests for each language over 10 queries/pipelines including every BSON type
- [ ] Generated Node and Python code for 3 samples actually runs against a fixture (int test; skip Java if no JDK, with reason)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 20:22+0100 by dell26/agent-3): Code export API: generateCode(query, language, {uri}) in packages/core/src/codegen; Node/Python/Java output is a complete program (connect, run, print each result as one line of relaxed EJSON/JSON); shell output is one mongosh statement using db.getSiblingDB(...).getCollection(...).
