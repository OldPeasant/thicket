# Fix Report

Date: 2026-11-17

Task: raw-cmd-read-pref - M2: Raw-command reads follow the profile read preference, writes its write concern

Scope: findings CR-1, CR-3 and CR-4 of `reviews/raw-cmd-read-pref/review.md` (CR-2 excluded by the parent worker, see "Not fixed"). This covers the parent's first attempt in commit 8a4e44f0 and the follow-up in this fixer run (base 277e22ae, task commits 74254089..8a4e44f0 plus the uncommitted spec change below).

## Fixed findings

### CR-3 — `ReadCursor` accepts any `ReadPreferenceLike`, but the driver cursor honours only `ReadPreference` instances

Files changed (commit 8a4e44f0):
- `packages/backend/src/browse/browse.ts`
- `packages/backend/src/docs/query/query.ts`
- `packages/backend/src/browse/read-preference.spec.ts`
- `packages/backend/src/docs/query/read-preference.spec.ts`
- `packages/backend/src/docs/write/read-preference.spec.ts`

Problem:
`Operation` passed the string `'primary'` to `ReadCursor`. The driver cursor silently ignores a read preference that is not a `ReadPreference` instance, so a future non-primary string would have read from the primary on the driver path only.

Fix:
The read preference parameters of `ReadCursor`, `Operation`, `command()`, `killOperations()` and `killCursorId()` are now typed `ReadPreference` (the `ReadPreferenceLike` import is gone from both modules; `grep ReadPreferenceLike packages/backend/src` finds nothing). `primary: true` uses `ReadPreference.primary`. The specs assert the instance. `DbLike.readPreference` was already `ReadPreference`, so no caller needed a conversion. Reviewed in this run: correct and complete.

Validation:
- `npx vitest run packages/backend` — Pass (42 files, 1723 tests)
- `npm run check` (includes `tsc`) — Pass

### CR-4 — Read-option merging and the open-cursor check are duplicated

Files changed (commit 8a4e44f0):
- `packages/backend/src/browse/browse.ts`
- `packages/backend/src/docs/query/query.ts`
- `packages/backend/src/browse/read-preference.spec.ts`

Problem:
`readPreference === undefined ? RAW : { ...RAW, readPreference }` appeared three times, and query.ts `isOpen` duplicated browse.ts `isOpenCursor`.

Fix:
browse.ts exports `rawOptions(readPreference)`, which `readOptions(db)`, `ReadCursor.command` and query.ts `command()` all use. It also exports `isOpenCursor`, and query.ts uses it in place of its local `isOpen`. Unit tests cover `rawOptions` (undefined gives `RAW` itself, explicit preference added, `readOptions` equals `rawOptions(db.readPreference)`) and `isOpenCursor` (undefined, null, 0, `Long.ZERO`, open id). Reviewed in this run: no duplicate is left (`grep "RAW : {" packages/backend/src` finds only `rawOptions`).

Validation:
- `npx vitest run packages/backend` — Pass

### CR-1 — Operation's driver-cursor and write paths have no unit tests; the cancel-in-flight path is untested anywhere

Files changed:
- `test/integration/raw-cmd-read-pref.int.spec.ts` (commit 8a4e44f0)
- `packages/backend/src/docs/query/read-preference.spec.ts` (this run, uncommitted)

Problem:
At the reviewed revision 83dd7248, no test exercised `Operation` with a `runCursorCommand` client, a cancel while `find`/`getMore` is in flight, `write()` options, primary reads, or the `MongoWriteConcernError` reply path. The int cancel test only covered an idle cursor.

Fix:
Each item the review lists is now covered:
- Abort during the first `hasNext()` and during a `getMore`, cursor closed only after the batch settles: covered by the test-writer's unit tests (commit ba871169, after the review range). They are in `docs/query/read-preference.spec.ts`, "Operation cancel with a driver cursor": first batch, getMore, failing getMore, and a primary-read cancel.
- Gap closed in this run: those tests called `op.close()` only after the pending batch had resolved, so a regression that closes the driver cursor from `Operation.close()` during the in-flight batch (the leak the review describes) was only caught indirectly. This run adds `it.each` test "cancel during the %s, close() at once: the cursor is closed only after the batch settles" for the first batch and for a getMore. It calls `op.close()` right after the cancel and asserts that close() has not resolved and the cursor has not been closed while the batch is pending. After the batch resolves, it asserts exactly one `close` and that it is the last call. Mutation check: removing the `this.cursor = undefined` line in `Operation.fetch` makes both new cases fail, as well as the two existing ones. The line was then restored.
- `Operation.write` sending `writeConcern` and no read preference: covered by "run() sends the profile read preference; write() sends none and adds the write concern" and "a cancelled write() looks for the command on the primary" (query spec), and by "insert, update, replace and delete carry writeConcern and no read preference" (write spec).
- Primary reads use `ReadPreference.primary`: "the primary option reads from the primary (run and open)", "countDocuments options" (query spec), and the four "reads that belong to a write go to the primary" tests (write spec).
- A thrown `MongoWriteConcernError` becomes the reply, and `checkReply` turns it into `SERVER_ERROR`: "a MongoWriteConcernError answers its reply" (query spec), and "docs.insert answers SERVER_ERROR 'applied but not acknowledged'" plus the updateMany/deleteMany case (write spec).
- Int test (8a4e44f0) "cancelling while a getMore runs on rs-b kills it and its cursor there": a `$where` sleep filter keeps the getMore running when the abort comes. The test asserts that find, getMore and kills all went to rs-b, and that rs-b's open-cursor count is back to its earlier value. Reviewed: sound.

Validation:
- `npx vitest run packages/backend/src/docs/query/read-preference.spec.ts` — Pass (21 tests)
- `npm run test:int -- raw-cmd-read-pref` — Pass, 7 tests (run by the parent for 8a4e44f0; this run did not change the int test, so it was not run again)

## Not fixed

### CR-2 — `$out` / `$merge` aggregations write without the profile write concern

Status:
Out of scope

Reason:
`packages/backend/src/agg` is outside the task's `touches`. The parent worker recorded the exclusion as an assumption in `tasks/raw-cmd-read-pref.md` (2026-11-17 05:50) so that a human can decide.

## Validation summary

Focused tests:
- `npx vitest run packages/backend/src/docs/query/read-preference.spec.ts` — Pass (21 tests); the new test also fails as intended against the mutated `Operation.fetch`

Full test suite:
- `npx vitest run packages/backend` — Pass (42 files, 1723 tests)
- `npm run check` (eslint --max-warnings 0, prettier --check, type check, unit tests: 81 files / 4270 tests, renderer 100 files / 3254 tests) — Pass

Lint/type-check/build:
- Included in `npm run check` — Pass

`.taskcheck`:
- Pass (it runs `npm run check`, as above)

Remaining unresolved findings:
1 (CR-2, out of scope; covered by an assumption)

## Final status

All validated findings fixed and validation passed.
