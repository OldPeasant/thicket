---
title: conn.close kills the server ops of the profile's running streams
status: todo
owner:
deps: [docs-query-backend]
touches: [packages/backend/src/connections/manager.ts,packages/backend/src/connections/handlers.ts,packages/backend/src/docs/query]
prio: 2
---
## Goal
`conn.close` cancels the profile's running streams (contract `conn.ts`) before it closes the driver
client, so their cleanup can still `killOp`/`killCursors` on the server. Today (docs-query-backend)
a docs.find stream ended by `conn.close` reports `CANCELLED` but its server operation keeps running,
because `ConnectionManager.close` closes the client first (review round 2, CR-2).

## Acceptance criteria
- [ ] Integration test: `conn.close` during a slow docs.find ends the stream with CANCELLED and the server op is gone (currentOp check, like the docs-query cancel test)

## Notes
See SPEC.md section 4 and docs/ARCHITECTURE.md (streams, document reads).
