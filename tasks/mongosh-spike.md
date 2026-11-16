---
title: M4: Spike: embedding mongosh in the backend process
status: in_progress
owner: felix/agent-1
deps: [electron-shell]
touches: [docs/mongosh.md,spikes/mongosh]
quality: exempt
quality_reason: research spike: produces a decision document and throwaway prototype, no product code
prio: 2
lease_until: 2026-11-16T19:29:43Z
---
## Goal
Find out how to host the real mongosh runtime in the utilityProcess (packages, versions, eval API, autocompletion, output types, interrupt), with a throwaway prototype in spikes/mongosh.

## Acceptance criteria
- [x] docs/mongosh.md answers: packages and versions, how eval/complete/interrupt work, how output is typed, packaging impact (size, native modules), licence
  - verified (2026-11-16 20:12+0100 by felix/agent-1): docs/mongosh.md written from the installed packages (cd spikes/mongosh && npm ci: @mongosh/* 5.6.2-5.11.9, mongodb 7.9.0, npm query licence survey, node bundle.mjs -> 22.4 MiB esbuild bundle that runs ping.cjs's full scenario) -> sections: packages/versions, eval, output types, autocompletion, interrupt, packaging (size, native kerberos/mongocrypt N-API), licence (all permissive, Apache-2.0 core)
- [x] The prototype evaluates `db.runCommand({ping:1})` against a fixture (command and output in verify)
  - verified (2026-11-16 20:12+0100 by felix/agent-1): podman run -d -p 127.0.0.1:27399:27017 mongo:8.2; cd spikes/mongosh && npm ci && node ping.cjs (Node 24.22.1) -> 'db.runCommand({ping:1})' => { type: null, printable: { ok: 1 } }; also use db, find => type Cursor, print, completion db.ord => db.orders, interrupt of async loop and 5 s $where sleep after 300 ms => MongoshInterruptedError, resume works; ends 'done'

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 20:12+0100 by felix/agent-1): Spike ran on Node 24.22.1, not inside Electron's utilityProcess (running the Electron binary needed an approval the agent lacked); N-API native modules and plain Node APIs are assumed to work there, first shell task should confirm with test:electron
- ASSUMPTION (2026-11-16 20:13+0100 by felix/agent-1): Recommended one worker_thread + own MongoClient per shell session (interrupt closes the client; sync loops need worker.terminate); not prototyped, a design choice humans may revisit
