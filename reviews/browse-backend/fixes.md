# Fix Report

Date: 2026-11-16

Task: browse-backend - M1: Databases and collections (db.*, coll.*)

Scope: current task. Findings CR-1 to CR-6 from `reviews/browse-backend/review.md` and TW-1 from `reviews/browse-backend/tests.md`, all approved for fixing by the parent worker. The code was base d61f0bc2c23cb4e70d20ea8ce55abb5784358fcb, HEAD b620141. The changes are uncommitted working-tree changes to `packages/backend/src/browse/{browse,handlers}.ts`, their specs, and `test/integration/browse.int.spec.ts`.

## Fixed findings

### CR-1 — Server errors whose message mentions certificate/SSL/TLS/handshake/"timed out" were classified as TLS_ERROR or TIMEOUT

Files changed:
- `packages/backend/src/browse/browse.ts`
- `packages/backend/src/browse/browse.spec.ts`

Problem:
`toBrowseError` sent every error except NamespaceNotFound to `toConnectError`. That function classifies errors by matching their message text, so a server reply such as "Collection shop.certificates already exists" was answered as TLS_ERROR.

Fix:
`toBrowseError` now checks for a server reply first. An error counts as a server reply when its name is `MongoServerError`, it has a string `codeName`, or it has an integer code (read with `toNumber`). A server reply becomes NOT_FOUND for NamespaceNotFound (26) and SERVER_ERROR with detail `{serverCode, codeName}` otherwise. Its message text is never classified. Messages are masked with `redact`. Only errors without a server reply (network, timeout, server selection) still go to `toConnectError`. New unit tests cover server messages that contain "certificates", "TLS", "timed out", and "SSL handshake ... authentication failed". All of them now yield SERVER_ERROR with the full detail and the prefix "The server refused the command". Another test checks that connection strings are masked in SERVER_ERROR and NOT_FOUND messages.

Validation:
- `cd packages/backend && npx vitest run src/browse src/server/backend.spec.ts` — Pass (110 tests)

### CR-2 — RAW read options turned `MongoServerError.code` into an Int32 object

Files changed:
- `packages/backend/src/browse/browse.ts`
- `packages/backend/src/browse/browse.spec.ts`
- `test/integration/browse.int.spec.ts`

Problem:
`promoteValues: false` also applies to the error documents the driver builds. As a result, `error.code` became `Int32(26)` instead of a number, `serverCode` was never reported, and the driver's own numeric error checks did not work.

Fix:
`RAW` is now `{ promoteLongs: false, promoteBuffers: false, bsonRegExp: true }`. Int64 values stay `Long`, so `raw` stays lossless and cursor ids stay Long for getMore. Int32 and Double values now become JS numbers, so a `raw` Double with an integer value is written as `$numberInt`. Error codes are read with `toNumber` in both `toBrowseError` and `isUnauthorized`. The unit tests that expected `promoteValues: false` were updated, and one now checks that it is not set. Another new test reads codes given as Int32 or Long. The int tests for NamespaceExists and Unauthorized now require `detail` to equal `{ serverCode: 48 | 13, codeName }` on the real server. The int test that expects `raw.objects` as `$numberLong` still passes unchanged.

Validation:
- `npm run test:int -- browse` (Podman) — Pass (26/26)

### CR-3 — Cancelling a write answered CANCELLED while the write still ran to completion

Files changed:
- `packages/backend/src/browse/handlers.ts`
- `packages/backend/src/browse/handlers.spec.ts`

Problem:
db.create, db.drop, coll.create, coll.drop and coll.rename were wrapped in `abortable`. Their handlers rejected with CANCELLED as soon as the request was cancelled, even though the command kept running at the server.

Fix:
The write handlers no longer use `abortable`. They ignore the signal, wait for the server's reply and return it (a result or a mapped error). The handler comment now says that a write, once sent, cannot be cancelled. The reads (db.listDatabases, db.stats, coll.list, coll.stats) keep `abortable`. New handler tests cover all five writes: after a cancel, each handler stays pending until the server answers and then resolves `{}`. Another test shows that a cancelled coll.drop still returns the server's NOT_FOUND.

Remaining limitation (outside `packages/backend/src/browse`, for the parent worker to decide): `serve()` in `packages/backend/src/server/rpc.ts` (lines 118-131) answers every cancelled request id with CANCELLED itself and drops the handler's later result. So on the wire, a cancelled write is still answered with CANCELLED. The handler fix removes the browse-level cause. Changing the generic transport behaviour for non-cancellable methods is a cross-cutting contract decision that this report does not make.

