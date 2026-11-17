---
title: conn.close cancels agg.run and io.export/import streams before closing the client
status: in_progress
owner: dell26/agent-1
deps: [conn-close-streams]
touches: [packages/backend/src/agg/handlers.ts,packages/backend/src/io/handlers.ts]
prio: 2
lease_until: 2026-11-17T04:23:54Z
---
## Goal
Contract `conn.close` cancels the profile's streams. conn-close-streams added
`ConnectionManager.cancelOnClose` and wrapped only `docs.find`. Wrap the producers of `agg.run`
and `io.export`/`io.import` the same way so their cleanup (killOp, killCursors, partial export file
removal) runs before the driver client closes (review CR-2 of conn-close-streams).

## Acceptance criteria
- [ ] Integration test: `conn.close` during a slow agg.run ends the stream with CANCELLED, the backend sent killOp and the server op is gone (like the docs-query conn.close test)
- [ ] Unit tests: io.export / io.import streams end CANCELLED on conn.close and their cleanup runs before the client closes

## Notes
See test/integration/docs-query.int.spec.ts "conn.close during a running find" (counts the
backend's own killOp commands via monitorCommands).
