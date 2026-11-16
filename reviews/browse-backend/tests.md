# Test Report

Date: 2026-11-16

Task: browse-backend - M1: Databases and collections (db.*, coll.*), round 3 (after fix commit cce0dff for round-2 CR-1)

Scope: task commits 871f3501b68cc5de83bf72feaa534c4b448ebb80..cce0dff2dff4750244bb56c5fd291569cd55ddba on branch `main`: a2f4db9 (implementation), 1280719 (round-1 tests and reports), 1fae938 (round-1 fixes), bbd72ba (round-2 tests and reports), cce0dff (round-3 fix: cursor batches kept as raw bytes with `fieldsAsRaw` and decoded with `promoteValues: false`). The parent supplied the base and commit list. `git merge-base HEAD origin/main` = 871f350 confirms the base. Measured HEAD is cce0dff2dff4750244bb56c5fd291569cd55ddba. The round-3 test changes are uncommitted working-tree changes to two test files.

Requirements:
- `tasks/browse-backend.md` acceptance criteria and recorded assumptions. The 21:54 assumption says cursor documents (coll.list raw, coll.stats raw) are lossless, while db.stats raw comes from a non-cursor reply and may print a whole-number Double as `$numberInt`, which is accepted.
- `reviews/browse-backend/review.md` round-2 CR-1 (raw outputs lost Double types); round-1 CR-2 (`serverCode` must stay numeric)
- SPEC.md (documents cross process boundaries as canonical EJSON) and docs/ARCHITECTURE.md "Conventions" and "Coverage"
- Parent worker instructions for round 3: lossless Double/Int32/Int64 in coll.list raw (incl. view pipelines/validators) and coll.stats raw, getMore nextBatch decoding, error codes still numeric

## Test files changed

- `packages/backend/src/browse/browse.spec.ts` (7 tests added)
- `test/integration/browse.int.spec.ts` (2 tests added, 2 existing tests strengthened, 1 of them renamed: see below)

No existing test was removed, skipped or weakened.

## Tests added or updated

Count: 11 (9 new tests, 2 existing int tests strengthened)

New unit tests (browse.spec `lossless cursor batches given as BSON bytes`). The fake client hands batch documents over as BSON bytes, like the driver does with `fieldsAsRaw`:
- `coll.list raw of a validator keeps Double, Int64 beyond 2^53, Decimal128, regex, Binary, Date and Timestamp`: the validator also covers -0.0, Infinity and MinKey. Parsing raw back with `EJSON.parse` and serializing it gives exactly the original BSON bytes.
- `decodes getMore nextBatch bytes losslessly, like the first batch`: 3 batches (first plus 2 getMore). Every entry keeps `$numberDouble`. getMore is sent with the Long cursor id, and every command carries `fieldsAsRaw` and no `promoteValues`.
- `hides system.buckets.<name> and reads viewOn from byte-decoded entries`
- `decodes a batch document given as a Uint8Array view with a byte offset`: a plain Uint8Array that is not a Buffer.
- `a cursor without a batch array lists nothing (and coll.stats answers NOT_FOUND)`: the `!Array.isArray` arm of `decodeBatch`.
- `coll.stats reads unpromoted Int32/Long/Double sizes from bytes; raw keeps whole-number Doubles`: sums are numbers and raw reproduces the exact bytes.
- `coll.stats over shards in a getMore batch: sums decoded values, raw shards stay lossless`

