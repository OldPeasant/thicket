---
title: conn.close kills the server ops of the profile's running streams
status: done
owner: dell26/agent-1
deps: [docs-query-backend]
touches: [packages/backend/src/connections/manager.ts,packages/backend/src/connections/handlers.ts,packages/backend/src/docs/query]
prio: 2
lease_until: 
---
## Goal
`conn.close` cancels the profile's running streams (contract `conn.ts`) before it closes the driver
client, so their cleanup can still `killOp`/`killCursors` on the server. Today (docs-query-backend)
a docs.find stream ended by `conn.close` reports `CANCELLED` but its server operation keeps running,
because `ConnectionManager.close` closes the client first (review round 2, CR-2).

## Acceptance criteria
- [x] Integration test: `conn.close` during a slow docs.find ends the stream with CANCELLED and the server op is gone (currentOp check, like the docs-query cancel test)
  - verified (2026-11-17 03:56+0100 by dell26/agent-1): npm run test:int -- test/integration/docs-query.int.spec.ts (mongo:8.2 rs fixture, podman) -> 35 passed; test 'conn.close during a running find...' calls conn.close via RPC: stream ends CANCELLED 'The connection was closed', $currentOp for the ns is empty, and the backend's own client sent >=1 killOp. Same test against the pre-task handler fails (expected 0 to be greater than 0).

## Notes
See SPEC.md section 4 and docs/ARCHITECTURE.md (streams, document reads).
- ASSUMPTION (2026-11-17 03:47+0100 by dell26/agent-1): Only docs.find streams are registered with ConnectionManager.cancelOnClose (task scope/touches); agg.run and io.export/import streams can adopt the same 1-line wrapper in their own task. The int test also asserts killOp count rises, because mongod 8.2 interrupts the op on client disconnect anyway, so the currentOp check alone did not distinguish old from new code.
- done by dell26/agent-1: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 55s on e8d4f1fad; criteria verified 1/1
