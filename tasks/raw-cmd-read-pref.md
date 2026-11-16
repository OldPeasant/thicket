---
title: M2: Raw-command reads follow the profile read preference, writes its write concern
status: todo
owner:
deps: [x509-proxy,conn-close-streams,validator]
touches: [packages/backend/src/docs,packages/backend/src/browse]
prio: 2
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