Integration (`browse.int.spec.ts`, 8.x replica set fixture):
- New: `coll.list pages with getMore past a 16 MB first batch; nextBatch entries keep a lossless raw`. Five collections with ~4 MB validators each force the server to split the answer. A direct probe asserts that the first batch is incomplete and the cursor id is non-zero, and then kills that probe cursor. Every entry's raw keeps `{"$numberDouble":"<i>.0"}`; `big0` holds `Double(0)`, which would print as `$numberInt` if promoted.
- New: `coll.list raw of a validator keeps Double, Int64 beyond 2^53, Decimal128 and regex`, plus Int32.
- Strengthened and renamed: `coll.list pages through more than one batch` is now `coll.list lists 130 collections, each with a lossless raw`. Each collection gets a whole-number Double validator and every raw is checked. The rename corrects a false claim: a probe showed that the 8.2 server answers all 130 entries in the first listCollections batch (130 = 130). The old test never ran getMore against a real server, and the new 16 MB test now covers that path.
- Strengthened: `coll.stats reports count, sizes and indexes` now compares the BSON type of `count`, `size`, `avgObjSize`, `storageSize`, `nindexes` and `totalIndexSize` in raw with an unpromoted direct `$collStats` read. `count` and `nindexes` must also match exactly.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: integration tests for each method against the 8.x replica set fixture | `db.* on the 8.x replica set`, `coll.* on the 8.x replica set` suites (incl. round-3 additions) | `npm run test:int -- browse` (Podman) | Pass (30/30) |
| AC2: drop/rename refused on a read-only profile (int test) | `%s is READ_ONLY on a read-only profile, even confirmed` (5 writes), `reads work on the read-only profile`, `a production profile needs confirmed: true` | `npm run test:int -- browse` | Pass |
| AC3: listing for a user with only `read` on one database | auth-fixture suite (4 tests, own mongo:8.2 `--auth` standalone) | `npm run test:int -- browse` | Pass |
| Round-2 CR-1: coll.list raw lossless (Double/Int32/Int64, view pipelines, validators) | unit: validator round-trip, `decodes batch documents given as bytes ...` (from cce0dff), Uint8Array-view test; int: `coll.list lists collections, views and time series ...` (view pipeline), `coll.list raw of a validator keeps ...`, `coll.list lists 130 collections ...` | `npx vitest run src/browse` (in packages/backend); `npm run test:int -- browse` | Pass |
| Round-2 CR-1: getMore nextBatch decoded losslessly | unit `decodes getMore nextBatch bytes losslessly ...`, `coll.stats over shards in a getMore batch ...`; int `coll.list pages with getMore past a 16 MB first batch ...` (real server getMore) | both above | Pass |
| Round-2 CR-1: coll.stats raw lossless | unit `coll.stats reads unpromoted Int32/Long/Double sizes from bytes ...`, shards test; int `coll.stats reports count, sizes and indexes` (types equal to an unpromoted direct read) | both above | Pass |
| db.stats raw: Int64 kept; whole-number Double may print as Int (accepted assumption) | unit `databaseStats reads unpromoted numerics ...`; int `db.stats counts ...` (`objects` is `$numberLong`) | both above | Pass (lossy whole-number Double is an accepted assumption, not tested as a requirement) |
| Round-1 CR-2 still holds with `fieldsAsRaw`: `serverCode` numeric | unit `asks names only by default ...` and round-3 getMore test (no `promoteValues` in options); int `coll.create ... other options is a SERVER_ERROR` (`{serverCode: 48}`), `a server refusal whose message names "certificates" ...`, rename `NamespaceExists`, auth `the server refuses other databases` (`{serverCode: 13, codeName: 'Unauthorized'}`) | both above | Pass |
| Earlier rounds (CR-1..CR-6, TW-1, CR-3 cancellation, paging, killCursors, buckets filter, sharded summing) | round-1/2 unit and int tests (unchanged) | `npx vitest run --project backend`; `npm run test:int -- browse` | Pass |
| A cancelled write is answered CANCELLED on the wire by `serve()` (recorded assumption) | none; generic RPC behaviour outside the task's files | - | Not testable within this task scope: recorded assumption |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/browse`

Result:

Pass: 2 files, 126 tests (118 before round 3). The first run had 2 failures. The cause was my fixture: a 3-byte Binary with subtype 4 is not a valid UUID, so EJSON.parse refused it. I changed it to subtype 0, and no production behaviour was involved.

Command:

`npm run test:int -- browse` (repo root; Podman/testcontainers, 8.x replica set fixture plus an own mongo 8.2 `--auth` standalone)

Result:

