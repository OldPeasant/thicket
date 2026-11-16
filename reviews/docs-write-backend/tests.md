# Test Report

Date: 2026-11-16

Task: docs-write-backend (M1: Document writes with conflict detection), round 2 (final revision after fixes)

Scope: `git diff 37861d5742a384e7ee1663a4e76509cbb87c0a91..984c6cc463b58ac9f22c6a220e9944689ec6a169` on branch `main` (base and final revision supplied by the parent worker; the 6 commits in the range are all `docs-write-backend:` commits: 54d6f9a, 3fbf6a5, e7231b7, 12eaea9, f52cbe4, 984c6cc). Round 2 focuses on the fix commit 984c6cc (TW-1, CR-1, CR-2, CR-3, see `reviews/docs-write-backend/fixes.md`). No uncommitted source or test changes (the only working-tree change during this run was `reviews/docs-write-backend/review.md`, not written by the test writer and not a test input).

Requirements:
- `tasks/docs-write-backend.md` acceptance criteria and recorded assumptions (delete of a gone document answers `deleted:false`; `expectedCount` refuses only when more documents match; non-operator update / `$`-keys in replacement are INVALID_PARAMS; insert generates ObjectId `_id`s; write errors map to SERVER_ERROR with serverCode/codeName)
- `SPEC.md` ("Editing and saving", bulk updateMany/deleteMany preview, `docs.*` method table)
- `docs/ARCHITECTURE.md` ("Coverage"), `docs/QUALITY.md`, `AGENTS.md`
- Round-1 test report findings and `reviews/docs-write-backend/fixes.md`

## Test files changed

None in round 2. The test files of this task, all committed in the measured revision:

- `packages/backend/src/docs/write/write.spec.ts` (round 1; updated by the fixer in 984c6cc)
- `packages/backend/src/docs/write/handlers.spec.ts` (round 1)
- `packages/backend/src/server/backend.spec.ts` (round 1, tests added only)
- `test/integration/docs-write.int.spec.ts` (implementation commits)

## Tests added or updated

Count: 0 in round 2.

Re-check of the fixer's test changes against the final code:
- TW-1: the round-1 test `updateMany > refuses a pipeline stage that is a number (INVALID_PARAMS), sending nothing` is unchanged and now passes. The fixer added `a pipeline stage that is an ObjectId` to the same table (EJSON value wrapper case named in TW-1). Both new conditions in `manyUpdate` (non-plain prototype, `_bsontype`) are exercised; `write.ts` branch coverage is 102/102.
- CR-2: the five assertions on the write-concern message were changed to the new wording ("the write was applied but not acknowledged by the requested write concern: ..."). They still assert the exact full message, the SERVER_ERROR code and, where they did before, the `serverCode`/`codeName` detail. Nothing was weakened. The "without details" case still checks the `unknown` fallback and the empty detail.
- CR-1 and CR-3: comment and documentation changes only (`write.ts` doc comment, `docs/ARCHITECTURE.md`, `packages/contract/src/docs.ts`, `packages/contract/src/errors.ts`). No behavior changed and the contract schemas are unchanged, so no new test is needed. The detail-less CONFLICT that CR-3 documents is already asserted by the round-1 tests (`updateMany`/`deleteMany` "more matches now than confirmed → CONFLICT", int `more matches than the confirmed preview count → CONFLICT`).

