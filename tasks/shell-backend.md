---
title: M4: mongosh host in the backend
status: todo
owner:
deps: [mongosh-spike,conn-manager]
touches: [packages/backend/src/shell]
prio: 2
---
## Goal
shell.open/eval/complete/close per connection following docs/mongosh.md; output streamed as typed events (documents as EJSON, text, errors); interrupt; one runtime per shell tab.

## Acceptance criteria
- [ ] Integration tests: `use test; db.c.insertOne({a:1}); db.c.find()` returns the document as EJSON
- [ ] Interrupt stops `while(true){}` within 2 s (int test)
- [ ] complete('db.c.fi') suggests `find`, `findOne` (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