Pass: 1 file, 30 tests, 23.9 s, run on the final, Prettier-formatted snapshot. An earlier run failed on my own probe assertion (`expected 130 to be less than 130`). That run showed the 130-collection test does not page on a real server, and it led to the 16 MB getMore test.

## Full test execution

Command:

`npx vitest run --project backend` (run as part of the coverage command below, all backend specs)

Result:

Pass: 10 files, 380 tests.

Command:

`npm run check` (eslint --max-warnings 0, prettier --check, typecheck of all workspaces, root `vitest run`, renderer `ng test`)

Result:

Pass: lint and Prettier clean; typecheck clean; `vitest run` 44 files / 2684 tests passed; renderer 39 files / 726 tests passed.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` when `package.json` exists, and that command passed on the final snapshot. It was not run separately.

## Bugs found

None. Every round-3 test passes against cce0dff, both with fake clients that send bytes and against the real 8.2 replica set, including getMore past a 16 MB first batch.

Observations for the parent worker. They are not filed as defects:
- The existing int test `coll.list pages through more than one batch` did not do what its name said. The server returns all 130 entries in the first batch, so the real getMore path (`nextBatch` with `fieldsAsRaw`) had no real-server coverage until this round. The test is now renamed, and a real paging test was added.
- Round-2 observations still apply unchanged: MaxTimeMSExpired (50) maps to SERVER_ERROR, not TIMEOUT; `isUnauthorized` has no null guard; any integer `code` counts as a server answer.

## Coverage

Status: verified (backend unit tests; integration-run coverage not measured).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured with tooling. `browse.ts`, `handlers.ts` and `browse/index.ts` were added by this task, so for them whole-file coverage equals changed-line coverage. The round-3 changed lines (`RAW.fieldsAsRaw`, `DECODE`, `decodeBatch` with both arms of the `instanceof Uint8Array` check and the non-array return, and the two `decodeBatch` calls in `runCursor`) are all covered. The other changed lines in `manager.ts`, `backend.ts` and `src/index.ts` are covered, as in round 2.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: browse-backend. The base is 871f3501b68cc5de83bf72feaa534c4b448ebb80 (given by the parent and equal to `git merge-base HEAD origin/main`). Measured HEAD is cce0dff2dff4750244bb56c5fd291569cd55ddba. Task commits are a2f4db9, 1280719, 1fae938, bbd72ba and cce0dff (`git log 871f350..HEAD`). `git diff --stat 871f350 HEAD` lists only browse files, the wiring (`manager.ts`, `backend.ts`, `src/index.ts`), the int test and fixture, and the reviews.
- Source/test snapshot identifier (including uncommitted inputs): sha256 prefixes, identical before and after the coverage run: browse.ts 599c668f4912, handlers.ts 3fd3a8381d1c, browse/index.ts 428176ddba66, connections/manager.ts 31b0a27af9a5, server/backend.ts 98f38447ee2f, src/index.ts b7cd45fddeb1, browse.spec.ts 3176d2213a9b, handlers.spec.ts 4f7fc8a4a128, browse.int.spec.ts 057d2966987b. Uncommitted inputs are only `browse.spec.ts` and `browse.int.spec.ts`.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/browse/browse.ts`, `src/browse/handlers.ts`, `src/browse/index.ts`, `src/connections/manager.ts`, `src/server/backend.ts`, `src/index.ts`. Excluded: `test/integration/fixtures/mongo.ts` and `test/integration/browse.int.spec.ts` (test code). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8 (v8). Command, run in `packages/backend`: `npx vitest run --coverage --coverage.include='src/browse/browse.ts' --coverage.include='src/browse/handlers.ts' --coverage.include='src/browse/index.ts' --coverage.include='src/connections/manager.ts' --coverage.include='src/server/backend.ts' --coverage.include='src/index.ts'`. It ran all backend unit specs (10 files, 380 tests).
- Run start/completion time and exit status: started 2026-11-16 22:00:06 +0100 and took 2.89 s; all tests passed, and the reports were written at 22:00:09.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-summary.json` (sha256 371ea5d37d2587dfba521b2861f8521fc2f0394d00a0226e5b4cc2b2aaad72c9) and `packages/backend/coverage/lcov.info` (sha256 67508075bc4b1d17cb14258f1afaaa22379b8c7c6ef20c6a451746f19a5c3196). Both are git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: Vitest's default `coverage.clean` replaced the directory. The report mtimes (22:00:09) match this run, the summary lists exactly the 6 included files, and the snapshot hashes matched before and after.
- Final run after latest test additions and production fixes: yes. The run measured cce0dff with all round-3 tests in their final, formatted form.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/browse/browse.ts` | 170/170 (100%) | 128/131 (97.71%) | 34/34 (100%) | 140/140 (100%) |
| `packages/backend/src/browse/handlers.ts` | 10/10 (100%) | 4/4 (100%) | 10/10 (100%) | 10/10 (100%) |
| `packages/backend/src/browse/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/backend/src/connections/manager.ts` | 163/165 (98.78%) | 89/90 (98.88%) | 34/36 (94.44%) | 141/142 (99.29%) |
| `packages/backend/src/server/backend.ts` | 29/31 (93.54%) | 9/10 (90%) | 9/11 (81.81%) | 27/27 (100%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| Aggregate (summed counters, the 6 files above) | 373/377 (98.93%) | 230/235 (97.87%) | 87/91 (95.60%) | 319/320 (99.68%) |

The aggregate covers backend unit tests only, and nothing in scope is unmeasured. `browse/index.ts` contains only re-exports and has no counters. The new browse code alone (browse.ts + handlers.ts) is at 180/180 statements, 132/135 branches, 44/44 functions and 150/150 lines.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `browse.ts:218` cond-expr arm `: 0` (listDatabases sort comparator, equal names) | Sort order. Equal names can only occur if the server lists a name twice. | Justified gap: not meaningfully reachable |
| `browse.ts:292` cond-expr arm `: 0` (coll.list sort comparator, equal names) | Sort order. Collection names are unique per database. | Justified gap: not meaningfully reachable |
| `browse.ts:305` cond-expr arm `String(error)` | Message when EJSON.parse throws a non-Error. | Justified gap: defensive code; bson throws Error subclasses |
| `manager.ts:63` default `new MongoClient` factory (2 functions, 1 branch) | Pre-existing code this task did not change; the int tests use the real client | Out of task scope |
| `backend.ts:30` default `log` (2 functions, 1 branch) | Pre-existing code this task did not change | Out of task scope |

## Unable to test

- On the wire, `serve()` answers a cancelled write with CANCELLED. This is generic RPC behaviour outside the task's files and is recorded as an assumption, so follow-up is the parent's decision.
- The int run can't check whether the driver itself honours `fieldsAsRaw` for `nextBatch` separately from the browse code. The 16 MB getMore int test covers the combined behaviour against the real server, which is what the requirement needs.
- Sharded-cluster `$collStats` against a real server: the task names only the 8.x replica set fixture. Fake clients that send bytes cover this, and no follow-up is needed.
- Coverage of the integration run: not measured. `test/integration/vitest.config.ts` has no coverage setup, and changing configuration is outside the test writer's authority.

## Summary

Tests added and all validation passed. No production defects found. Round 3 adds 7 unit tests and 2 int tests, and strengthens 2 int tests for the CR-1 fix. coll.list raw (validators, view pipelines) and coll.stats raw keep Double, Int32, Int64 (incl. values beyond 2^53), Decimal128, regex, Binary, Date and Timestamp exactly. This holds for first and getMore batches, both with fake clients that send bytes and against the real 8.2 replica set, where getMore is forced past a 16 MB first batch. `serverCode` stays numeric. The old "pages through more than one batch" int test turned out not to page on a real server; it is now renamed and backed by a real paging test. `npx vitest run src/browse` (126), the backend project (380), `npm run check` and `npm run test:int -- browse` (30/30) all pass. Task-scoped unit coverage of the new browse code is 100% of statements, functions and lines, with 132/135 branches; the 3 uncovered branches are justified.
