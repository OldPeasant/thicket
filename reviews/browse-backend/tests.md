# Test Report

Date: 2026-11-16

Task: browse-backend - M1: Databases and collections (db.*, coll.*)

Scope: base d61f0bc2c23cb4e70d20ea8ce55abb5784358fcb .. HEAD 636012ab3e9281201a293278df2433f8b9b67010 on branch `main` (one task commit, 636012a, as given by the parent worker and confirmed with `git log d61f0bc..HEAD`). Test changes in this report are uncommitted working-tree changes on top of 636012a.

Requirements:
- `tasks/browse-backend.md` acceptance criteria and its recorded assumptions (coll.validator.* out of scope)
- SPEC.md section 4, docs/ARCHITECTURE.md ("Coverage", "Conventions": every write path checks read-only in the backend)
- Contract `packages/contract/src/db.ts`, `packages/contract/src/coll.ts`
- Parent worker instructions (unit specs with fake ClientLike objects for the listed logic)

## Test files changed

- `packages/backend/src/browse/browse.spec.ts` (new, 53 tests)
- `packages/backend/src/browse/handlers.spec.ts` (new, 15 tests)
- `packages/backend/src/server/backend.spec.ts` (7 tests added; one fictitious `prod` profile added to its profile map, existing tests unchanged)
- `test/integration/browse.int.spec.ts` (1 test added)

## Tests added or updated

