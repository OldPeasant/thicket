# Test Report

Date: 2026-11-16

Task: docs-write-backend (M1: Document writes with conflict detection)

Scope: `git diff d29db11c6147eeaeaeda9106d38fc1b64bba115d..766333ad5acf3243eed74cedd4d5c407e5fc3fa3` on branch `main` (base and task commits supplied by the parent worker; the 4 commits after d29db11 are all `docs-write-backend:` commits). Plus the uncommitted test files listed below.

Requirements:
- `tasks/docs-write-backend.md` acceptance criteria and recorded assumptions (delete of a gone document answers `deleted:false`; `expectedCount` refuses only when more documents match; non-operator update / `$`-keys in replacement are INVALID_PARAMS; insert generates ObjectId `_id`s; write errors map to SERVER_ERROR with serverCode/codeName)
- `SPEC.md` ("Editing and saving", bulk updateMany/deleteMany preview, `docs.*` method table)
- `docs/ARCHITECTURE.md` ("Coverage"), `docs/QUALITY.md`, `AGENTS.md`
- Parent instructions (unit specs with a fake `ClientLike`, following `packages/backend/src/docs/query/query.spec.ts`)

## Test files changed

- `packages/backend/src/docs/write/write.spec.ts` (new)
- `packages/backend/src/docs/write/handlers.spec.ts` (new)
- `packages/backend/src/server/backend.spec.ts` (tests added; nothing removed or weakened)

`test/integration/docs-write.int.spec.ts` was reviewed against the acceptance criteria and left unchanged: it already covers every criterion (see below); the remaining gaps (per-method guard on production profiles) are covered by the new `backend.spec.ts` tests through the real `startBackend` wiring.

## Tests added or updated

Count: 90 (write.spec.ts 66, handlers.spec.ts 17, backend.spec.ts 7)

