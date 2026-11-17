---
title: M4: mongosh host in the backend
status: todo
owner: 
deps: [mongosh-spike,conn-manager]
touches: [packages/backend/src/shell]
prio: 2
lease_until: 
extended: 
releases: 1
---
## Goal
shell.open/eval/complete/close per connection following docs/mongosh.md; output streamed as typed events (documents as EJSON, text, errors); interrupt; one runtime per shell tab.

## Acceptance criteria
- [x] Integration tests: `use test; db.c.insertOne({a:1}); db.c.find()` returns the document as EJSON
  - verified (2026-11-17 03:42+0100 by dell26/agent-1): npx vitest run --config test/integration/vitest.config.ts test/integration/shell.int.spec.ts --reporter=verbose (MongoDB container via Podman, merged HEAD 369c532) -> 17 passed incl. 'shell.eval > use test; db.c.insertOne({a:1}); db.c.find() returns the document as EJSON'
- [x] Interrupt stops `while(true){}` within 2 s (int test)
  - verified (2026-11-17 03:42+0100 by dell26/agent-1): npx vitest run --config test/integration/vitest.config.ts test/integration/shell.int.spec.ts --reporter=verbose (MongoDB container via Podman, merged HEAD 369c532) -> 17 passed incl. 'interrupt > stops while(true){} within 2 s and the session goes on' (1.7 s)
- [x] complete('db.c.fi') suggests `find`, `findOne` (test)
  - verified (2026-11-17 03:42+0100 by dell26/agent-1): npx vitest run --config test/integration/vitest.config.ts test/integration/shell.int.spec.ts --reporter=verbose (MongoDB container via Podman, merged HEAD 369c532) -> 17 passed incl. 'shell.complete > complete(db.c.fi) suggests find and findOne' against the real mongosh runtime; plus handlers.spec.ts unit cases
  - verified (2026-11-17 03:42+0100 by dell26/agent-1): npx vitest run --config test/integration/vitest.config.ts test/integration/shell.int.spec.ts --reporter=verbose (MongoDB via Podman, merged HEAD 369c532) -> 'shell.complete > complete db.c.fi suggests find and findOne' passed against the real mongosh runtime

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 02:49+0100 by dell26/agent-1): shell.eval cancel = interrupt (the contract has no shell.interrupt): cooperative mongosh interrupt first, worker terminated and replaced after 1 s (state lost, a print output tells the user on the next eval, same db kept)
- ASSUMPTION (2026-11-17 02:49+0100 by dell26/agent-1): Console input is split into pieces at shell commands (use/show/it/exit/quit at a statement start) because mongosh's evaluator would read 'use test; db.c.find()' as switching to db 'test;'; JS between commands is evaluated as one program
- ASSUMPTION (2026-11-17 02:49+0100 by dell26/agent-1): shell.complete returns mongosh's completions as given: whole input with the completed word (db.c.fi -> db.c.find, db.c.findOne); the UI replaces the text before the cursor
- ASSUMPTION (2026-11-17 02:49+0100 by dell26/agent-1): Result value: canonical EJSON of the printable (cursor batches as the array of documents), omitted for Help/banner and non-data values; evaluations of one session are queued; conn.close also closes that profile's shell sessions; interactive prompts (passwordPrompt) fail
- ASSUMPTION (2026-11-17 02:49+0100 by dell26/agent-1): Bundling: apps/desktop build.mjs gets a shell-worker.cjs entry; kerberos and mongodb-client-encryption are esbuild externals and not shipped yet (GSSAPI/CSFLE unavailable until packaging adds them); running the worker inside the real Electron utilityProcess was not verified here (plain Node worker of the bundle was)
- ASSUMPTION (2026-11-17 03:07+0100 by dell26/agent-1): exit/quit (and exit()/quit()) are not passed to mongosh (it would close the session's client): the console prints that they are unavailable and the session goes on; closing the shell tab ends the session
- extended by dell26/agent-1: Implementation complete; all 3 criteria verified on merged HEAD (shell int 17/17, npm run check pass); round-4 review 0 P0-P2. Main merged in 369c532 (conflict resolution in apps/desktop/scripts/build.mjs externals, packages/backend/package.json deps, src/index.ts exports, server/backend.ts ssh+indexes+shell wiring). done refuses: evidence stale after that resolution. Left: run test-writer + code-reviewer on current HEAD (scope: the merge resolution lines), update quality.json reviewed_revision, done.
- release by dell26/agent-1: over budget after 2 sessions (~60 min) and a review that decided nothing; still resumable: continue from wip/shell-backend (see git log)
