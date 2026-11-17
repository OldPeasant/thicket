---
title: M2: Raw-command reads follow the profile read preference, writes its write concern
status: in_progress
owner: felix/agent-1
deps: [x509-proxy,conn-close-streams,validator]
touches: [packages/backend/src/docs,packages/backend/src/browse]
prio: 2
lease_until: 2026-11-17T05:00:47Z
---
## Goal
`x509-proxy` sets the profile's read preference (+ tags) and write concern as the driver client's
defaults, but the backend's own reads and writes are raw `db.command()`s (`Operation` in
`docs/query/query.ts`, `browse.ts`, `docs/write/write.ts`), which the driver always sends to the
primary and without the client write concern. Make them follow the profile, as SPEC M2 "Read
preference and write concern per profile; open on secondary for read-only work" needs. A cursor's
`getMore`/`killCursors` must reach the server that opened it (e.g. `db.runCursorCommand()` or
pinning the server), not whatever the read preference selects next.

## Acceptance criteria
- [ ] Int test (SOCKS5 replica set fixture `test/integration/fixtures/socks.ts`): `docs.find` with
      more than one batch on a `secondaryPreferred` profile reads every batch from `rs-b:27017`
      (connection checkout events or `currentOp`), and cancelling it kills the cursor there
- [ ] Int test: `docs.insert` on a profile with `writeConcern: { w: 3 }` answers `SERVER_ERROR`
      (write concern error, 2 members); with `w: 2` a secondary read sees the document
- [ ] Browse reads (`listCollections`, counts, stats) honour the read preference (unit test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md ("Connections").
- ASSUMPTION (2026-11-17 05:35+0100 by felix/agent-1): Cancelling a command still in flight finds it with currentOp/killOp sent with the same read preference; with several eligible secondaries that may reach a different member (the driver has no public API to target one server for a raw command). Open cursors are always killed on their own server (driver cursor).
- ASSUMPTION (2026-11-17 05:35+0100 by felix/agent-1): Schema/index/user commands (create, drop, rename, collMod, createIndexes, usersInfo) stay on the primary without the profile write concern; only document writes (docs.*, io.import) carry it. Reads tied to a write (previewMany, expectedCount check, conflict detail) read from the primary.
- ASSUMPTION (2026-11-17 05:35+0100 by felix/agent-1): Aggregations (agg.run incl. $out/$merge, agg.explain) and io.export follow the read preference too, since they go through Operation; $out/$merge on a secondary needs MongoDB 5.0+.
- ASSUMPTION (2026-11-17 05:35+0100 by felix/agent-1): ClientLike test fakes without db().runCursorCommand fall back to plain getMore commands (with the read preference) instead of rewriting every existing fake; real MongoClients always use the pinned driver cursor.
