# Test Report

Date: 2026-11-16

Task: browse-backend - M1: Databases and collections (db.*, coll.*), round 2 (after fix commit 101d24f)

Scope: task commits on branch `main`, base d61f0bc2c23cb4e70d20ea8ce55abb5784358fcb as given by the parent worker. Main has since been rebased under the task: the task commits are now 97e9b8f (implementation), 593a8d8 (round-1 tests and reports) and d7823d1 (fixes), on top of merge base 3b522e71cce695fbe3ea86387f5ff6ce5a631bfe. Measured HEAD is d7823d107168165b9b5a3dda84598c4aae455140. The fix commit the parent named, 101d24facc5426b495450d4f811d22bceebb0a08, is the pre-rebase version of d7823d1. `git diff 101d24f d7823d1` differs only in `tasks/browse-backend.md` (1 line), so the code under test is the fixed code. The round-2 test changes in this report are uncommitted working-tree changes on top of d7823d1.

Requirements:
- `tasks/browse-backend.md` acceptance criteria and recorded assumptions (coll.validator.* out of scope; a cancelled write may still be answered CANCELLED by `serve()`)
- SPEC.md section 4 (stable error codes), contract `packages/contract/src/errors.ts` (`ServerErrorDetail`), `db.ts`, `coll.ts`
- `reviews/browse-backend/review.md` round-1 findings CR-1..CR-6, `reviews/browse-backend/fixes.md`, and round-1 TW-1
- docs/ARCHITECTURE.md "Coverage"; parent worker instructions for round 2

## Test files changed

- `packages/backend/src/browse/browse.spec.ts` (25 tests added)
- `packages/backend/src/browse/handlers.spec.ts` (9 tests added)
- `test/integration/browse.int.spec.ts` (2 tests added, 1 assertion added to the existing rename test)

No existing test was removed, skipped or weakened.

## Tests added or updated

Count: 37 (36 new tests, 1 existing int test strengthened)

