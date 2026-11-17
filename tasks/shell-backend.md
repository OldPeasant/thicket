---
title: M4: mongosh host in the backend
status: in_progress
owner: dell26/agent-1
deps: [mongosh-spike,conn-manager]
touches: [packages/backend/src/shell]
prio: 2
lease_until: 2026-11-17T02:08:55Z
---
## Goal
shell.open/eval/complete/close per connection following docs/mongosh.md; output streamed as typed events (documents as EJSON, text, errors); interrupt; one runtime per shell tab.

## Acceptance criteria
- [ ] Integration tests: `use test; db.c.insertOne({a:1}); db.c.find()` returns the document as EJSON
- [ ] Interrupt stops `while(true){}` within 2 s (int test)
- [ ] complete('db.c.fi') suggests `find`, `findOne` (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 02:49+0100 by dell26/agent-1): shell.eval cancel = interrupt (the contract has no shell.interrupt): cooperative mongosh interrupt first, worker terminated and replaced after 1 s (state lost, a print output tells the user on the next eval, same db kept)
- ASSUMPTION (2026-11-17 02:49+0100 by dell26/agent-1): Console input is split into pieces at shell commands (use/show/it/exit/quit at a statement start) because mongosh's evaluator would read 'use test; db.c.find()' as switching to db 'test;'; JS between commands is evaluated as one program
- ASSUMPTION (2026-11-17 02:49+0100 by dell26/agent-1): shell.complete returns mongosh's completions as given: whole input with the completed word (db.c.fi -> db.c.find, db.c.findOne); the UI replaces the text before the cursor
