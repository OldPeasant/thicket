# Code Review

Date: 2026-11-17

Task: raw-cmd-read-pref - M2: Raw-command reads follow the profile read preference, writes its write concern

Scope: `git diff 277e22ae..e19cc6a2` (the whole task diff up to the final code revision). This is a re-review after fixes. HEAD cc5e0b32 adds only `reviews/` on top of e19cc6a2. There are no uncommitted changes.

Requirements:
- tasks/raw-cmd-read-pref.md: acceptance criteria and the five recorded assumptions
- SPEC.md M2 "Read preference and write concern per profile"
- docs/ARCHITECTURE.md "Connections" (updated by this task)
- AGENTS.md (Evidence, quality gate)
- Previous review (83dd7248), reviews/raw-cmd-read-pref/fixes.md and tests.md

Git range:
- Branch: main
- HEAD: cc5e0b325a045dfbe4bcafe2dd6971a2e18bbbed (final code revision e19cc6a2284d5295270c3dfeb648d8dcc22e05fc)
- Base/start: 277e22aee71aac1d9ff5d214ba4be544ed50782c
- Commits reviewed: 8 (74254089, 34048f9c, dcac112a, 13d39f13, ba871169, 8a4e44f0, e19cc6a2, cc5e0b32)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Status of earlier findings

- **CR-1 (P2, missing tests for Operation's driver cursor, write and cancel paths): resolved.**
  `packages/backend/src/docs/query/read-preference.spec.ts` now covers these cases:
  - `run()` vs `write()` options and body;
  - primary reads;
  - one driver cursor across open/more;
  - cancel during the first batch and during a getMore;
  - `close()` called at once while the batch is still pending, with the cursor closed only after it settles (`it.each` at line 350);
  - a failing getMore after a cancel;
  - `killOperations` with the read preference;
  - `MongoWriteConcernError` turned into its reply.

  `packages/backend/src/docs/write/read-preference.spec.ts` covers the following:
  - writes carry `writeConcern` and no read preference;
  - preview, expectedCount and conflict reads go to the primary;
  - a write concern error becomes `SERVER_ERROR`.

  The int test now has a cancel that lands while a getMore is running on rs-b (`$where` sleep). It asserts that every command reached rs-b and that no cursor is left open there.
- **CR-2 (P3, `$out` / `$merge` without the write concern): accepted as an assumption.** The task records it as an assumption (2026-11-17 05:50), and `packages/backend/src/agg` is outside the task's `touches`. A human decides.
- **CR-3 (P3, `ReadPreferenceLike` silently ignored by the driver cursor): resolved.** `ReadCursor`, `Operation`, `command()`, `killOperations()` and `killCursorId()` now take `ReadPreference`. `primary: true` uses `ReadPreference.primary`. `ReadPreferenceLike` no longer appears in `packages/backend/src`.
- **CR-4 (P3, duplicated option merging and open-cursor check): resolved.** `rawOptions()` and `isOpenCursor()` are exported once from browse.ts (lines 146 and 170) and used in query.ts. No other copy remains.

## Verified behaviour (no finding)

- **AC1, read preference and cursor pinning.** `Operation.open` and `more` use one `ReadCursor`. On real clients that is `db.runCursorCommand(cmd, { raw: true, readPreference })`, so `getMore` and `killCursors` go to the server that opened the cursor. The int tests check the address of each command:
  - `find` and every `getMore` reach `rs-b:27017`;
  - a cancel after the first batch, and a cancel during a getMore, kill the cursor there;
  - rs-b's `metrics.cursor.open.total` goes back to its earlier value.
- **AC2, write concern.** `Operation.write` sends no read preference (primary) and adds the profile write concern via `withWriteConcern`, mapping `w`, `journal` and `wtimeoutMS` to `w`, `j` and `wtimeout`. `command()` returns the reply of a `MongoWriteConcernError`, and `checkReply` and import report it as `SERVER_ERROR` "applied but not acknowledged". The int test checks `w: 3` end to end (`UnsatisfiableWriteConcern`, the document applied on the primary). It also checks `w: 2` with a `secondary` read.
- **AC3, browse reads.** These reads follow the read preference: `listDatabases`, `dbStats` (`read()`), and `listCollections` and `$collStats` (`runCursor`, which builds a `ReadCursor`). `browse/read-preference.spec.ts` unit-tests them. Commands that change something (`create`, `drop`, `renameCollection`, `collMod`, index commands, `usersInfo`, `connectionStatus`) still use `run` / `runCommand` on the primary, as assumption #2 says.
- **Cancel race.** `Operation.fetch` drops `this.cursor` on cancel, so `close()` never closes a driver cursor while its `hasNext()` is still running. The `guard` `onSettled` callback closes it once the batch has settled. This avoids the driver's session-ended leak. In `browse.runCursor`, the signal is checked only between batches, and `finally` closes an idle cursor.
- **Cancel targeting.** A cancelled read sends `currentOp` / `killOp` with the same read preference, and a cancelled write sends them to the primary. Assumption #1 records the limit when several secondaries are eligible.
- **Other callers.** `agg.ts`, `io/export.ts`, `indexes.ts` (`$indexStats`, shards) and `validator.ts` (`listCollections` entry, the `checkValidator` find) are reads, so following the read preference fits assumption #3. `setValidator` stays on the primary through `runCommand`.
- **Validation run by this review.** `npx vitest run` on the three `read-preference.spec.ts` files and `io/import.spec.ts` gave 4 files, 103 tests passed. The int tests were not re-run here.
- **Evidence.** `tasks.py verify raw-cmd-read-pref` still lists all three criteria as open. No criterion is claimed without evidence. The parent must record the int-test and unit-test runs before `done`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-5 | The `w: 2` int test does not show that the insert carried the write concern**
    - File: `test/integration/raw-cmd-read-pref.int.spec.ts:256`
    - Category: Tests
    - Problem: the test inserts with a `w: 2` profile and then reads from the secondary. On a two-member local replica set, replication usually finishes before the follow-up find. The secondary read would then also see the document if `Operation.write` sent no `writeConcern` at all, so the test cannot tell the difference. The writer's `take` is never checked, unlike the `w: 3` test, whose error message proves the concern was applied.
    - Why it matters: AC2 says "with `w: 2` a secondary read sees the document". The unit tests check the field, but the end-to-end check for `w: 2` is weaker than it looks.
    - Suggested fix: keep the `commandStarted` events from the writer client and assert that the `insert` went to `PRIMARY_HOST` with `command.writeConcern` matching `{ w: 2, wtimeout: 20000 }`. This needs `take` to expose the command, or a separate filter on the recorded events.

## Review conclusion

No material issues found. All earlier findings are resolved, except CR-2, which is recorded as an assumption for a human to decide. CR-5 is an optional test hardening.
