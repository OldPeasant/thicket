---
title: M4 (Should): Run a script file in the shell
status: in_progress
owner: dell26/agent-3
deps: [shell-ui]
touches: [packages/renderer/src/app/console/scripts]
prio: 3
lease_until: 2026-11-17T06:03:01Z
---
## Goal
Choose a .js/.mongodb file and run it in the current shell with progress and output.

## Acceptance criteria
- [ ] e2e: run a fixture script that inserts 3 docs; output shown, docs present

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 06:45+0100 by dell26/agent-3): Script file is chosen with the renderer's own <input type=file> and its text sent via the existing shell.eval (no new contract method, no path crosses the bridge); limited to .js/.mongodb and 5 MB
