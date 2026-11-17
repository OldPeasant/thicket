---
title: conn.close cancels agg.run and io.export/import streams before closing the client
status: in_progress
owner: dell26/agent-1
deps: [conn-close-streams]
touches: [packages/backend/src/agg/handlers.ts,packages/backend/src/io/handlers.ts]
prio: 2
lease_until: 2026-11-17T04:30:19Z
---
## Goal
Contract `conn.close` cancels the profile's streams. conn-close-streams added
`ConnectionManager.cancelOnClose` and wrapped only `docs.find`. Wrap the producers of `agg.run`
and `io.export`/`io.import` the same way so their cleanup (killOp, killCursors, partial export file
removal) runs before the driver client closes (review CR-2 of conn-close-streams).

## Acceptance criteria
- [x] Integration test: `conn.close` during a slow agg.run ends the stream with CANCELLED, the backend sent killOp and the server op is gone (like the docs-query conn.close test)
  - verified (2026-11-17 05:12+0100 by dell26/agent-1): npx vitest run --config test/integration/vitest.config.ts test/integration/agg.int.spec.ts (mongo8rs container fixture) -> 16 passed; new test 'conn.close during a slow agg.run' ($function sleep pipeline) gets stream error {CANCELLED, 'The connection was closed'}, $currentOp empty for the ns, backend's own killOp count increased (monitorCommands); same test with the old agg handler fails (op still in currentOp)
- [x] Unit tests: io.export / io.import streams end CANCELLED on conn.close and their cleanup runs before the client closes
  - verified (2026-11-17 05:12+0100 by dell26/agent-1): npx vitest run packages/backend/src/io/handlers.spec.ts -> pass; 'ioHandlers and conn.close' tests: io.export order find,getMore,currentOp,killOp,killCursors,client.close with partial file already removed, io.import order insert,currentOp,killOp,client.close, both reject CANCELLED 'The connection was closed'; both fail (5s timeout) with the old io handlers

## Notes
See test/integration/docs-query.int.spec.ts "conn.close during a running find" (counts the
backend's own killOp commands via monitorCommands).
