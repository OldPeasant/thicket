# Code Review

Date: 2026-11-17

Task: conn-close-streams - conn.close kills the server ops of the profile's running streams

Scope: `git diff 3168a0c..HEAD -- packages test` (all task commits on top of the base, final revision). This is a re-review: it covers the test-writer's added unit tests and the fixer's CR-1 change since the previous review at c96abd1.

Requirements:
- tasks/conn-close-streams.md (goal, acceptance criterion #1, recorded assumption)
- SPEC.md section 4 (cancellable queries; `cancel` kills the server-side operation)
- docs/ARCHITECTURE.md (document reads, `Operation` cancel cleanup, streams)
- packages/contract conn.ts (`conn.close`: "cancels its streams and shells")
- AGENTS.md, docs/QUALITY.md
- Previous review (c96abd1) and reviews/conn-close-streams/fixes.md
- Context: packages/backend/src/docs/query/query.ts (`Operation.cleanUp`, `killOperations`, CANCEL_SETTLE_MS)

Git range:
- Branch: main
- HEAD: 00fcfe5
- Base/start: 3168a0c1b52322611c986b7d5424b85a9b7bdfb0
- Commits reviewed: 5 (9261b8a, 686d923, c96abd1, dffd50c, 00fcfe5). There are no uncommitted changes to tracked files. The untracked file is `tasks/conn-close-agg-io-streams.md` (see the notes below).

Summary: 0 P0, 0 P1, 0 P2, 0 P3

Verification performed by the reviewer:
- `npx vitest run packages/backend/src/connections/manager.spec.ts packages/backend/src/docs/query/handlers.spec.ts` -> 2 files, 141 passed
- `npm run test:int -- test/integration/docs-query.int.spec.ts` (Testcontainers, mongo8rs) -> 35 passed, including "conn.close during a running find ends its stream with CANCELLED and kills the server operation"

Changes since the previous review (checked, no finding):
- Production code (`packages/backend/src/connections/manager.ts`, `packages/backend/src/docs/query/handlers.ts`) is unchanged since c96abd1. The correctness notes of the previous review still hold: `close` removes the entry, aborts the registered work, waits at most CLOSE_CANCEL_GRACE_MS before it closes the client, and clears the timer. Work started for a closed or replaced client is refused with `CANCELLED`. The caller signal is forwarded and its listener removed. A synchronous throw from the work is turned into a rejection.
- Previous CR-1 (fixed): the integration test now counts `killOp` commands from a `commandStarted` listener on the backend's own `MongoClient`, created with `monitorCommands: true` through the manager's `createClient` dep. Before, it read the server-wide `serverStatus` counter. The override matches the default factory (`new MongoClient(uri, options)`) and adds only the monitoring option. The assertion still separates the new behavior from the old one: `Operation` sends `killOp` only from `cleanUp` after its signal is aborted (query.ts:164-193). The old code never aborted the find's signal on `conn.close`, so with the old code this backend sends no `killOp`, and another spec file sharing the container can no longer affect the count.
- New unit tests in manager.spec.ts cover these cases: a synchronous throw, a caller signal that is already aborted, a caller abort after the work settled, close waiting for cleanup that is already running, several works per profile, profile isolation, closeAll order, refusal while the profile is connecting, and work that settles after the grace time. They assert observable ordering and outcomes, not internals. The handlers.spec.ts test checks the full order `find, currentOp, killOp, killCursors, client.close` with the real `ConnectionManager`. Fake timers are restored in `finally`.
- Previous CR-2 (agg.run and io.export/io.import streams not wrapped) is out of this task's `touches`. It is now described in the follow-up task `tasks/conn-close-agg-io-streams.md` (deps: conn-close-streams). That task covers agg.run killOp and the io.export/import cleanup ordering.

Notes for the parent worker (TFP state, not code findings):
- `tasks/conn-close-agg-io-streams.md` is untracked in this clone. It has to be committed and pushed, as AGENTS.md step 7 says, or the follow-up for CR-2 is lost.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found.