What they cover:
- insert: ObjectId `_id` generated as first field when missing, given `_id` kept, canonical EJSON ids returned, BSON types kept (Long), distinct generated ids, `ordered` default true / false passed through, writeErrors to SERVER_ERROR with serverCode/codeName and "n of m documents inserted" message (singular/plural, "and N more write errors"), write error without details, writeConcernError (with and without details), invalid document INVALID_PARAMS with nothing sent, server command rejection to SERVER_ERROR, pre-aborted signal CANCELLED with nothing sent.
- update: `$and` of `{_id:{$eq:id}}` and expected values, `multi:false`/`upsert:false`, empty expected matches by `_id` alone, operator-like id matched literally, matched-but-unchanged gives `modified:false`, matched 0 gives CONFLICT with canonical current document (and the exact `find` sent) or `current:null` when gone, non-operator / mixed / empty / pipeline update INVALID_PARAMS with nothing sent, invalid id/expected INVALID_PARAMS, writeErrors to SERVER_ERROR without a conflict lookup, writeConcernError.
- replace: by `_id` without expected, `$and` with expected, CONFLICT with current or null, `$`-prefixed top-level keys INVALID_PARAMS (listing the keys) with nothing sent, writeErrors.
- delete: `limit:1` by `_id`, `$and` with expected, `deleted:false` without lookup (no / empty expected), `deleted:false` when already gone with expected, CONFLICT with current when the document exists with other values, writeErrors (no lookup), writeConcernError, invalid expected.
- previewMany: count then sample with default size 20 (`limit`/`batchSize`/`singleBatch`), sampleSize/collation/maxTimeMS passed to count and sample, no sample query when nothing matches, invalid filter/collation INVALID_PARAMS.
- updateMany: multi update statement, pipeline and collation, INVALID_PARAMS for empty pipeline, string/number/array/null stages, non-operator and empty update (nothing sent, also not the count), no count without expectedCount, runs when now equal/fewer, CONFLICT (nothing written) when more match, count uses same filter and collation, expectedCount 0, writeErrors message with modified count, writeConcernError.
- deleteMany: `limit:0` statement, collation, CONFLICT when more match, deletes when count still matches, invalid filter, writeErrors with deleted count, writeConcernError, negative/missing `n` counts as 0.
- handlers: exactly the 7 methods, each runs on the profile's open connection, each answers NOT_CONNECTED without a connection (nothing sent), pre-aborted and mid-write cancellation answer CANCELLED.
- startBackend wiring: each of the 6 write methods is served and guarded (READ_ONLY on a read-only profile even when confirmed, CONFIRMATION_REQUIRED unconfirmed on production, reaches the handler when confirmed); `docs.previewMany` is served and not guarded.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: update succeeds; concurrent change gives CONFLICT with server doc; delete; insert returns `_id` (integration) | int: `docs.insert` (2), `docs.update with conflict detection` (5), `docs.replace` (1), `docs.delete` (3); unit: `insertDocuments`, `updateDocument`, `replaceDocument`, `deleteDocument` describes | `npx vitest run --config test/integration/vitest.config.ts docs-write` (Podman containers, mongo 8 replica set fixture); `npx vitest run src/docs/write` in `packages/backend` | Pass (int 20/20; unit pass) |
| AC2: updateMany/deleteMany preview count equals affected count of execute step (integration) | int: `updateMany: the preview count equals the matched and modified count…`, `updateMany with an update pipeline and a collation`, `deleteMany: the preview count equals the deleted count`, `more matches than the confirmed preview count → CONFLICT`; unit: `previewMany`, `updateMany`, `deleteMany` describes | same two commands | Pass |
| AC3: read-only and unconfirmed-production writes refused (integration) | int: `write guard` (4 tests); unit: `backend.spec.ts` `%s is served and guarded…` (6), `docs.previewMany is served and not guarded…` | int command above; `npx vitest run src/server/backend.spec.ts` in `packages/backend` | Pass |
| Assumption: non-operator update / `$`-keys in replacement are INVALID_PARAMS | `refuses an update with %s`, `refuses an empty update and an update pipeline`, `refuses $-prefixed top-level fields…`, int `an update without operators is refused` | unit + int commands | Pass |
| Update pipeline validation (module's documented contract: "every stage of an update pipeline must be a document") | `updateMany > refuses a pipeline stage that is a number (INVALID_PARAMS), sending nothing` | `npx vitest run src/docs/write` | Fail (TW-1) |
| Assumption: write errors / write concern errors give SERVER_ERROR with serverCode/codeName | write error / write concern error tests in every describe; int `a duplicate _id fails with SERVER_ERROR (DuplicateKey)` | unit + int | Pass |
| Assumption: expectedCount refuses only when more match | `runs when the matches now are %s the confirmed count`, `more matches now than confirmed → CONFLICT…`, deleteMany equivalents | unit | Pass |
| Assumption: delete of a gone document answers `deleted:false`, existing-but-changed gives CONFLICT | `deleteDocument` describe; int `docs.delete` | unit + int | Pass |
| Assumption: insert generates ObjectId `_id`s | `generates an ObjectId _id as the first field…`, `generates distinct ids…`; int insert test | unit + int | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/docs/write src/server/backend.spec.ts`

Result:

Fail: 116 passed, 1 failed (`updateMany > refuses a pipeline stage that is a number (INVALID_PARAMS), sending nothing`, production defect TW-1).

Integration: `npx vitest run --config test/integration/vitest.config.ts docs-write` -> Pass, 20/20 (5.9 s).

## Full test execution

Command:

`npm run check` (repo root: lint, type check, unit tests)

Result:

Fail: lint and type check passed; root `vitest run` 2918 passed, 1 failed (the TW-1 test), so the renderer test step after it did not run.

## .taskcheck

Result:

Fail (it runs `npm run check`; fails only on the TW-1 test).

## Bugs found

### Update pipeline with a numeric (or other BSON value) stage is not refused with INVALID_PARAMS

Finding ID:

`TW-1`

Test:

`packages/backend/src/docs/write/write.spec.ts` > `updateMany` > `refuses a pipeline stage that is a number (INVALID_PARAMS), sending nothing`

Production source:

`packages/backend/src/docs/write/write.ts:57-64` (`manyUpdate`)

Requirement:

`manyUpdate` documents and enforces "every stage of an update pipeline must be a document" (INVALID_PARAMS before anything is sent); the task's assumptions make malformed update params INVALID_PARAMS rather than server errors. `parseDocument` in `../query/query.ts` already rejects BSON value wrappers (`_bsontype`, non-plain prototype); `manyUpdate` does not.

Expected behavior:

`docs.updateMany` with `update: '[{"$set":{"a":1}},1]'` rejects with INVALID_PARAMS ("every stage of an update pipeline must be a document") and sends no command.

Actual behavior:

The update is parsed canonically, so `1` becomes a `BSON.Int32` instance; `typeof stage === 'object'` passes the check, and the `update` command is sent to the server with a non-document stage (the server then rejects it, giving SERVER_ERROR instead of INVALID_PARAMS). The same applies to any EJSON value wrapper as a stage (`{"$oid":…}`, `{"$date":…}`, `{"$numberLong":…}`). Strings, arrays and null are correctly refused.

Severity:

Low (the server still refuses the write; no data is changed, but the error code and the "nothing sent" guarantee are wrong).

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: verified (fresh run with exit code 0; test selection excludes only the TW-1 failing test, because Vitest writes no coverage report for a failing run; the full-selection run with the same command exited 1 and produced no report)

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately with a diff intersection; every executable line of every measured file is covered (lines 161/161), so all changed executable lines are covered.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: docs-write-backend; base d29db11c6147eeaeaeda9106d38fc1b64bba115d; HEAD 766333ad5acf3243eed74cedd4d5c407e5fc3fa3; task commits and changed code given by the parent worker and confirmed with `git diff --stat d29db11..766333a`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 766333a plus uncommitted test files, sha256: `write.ts` 0804868a897bb6a4…, `handlers.ts` db6cf16c930db566…, `write/index.ts` 7710ebbb147cda45…, `server/backend.ts` 09c086ec5eb86dc6…, `src/index.ts` 9e0a1a0b9ed7a801…, `write.spec.ts` 3963c9f72a8fadd5…, `handlers.spec.ts` f0fe570d6fb83809…, `backend.spec.ts` 7f87a816bb21dbc1…; hashed before and after the run, unchanged.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/docs/write/write.ts`, `packages/backend/src/docs/write/handlers.ts`, `packages/backend/src/docs/write/index.ts`, `packages/backend/src/server/backend.ts`, `packages/backend/src/index.ts`. Excluded: `docs/ARCHITECTURE.md` (documentation), `test/integration/docs-write.int.spec.ts` (test). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` (v8), Node 24.22.1; in `packages/backend`: `npx vitest run --coverage --coverage.include='src/docs/write/write.ts' --coverage.include='src/docs/write/handlers.ts' --coverage.include='src/docs/write/index.ts' --coverage.include='src/server/backend.ts' --coverage.include='src/index.ts' --testNamePattern='^(?!.*pipeline stage that is a number).*$'`; all backend unit spec files (14 files, 609 passed, 1 deselected). Integration tests are not part of this measurement.
- Run start/completion time and exit status: 2026-11-16 23:49:29 to 23:49:33 +0100, exit 0.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-summary.json` (sha256 315ebc08d40f25c8595629de3cb9b36c0a009118ff2458b8d4e1922d88d4e512), `packages/backend/coverage/lcov.info` (sha256 c4146302356848fa6077b0504d0e059c849a5bce9375c6b2d239901e1f5301a5), git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: report files written 23:49:33 by this run (Vitest cleans the reports directory at start); input hashes identical before and after.
- Final run after latest test additions and production fixes: yes for the latest test additions; no production fixes have been made yet (the TW-1 fix will make this report stale for the fixed revision).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/docs/write/write.ts` | 143/143 (100%) | 100/100 (100%) | 26/26 (100%) | 125/125 (100%) |
| `packages/backend/src/docs/write/handlers.ts` | 8/8 (100%) | N/A | 8/8 (100%) | 8/8 (100%) |
| `packages/backend/src/docs/write/index.ts` | N/A (re-exports only) | N/A | N/A | N/A |
| `packages/backend/src/server/backend.ts` | 29/31 (93.5%) | 9/10 (90%) | 9/11 (81.8%) | 27/27 (100%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| Aggregate (summed counters, all 5 files measured, none missing) | 181/183 (98.9%) | 109/110 (99.1%) | 43/45 (95.6%) | 161/161 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/server/backend.ts:32` (default `log` function and its branch) | Pre-existing code, not changed by this task (no-op logger when none is passed) | Left uncovered: outside task scope, no behavior |
| `packages/backend/src/server/backend.ts:74` (initial no-op `stop`) | Pre-existing code, not changed by this task | Left uncovered: outside task scope; the task's line 57 (`docsWriteHandlers`) is covered by the new wiring tests |

## Unable to test

- Write concern errors and partial unordered-insert failures against a real server: they need a replica set with a member down or a write concern that times out; covered with the fake client only. No follow-up needed for the acceptance criteria.
- Server-side kill of a cancelled write: the unit test checks that the handler answers CANCELLED at once; whether the server operation is killed is the shared `Operation` code (tested in `query.spec.ts`), not this task.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion (TW-1, Low: `manyUpdate` lets BSON value stages such as a number through instead of INVALID_PARAMS; it is the only failing test and makes `npm run check` / `.taskcheck` fail). All acceptance criteria pass in the integration suite (20/20) and in unit tests; task-scoped coverage of `write.ts` and `handlers.ts` is 100% on all metrics.
