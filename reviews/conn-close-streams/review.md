# Code Review

Date: 2026-11-17

Task: conn-close-streams - conn.close kills the server ops of the profile's running streams

Scope: `git diff 3168a0c..HEAD -- packages test` (task commits after the base commit). The parent named commits 7eb8a9a and 9fe2c4e; those hashes do not exist in this clone (most likely they were rebased). The commits actually on top of the base are listed below and were reviewed instead. The changed code is the same as described.

Requirements:
- tasks/conn-close-streams.md (goal, acceptance criterion #1, recorded assumption)
- SPEC.md section 4 (cancellable queries; `cancel` kills the server-side operation)
- docs/ARCHITECTURE.md (document reads, `Operation` cancel cleanup, streams)
- packages/contract conn.ts (`conn.close`: "cancels its streams and shells")
- AGENTS.md, docs/QUALITY.md
- Context: packages/backend/src/server/rpc.ts (stream registry, STREAM_CANCEL_GRACE_MS), packages/backend/src/docs/query/query.ts (`Operation.cleanUp`, CANCEL_SETTLE_MS = 4000)

Git range:
- Branch: main
- HEAD: c96abd105f3a2ce09b9914997631b902e8531107
- Base/start: 3168a0c1b52322611c986b7d5424b85a9b7bdfb0
- Commits reviewed: 3 (9261b8a manager/handler change and unit tests, 686d923 integration test, c96abd1 lint fix in manager spec); no uncommitted changes

Summary: 0 P0, 0 P1, 0 P2, 2 P3

Verification performed by the reviewer:
- `npx vitest run packages/backend/src/connections/manager.spec.ts` -> 109 passed
- `npm run test:int -- test/integration/docs-query.int.spec.ts` (Testcontainers, mongo8rs) -> 35 passed, including "conn.close during a running find ends its stream with CANCELLED and kills the server operation"

Correctness notes (checked, no finding):
- `close` deletes the entry first, so `isOpenClient` is false and the handler maps the aborted find to `CANCELLED 'The connection was closed'`. The rpc stream controller itself is not aborted, so the stream reports the handler's error, which is what the test asserts.
- The work signal is aborted before the client closes. `close` then waits for the work (and `Operation.close` -> `cleanUp`, bounded by CANCEL_SETTLE_MS = 4 s) for at most CLOSE_CANCEL_GRACE_MS = 5 s before closing the client. The timer is cleared.
- A producer that starts after `conn.close` (or after close+reopen with a new client) is refused with `CANCELLED` by the state/client identity check in `cancelOnClose`.
- The caller signal is forwarded and the listener removed in `finally`. Finished work is removed from the set, so later closes do not wait for it.
- A synchronous throw from `work` is converted into a rejection and still unregistered.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | killOp assertion uses a server-global counter on a shared container**
    - File: `test/integration/docs-query.int.spec.ts:484`
    - Category: Tests
    - Problem: The only assertion that tells the new behavior apart from the old one (per the task assumption, mongod 8.2 also interrupts the op when the client disconnects) is `serverStatus.metrics.commands.killOp.total` going up. That counter covers the whole server. `mongo8rs` is a global fixture shared by 8 integration spec files, and Vitest runs files in parallel by default. Today no other spec issues `killOp` on that fixture, but a later cancel test in another file (agg.run, docs writes) would make this assertion pass even if `conn.close` stopped killing the op.
    - Why it matters: The regression guard for the task's core behavior can give a false pass once other tests cancel on the same server.
    - Suggested fix: Count `killOp` commands sent by this backend's own client instead, for example with driver command monitoring (`monitorCommands` / `commandStarted` on the manager's client). Another option is to filter the server-side evidence by the stream's `thicket:` comment.

- [ ] **CR-2 | agg.run and io.export/io.import streams still close the client before their cleanup; no follow-up task exists**
    - File: `packages/backend/src/agg/handlers.ts:22`, `packages/backend/src/io/handlers.ts:107`, `packages/backend/src/io/handlers.ts:143`
    - Category: Integration
    - Problem: The contract says `conn.close` "cancels its streams". Only `docs.find` is registered with `cancelOnClose`. `agg.run` uses the same pattern as the old find code: it passes `sink.signal` and rewrites the error after the client is closed. So its server operation is not killed with `killOp` on `conn.close`. Because of the task's `touches`, this is recorded as an assumption, but `tasks/` has no task that will adopt the wrapper.
    - Why it matters: The same defect this task fixed (CR-2 of docs-query-backend) remains for aggregations and exports, and only an assumption tracks it.
    - Suggested fix: The parent worker should create a follow-up task (for example `tasks.py new agg-io-close-streams ... --touches packages/backend/src/agg,packages/backend/src/io`) that wraps those producers with `manager.cancelOnClose`.

## Review conclusion

No material issues found.