The fixes left no test gap, so no tests were added.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: update succeeds; concurrent change gives CONFLICT with server doc; delete; insert returns `_id` (integration) | int: `docs.insert` (2), `docs.update with conflict detection` (5), `docs.replace` (1), `docs.delete` (3); unit: `insertDocuments`, `updateDocument`, `replaceDocument`, `deleteDocument` describes | `npx vitest run --config test/integration/vitest.config.ts docs-write` (repo root; containers via the project's integration fixture); unit via `npm run check` | Pass (int 20/20; unit pass) |
| AC2: updateMany/deleteMany preview count equals affected count of execute step (integration) | int: `updateMany: the preview count equals the matched and modified count…`, `updateMany with an update pipeline and a collation`, `deleteMany: the preview count equals the deleted count`, `more matches than the confirmed preview count → CONFLICT`; unit: `previewMany`, `updateMany`, `deleteMany` describes | same two commands | Pass |
| AC3: read-only and unconfirmed-production writes refused (integration) | int: `write guard` (4 tests); unit: `backend.spec.ts` `%s is served and guarded…` (6), `docs.previewMany is served and not guarded…` | same two commands | Pass |
| TW-1 fix: every update pipeline stage must be a document (INVALID_PARAMS, nothing sent) | `updateMany > refuses a pipeline stage that is a number / an ObjectId / a string / an array / null (INVALID_PARAMS), sending nothing` | `npm run check`; coverage run below | Pass |
| CR-2 fix: write concern error message says the write was applied but not acknowledged | `a write concern error fails with SERVER_ERROR and its code`, `a write concern error without details still fails with SERVER_ERROR` (insert), `a write concern error → SERVER_ERROR` (update, delete, updateMany) | `npm run check` | Pass |
| CR-1, CR-3: documentation of the best-effort, detail-less bulk CONFLICT | Not testable as documentation; the behavior it documents is covered by the AC2 CONFLICT tests | n/a | Not testable (comments/docs only) |
| Assumption: non-operator update / `$`-keys in replacement are INVALID_PARAMS | `refuses an update with %s`, `refuses an empty update and an update pipeline`, `refuses $-prefixed top-level fields…`, int `an update without operators is refused` | unit + int commands | Pass |
| Assumption: write errors / write concern errors give SERVER_ERROR with serverCode/codeName | write error / write concern error tests in every describe; int `a duplicate _id fails with SERVER_ERROR (DuplicateKey)` | unit + int commands | Pass |
| Assumption: expectedCount refuses only when more match | `runs when the matches now are %s the confirmed count`, `more matches now than confirmed → CONFLICT…`, deleteMany equivalents | `npm run check` | Pass |
| Assumption: delete of a gone document answers `deleted:false`, existing-but-changed gives CONFLICT | `deleteDocument` describe; int `docs.delete` | unit + int commands | Pass |
| Assumption: insert generates ObjectId `_id`s | `generates an ObjectId _id as the first field…`, `generates distinct ids…`; int insert test | unit + int commands | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run --coverage --coverage.include='src/docs/write/write.ts' --coverage.include='src/docs/write/handlers.ts' --coverage.include='src/docs/write/index.ts' --coverage.include='src/server/backend.ts' --coverage.include='src/index.ts'`

Result:

Pass: 14 files, 611 tests passed, 0 failed (all backend unit specs, including `src/docs/write` and `src/server/backend.spec.ts`).

Integration: `npx vitest run --config test/integration/vitest.config.ts docs-write` (repo root) -> Pass, 1 file, 20/20 tests (7.7 s, started 23:56:56).

## Full test execution

Command:

`npm run check` (repo root: lint, type check, unit tests)

Result:

Pass: eslint and prettier clean; tsc for all workspaces and ngc for the renderer clean; root `vitest run` 48 files, 2920 tests passed; renderer `ng test` 52 files, 1224 tests passed.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`, which passed as shown above at revision 984c6cc).

## Bugs found

No new production defects in round 2.

### Update pipeline with a numeric (or other BSON value) stage is not refused with INVALID_PARAMS

Finding ID:

`TW-1`

Status:

Fixed in 984c6cc and verified: the failing round-1 test now passes, a regression case for an ObjectId stage was added by the fixer, and `npm run check` passes.

Test:

`packages/backend/src/docs/write/write.spec.ts` > `updateMany` > `refuses a pipeline stage that is a number (INVALID_PARAMS), sending nothing`

Production source:

`packages/backend/src/docs/write/write.ts:57-70` (`manyUpdate`)

Requirement:

`manyUpdate` refuses with INVALID_PARAMS ("every stage of an update pipeline must be a document") before anything is sent.

Expected behavior:

`docs.updateMany` with `update: '[{"$set":{"a":1}},1]'` rejects with INVALID_PARAMS and sends no command.

Actual behavior:

Round 1: the BSON Int32 stage passed the check and the command was sent. Final revision: refused with INVALID_PARAMS, nothing sent.

Severity:

Low

Fix required:

`No — fixed by the fixer in 984c6cc; no further production change needed.`

## Coverage

