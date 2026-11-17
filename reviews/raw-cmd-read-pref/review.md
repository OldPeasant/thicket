# Code Review

Date: 2026-11-17

Task: raw-cmd-read-pref - M2: Raw-command reads follow the profile read preference, writes its write concern

Scope: `git diff 87a98f10..83dd7248` (committed changes only; later test-writer commits excluded)

Requirements:
- tasks/raw-cmd-read-pref.md acceptance criteria and recorded assumptions #1-#4
- SPEC.md M2 "Read preference and write concern per profile"
- docs/ARCHITECTURE.md "Connections"
- AGENTS.md (Evidence, quality gate), docs/QUALITY.md
- mongodb driver 7.9.0 source (node_modules/mongodb/src: cursor/abstract_cursor.ts, cursor/run_command_cursor.ts, sdam/server.ts, write_concern.ts, error.ts, db.ts) to check cursor and write-concern semantics

Git range:
- Branch: main
- HEAD: 83dd7248
- Base/start: 87a98f10781c7633bad5346c9cc76e76ceb8bb68
- Commits reviewed: 4 (4fa0d8dc, 93dcba8b, e2e70cf4, 83dd7248)

Summary: 0 P0, 0 P1, 1 P2, 3 P3

## Verified behaviour (no finding)

- Driver cursor usage: `db.runCursorCommand(cmd, { raw: true, readPreference })` selects the server
  once (`RunCommandCursor._initialize` records `operation.server`), and `getMore` / `killCursors`
  go to that `selectedServer`. With `raw: true`, `CursorResponse.shift` returns document bytes,
  which `decodeBatch` decodes losslessly. `setComment` / `setBatchSize` feed `getMoreOptions`;
  they are not the `batchSize()` / `maxTimeMS()` overrides that throw `MongoCursorInUseError`.
- Batch semantics: `hasNext()` initializes the cursor or runs one `getMore`, looping only while
  a batch is empty and the cursor is open. `readBufferedDocuments()` then drains exactly that
  batch. `cursor.id` becomes `Long.ZERO` when the cursor is exhausted or cleaned up, so
  `ReadCursor.hasMore` is correct.
- close() race: closing a driver cursor while `cursorInit` is in flight would leak it on the
  server. `cleanup` ends the session before the id is known, and the later `isDead` cleanup
  skips the kill because `session.hasEnded` (abstract_cursor.ts:850, 936-943). The
  implementation avoids this. `Operation.fetch` clears `this.cursor` on cancel
  (query.ts:304), and the cursor is closed only from `guard`'s `onSettled`, after `hasNext()`
  settled (query.ts:301). `runCursor` checks the signal only between batches.
- Read/write routing: `Operation.write` sends no read preference (primary) and the command's
  `writeConcern` field. Reads that belong to a write use `primary: true`, and schema, index
  and user commands keep using `runCommand` (primary, no write concern), as assumption #2
  says.
- Write concern mapping: `w`, `journal` and `wtimeoutMS` map to `w`, `j` and `wtimeout`. This
  matches `WriteConcern.apply` in the driver. `Db.writeConcern` / `Db.readPreference` inherit
  the client options (db.ts:166-173, 205-219).
- MongoWriteConcernError: `Server.command` throws it only for `ok: 1` replies, because
  `ok: 0` throws `MongoServerError` first. `error.result` is the full reply, so
  `checkReply` / import's check report `SERVER_ERROR` "applied but not acknowledged" with the
  server code. The int test for `w: 3` checks this end to end.
