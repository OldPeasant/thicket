---
title: M4 (Should): Run a script file in the shell
status: in_progress
owner: dell26/agent-3
deps: [shell-ui]
touches: [packages/renderer/src/app/console/scripts]
prio: 3
lease_until: 2026-11-17T06:18:10Z
---
## Goal
Choose a .js/.mongodb file and run it in the current shell with progress and output.

## Acceptance criteria
- [x] e2e: run a fixture script that inserts 3 docs; output shown, docs present
  - verified (2026-11-17 06:45+0100 by dell26/agent-3): npm run test:e2e -- test/e2e/shell.e2e.ts (built Electron app, Testcontainers MongoDB; test 'run a script file in the shell' picks test/e2e/fixtures/insert-three.mongodb via the Run script… file chooser) -> 3 passed; transcript shows 'inserted 1..3', 'count: 3', no errors; MongoClient finds the 3 docs in shell_scripts_e2e.scripted

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 06:45+0100 by dell26/agent-3): Script file is chosen with the renderer's own <input type=file> and its text sent via the existing shell.eval (no new contract method, no path crosses the bridge); limited to .js/.mongodb and 5 MB
- ASSUMPTION (2026-11-17 06:45+0100 by dell26/agent-3): 'Progress' = the run shows 'Running <file>… N outputs so far' while print()/results stream in, then a finished/failed announcement; no per-statement progress (mongosh evaluates the JS as one program)