Validation:
- `cd packages/backend && npx vitest run src/browse src/server/backend.spec.ts` — Pass

### CR-4 — The listDatabases fallback paths of assumption #3 were untested

Files changed:
- `packages/backend/src/browse/browse.spec.ts` (one test added for CR-5, see below)

Problem:
The paths that add privileged databases, fall back to the privileges when listDatabases is Unauthorized, tolerate a failing connectionStatus, and ignore `db: ""` were not covered.

Fix:
I checked that the test-writer's tests cover this. browse.spec `listDatabases` tests the privilege merge without duplicates, ignores `db: ""`/cluster/anyResource privileges, falls back on Unauthorized (by code and by code name), and keeps the listing when connectionStatus fails. The int test "db.listDatabases adds an authorized database that holds no data yet" runs on the auth fixture. browse.spec also has unit tests for `toBrowseError`, `toNumber`, `parseCreateOptions` and cancellation between batches (killCursors). For CR-5 I added the case where listDatabases is Unauthorized and connectionStatus also fails.

Validation:
- `cd packages/backend && npx vitest run src/browse src/server/backend.spec.ts` — Pass
- `npm run test:int -- browse` — Pass

### CR-5 — listDatabases could answer an empty list instead of the error

Files changed:
- `packages/backend/src/browse/browse.ts`
- `packages/backend/src/browse/browse.spec.ts`

Problem:
When listDatabases was refused (Unauthorized) and connectionStatus also failed, both errors were swallowed and `{ databases: [] }` was returned.

Fix:
`listDatabases` now remembers the refusal. If connectionStatus then fails, it throws the original listDatabases error, mapped by `toBrowseError` (SERVER_ERROR, `{serverCode: 13, codeName: 'Unauthorized'}`). If listDatabases did answer, connectionStatus is still optional and its failure is ignored. A new unit test covers this case.

Validation:
- `cd packages/backend && npx vitest run src/browse src/server/backend.spec.ts` — Pass

### CR-6 — Browse errors reused connect-time message prefixes

Files changed:
- `packages/backend/src/browse/browse.ts`
- `packages/backend/src/browse/browse.spec.ts`

Problem:
Unexpected failures in a browse command were answered as INTERNAL with the prefix "Unexpected error while connecting: ...".

Fix:
Server errors now use the prefix "The server refused the command" (see CR-1). If `toConnectError` classifies an error as INTERNAL, `toBrowseError` answers INTERNAL with the prefix "Unexpected error while browsing" and the masked text. A unit test checks a TypeError and a non-Error value. Network, DNS, TLS and timeout errors without a server reply keep their connection classification, and a unit test checks that a server selection timeout is still TIMEOUT.

Validation:
- `cd packages/backend && npx vitest run src/browse src/server/backend.spec.ts` — Pass

### TW-1 — coll.create accepted EJSON value wrappers as create options

Files changed:
- `packages/backend/src/browse/browse.ts`

Problem:
`parseCreateOptions` accepted any non-array object. `{"$date":...}`, `{"$oid":...}` and `{"$numberInt":...}` were parsed into Date, ObjectId and Int32 objects and passed the check as if they were documents.

Fix:
Only plain documents are accepted now. A parsed value whose prototype is not `Object.prototype` (this also covers arrays and Date) or that has a `_bsontype` is refused with INVALID_PARAMS ("options must be an EJSON document") before any command is sent. The test-writer's 4 failing tests now pass and were not changed.

Validation:
- `cd packages/backend && npx vitest run src/browse src/server/backend.spec.ts` — Pass

## Not fixed

None. CR-3 is fixed in the browse handlers as instructed. The transport-level behaviour of `serve()` described under CR-3 is outside the approved scope and is left for the parent worker to decide.

## Validation summary

Focused tests:
- `cd packages/backend && npx vitest run src/browse src/server/backend.spec.ts` — Pass (3 files, 110 tests)
- `npx eslint packages/backend/src/browse test/integration/browse.int.spec.ts` — Pass
- `npx prettier --check packages/backend/src/browse test/integration/browse.int.spec.ts` — Pass

Full test suite:
- `npx vitest run --project backend` — Pass (10 files, 338 tests)
- `npm run test:int -- browse` (Podman, 8.x replica set fixture plus mongo 8.2 `--auth` standalone) — Pass (1 file, 26 tests), run both before and after the int-test `serverCode` assertions were added

Lint/type-check/build:
- `npm run check` — Pass (lint, typecheck, root `vitest run` 44 files / 2624 tests, renderer `ng test` 32 files / 571 tests)

`.taskcheck`:
- Not run separately. It runs `npm run check`, which passed.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
