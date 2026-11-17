# Code Review

Date: 2026-11-17

Task: change-streams - M6 (Could): Watch changes

Scope: `git diff e0c5399eb4626056de8746d47a1ed811c95cad96..0fe60e1b00a0bb64e67532689212f93983800e61` (final revision, re-review after fixes), committed changes only

Requirements:
- tasks/change-streams.md acceptance criteria:
  - (1) integration test: insert/update/delete events received in order;
  - (2) a standalone server shows a clear 'needs replica set' message (test).
- Recorded assumptions #1-#3 for change-streams (raw `$changeStream` aggregate without auto-resume; standalone refused via `hello` with `UNSUPPORTED`/`needsReplicaSet`; "open document" = `docs.get` side panel, `updateLookup` default, 1000 events kept)
- SPEC.md M6 "Could" change streams
- docs/ARCHITECTURE.md ("Watch changes" section; `ReadCursor` convention for cursor commands in packages/backend/src/browse/browse.ts)
- AGENTS.md project notes
- Previous review (CR-1, CR-2), reviews/change-streams/fixes.md, reviews/change-streams/tests.md
- mongodb driver 7.9.0 sources in node_modules (`RunCommandCursor`, `AbstractCursor.tryNext`/`fetchBatch`, `GetMoreOperation`), used to check the fix

Git range:
- Branch: main
- HEAD: 0fe60e1b00a0bb64e67532689212f93983800e61
- Base/start: e0c5399eb4626056de8746d47a1ed811c95cad96
- Commits reviewed: 6 (d1e63bcc, 810ef00c, b7c8e438, 90daa343, 8b6b6966, 0fe60e1b); working tree clean

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Verification of the previous findings

- **Previous CR-1 (unpinned getMore/killCursors): fixed.** `streamChanges` now uses `db.runCursorCommand(command, { raw: true })` whenever the database has it (packages/backend/src/admin/watch/watch.ts:118-119). I checked this against the driver source:
  - `RunCommandCursor.getMore` sends its `GetMoreOperation` to `this.server`, the server that answered the aggregate, and the cursor's `close()` sends `killCursors` to that same server.
  - `setMaxTimeMS` sets `getMoreOptions.maxAwaitTimeMS`, and `GetMoreOperation` sends it as `getMore.maxTimeMS` (get_more.ts:77), so each round waits 1 s.
  - The read preference defaults to primary, because no `readPreference` option is passed. This matches the docs.
  - `tryNext` runs one `fetchBatch`. On the first call that is the aggregate, plus a single `getMore` if the first batch is empty. It does not loop over empty batches the way `hasNext` does.
  - The loop condition `isOpenCursor(cursor.id)` prevents a `tryNext` on an exhausted cursor, which would throw `MongoCursorExhaustedError`.

  The integration test at test/integration/change-streams.int.spec.ts:374 confirms all of this on the real fixture: exactly one aggregate, every getMore carries the same cursor id, `maxTimeMS` 1000 and the same address, and exactly one killCursors goes to that address.
- **Previous CR-2 (cursor leaked when cancelled during the aggregate): fixed.** When a round is still in flight, the `finally` block at watch.ts:165-168 defers `close` until that round settles (`round.then(close, close)`). The handlers also absorb a late rejection, so it cannot surface as an unhandled rejection. The fake-only command path kills the cursor from the late reply (watch.ts:192-198). Two integration tests (change-streams.int.spec.ts:336, :354) check through `$currentOp` with `idleCursors` that no cursor is left on the server. The fixer's mutation check shows the second test detects the old behaviour.
- `npx vitest run src/admin/watch` (packages/backend), run during this review: 2 files, 59 tests passed.

## Acceptance criteria

- (1) Met by change-streams.int.spec.ts:174, against the `mongo8rs` fixture through the served RPC path. It checks:
  - the order insert, update, insert, delete;
  - the documentKeys;
  - the updateLookup `fullDocument`;
  - lossless Int32, Double and Long values;
  - non-decreasing clusterTime.
- (2) Met at two levels:
  - Backend: change-streams.int.spec.ts:446 runs against the `mongo8` standalone. It expects `UNSUPPORTED` with `NEEDS_REPLICA_SET_MESSAGE` and detail `needsReplicaSet`.
  - Renderer: watch-view.spec.ts:110 checks that the dedicated notice is shown.
- `python tasks.py verify change-streams` still shows both criteria unrecorded. The parent records them after the review. Not a finding.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Choosing "Watch changes" again for an open watch tab silently restarts the stream, even after Stop**
    - File: `packages/renderer/src/app/watch/watch-view.ts:110-115` (with `packages/renderer/src/app/layout/workspace.service.ts:49`, `packages/renderer/src/app/layout/app-shell.ts:106-116`)
    - Category: Correctness
    - Problem: the sidebar's `openWatch` calls `workspace.open(...)`. For a tab that is already open, `open` replaces it with a new object (`{ ...t, ...tab }`). The shell tracks tabs by id, so it keeps the same `WatchView` and only sets a new `tab` input. `target` is a `computed` that returns a fresh object each time. The constructor `effect` reads `target()` and calls `start()` whenever it changes. As a result, choosing "Watch changes" again for a collection whose watch tab is already open does two things. First, it cancels the running stream and opens a new one. Events committed between the old cursor's last getMore and the new aggregate are never shown. Second, a stream the user stopped with Stop starts again without being asked. No test covers re-opening an existing tab: watch-view.spec.ts sets the `tab` input only once per test, apart from the "no profile" case.
    - Why it matters: the expected behaviour of "select the tab when it is already open" is a no-op. Instead the user loses events and Stop is overridden. The impact is small, because the list is kept and the gap is short.
    - Suggested fix: start only when the watched target really changes. Either compare `profileId`/`db`/`coll` with the last started target, or give `target` an `equal` function that compares those fields. Add a view test that sets an equal `tab` input again and expects no second `admin.watch` call.

## Review conclusion

No material issues found. Both acceptance criteria are implemented and covered by integration tests that ran against the named fixtures. The fixes for the previous CR-1 and CR-2 are correct and complete, and they now follow the `ReadCursor` convention for pinned cursor commands. Renderer state handling is sound:
- old stream callbacks are ignored by subscription identity;
- out-of-order `docs.get` answers are guarded by an AbortController;
- the stream is cancelled when the tab closes.

Rendering goes through Angular interpolation only, with no `innerHTML` or sanitizer bypass. The new CR-1 is optional, low-priority polish.
