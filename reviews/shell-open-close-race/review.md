# Code Review

Date: 2026-11-17

Task: shell-open-close-race: Shell opening during conn.close/tunnel loss outlives the connection

Scope: `git diff d6a2fdab5cfd18b8fec3a1734e60888620ba7e76..5ee7bdd65d69496ddcec624a9900520bc0fa2357` (committed changes only; working tree clean)

Requirements:
- `tasks/shell-open-close-race.md` acceptance criteria
- `reviews/shell-backend/review.md` round 6 CR-1 (background)
- `AGENTS.md`, `docs/ARCHITECTURE.md`
- Parent instructions: correctness, races with reconnect, cleanup, wiring of conn.close/onStatus in `packages/backend/src/server/backend.ts`

Git range:
- Branch: main
- HEAD: 5ee7bdd65d69496ddcec624a9900520bc0fa2357
- Base/start: d6a2fdab5cfd18b8fec3a1734e60888620ba7e76
- Commits reviewed: 2 (663f7f6, 5ee7bdd)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## What was checked

- `ShellHost.open` (`packages/backend/src/shell/host.ts:102-152`). It registers its `AbortController` in `opening` synchronously, before its first `await`. `shellHandlers` calls `manager.configOf` synchronously right before `host.open`, so no `closeProfile` can run between reading the config and registering the open. The caller's signal is forwarded with `onAbort` and removed in `finally`. An abort that lands after `startWorker` resolved, but before the continuation runs, is caught by the `closing.signal.aborted` check (line 122), which terminates the worker. Between that check and `sessions.set` nothing yields, so no window is left open. An abort while waiting goes through `startWorker`'s catch, which terminates the worker. A `CONNECTION_CLOSED` reason is turned into `CANCELLED` "The connection was closed while the shell was opening". The caller's own abort keeps the plain `CANCELLED`.
- Cleanup: `finally` removes the controller. It deletes the map entry only while the entry is still the same set, so a reopen registered after `closeProfile` keeps its registration. The test "a new open of the profile started while a cancelled one settles is still tracked" covers this case.
- `closeProfile` (line 278) aborts the pending opens synchronously, before its first `await`. The `onStatus` path in `backend.ts:104`, which `tunnelLost` calls synchronously in the step where it sets the `error` state, therefore cancels pending opens at once. The open also cannot slip in afterwards, because `manager.client` requires `state === 'connected'`.
- Reconnect after `closeProfile` completed: a new open makes a fresh set and is not affected (AC2 test, line ~1235 of host.spec.ts).
- Tests: `npx vitest run src/shell/host.spec.ts src/server/backend.spec.ts` in `packages/backend` -> 2 files, 117 passed. The wiring from conn.close and onStatus to `closeProfile` is covered by existing backend.spec.ts tests (lines 552-630). The new behavior inside `closeProfile` is covered by the host.spec.ts tests, as the criteria allow ("unit test in handlers.spec.ts or host.spec.ts").
- Evidence: `tasks.py verify shell-open-close-race` shows both criteria still unverified. The parent worker records this evidence; it is not a finding against the code.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | A reconnect while `conn.close` is still closing has its new shell opens cancelled**
    - File: `packages/backend/src/server/backend.ts:120-125` (with `packages/backend/src/connections/manager.ts:429-450`, `packages/backend/src/shell/host.ts:278-281`)
    - Category: Correctness
    - Problem: `ConnectionManager.close` removes the entry synchronously (`entries.delete`, manager.ts:432). It then awaits the work grace (`CLOSE_CANCEL_GRACE_MS`), the client close, and the tunnel close. The `conn.close` wrapper calls `shells.closeProfile(profileId)` only after all of that has finished. If a `conn.open` of the same profile reaches `connected` during that wait and a `shell.open` starts on the new connection, the late `closeProfile` aborts that open (`CANCELLED` "connection was closed") or closes the new session. The new shell belongs to the new connection, and the old connection's close kills it. Before this task the window only affected sessions that had finished opening; it now also affects opens in flight. The window is narrow: the reconnect has to finish connecting while the old close is still running, and the renderer's `disconnect` awaits `conn.close`.
    - Why it matters: Acceptance criterion 2 ("A shell opened after a reconnect is unaffected") holds when the reconnect follows a finished close, which is what the test covers. It does not hold for a reconnect that overlaps the old close.
    - Suggested fix: Take the snapshot of what to close when the connection entry goes away, not after the close has finished. For example, start `shells.closeProfile(id)` right after the synchronous part of `connClose(...)` has run, and await both. `closeProfile` aborts the opens and takes its session snapshot synchronously, so only the old connection's shells are hit. Alternatively, tag opens and sessions with a connection generation. This changes the order asserted by backend.spec.ts "conn.close also closes the shell sessions of that profile, after the connection", so update that test and add one for the overlapping reconnect. Another option is to record it as an accepted limitation with `tasks.py assume`.

## Review conclusion

No material issues found. The acceptance criteria are implemented and covered by unit tests. CR-1 is a low-priority edge case in the conn.close wiring, for the parent worker to fix or record as an assumption.