- AC1-AC3 have matching tests: int tests use `commandStarted` addresses and
  `serverStatus.metrics.cursor.open.total` on rs-b, and unit tests in `read-preference.spec.ts`
  cover listDatabases, dbStats, listCollections and $collStats. No criterion is claimed yet
  (`tasks.py verify` lists all three as open), so there is no unsupported evidence to report.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Operation's driver-cursor and write paths have no unit tests; the cancel-in-flight path is untested anywhere**
    - File: `packages/backend/src/docs/query/query.ts:299`
    - Category: Tests
    - Problem: `read-preference.spec.ts` only tests `ReadCursor` and browse functions. No
      test, unit or int, at 83dd7248 covers `Operation` with a client that has
      `runCursorCommand`, which is how every real `MongoClient` runs. The untested behaviour
      includes the following:
      - A cancel while the `find` or `getMore` is in flight. `fetch` clears `this.cursor`,
        and `cleanUp` must call `cursor.close()` only after `hasNext()` settled.
      - `Operation.write` adding `writeConcern` and sending no read preference.
      - `primary: true` reads in write.ts going to the primary.
      - `command()` turning `MongoWriteConcernError` into its reply. Only the int `w: 3`
        insert covers this.

      The int cancel test (`test/integration/raw-cmd-read-pref.int.spec.ts:155`) aborts
      inside the `send` callback. `more()` therefore throws before any `getMore` is sent, and
      `op.close()` kills an idle cursor. It does not exercise the background-cleanup path.
    - Why it matters: this is the path that is sensitive to races. If a later change closes
      the driver cursor directly on cancel, for example from `Operation.close()`, while
      `cursorInit` is in flight, the server cursor leaks silently: the driver ends the session
      first and then skips `killCursors` (abstract_cursor.ts:850, 936-943). No test would
      notice.
    - Suggested fix: add unit tests with a fake `DbLike` that has `runCursorCommand` and a
      `hasNext()` you control: abort during the first `hasNext()` and during a `getMore`, then
      assert that `close` comes only after it settles. Also assert the `write()` command
      options and body (no `readPreference`, `writeConcern` field), that the `PRIMARY` reads
      use `'primary'`, and that a thrown `MongoWriteConcernError` becomes the reply that
      `checkReply` turns into `SERVER_ERROR`.

## P3 Low

- [ ] **CR-2 | `$out` / `$merge` aggregations write without the profile write concern**
    - File: `packages/backend/src/agg/agg.ts:136`
    - Category: Correctness
    - Problem: `streamAggregate` runs every pipeline through `Operation.open`. That includes
      pipelines where `writesTo()` is true. These pipelines get the profile's read preference,
      but the command never gets `withWriteConcern`, so `$out` / `$merge` writes skip the
      profile's `writeConcern`. Assumption #2 lists only docs.* and io.import as document
      writes. Assumption #3 covers the read preference of `$out` / `$merge` but does not
      mention the write concern.
    - Why it matters: SPEC M2 asks for a write concern per profile, and `$merge` writes
      documents. A `w: "majority"` profile would get acknowledgements at the server default.
    - Suggested fix: if `writesTo(pipeline)`, add the profile write concern, for example
      `withWriteConcern(client.db(p.db), built)` or an `Operation` option. Otherwise record
      the exclusion as an explicit assumption so a human can decide.

- [ ] **CR-3 | `ReadCursor` accepts any `ReadPreferenceLike`, but the driver cursor honours only `ReadPreference` instances**
    - File: `packages/backend/src/browse/browse.ts:185`
    - Category: Quality
    - Problem: `AbstractCursor`'s constructor uses `options.readPreference` only when it is
      `instanceof ReadPreference`. Anything else silently becomes primary
      (abstract_cursor.ts:229-232). `Operation` passes the string `'primary'` for
      `primary: true` (query.ts:190). That works only because the fallback is also primary. A
      future caller passing `'secondary'` would silently read from the primary on the
      driver path, while the plain-command path would honour it.
    - Why it matters: the two paths can disagree silently, and unit tests run on the plain
      path.
    - Suggested fix: type the parameter as `ReadPreference` and pass `ReadPreference.primary`,
      or normalise it with `ReadPreference.fromOptions({ readPreference })` before calling
      `runCursorCommand`.

- [ ] **CR-4 | Read-option merging and the open-cursor check are duplicated**
    - File: `packages/backend/src/docs/query/query.ts:97`
    - Category: Quality
    - Problem: `readPreference === undefined ? RAW : { ...RAW, readPreference }` appears three
      times: `readOptions` (browse.ts:146), `ReadCursor.command` (browse.ts:244) and query.ts
      `command()` (query.ts:97). `isOpen` (query.ts:157) duplicates `isOpenCursor`
      (browse.ts:164).
    - Why it matters: the read-routing rule then lives in several places, and a later change,
      for example to read concern, has to be made in each copy.
    - Suggested fix: export one helper from browse.ts that takes an explicit read preference,
      for example `readOptions(db, override?)`, plus one open-cursor predicate, and use them
      in both modules.

## Review conclusion

No material issues found. Nothing blocks completion. CR-1 is a test gap the parent should close, or accept, before `done`. CR-2 needs a fix or an explicit assumption. CR-3 and CR-4 are optional cleanups.
