# Fix Report

Date: 2026-11-17

Task: change-streams - M6 (Could): Watch changes

Scope: current task; findings CR-1 and CR-2 from `reviews/change-streams/review.md`. This run
continues an earlier fixer run that stopped partway, and keeps its uncommitted work.

## Fixed findings

### CR-1 — getMore/killCursors are not pinned to the server that opened the change stream

Files changed:
- `packages/backend/src/admin/watch/watch.ts`
- `packages/backend/src/connections/manager.ts`
- `packages/backend/src/admin/watch/watch.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
`streamChanges` sent the `aggregate`, each `getMore` and the `killCursors` as separate
`db.command` calls, and the driver chose a server for each call again. On a sharded cluster with
several mongos, or in load-balanced mode, a `getMore` could reach a different server and fail with
CursorNotFound.

Fix:
When the database has `runCursorCommand` (the real driver always has it), the stream now runs as
one raw driver cursor (`runCursorCommand(command, { raw: true })`). The cursor gets
`setMaxTimeMS(WATCH_AWAIT_MS)`. Each round is one `tryNext` plus `readBufferedDocuments`, and the
code checks for an abort between rounds. It ends with `cursor.close()`. The driver pins the cursor,
so every `getMore` and the `killCursors` go to the server that opened it, as `ReadCursor` already
does. `CursorLike` gains the optional `tryNext` and `setMaxTimeMS`. The plain-command path is still
there for unit-test fakes that have no `runCursorCommand`. `docs/ARCHITECTURE.md` "Watch changes"
now describes the cursor.

Validation:
- `cd packages/backend && npx vitest run src/admin/watch` — Pass (57 tests). The new
  "streamChanges with a driver cursor" suite checks that the stream opens exactly one
  `runCursorCommand` with `{ raw: true }`, sends no separate commands, and makes only
  `setMaxTimeMS`/`tryNext`/`close` calls.
- `npx vitest run --config test/integration/vitest.config.ts test/integration/change-streams.int.spec.ts`
  (mongo8rs/mongo8 fixtures, Podman) — Pass (9/9). The tests cover order, types, invalidate and
  standalone against the real driver cursor path.

### CR-2 — Cancel while the opening aggregate is in flight leaves the server-side cursor open

Files changed:
- `packages/backend/src/admin/watch/watch.ts`
- `packages/backend/src/admin/watch/watch.spec.ts`
- `test/integration/change-streams.int.spec.ts`

Problem:
A cancel before the `aggregate` answered returned `CANCELLED` but never killed the cursor that the
aggregate then opened on the server. The cursor stayed until the idle-cursor timeout. The earlier
fixer's driver-cursor version still had the same leak: its `finally` called `void close()` at
once, and the driver does not kill a cursor that is closed during its first command.

Fix:
In `streamWithCursor` the `finally` now runs `void round.then(close, close)` when a round is still
in flight. The cancel still answers `CANCELLED` at once. The cursor is closed once the abandoned
round settles: after the aggregate for an opening cursor, or after at most 1 s for a `getMore`. On
the fake-only command path, a cancelled opening `aggregate` kills the cursor id from its late reply
in the background.

Validation:
- `cd packages/backend && npx vitest run src/admin/watch` — Pass. Before this fix, 2 tests failed:
  "cancel while a getMore waits ... closes the cursor after that round" and "a cancel while the
  opening aggregate is in flight closes the cursor once it opened".
- New integration tests in `test/integration/change-streams.int.spec.ts`, in the describe block
  "streamChanges cursor cleanup on a replica set". They use a real `MongoClient` on `mongo8rs` and a
  dedicated collection. A `$currentOp` with `idleCursors` matches every cursor on that namespace,
  idle or inside a running getMore. The tests cover:
  - cancel while a getMore waits: first confirms that exactly 1 server cursor exists, then that 0
    remain after the cancel;
  - cancel while the aggregate is in flight: aborts inside the `commandStarted` event for
    `aggregate`, so the timing is deterministic, repeats this 3 times, then expects 0 cursors left.
  Both poll for up to 10 s and pass.
- Mutation check: I put back `if (round) void close();` and ran the integration spec. The
  aggregate-in-flight test failed with "cursors left: [idleCursor ... killed_...]". With the fix
  restored it passed again. The spec passed in 3 runs in a row with the fix.

The temporary scratch test `test/integration/zz-scratch-watch-kill.int.spec.ts` from the earlier
run is deleted. Its useful assertions are now in the committed integration spec, in the more robust
form described above.

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/backend && npx vitest run src/admin/watch` — Pass (2 files, 57 tests)
- `npx vitest run --config test/integration/vitest.config.ts test/integration/change-streams.int.spec.ts` — Pass (9/9, 3 consecutive runs)
- `npx prettier --check` on the changed files — Pass

Full test suite:
- `npm run check` (repo root: lint, type check, backend and renderer unit tests) — Pass (exit 0;
  backend 94 files / 4913 tests, renderer 113 files / 3779 tests)

Lint/type-check/build:
- Part of `npm run check` — Pass

`.taskcheck`:
- Not run directly (the sandbox asked for approval). It runs `npm run check`, which passed.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