Count: 76

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: integration tests for each method against the 8.x replica set fixture | existing `db.* on the 8.x replica set`, `coll.* on the 8.x replica set` suites (db.create/listDatabases/stats/drop, coll.list/create/stats/rename/drop, paging over 130 collections) | `npm run test:int -- browse` | Pass (26/26) |
| AC2: drop/rename refused on a read-only profile (int test) | existing `%s is READ_ONLY on a read-only profile, even confirmed` (db.create, db.drop, coll.create, coll.drop, coll.rename) | `npm run test:int -- browse` | Pass |
| AC2 (unit, wiring): startBackend registers the browse methods and wraps their writes in the guard | backend.spec `serves the db.* and coll.* browse handlers`, `%s is guarded: READ_ONLY on a read-only profile, CONFIRMATION_REQUIRED on production` (5 writes), `browse reads are not guarded on a read-only profile` | `cd packages/backend && npx vitest run src/browse src/server/backend.spec.ts` | Pass |
| AC3: listing works for a user with only `read` on one database (`authorizedDatabases`) | existing `db.listDatabases lists only the authorized database`, `coll.list, coll.stats and db.stats work on that database`, `the server refuses other databases`; new `db.listDatabases adds an authorized database that holds no data yet` | `npm run test:int -- browse` (own mongo:8.2 `--auth` standalone, per the recorded assumption) | Pass |
| listDatabases: Unauthorized fallback to connectionStatus privileges, privilege merge without duplicates, `db: ""`/cluster/anyResource ignored, failing connectionStatus is best effort, other errors mapped | browse.spec `listDatabases` (8 tests) | focused unit command above | Pass |
| toBrowseError mapping (NamespaceNotFound -> NOT_FOUND by code or codeName, default message, SERVER_ERROR detail, RpcError passthrough, network/internal classification) | browse.spec `toBrowseError` (7 tests) | focused unit command above | Pass |
| toNumber for promoted/unpromoted BSON numerics; size() clamps negative/NaN/missing to 0 | browse.spec `toNumber` (2), `databaseStats answers 0 for missing, negative or non-finite values` | focused unit command above | Pass |
| parseCreateOptions: undefined, canonical types kept, invalid JSON, non-documents | browse.spec `parseCreateOptions` (passing cases) | focused unit command above | Pass |
| parseCreateOptions / coll.create refuse EJSON value wrappers that pass the contract's `{`-check | browse.spec `refuses {"$numberInt":"5"} ...`, `refuses {"$date":...} ...`, `refuses {"$oid":...} ...`, `createCollection does not create a collection from a date given as options` | focused unit command above | Fail (TW-1) |
| getMore paging, cancel between batches -> killCursors + CANCELLED, killCursors failure still CANCELLED, exhausted first batch, missing cursor -> INTERNAL, failing getMore mapped | browse.spec `listCollections` (paging/cancel tests), `collectionStats pages through shards ... kills it on cancel` | focused unit command above | Pass |
| system.buckets filtering only when its time series is listed; view/timeseries/unknown types; viewOn | browse.spec `listCollections` (3 tests) | focused unit command above | Pass |
| Sharded $collStats summing (counts/sizes summed, nindexes max, raw `{shards}`), missing storageStats, empty -> NOT_FOUND | browse.spec `collectionStats` (5 tests) | focused unit command above | Pass |
| createCollection keeps `create` first and ignores `create` in options; rename on admin with full namespaces | browse.spec `coll.create / coll.drop / coll.rename` (passing tests) | focused unit command above | Pass |
| NOT_CONNECTED for every browse handler without an open connection, no command sent; withSizes/dropTarget defaults; params reach the server; cancel answers CANCELLED at once | handlers.spec (15 tests) | focused unit command above | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/browse src/server/backend.spec.ts`

Result:

Fail: 90 passed, 4 failed (all 4 are TW-1, see "Bugs found").

Command:

`npm run test:int -- browse` (Podman, testcontainers, 8.x replica set fixture plus an own mongo 8.2 `--auth` standalone)

Result:

Pass: 1 file, 26 tests passed, 21.7 s.

## Full test execution

Command:

`npm run check` (lint, typecheck, `vitest run` over all workspaces, then renderer tests)

Result:

Fail: lint and typecheck passed (the test step runs only after both); `vitest run`: 44 files, 2604 passed, 4 failed (TW-1). The renderer test step did not run because the preceding step failed.

## .taskcheck

Result:

Fail: `.taskcheck` runs `npm run check` (see above); it fails on the 4 TW-1 tests until the production fix lands. Not run separately.

## Bugs found

### coll.create accepts EJSON value wrappers as create options

Finding ID:

`TW-1`

Test:

`parseCreateOptions > refuses {"$numberInt":"5"} (an EJSON value wrapper, not a document) with INVALID_PARAMS`, `... {"$date":{"$numberLong":"0"}} ...`, `... {"$oid":"0123456789abcdef01234567"} ...`, and `coll.create / coll.drop / coll.rename > createCollection does not create a collection from a date given as options` (all in `packages/backend/src/browse/browse.spec.ts`)

Production source:

`packages/backend/src/browse/browse.ts:241` (`parseCreateOptions`: the `typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)` check)

Requirement:

Contract `coll.create` `options: ejsonDocument('create options')` (EJSON text of a document) and the function's own contract "INVALID_PARAMS when it isn't a document".

Expected behavior:

Options text that EJSON reads as a single BSON value rather than a document is refused with `INVALID_PARAMS` before any command is sent.

Actual behavior:

`BSON.EJSON.parse(text, { relaxed: false })` turns `{"$numberInt":"5"}`, `{"$date":...}`, `{"$oid":...}` into an Int32, Date or ObjectId object, which passes the `typeof === 'object'` check. These texts start with `{`, so they also pass the contract's `ejsonDocument` check and reach the handler. `createCollection` then spreads `Object.entries` of that value: a Date yields no entries, so `coll.create` silently creates the collection without options; an Int32 sends `{create, value: 5}` (server error instead of INVALID_PARAMS); an ObjectId sends `i0..i3` fields. Possible fix (for the fixer): accept only plain documents, e.g. refuse values with a `_bsontype` or a prototype other than `Object.prototype`.

Severity:

Low

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: verified for the unit-test measurement below, with a stated test selection: the run deselects the 4 failing TW-1 tests with `-t` so that the provider writes a report (Vitest writes none when tests fail). The same command without `-t` exited with a failure (4 failed, 318 passed) and wrote no coverage report. Integration-test coverage was not measured (the int config has no coverage setup).

Metric: whole-file coverage of task-changed production files (backend unit tests only).
Changed-line coverage: not measured with tooling. `browse.ts`, `handlers.ts` and `browse/index.ts` were added by this task, so their whole-file numbers are their changed-line numbers. The changed executable lines in `manager.ts` (`export` of `abortable`) and `backend.ts` (`...browseHandlers(connections)`) are inside covered functions and statements.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: browse-backend; base d61f0bc2c23cb4e70d20ea8ce55abb5784358fcb; HEAD 636012ab3e9281201a293278df2433f8b9b67010; task commit 636012a, from the parent worker and `git log d61f0bc..HEAD` / `git diff --stat d61f0bc..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): sha256 prefixes, the same before and after the runs: browse.ts d02d2d6e08c1, handlers.ts aa67d0d4ff0e, browse/index.ts 428176ddba66, server/backend.ts 98f38447ee2f, connections/manager.ts 31b0a27af9a5, browse.spec.ts c47ead42d426, handlers.spec.ts 95fc8504e413, backend.spec.ts 3c8144d687e7, browse.int.spec.ts e2bfb90eaea4.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/browse/browse.ts`, `src/browse/handlers.ts`, `src/browse/index.ts`, `src/connections/manager.ts`, `src/server/backend.ts`, `src/index.ts`. Excluded: `test/integration/fixtures/mongo.ts` and `test/integration/browse.int.spec.ts` (test code). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8 (v8); `npx vitest run --coverage --coverage.clean=true --coverage.include='src/browse/browse.ts' --coverage.include='src/browse/handlers.ts' --coverage.include='src/browse/index.ts' --coverage.include='src/server/backend.ts' --coverage.include='src/connections/manager.ts' --coverage.include='src/index.ts' --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json -t '^(?!.*(EJSON value wrapper|date given as options)).*$'` in `packages/backend`; every backend unit spec except the 4 TW-1 tests (318 passed, 4 skipped).
- Run start/completion time and exit status: started 2026-11-16 21:37:42, 4.33 s; exit 0.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-summary.json` (sha256 27558da60368e23a40c1f30561697b3c5085c41bec86bfbd13b33e3eda87eebf), `packages/backend/coverage/coverage-final.json` (sha256 1b8c6a1f41241351372ac73039a563f8955fa634a5fd9e4df10b2fe29ecfe74f). Both are git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: `coverage/` did not exist before the run (`ls` showed no directory after the failed run), the run used `--coverage.clean=true`, and the snapshot hashes matched before and after.
- Final run after latest test additions and production fixes: yes for the test additions. No production fix has been made yet; once TW-1 is fixed, a fresh run is needed.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/browse/browse.ts` | 135/135 (100%) | 85/88 (96.59%) | 30/30 (100%) | 112/112 (100%) |
| `packages/backend/src/browse/handlers.ts` | 10/10 (100%) | 4/4 (100%) | 10/10 (100%) | 10/10 (100%) |
| `packages/backend/src/browse/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/backend/src/connections/manager.ts` | 163/165 (98.78%) | 89/90 (98.88%) | 34/36 (94.44%) | 141/142 (99.29%) |
| `packages/backend/src/server/backend.ts` | 29/31 (93.54%) | 9/10 (90%) | 9/11 (81.81%) | 27/27 (100%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| Aggregate (summed counters, the 6 files above) | 338/342 (98.83%) | 187/192 (97.39%) | 83/87 (95.40%) | 291/292 (99.65%) |

The aggregate covers backend unit tests only. Nothing in scope is unmeasured; `browse/index.ts` (re-exports only) has no executable counters.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `browse.ts:151` cond-expr arm `: 0` (sort comparator, equal names) | listDatabases sort order; equal names cannot occur after the de-duplication against `known` unless the server lists a name twice | Justified gap: not meaningfully reachable |
| `browse.ts:225` cond-expr arm `: 0` (sort comparator, equal names) | coll.list sort order; collection names are unique per database | Justified gap: not meaningfully reachable |
| `browse.ts:238` cond-expr arm `String(error)` | message when EJSON.parse throws a non-Error | Justified gap: defensive, the bson library throws Error subclasses |
| `manager.ts:63` (default `new MongoClient`), 2 functions | pre-existing code, not changed by this task (real-client path covered by the int tests) | Out of task scope |
| `backend.ts:30` default `log`, 2 functions | pre-existing code, not changed by this task | Out of task scope |

## Unable to test

- Sharded-cluster `$collStats` summing and cancellation against a real server: the task names only the 8.x replica set fixture. Covered with fake clients in unit tests; no follow-up needed for this task.
- Coverage of the integration run: not measured, because `test/integration/vitest.config.ts` has no coverage setup and changing configuration is outside the test writer's authority.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion. All three acceptance criteria pass in the integration run (26/26, including a new test for an authorized database without data). One Low-severity production defect, TW-1 (`coll.create` accepts EJSON value wrappers such as `{"$date":...}` as options), has 4 failing unit tests, so `npm run check` / `.taskcheck` fail until it is fixed.
