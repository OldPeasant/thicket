# Code Review

Date: 2026-11-16

Task: browse-backend - M1: Databases and collections (db.*, coll.*)

Scope: implementation commit 636012a on top of base d61f0bc (`git diff d61f0bc..636012a`): packages/backend/src/browse/{browse,handlers,index}.ts, wiring in packages/backend/src/server/backend.ts and packages/backend/src/index.ts, packages/backend/src/connections/manager.ts (ClientLike.command options, exported abortable), test/integration/fixtures/mongo.ts (`auth` option), test/integration/browse.int.spec.ts. Uncommitted spec files being added concurrently by the test-writer (browse.spec.ts, handlers.spec.ts) are not reviewed. coll.validator.get/set are out of scope (separate `validator` task).

Requirements:
- tasks/browse-backend.md acceptance criteria and recorded assumptions (#1 to #5)
- SPEC.md section 4 (API contract, error codes, canonical EJSON) and section 3 M1 (sidebar tree, stats on demand)
- docs/ARCHITECTURE.md (backend handlers, toConnectError classification, write guard)
- packages/contract/src/db.ts, coll.ts, errors.ts (method params/results, ServerErrorDetail)
- AGENTS.md, docs/QUALITY.md

Git range:
- Branch: main
- HEAD: 636012ab3e9281201a293278df2433f8b9b67010
- Base/start: d61f0bc2c23cb4e70d20ea8ce55abb5784358fcb
- Commits reviewed: 1

Summary: 0 P0, 0 P1, 4 P2, 2 P3

Verification performed by the reviewer: `npm run test:int -- browse` (Podman) -> 1 file, 25 tests passed. Driver behaviour checked against node_modules/mongodb 7.9.0 (lib/cmap/connection.js builds `MongoServerError` from `document.toObject(bsonOptions)`; a BSON round trip with the `RAW` options yields `code: new Int32(26)`, `typeof code === 'object'`).

Acceptance criteria:
- AC1 (int tests for each method against the 8.x replica set): met. db.listDatabases (with and without sizes), db.create, db.drop, db.stats, coll.list (incl. views, time series, more than one batch), coll.create (options, conflict, invalid EJSON), coll.drop (collection and view), coll.rename (incl. dropTarget, NOT_FOUND), coll.stats (incl. NOT_FOUND) all run against mongo8rs through `serve()` with contract validation.
- AC2 (drop/rename refused on a read-only profile): met, for every write method, with and without `confirmed`, and the server state is checked afterwards.
- AC3 (listing for a user with only `read` on one database): met against a dedicated auth standalone (assumption #2). The fallback paths of assumption #3 are not exercised (CR-4).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Server errors whose message mentions certificate/SSL/TLS/handshake/"timed out" are classified as TLS_ERROR or TIMEOUT**
    - File: `packages/backend/src/browse/browse.ts:37` (via `packages/backend/src/connections/errors.ts:92-99` and `:140-150`)
    - Category: Correctness
    - Problem: `toBrowseError` hands every non-NamespaceNotFound driver error to `toConnectError`, whose `classifyCode` checks `isTls`/`isAuth`/`isTimeout` before `SERVER_ERROR`, and those predicates match on the message text (`/certificate|\bSSL\b|\bTLS\b|handshake/i`, `/timed out/i`, `/authentication failed/i`). Server command errors embed user-chosen namespaces, e.g. `NamespaceExists`: "Collection shop.certificates already exists with different options", or `Unauthorized`: "not authorized on ssl to execute command ...". Such a `MongoServerError` is answered as `TLS_ERROR` (no `detail`) instead of `SERVER_ERROR` with `codeName`.
    - Why it matters: the renderer maps codes to explanations (SPEC section 4: stable error codes); a collision on coll.create or a missing privilege on a database named `ssl` would be explained as a TLS handshake failure. The classifier was written for connect-time failures; commands on an established connection are a different situation.
    - Suggested fix: in `toBrowseError`, answer `SERVER_ERROR` (with `serverCode`/`codeName`, masked message) directly when the error is a `MongoServerError` / carries a `codeName`, and only fall back to `toConnectError` for network/selection/timeout errors that have no server code. Add a unit test with a namespace like `certificates`.

- [ ] **CR-2 | RAW read options turn `MongoServerError.code` into an Int32 object: `serverCode` is never reported and numeric code checks silently fail**
    - File: `packages/backend/src/browse/browse.ts:16-21`, `:31`, `:42`, `:67`
    - Category: Integration
    - Problem: the driver builds `MongoServerError` from the response deserialized with the command's BSON options, so with `promoteValues: false` `error.code` is `Int32(26)`, not `26`. Consequences: `e.code === NAMESPACE_NOT_FOUND` and `e.code === UNAUTHORIZED` never match (only the `codeName` fallbacks keep NOT_FOUND and the listDatabases Unauthorized fallback working); `toConnectError` only sets `detail.serverCode` when `typeof e.code === 'number'`, so every browse `SERVER_ERROR` lacks `serverCode` (the int test only asserts `codeName`, which hides this); the driver's own `typeof err.code === 'number'` checks (`isNodeShuttingDownError`, `isRecoveringError`, `isNotWritablePrimaryError` in mongodb/lib/error.js) fall back to message matching or nothing for these commands, so a ShutdownInProgress / InterruptedAtShutdown answer no longer marks the server unknown.
    - Why it matters: `ServerErrorDetail.serverCode` is part of the contract; the identical-looking code paths are dead, which makes the error mapping fragile. Assumption #5 records the RAW option but not this side effect.
    - Suggested fix: normalise the code before classifying (e.g. `toNumber(e.code)` in `toBrowseError`, and pass a detail with the numeric code), or read raw values a different way (keep driver promotion for the command and only preserve types for the `raw` output). Add an assertion on `detail.serverCode` in the NamespaceExists/Unauthorized int tests.

- [ ] **CR-3 | Cancelling a write answers CANCELLED although the write still runs to completion on the server**
    - File: `packages/backend/src/browse/handlers.ts:27-49`
    - Category: Correctness
    - Problem: db.create, db.drop, coll.create, coll.drop and coll.rename are wrapped in `abortable`, which rejects with `CANCELLED` as soon as the signal aborts while the command already sent keeps running (the handler comment says so). The caller is told "The operation was cancelled" for a drop or rename that the server then commits.
    - Why it matters: the CANCELLED contract code means "cancelled by the user"; a renderer that trusts it will show the database/collection as still present (or a rename as not done) after it was dropped/renamed, and may offer a retry that fails with NOT_FOUND. This is the "cancelled write may already have been committed" case.
    - Suggested fix: do not wrap the write handlers in `abortable` (these DDL commands are short and cannot be undone), or wait for the command's outcome and report it; keep `abortable` for the reads.

- [ ] **CR-4 | The listDatabases fallback paths of assumption #3 are untested**
    - File: `packages/backend/src/browse/browse.ts:139-150`; `test/integration/browse.int.spec.ts:425-430`
    - Category: Tests
    - Problem: the reader test only covers a database that already holds data, so the server lists it and the `connectionStatus` addition contributes nothing. Not covered in the commit: a privileged database without data being added, the `Unauthorized` refusal of `listDatabases` falling back to the privileged list, `connectionStatus` failing, and privileges with `db: ""` being ignored. There are no unit tests for `toBrowseError`, `toNumber`, `parseCreateOptions` or `runCursor` cancellation (killCursors) in the reviewed commit.
    - Why it matters: this is the behaviour AC3 is about and the part that is custom logic rather than a plain server command; regressions there would go unnoticed.
    - Suggested fix: in the auth fixture test, grant the reader `read` on a second, empty database and assert it is listed; add unit tests with a fake `ClientLike` for the Unauthorized and connectionStatus-failure paths, error mapping, and the abort-between-batches path. (The test-writer may be adding some of this in the uncommitted spec files.)

## P3 Low

- [ ] **CR-5 | listDatabases can answer an empty list instead of the error**
    - File: `packages/backend/src/browse/browse.ts:139-149`
    - Category: Correctness
    - Problem: when `listDatabases` is refused (Unauthorized) and `connectionStatus` also fails, both errors are swallowed and `{ databases: [] }` is returned.
    - Why it matters: the sidebar would show "no databases" with no hint why; the user cannot distinguish an empty server from a permission or transport problem.
    - Suggested fix: when `listDatabases` was refused, let a `connectionStatus` failure propagate (or rethrow the original Unauthorized error) instead of answering an empty list.

- [ ] **CR-6 | Browse errors reuse connect-time message prefixes**
    - File: `packages/backend/src/browse/browse.ts:37` (prefixes in `packages/backend/src/connections/errors.ts:128-136`)
    - Category: Quality
    - Problem: unexpected failures in a browse command (e.g. a TypeError from a malformed cursor answer at `browse.ts:92-93`) are answered as INTERNAL "Unexpected error while connecting: ...", although the connection is already open.
    - Why it matters: misleading text for users and in logs when diagnosing a browse failure.
    - Suggested fix: give `toBrowseError` its own prefix for INTERNAL/unclassified errors (this falls out naturally from the fix for CR-1).

## Review conclusion

Material issues found; fix before completing the task.

The acceptance criteria are met and the integration tests pass (25/25 reproduced by the reviewer). No security problems found: writes go through `guardWrites` in `startBackend`, test passwords are generated at run time, and no secrets are logged. CR-1 to CR-3 are concrete error-mapping and cancellation defects in the new code that should be fixed or explicitly accepted by the parent worker; CR-4 is a test gap on the custom authorizedDatabases logic.
