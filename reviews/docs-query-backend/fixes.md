# Fix Report

Date: 2026-11-16

Task: docs-query-backend - M1: Query documents with paging, counts, cancel and slices

Scope: current task. Findings CR-1..CR-7 from `reviews/docs-query-backend/review.md` and TW-1 from `reviews/docs-query-backend/tests.md`. Most fixes were made by an earlier fixer run that was interrupted before it wrote this report; its changes are commit 36d33f5 ("fixes for review findings CR-1..CR-7 and TW-1 (WIP)"). This run checked every finding against that commit's code, added the missing direct unit tests for the core projection classifiers that commit 36d33f5 exported, and ran the validation.

## Fixed findings

### CR-1 — An early cancel left the query running and its cursor open

Files changed:
- `packages/backend/src/docs/query/query.ts` (36d33f5)
- `packages/backend/src/docs/query/query.spec.ts` (36d33f5)
- `test/integration/docs-query.int.spec.ts` (36d33f5)

Problem:
`Operation.cleanUp` probed `currentOp` only once, right after the abort. If the command was not registered on the server yet, nothing was killed. If the reply came after the 4 s wait, its cursor id was lost.

Fix:
`killOperations` now returns how many operations it found. `cleanUp` probes `currentOp` again every 100 ms (`KILL_RETRY_MS`) until it finds the operation, the command settles, or `CANCEL_SETTLE_MS` (4 s) runs out. The cursor of a reply is always killed when the reply arrives (`pending.then(... killCursorId)`). This also covers a reply that comes after the 4 s, which now only limit how long `close()` waits. Checked in this run: the loop stops as soon as the reply settles, so it cannot keep probing after the command finished.

Tests: unit tests "an operation not yet in currentOp is probed again until it shows up, then killed" and "a cursor of a reply arriving after the settle time is still killed", plus the updated probe-count test. Integration test "cancelling right after the docs.find response (op not yet in currentOp) leaves nothing behind": 3 rounds, each checking that `$currentOp` with `idleCursors: true` is empty.

Validation:
- `npm run check` — Pass
- `npm run test:int -- test/integration/docs-query.int.spec.ts` — Pass (35/35)

### CR-2 — With sliceAbove, an inclusion projection of only the large array became `$slice`-only (whole document returned)

Files changed:
- `packages/backend/src/docs/query/query.ts` (36d33f5)
- `packages/core/src/paging/projection.ts` (36d33f5: `isIncluded` and `isInclusion` are now exported)
- `packages/core/src/paging/projection.spec.ts` (this run)
- `packages/backend/src/docs/query/query.spec.ts` (36d33f5)
- `test/integration/docs-query.int.spec.ts` (36d33f5)

Problem:
`{items: 1}` was rewritten to `{items: {$slice: n}}`. MongoDB treats that as an exclusion projection and returns every field. The backend also had its own copy of the projection classifier, which disagreed with core's.

Fix:
For inclusion projections, the backend now uses the `$slice` expression `{$cond: [{$isArray: '$items'}, {$slice: ['$items', n]}, '$items']}`, which keeps the field included. Exclusion projections still use the `$slice` operator. The local classifier was removed, and the backend now uses core's `isInclusion`/`isIncluded`. Top-level field names containing `.` or starting with `$` are skipped, because a projection cannot address them. Ids are matched literally (see CR-6). This run added direct unit tests for the two newly exported core functions: inclusion and exclusion cases, `$slice`/`$meta` alone, the expression form, and `_id` alone.

Tests: unit tests "an inclusion projection of only the large array ... stays an inclusion" (`{"items":1}` and `{"_id":0,"items":1}`) and "an inclusion projection of _id alone includes no array". Integration test "docs.get with sliceAbove keeps the inclusion projection %s" for `{"items":1}`, `{"_id":0,"items":1}` and `{"items":1,"title":1}`. It checks the returned field set, the first 100 items and that the response is under 20 000 bytes. A further integration test covers the exclusion projection case.

Validation:
- `cd packages/core && npx vitest run src/paging/projection.spec.ts` — Pass (16/16)
- `npm run check` — Pass
- `npm run test:int -- test/integration/docs-query.int.spec.ts` — Pass

### CR-3 — conn.close did not end running docs.find streams with CANCELLED

Files changed:
- `packages/backend/src/docs/query/handlers.ts` (36d33f5)
- `packages/backend/src/docs/query/handlers.spec.ts` (36d33f5)
- `test/integration/docs-query.int.spec.ts` (36d33f5)

Problem:
When the connection was closed during a find, the stream failed with whatever error the closed driver client raised.

Fix:
The find producer now catches the failure. If the profile's open client is no longer the one the stream started with (`manager.client()` throws `NOT_CONNECTED` or returns a different client), the producer throws `CANCELLED` ("The connection was closed"). Otherwise the error passes on unchanged. This stays inside the task's area and does not change the `ConnectionManager`.

Tests: unit tests "docs.find ends CANCELLED when conn.close closed its connection meanwhile" and "docs.find passes a failure on unchanged while its connection is open". Integration test "conn.close during a running find ends its stream with CANCELLED".