Status: verified (fresh run on the final revision, full backend unit selection, exit 0, all tests passed)

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured with a diff intersection; every executable line of every measured file is covered (lines 161/161), so all changed executable lines are covered.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: docs-write-backend; base 37861d5742a384e7ee1663a4e76509cbb87c0a91 (given by the parent, confirmed ancestor of HEAD); HEAD 984c6cc463b58ac9f22c6a220e9944689ec6a169; all 6 commits in `37861d5..984c6cc` are `docs-write-backend:` commits, confirmed with `git log --oneline` and `git diff --stat`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 984c6cc, no uncommitted source or test changes; sha256 of the measured inputs: `write.ts` a21b65eea0f9a308…, `handlers.ts` db6cf16c930db566…, `write/index.ts` 7710ebbb147cda45…, `server/backend.ts` 09c086ec5eb86dc6…, `src/index.ts` 9e0a1a0b9ed7a801…, `write.spec.ts` 8b2b0c21369ed5d2…, `handlers.spec.ts` f0fe570d6fb83809…, `backend.spec.ts` 7f87a816bb21dbc1…; hashed before the coverage run and again after the check and integration runs, unchanged.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/docs/write/write.ts`, `packages/backend/src/docs/write/handlers.ts`, `packages/backend/src/docs/write/index.ts`, `packages/backend/src/server/backend.ts`, `packages/backend/src/index.ts`. Excluded: `packages/contract/src/docs.ts` and `packages/contract/src/errors.ts` (comment-only changes in 984c6cc, no executable change), `docs/ARCHITECTURE.md` (documentation), `reviews/` (reports), spec and integration test files (tests). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` (v8), Node v24.22.1; working directory `packages/backend`; command as in "Focused test execution"; all 14 backend unit spec files, no test deselected. Integration tests are not part of this measurement.
- Run start/completion time and exit status: 2026-11-16 23:55:38 +0100, reports written 23:55:42 +0100; exit 0 (611 passed).
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-summary.json` (sha256 ed21a8d986ce3fa63db15b1db1d2e21c901f15ce25d6f28ea17cfa9e92298b8b), `packages/backend/coverage/lcov.info` (sha256 6b578799a36555aad420a65715002d1f287169be7c26f13664289361f97a20ed), git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: report files written 23:55:42 by this run (Vitest cleans the reports directory at start; the hashes differ from the round-1 reports); input hashes identical before and after.
- Final run after latest test additions and production fixes: yes (revision 984c6cc contains all fixes; no tests were added afterwards).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/docs/write/write.ts` | 143/143 (100%) | 102/102 (100%) | 26/26 (100%) | 125/125 (100%) |
| `packages/backend/src/docs/write/handlers.ts` | 8/8 (100%) | N/A | 8/8 (100%) | 8/8 (100%) |
| `packages/backend/src/docs/write/index.ts` | N/A (re-exports only) | N/A | N/A | N/A |
| `packages/backend/src/server/backend.ts` | 29/31 (93.5%) | 9/10 (90%) | 9/11 (81.8%) | 27/27 (100%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| Aggregate (summed counters, all 5 included files measured, none missing; contract comment-only files excluded) | 181/183 (98.9%) | 111/112 (99.1%) | 43/45 (95.6%) | 161/161 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/server/backend.ts:32` (default `log` function and its branch) | Pre-existing code, not changed by this task (no-op logger when none is passed) | Left uncovered: outside task scope, no behavior |
| `packages/backend/src/server/backend.ts:74` (initial no-op `stop`) | Pre-existing code, not changed by this task | Left uncovered: outside task scope; the task's line 57 (`docsWriteHandlers`) is covered by the wiring tests |

## Unable to test

- Write concern errors and partial unordered-insert failures against a real server: they need a replica set with a member down or a write concern that times out; covered with the fake client only. No follow-up needed for the acceptance criteria.
- Server-side kill of a cancelled write: the unit test checks that the handler answers CANCELLED at once; killing the server operation is the shared `Operation` code (tested in `query.spec.ts`), not this task.
- The non-atomic window of the `expectedCount` check (CR-1) is documented, not prevented; a race between count and write is not reproducible deterministically and is not a requirement.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. TW-1 is fixed and verified; the CR-2 message change is asserted in full; CR-1/CR-3 are documentation-only. `npm run check` (= `.taskcheck`) passes, the docs-write integration suite passes 20/20, and `write.ts` and `handlers.ts` have 100% coverage on all metrics at revision 984c6cc.