New tests:
- browse.spec `toBrowseError` (10): a server error without a message answers the bare prefix and keeps its detail; an integer code alone counts as a server answer; a MongoServerError without code or code name gives a contract-valid detail; a non-integer or string code alone is not a server answer; every SERVER_ERROR detail validates against `serverErrorDetail.strict()`; a real `MongoWriteConcernError` whose message says "timed out" is SERVER_ERROR; a NamespaceNotFound whose message mentions TLS is still NOT_FOUND; real `MongoNetworkError` / `MongoNetworkTimeoutError` stay NETWORK_ERROR / TIMEOUT; connection strings are masked in INTERNAL browse messages; null/undefined give INTERNAL with the bare browse prefix.
- browse.spec `parseCreateOptions: other EJSON value wrappers (TW-1 follow-up)` (9): `$numberLong`, `$numberDouble`, `$numberDecimal`, `$regularExpression`, `$binary`, `$timestamp`, `$minKey`, `$maxKey` are refused with INVALID_PARAMS; `{}` and documents with EJSON-typed fields are accepted.
- browse.spec `listDatabases` (4): Unauthorized given as an unpromoted Int32 code still falls back (CR-2); Unauthorized plus a network error of connectionStatus answers the refusal (CR-5); a network error of listDatabases is NETWORK_ERROR without asking connectionStatus; an answer without `databases` is INTERNAL with the browse prefix (CR-6).
- browse.spec `coll.create / coll.drop / coll.rename` (2): a NamespaceExists on `shop.certificates` is SERVER_ERROR, not TLS_ERROR (CR-1); create options with EJSON-typed fields are kept.
- handlers.spec (9): each read (db.listDatabases, db.stats, coll.list, coll.stats) answers CANCELLED at once while its command is pending; each write (db.create, db.drop, coll.create, coll.drop, coll.rename) with an already-aborted signal still sends the command and answers its result (CR-3).
- browse.int.spec (2 + 1): coll.create with `{"$date":...}` as options is INVALID_PARAMS and creates nothing on the real server (TW-1); an existing `certificates` collection created again with other options is SERVER_ERROR `{serverCode: 48, codeName: 'NamespaceExists'}` with the "The server refused the command" prefix (CR-1, real server); the existing rename-onto-existing-target test now also asserts `detail = {serverCode: 48, codeName: 'NamespaceExists'}` (CR-2).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: integration tests for each method against the 8.x replica set fixture | `db.* on the 8.x replica set`, `coll.* on the 8.x replica set` suites (incl. the 2 new round-2 tests) | `npm run test:int -- browse` (Podman) | Pass (28/28) |
| AC2: drop/rename refused on a read-only profile (int test) | `%s is READ_ONLY on a read-only profile, even confirmed` (5 writes), `reads work on the read-only profile`, `a production profile needs confirmed: true` | `npm run test:int -- browse` | Pass |
| AC2 (unit, wiring): browse writes guarded in startBackend | backend.spec `%s is guarded: ...`, `browse reads are not guarded ...`, `serves the db.* and coll.* browse handlers` | `npx vitest run --project backend` | Pass |
| AC3: listing for a user with only `read` on one database | auth-fixture tests `db.listDatabases lists only the authorized database`, `... adds an authorized database that holds no data yet`, `coll.list, coll.stats and db.stats work on that database`, `the server refuses other databases (SERVER_ERROR Unauthorized)` | `npm run test:int -- browse` (own mongo:8.2 `--auth` standalone) | Pass |
| CR-1: server replies are never classified by their message text | browse.spec `a server error %i (%s) is SERVER_ERROR whatever its message says` (4), round-2 write-concern, NamespaceNotFound-with-TLS, `createCollection of a name whose message mentions certificates ...`; int `a server refusal whose message names "certificates" ...` | backend unit + `npm run test:int -- browse` | Pass |
| CR-2: numeric `serverCode` despite RAW options; Int32/Long codes read | browse.spec `reads a server code given as a BSON Int32 or Long`, `recognises Unauthorized given as an unpromoted Int32 code`, `asks names only by default ...` (no `promoteValues: false`); int NamespaceExists/Unauthorized/rename `detail` assertions | backend unit + int | Pass |
| CR-3: writes not cancellable once sent; reads cancellable | handlers.spec `%s is not cancellable once sent ...` (5), `%s with a signal already aborted still sends the write ...` (5), `a cancelled write answers the server error ...`, `%s (a read) answers CANCELLED at once ...` (4) | `npx vitest run --project backend` | Pass |
| CR-5: Unauthorized + failing connectionStatus answers the refusal, not `[]` | browse.spec `... connectionStatus fails too, the refusal is answered`, `... connectionStatus has a network error, the refusal is answered`; `a failing connectionStatus does not fail the listing` | `npx vitest run --project backend` | Pass |
| CR-6: browse INTERNAL prefix | browse.spec `unexpected errors are INTERNAL with a browse prefix ...`, `masks connection strings in INTERNAL browse messages`, `null and undefined are INTERNAL ...`, `a listDatabases answer without a databases array is INTERNAL` | `npx vitest run --project backend` | Pass |
| SERVER_ERROR detail matches contract `ServerErrorDetail` | browse.spec `every SERVER_ERROR detail validates against the contract ServerErrorDetail`, `a MongoServerError without code or code name ...` | `npx vitest run --project backend` | Pass |
| TW-1: only plain documents as create options | browse.spec round-1 wrapper tests (4) plus 9 round-2 tests; int `coll.create refuses an EJSON value wrapper as options and creates nothing` | backend unit + int | Pass |
| Paging, killCursors on cancel, system.buckets filtering, sharded $collStats summing, sizes/counts | round-1 browse.spec suites (unchanged) | `npx vitest run --project backend` | Pass |
| A cancelled write is answered CANCELLED on the wire by `serve()` (recorded assumption) | none; this is generic RPC behaviour outside `packages/backend/src/browse` | - | Not testable within this task scope: recorded as an accepted assumption |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/browse`

Result:

Pass: 2 files, 118 tests.

Command:

`npm run test:int -- browse` (Podman, testcontainers, 8.x replica set fixture plus an own mongo 8.2 `--auth` standalone)

Result:

Pass: 1 file, 28 tests, 22.6 s. A run before the int-test additions also passed (26/26).

## Full test execution

Command:

`npx vitest run --project backend`

Result:

Pass: 10 files, 372 tests.

Command:

`npm run check` (eslint + prettier, typecheck of all workspaces, root `vitest run`, renderer `ng test`)

Result:

Pass: lint and Prettier clean; typecheck clean; `vitest run` 44 files / 2676 tests passed; renderer 39 files / 726 tests passed.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` when `package.json` exists, and that command passed (see above). It was not run separately.