Validation:
- `npm run check` — Pass
- `npm run test:int -- test/integration/docs-query.int.spec.ts` — Pass

### CR-4 — getSlice returned wrong data for paths through arrays or with numeric components

Files changed:
- `packages/backend/src/docs/query/query.ts` (36d33f5)
- `packages/backend/src/docs/query/query.spec.ts` (36d33f5)
- `test/integration/docs-query.int.spec.ts` (36d33f5)

Problem:
`items.3`, or `a.b` where `a` is an array, were evaluated as aggregation paths and returned another array or an empty result instead of an error.

Fix:
`pathParts` now refuses numeric path components with `INVALID_PARAMS` ("array indexes are not supported"). The aggregation also checks on the server that every parent is a document (`$type` equals `object`). If a parent is not, the call returns `NOT_FOUND` with its own message.

Tests: unit tests for numeric components (`items.3`, `0`, `a.10.b`), for the generated parent checks and for the path-through-array message. Integration test with `obj.inner.list` (works), `lines.items` (NOT_FOUND), `obj.missing.list` (NOT_FOUND), and `lines.0.items` and `matrix.1` (INVALID_PARAMS).

Validation:
- `npm run check` — Pass
- `npm run test:int -- test/integration/docs-query.int.spec.ts` — Pass

### CR-5 — fromEnd and before without a limit buffered the whole result

Files changed:
- `packages/backend/src/docs/query/query.ts` (36d33f5)
- `packages/contract/src/docs.ts` (36d33f5: doc comments only)
- `packages/backend/src/docs/query/query.spec.ts`, `packages/backend/src/docs/query/handlers.spec.ts` (36d33f5)
- `test/integration/docs-query.int.spec.ts` (36d33f5)

Problem:
A backward read without a limit kept every row in memory before sending anything.

Fix:
`buildFind` refuses `before`/`fromEnd` without a `limit` > 0 with `INVALID_PARAMS` ("before and fromEnd need a limit (the page size)"), and the contract's doc comments say so. Existing tests that used `before`/`fromEnd` without a limit for other checks now pass a limit. Their assertions were not weakened. The renderer does not call `docs.find` with `before`/`fromEnd` yet (grep found no uses), so no caller breaks.

Tests: unit tests "refuses before/fromEnd without limit / with limit 0" and "after needs no limit". Integration test "refuses before and fromEnd without a limit".

Validation:
- `npm run check` — Pass
- `npm run test:int -- test/integration/docs-query.int.spec.ts` — Pass

### CR-6 — docs.get and docs.getSlice matched the id with implicit equality

Files changed:
- `packages/backend/src/docs/query/query.ts` (36d33f5)
- `packages/backend/src/docs/query/query.spec.ts` (36d33f5)
- `test/integration/docs-query.int.spec.ts` (36d33f5)

Problem:
An id such as `{"$ne":null}` was treated as a query operator.

Fix:
All three filters now use `idFilter(id)`, which builds `{_id: {$eq: id}}`: the size aggregation of `docs.get`, the `find` of `docs.get`, and the `$match` of `docs.getSlice`.

Tests: unit test "matches the id literally, also when it looks like a query operator" and updated filter expectations. Integration test "docs.get and getSlice match an operator-looking id literally": it returns `null` or `NOT_FOUND` instead of an arbitrary document.

Validation:
- `npm run check` — Pass
- `npm run test:int -- test/integration/docs-query.int.spec.ts` — Pass

### CR-7 / TW-1 — Streams still sent events after serve() was stopped

Files changed:
- `packages/backend/src/server/rpc.ts` (36d33f5)
- `packages/backend/src/server/rpc.spec.ts` (36d33f5 added the grace-timer test; the TW-1 test by the test-writer is unchanged)
- `docs/ARCHITECTURE.md` (36d33f5)

Problem:
`stop()` aborted running streams, but their `finish` still sent on the port when the producer settled or when the cancel grace timer fired.

Fix:
Each running stream now has `cancel()`, which aborts and starts the grace timer once, and `drop()`, which aborts and marks the stream over without sending anything. `stop()` calls `drop()` on every stream. Marking a stream over also clears its grace timer.

Tests: the test-writer's TW-1 test "stop() stops sending stream events, also when the producer settles later" passes unchanged. New test "stop() after a cancel clears the grace timer: no CANCELLED is sent later".

Validation:
- `npm run check` — Pass (the TW-1 test is included)

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/core && npx vitest run src/paging/projection.spec.ts` — Pass (16 tests)

Full test suite:
- `npm run check` (lint, type check, `vitest run`, renderer `ng test`) — Pass: root vitest 46 files and 2822 tests passed; renderer 44 files and 831 tests passed.
- `npm run test:int -- test/integration/docs-query.int.spec.ts` (replica-set container) — Pass: 1 file, 35 tests, about 12 s.

Lint/type-check/build:
- Included in `npm run check` (eslint, `tsc`, `ngc`) — Pass

`.taskcheck`:
- Not run separately. It runs `npm run check`, which passed (see above).

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
