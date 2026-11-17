# Code Review

Date: 2026-11-17

Task: conn-close-agg-io-streams - conn.close cancels agg.run and io.export/import streams before closing the client

Scope: `git diff 1f83bd0..HEAD` (all task commits on top of the base commit 1f83bd0f28d8aac2994dbf7d9953394d14ae95d4). Committed changes only.

Requirements:
- tasks/conn-close-agg-io-streams.md (goal, acceptance criteria 1 and 2, notes)
- reviews/conn-close-streams/review.md (CR-2 of the predecessor task, which this task addresses)
- docs/ARCHITECTURE.md (document reads, `Operation` cancel cleanup, io streams)
- packages/contract/src/conn.ts (`conn.close` cancels the profile's streams)
- AGENTS.md, docs/QUALITY.md
- Context read: packages/backend/src/connections/manager.ts (`cancelOnClose`, `close`), packages/backend/src/docs/query/handlers.ts, packages/backend/src/io/export.ts, packages/backend/src/io/import.ts

Git range:
- Branch: main
- HEAD: 629875828174acd6b4e57a6c056bda6af6d822f3
- Base/start: 1f83bd0f28d8aac2994dbf7d9953394d14ae95d4
- Commits reviewed: 3 (a3be31c, 0d9bf59, 6298758). The working tree has no uncommitted changes.

Summary: 0 P0, 0 P1, 0 P2, 1 P3

Verification performed by the reviewer:
- `npx vitest run packages/backend/src/connections/manager.spec.ts packages/backend/src/agg/handlers.spec.ts packages/backend/src/io/handlers.spec.ts packages/backend/src/docs/query/handlers.spec.ts` -> 4 files, 214 passed
- `npx vitest run --config test/integration/vitest.config.ts test/integration/agg.int.spec.ts` (Testcontainers) -> 16 passed, including "conn.close during a slow agg.run ends its stream with CANCELLED and kills the server operation"

Checked without findings:
- `streamOnConnection` (manager.ts:597-610) wraps `cancelOnClose` and maps any failure to `CANCELLED "The connection was closed"` only when `client` is no longer the profile's open client. Other failures pass through unchanged, and a caller cancel on an open connection keeps its own "The operation was cancelled" error. Unit tests cover every branch, including a refused start for a stranger or closed client and a failure that arrives after a reopen.
- agg.run (agg/handlers.ts:20-26): `buildAggregate` still validates before the stream exists. The producer gets the combined signal, so `conn.close` aborts `streamAggregate`, whose `Operation` cleanup (currentOp, killOp, killCursors) runs before `client.close`. The unit test asserts the exact order `aggregate, currentOp, killOp, killCursors, client.close`.
- io.export (io/handlers.ts:107-117): `exportToFile` gets the combined signal. On abort its catch closes the write stream and removes the partial file, and its `finally` closes the `Operation`. Both run before the promise settles, so they run before `close` closes the client (the grace period permitting). The unit test checks that the file was already removed when `client.close` ran.
- io.import (io/handlers.ts:147-160): `importFile` gets the combined signal through both `Operation` and `scanFile`. The chosen file is not removed, and the test asserts this.
- Integration criterion 1: the test uses the same method as the accepted docs-query test. It counts `killOp` commands from the backend's own `MongoClient` (`monitorCommands`), checks the stream outcome `CANCELLED` and checks that `$currentOp` shows no remaining operation on the namespace. `connHandlers` is mounted next to the guarded agg handlers, and the profile is reopened in `finally` for later tests.
- Unit criterion 2: io.export and io.import each have a conn.close test (stream ends CANCELLED, cleanup recorded before `client.close`). Each also has a contrasting test with the connection still open.
- No security-relevant change: no new input paths, logging or configuration.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | docs.find still duplicates the logic the new helper factors out**
    - File: `packages/backend/src/docs/query/handlers.ts:28-40`
    - Category: Quality
    - Problem: This task adds `streamOnConnection` (manager.ts:597) as the shared form of "cancelOnClose plus map failures of a closed client to CANCELLED". `docs.find` still has its own inline copy of the same try/catch, with an `isOpenClient` check and a literal `RpcError('CANCELLED', 'The connection was closed')`. Three stream producers use the helper and one keeps the copy.
    - Why it matters: if the close-mapping rule or its message changes in one place, `docs.find` can drift from agg/io. This is minor, and `docs/query/handlers.ts` is outside this task's `touches`.
    - Suggested fix: when that file is next changed, replace the inline block with `streamOnConnection(manager, p.profileId, client, sink.signal, (signal) => streamFind(...))` and drop the `isOpenClient` import. It is also fine to accept this finding and leave the code as it is.

## Review conclusion

No material issues found.