## Bugs found

None. No round-2 test fails against the fixed code.

Observations for the parent worker. They are not filed as defects and have no failing tests:
- `MaxTimeMSExpired` (code 50) from a browse command is answered SERVER_ERROR. The contract comment for `TIMEOUT` in `packages/contract/src/errors.ts` says "(server selection, maxTimeMS, ...)". The fixer's unit test asserts SERVER_ERROR for code 50, and before the fix a real server's message ("operation exceeded time limit") was not classified as TIMEOUT either. Browse does not send `maxTimeMS`, but a server-side `defaultMaxTimeMS` (MongoDB 8.0+) could trigger it. The requirement is ambiguous, so the parent should decide whether this needs a mapping.
- `isUnauthorized` (`browse.ts:84-85`) reads `.code` without a null check. If the driver ever rejected listDatabases with `null`/`undefined`, a raw TypeError would escape instead of an RpcError. The driver never does this, so no test was added.
- `serverCodes` treats any error with an integer `code` as a server answer. A DOMException (`AbortError` has code 20) would become SERVER_ERROR. No browse code path produces one today (the driver gets no `signal`), so this is not reachable.

## Coverage

Status: verified (backend unit tests; integration-run coverage not measured).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured with tooling. `browse.ts`, `handlers.ts` and `browse/index.ts` were added by this task, so for them whole-file coverage equals changed-line coverage. The changed lines in `manager.ts` (`export function abortable`, the `ClientLike.command` options type), `backend.ts` (`...browseHandlers(connections)`) and `src/index.ts` (re-export) are all covered.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: browse-backend. The parent gave base d61f0bc2c23cb4e70d20ea8ce55abb5784358fcb; after the rebase the merge base is 3b522e71cce695fbe3ea86387f5ff6ce5a631bfe. Measured HEAD is d7823d107168165b9b5a3dda84598c4aae455140. Task commits are 97e9b8f, 593a8d8 and d7823d1 (`git diff --stat d35a926..HEAD` lists only browse files, the wiring, the int test/fixture, reviews and the task file). They are the rebased 5a9cfcd, 8dfb6f9 and 101d24f, and the code is the same as 101d24f.
- Source/test snapshot identifier (including uncommitted inputs): sha256, identical before and after the runs: browse.ts 5dbb4484e9d1, handlers.ts 3fd3a8381d1c, browse/index.ts 428176ddba66, connections/manager.ts 31b0a27af9a5, server/backend.ts 98f38447ee2f, browse.spec.ts 6ef62d4f94f3, handlers.spec.ts 4f7fc8a4a128, browse.int.spec.ts c8b4846c87a3. Uncommitted: the three test files only. `reviews/browse-backend/review.md` was being modified concurrently by another helper and is not an input.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/browse/browse.ts`, `src/browse/handlers.ts`, `src/browse/index.ts`, `src/connections/manager.ts`, `src/server/backend.ts`, `src/index.ts`. Excluded: `test/integration/fixtures/mongo.ts` and `test/integration/browse.int.spec.ts` (test code). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8 (v8 provider). Command, run in `packages/backend`: `npx vitest run --coverage --coverage.include='src/browse/browse.ts' --coverage.include='src/browse/handlers.ts' --coverage.include='src/browse/index.ts' --coverage.include='src/connections/manager.ts' --coverage.include='src/server/backend.ts' --coverage.include='src/index.ts'`. It ran all backend unit specs (10 files, 372 tests, none deselected). An earlier run limited to the three browse files gave the same per-file numbers.
- Run start/completion time and exit status: started 2026-11-16 21:48:12 +0100, 2.91 s; all tests passed and the report was written at 21:48:15.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-summary.json` (sha256 4ea5fa383bd4396205ec477da7b17947b2747e9f758b5b48400076d14610c48b), `packages/backend/coverage/lcov.info` (sha256 c0e89cbe1e9e54a00953f4048cfa5c58fcc4d9d8f48169fdd2c1baf082927895). Both are git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: Vitest's default `coverage.clean` replaced the directory. The file mtimes (21:48:15) match this run, the summary lists exactly the 6 included files, and the snapshot hashes matched before and after.
- Final run after latest test additions and production fixes: yes. The run measured the final fixed code (d7823d1) with all round-2 tests.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/browse/browse.ts` | 165/165 (100%) | 124/127 (97.63%) | 32/32 (100%) | 136/136 (100%) |
| `packages/backend/src/browse/handlers.ts` | 10/10 (100%) | 4/4 (100%) | 10/10 (100%) | 10/10 (100%) |
| `packages/backend/src/browse/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/backend/src/connections/manager.ts` | 163/165 (98.78%) | 89/90 (98.88%) | 34/36 (94.44%) | 141/142 (99.29%) |
| `packages/backend/src/server/backend.ts` | 29/31 (93.54%) | 9/10 (90%) | 9/11 (81.81%) | 27/27 (100%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| Aggregate (summed counters, the 6 files above) | 368/372 (98.92%) | 226/231 (97.84%) | 85/89 (95.51%) | 315/316 (99.68%) |

The aggregate covers backend unit tests only, and nothing in scope is unmeasured. `browse/index.ts` contains only re-exports and has no executable counters. The new browse code alone (browse.ts + handlers.ts) is at 175/175 statements, 128/131 branches, 42/42 functions and 146/146 lines.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `browse.ts:198` cond-expr arm `: 0` (listDatabases sort comparator, equal names) | Sort order. Equal names cannot occur after de-duplication against `known` unless the server lists a name twice. | Justified gap: not meaningfully reachable |
| `browse.ts:272` cond-expr arm `: 0` (coll.list sort comparator, equal names) | Sort order. Collection names are unique per database. | Justified gap: not meaningfully reachable |
| `browse.ts:285` cond-expr arm `String(error)` | Message when EJSON.parse throws a non-Error. | Justified gap: defensive code; the bson library throws Error subclasses |
| `manager.ts:63` (default `new MongoClient` factory), 2 functions | Pre-existing code that this task did not change. The real-client path is exercised by the int tests. | Out of task scope |
| `backend.ts:30` default `log`, 2 functions | Pre-existing code that this task did not change. | Out of task scope |

All server-error-mapping branches added by the fixes are covered: `serverCodes` (name / codeName / integer code arms, code-only and codeName-only detail), `messageOf` (non-object, non-string message), `toBrowseError` (empty-message arms of NOT_FOUND, SERVER_ERROR and INTERNAL), `isUnauthorized` (code and codeName arms), the CR-5 rethrow and the TW-1 plain-document check (all four arms).

## Unable to test

- On the wire, `serve()` answers a cancelled write with CANCELLED (`packages/backend/src/server/rpc.ts`), even though the browse handlers now wait for the server. This is generic transport behaviour outside the task's touches and is recorded as an assumption. Follow-up is the parent's decision.
- Sharded-cluster `$collStats` summing and cancellation against a real server: the task names only the 8.x replica set fixture. Fake clients cover this in unit tests; no follow-up needed for this task.
- Coverage of the integration run: not measured. `test/integration/vitest.config.ts` has no coverage setup, and changing configuration is outside the test writer's authority.

## Summary

Tests added and all validation passed. Round 2 adds 36 tests and one strengthened assertion for the fix paths: server-error mapping edge cases (CR-1/CR-2/CR-6, contract-valid `detail`), writes that are not abortable and reads that are (CR-3), the CR-5 refusal fallback, and more EJSON value wrappers (TW-1). Two new int tests check CR-1 and TW-1 against the real 8.x replica set. No production defects found. `npx vitest run --project backend` (372), `npm run check` and `npm run test:int -- browse` (28/28) pass. Task-scoped unit coverage of the new browse code is 100% of statements, functions and lines, with 128/131 branches; the 3 uncovered branches are justified. One contract ambiguity (MaxTimeMSExpired -> SERVER_ERROR vs the TIMEOUT comment) is left to the parent worker.
