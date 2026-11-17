# Code Review

Date: 2026-11-17

Task: change-streams - M6 (Could): Watch changes

Scope: `git diff acb303b0..c14793aa` (the four "change-streams: ..." commits), committed changes only

Requirements:
- tasks/change-streams.md acceptance criteria (1) integration test: insert/update/delete events received in order; (2) standalone server shows a clear 'needs replica set' message (test)
- Recorded assumptions #1-#3 for change-streams (`python tasks.py assumptions`)
- SPEC.md M6 "Could" change streams, section 4 `admin.*` namespace
- docs/ARCHITECTURE.md (new "Watch changes" section; "Read preference and write concern" / `ReadCursor` convention in packages/backend/src/browse/browse.ts)
- AGENTS.md project notes
- Contract `admin.watch` in packages/contract/src/admin.ts (unchanged by this task)

Git range:
- Branch: main
- HEAD: c14793aa31b4b27bc0086b8f40a861035fb1342e
- Base/start: acb303b04d810d7f1f060755633c8517ac45f4b0
- Commits reviewed: 4 (9e9f6622, 40788a25, 7679fcef, c14793aa); working tree clean

Summary: 0 P0, 0 P1, 1 P2, 1 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | getMore/killCursors are not pinned to the server that opened the change stream (sharded with several mongos, load-balanced)**
    - File: `packages/backend/src/admin/watch/watch.ts:126` (also `:113`, `:134`)
    - Category: Integration
    - Problem: `streamChanges` sends the `aggregate`, each `getMore` and the `killCursors` as independent `db.command(...)` calls. Each call selects a server again. That is the pattern the backend moved away from in task raw-cmd-read-pref: `ReadCursor` (packages/backend/src/browse/browse.ts:150-190) runs cursor commands through `runCursorCommand` so that "every `getMore` and the `killCursors` ... reach the server that answered the command". On a replica set every call goes to the primary, so this works, and the integration tests cover only that case. But `assertWatchable` explicitly lets sharded clusters and load-balanced deployments through (watch.ts:49). On a sharded cluster whose connection string lists several mongos, primary selection can pick a different mongos for a `getMore`, which then fails with CursorNotFound. In load-balanced mode the cursor is pinned to one connection, and a `getMore` sent on another pooled connection can fail the same way. The stream then ends with an error after the first round. The same happens after a replica-set failover, but that case is covered by the "no auto-resume" assumption.
    - Why it matters: watching a sharded or load-balanced deployment, which the code advertises as supported, can fail at random. It also departs from the project's documented convention for cursor commands.
    - Suggested fix: run the change stream through a pinned driver cursor, as `ReadCursor` does: `db.runCursorCommand(command, { raw: true })` with `setMaxTimeMS(WATCH_AWAIT_MS)` for the await time and `cursor.close()` instead of a raw `killCursors`. Extend `ReadCursor` if needed. Alternatively, refuse sharded and load-balanced deployments in `assertWatchable` and record that as an assumption. Add a unit test that the getMore goes through the cursor (or that these topologies are refused).

## P3 Low

- [ ] **CR-2 | Cancel while the opening aggregate is in flight leaves the server-side change stream cursor open**
    - File: `packages/backend/src/admin/watch/watch.ts:100-113`
    - Category: Correctness
    - Problem: `run` wraps the `aggregate` in `abortable`. If the user presses Stop (or Start with a new mode) before the aggregate answers, `streamChanges` rejects `CANCELLED` and `id` is still undefined, so the `finally` block kills nothing. The aggregate still completes on the server and opens a change stream cursor that nobody kills. It lives until the server's idle cursor timeout (10 min by default). The unit test "a cancel before the aggregate answers ends CANCELLED without a cursor to kill" (watch.spec.ts:363) confirms this behaviour: the late reply carries cursor id 8 and only `aggregate` is ever sent.
    - Why it matters: rapid Stop/Start or checkbox toggles leave orphaned cursors on the server. The waste is small and bounded, but avoidable.
    - Suggested fix: when the signal aborts during the opening command, still await the original aggregate promise in the background and kill its cursor if one opened. Using a driver cursor (CR-1) and closing it would also cover this.

## Review conclusion

No material issues found. Both acceptance criteria are implemented and tested:
- (1) `test/integration/change-streams.int.spec.ts` checks the insert/update/insert/delete order, the documentKeys, lossless types and clusterTime order against the replica-set fixture.
- (2) The standalone is refused at request time with `UNSUPPORTED` and detail `needsReplicaSet`. The integration test runs against the `mongo8` standalone fixture, and the renderer shows a dedicated notice (watch-view.spec.ts:110).

Renderer state handling is sound:
- stale-stream callbacks are ignored by subscription identity;
- out-of-order `docs.get` answers are guarded with an AbortController;
- the stream is cancelled when the tab closes.

CR-1 is worth fixing (or making an explicit, recorded scope decision on) before completing the task, because the code claims to support sharded and load-balanced deployments. CR-2 is optional.
