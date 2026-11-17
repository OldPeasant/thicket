# Test Report

Date: 2026-11-17

Task: agg-backend — M3: Aggregation run, stage preview, explain, views

Reviewed revision: `be1062bf028e0760b54d0d623f6d04d83147e39d` (second pass, on the final code after the fixer's changes for CR-1 to CR-4), plus the uncommitted test additions listed below.

Scope: `git diff b29230049b3ab641237739388e16062b9220810b..be1062bf028e0760b54d0d623f6d04d83147e39d` on branch `main`. The base is `git merge-base HEAD origin/main`. The task commits are `659163dae24ca4154c806cb303a7fb625282933d` (handlers), `567761fc7fc2b61923cc346f29bb4bda669994b9` (integration tests), `643a41a412fc0c749b7c3ddd1851c0f2325c1682` (unit tests and reports) and `be1062bf028e0760b54d0d623f6d04d83147e39d` (review fixes). The parent named them, and I confirmed them with `git log`. This pass focuses on the fix commit (`git show HEAD -- packages test`): `mustComeFirst()` in `agg.ts`, `WRITING_STAGES` now exported from `guard/guard.ts`, and `isOpenClient` moved to `connections/manager.ts`. There are no uncommitted production changes. The uncommitted inputs are the two spec files below and this report. `reviews/agg-backend/review.md` also shows as modified in the working tree. I did not change it, and this report does not cover it.

Requirements:
- `tasks/agg-backend.md` acceptance criteria and recorded assumptions
- `reviews/agg-backend/review.md` findings CR-1 to CR-4 and `reviews/agg-backend/fixes.md` (the intended behavior of the fixes)
- `packages/contract/src/agg.ts`; `docs/ARCHITECTURE.md` "Coverage" and "Conventions"; `AGENTS.md`; `docs/QUALITY.md`
- Parent worker instructions for this second pass

## Test files changed

- `packages/backend/src/agg/agg.spec.ts` (this pass: 8 tests added; first pass: new file)
- `packages/backend/src/connections/manager.spec.ts` (this pass: 3 tests added, new describe `isOpenClient`)
- `packages/backend/src/agg/handlers.spec.ts` (first pass; unchanged in this pass)
- `test/integration/agg.int.spec.ts`: unchanged by me. The fixer added the `$text` preview integration test in `be1062b`.

## Tests added or updated

Count: 11 in this pass, 102 in total for the task by the test-writer (first pass: 72 in `agg.spec.ts` and 19 in `handlers.spec.ts`).

This pass, `agg.spec.ts`:
- `previewPipeline` "a first $match whose filter is %s keeps the sample first (no throw)" × 4 (null, an array, a string, a BSON value). These cover the `isPlainDocument(filter)` guard in `mustComeFirst`, so `'$text' in filter` is never evaluated on a non-object.
- `previewPipeline` "a $text key in a first stage other than $match does not move the sample"
- `previewPipeline` "a $text $match later in the pipeline does not move the sample"
- `previewStage` "sends a leading $text $match as the first stage, the sample $limit after it" (the command actually sent, not only the helper)
- `writesTo` "agrees with the guard: every stage in its WRITING_STAGES list writes, for both" (CR-2: the shared list makes `writesTo`, `pipelineWrites` and the preview refusal agree)

This pass, `manager.spec.ts` (`isOpenClient`, CR-4):
- "is true only for the client of the open connection of that profile"
- "is false (does not throw) for a profile that was never opened"
- "is false for a client after its connection was closed, and after a reopen"

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: preview of stage 2 of 3 matches running the first 2 stages (int) | `agg.int.spec.ts` "preview of stage 2 of 3 matches running the first 2 stages", "samples sampleSize input documents and returns at most limit" | `npx vitest run --config test/integration/vitest.config.ts agg.int` (repo root, Podman containers) | Pass (15/15) |
| AC1: explain returns winning plan (int) | `agg.int.spec.ts` "explains a find and returns the winning plan (index used)", "explains an aggregate and returns the winning plan" | same | Pass |
| AC2: `$out` on read-only refused; on production requires confirmed (int) | `agg.int.spec.ts` "refuses $out on a read-only profile, even confirmed", "$out on production requires confirmed", "$merge on production requires confirmed", "read-only profiles still run reading pipelines" | same | Pass |
| CR-1 fix: preview of a pipeline whose first `$match` has a top-level `$text` works against a real server | `agg.int.spec.ts` "previews a pipeline whose first $match uses $text (it must stay the first stage)" | same | Pass |
| CR-1 fix: `mustComeFirst` puts the sample after a leading `$text` `$match` only. It does not for a plain/nested-`$text` `$match`, a non-document `$match` filter, `$text` in another stage, or a later `$text` `$match`. The command sent by `previewStage` has that order | `agg.spec.ts` `previewPipeline` "puts the sample $limit after a first $match with a top-level $text", "a $match without a top-level $text keeps the sample first", the 4 non-document-filter cases, "a $text key in a first stage other than $match…", "a $text $match later…"; `previewStage` "sends a leading $text $match as the first stage…" | `cd packages/backend && npx vitest run src/agg/ src/connections/manager.spec.ts src/guard` | Pass |
| CR-2 fix: one `WRITING_STAGES` list (guard) used by `writesTo`, the preview refusal and `pipelineWrites` | `agg.spec.ts` `writesTo` "agrees with the guard…"; existing `writesTo`, `previewPipeline` `$out`/`$merge` refusal, `buildExplained` and `guard.spec.ts` `pipelineWrites` tests | same | Pass |
| CR-3 fix: import path `../browse/browse` | Covered by `npm run check` (typecheck and lint) and every `agg.spec.ts` test that canonicalises output | `npm run check` | Pass |
| CR-4 fix: `isOpenClient` exported from `connections/manager.ts`. True only for the profile's current open client; false for another client, another profile, a never-opened profile (no throw), a closed connection, and the old client after a reopen | `manager.spec.ts` describe `isOpenClient` (3 tests); `agg/handlers.spec.ts` and `docs/query/handlers.spec.ts` CANCELLED-on-close/reopen tests (callers) | `cd packages/backend && npx vitest run src/agg/ src/connections/manager.spec.ts src/guard`, `npm run check` | Pass |
| First-pass unit behavior (parsePipeline, writesTo, previewPipeline, buildAggregate, streamAggregate, previewStage, buildExplained, explain, createView, handlers) | `agg.spec.ts`, `handlers.spec.ts` (see the first-pass rows, unchanged) | `npm run check` | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/agg/ src/connections/manager.spec.ts src/guard`

Result:

Pass (4 files, 250 tests). All new tests passed on the first run. `npx prettier --check` on both edited spec files: clean.

## Full test execution

Command:

`npm run check` (repo root: eslint `--max-warnings 0` + prettier `--check`, typecheck of all workspaces, `vitest run`, renderer `ng test`)

Result:

Pass (vitest 55 files / 3264 tests, which is 3253 before plus the 11 new ones; renderer 71 files / 2014 tests)

Command:

`npx vitest run --config test/integration/vitest.config.ts agg.int` (repo root, Podman containers)

Result:

Pass (1 file, 15 tests, including the fixer's `$text` preview test)

## .taskcheck

Result:

Pass, indirectly: `.taskcheck` runs `npm run check`, and that passed. I did not invoke the `.taskcheck` script separately.

## Bugs found

None. The fixes behave as `fixes.md` describes, and no test exposed behavior that violates the acceptance criteria, the contract, the recorded assumptions or the review findings.

The first-pass observation still applies (not a defect against any requirement): a cancelled `agg.createView` answers CANCELLED at once, but the `create` command is not killed on the server.

## Coverage

Status: verified (whole-file coverage of the task-changed production files; a fresh run on the final snapshot, i.e. revision `be1062b` plus this pass's test additions)

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured for the lines the fix commit changed, from the provider's source-mapped `coverage-final.json`. Method: I counted the statements, branches and functions that start inside the changed line ranges. Results:
- `agg.ts` 85-101 (`stageName`, `mustComeFirst`, `writesTo`): statements 9/9, branches 6/7. The only miss is the pre-existing `?? ''` on line 85. `mustComeFirst` was called 26 times.
- `manager.ts` 340-352 (`isOpenClient`): statements 3/3, including the `catch` return. Branches 0/0. The function was called 16 times.
- `guard.ts` 48-52 (`WRITING_STAGES` export): statements 1/1.
- `agg/handlers.ts` and `docs/query/handlers.ts`: these changes only remove lines and change imports, so they have no executable added lines.

This method approximates changed-line coverage. It is not a dedicated diff-coverage tool.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `agg-backend`; base `b29230049b3ab641237739388e16062b9220810b` (`git merge-base HEAD origin/main`); HEAD `be1062bf028e0760b54d0d623f6d04d83147e39d`; commits `659163d`, `567761f`, `643a41a`, `be1062b` named by the parent and checked with `git log` and `git diff --stat base HEAD`
- Source/test snapshot identifier (including uncommitted inputs): sha256 `agg/agg.ts` 4440d2576ef0bea1fd0a70ac9b84d3d5d6e4824420764fe64bc2dc1827cd018d, `agg/handlers.ts` e6145ca59a749f2e1803b8597c67daad967df469c1ae0aacfca10713fd4eccbb, `agg/index.ts` 4a6c737cc85d0ca5dda66ba12a6d82deb7637efad343e6635e8be00591932bdc, `connections/manager.ts` e967a96baf61ae4ff669cdf716e01ea53d5c5de3d0fd0eda60b8f3380e258df0, `guard/guard.ts` 93c4c8123af3b924f8d258c314ddd3b93338d0e6f8b3fb4faa871f6909a6cf61, `docs/query/handlers.ts` 5fdf18995598bceeee4042e6d4d69e9fcacd6e4658d62a63a8003bafc20e4d84, `server/backend.ts` 62d36b9b2d5b2c45bbda3321040686d5c4b34844655db7f188d2e6555b02e7fe, `src/index.ts` dfdf15938ca83128cf3ca1728130a4b8f1a2a9096ac061aa86c9e7911a013632; uncommitted `agg/agg.spec.ts` 7fa8b782cd61b9b262fb29768ea85fd586325ae1125fb84433827145033cb0e8, uncommitted `connections/manager.spec.ts` e8825016a31f5f1093a827f5a1cd6ae778a20a1f8a1e5d71a50eb1bdc8b3c324; `agg/handlers.spec.ts` d9c0a5eb8b53dc46e134d2e8dede23ced2301ab7b5ec12e56097bc3c10a17ab7. The hashes were identical before and after the run.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/agg/agg.ts`, `src/agg/handlers.ts`, `src/agg/index.ts` (re-exports, no executable code), `src/connections/manager.ts`, `src/guard/guard.ts`, `src/docs/query/handlers.ts`, `src/server/backend.ts`, `src/index.ts`. Excluded: spec files and `test/integration/agg.int.spec.ts` (tests), `reviews/` (reports). There are no renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8`, run in `packages/backend`: `npx vitest run --coverage --coverage.include='src/agg/agg.ts' --coverage.include='src/agg/handlers.ts' --coverage.include='src/agg/index.ts' --coverage.include='src/connections/manager.ts' --coverage.include='src/guard/guard.ts' --coverage.include='src/docs/query/handlers.ts' --coverage.include='src/server/backend.ts' --coverage.include='src/index.ts' --coverage.reportsDirectory=coverage/agg-backend-pass2 --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json`. The selection is the whole backend unit suite (20 files, 932 tests). Integration tests are not part of this measurement.
- Run start/completion time and exit status: 2026-11-17T02:35:20+01:00 to about 02:35:26+01:00; all 932 tests passed (exit 0)
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/agg-backend-pass2/coverage-summary.json` sha256 25c9531cce0b7940cc8e638464273af34b8c5da2cf15fed3003584cb1d429504; `coverage-final.json` sha256 9a3c42d67184615e61d27fc5e4206e645f25631e48fa3a873220430f3dfd2641 (Git-ignored)
- Evidence outputs are fresh and inputs stayed unchanged: `coverage/agg-backend-pass2` did not exist before the run (listed at 02:35:17), and the input hashes were the same before and after
- Final run after latest test additions and production fixes: yes (this run is after the fix commit `be1062b` and after all tests of this pass were added)

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/agg/agg.ts` | 89/89 (100%) | 54/55 (98.18%) | 16/16 (100%) | 79/79 (100%) |
| `packages/backend/src/agg/handlers.ts` | 16/16 (100%) | 4/4 (100%) | 7/7 (100%) | 14/14 (100%) |
| `packages/backend/src/agg/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/backend/src/connections/manager.ts` | 167/168 (99.40%) | 90/91 (98.90%) | 36/37 (97.30%) | 144/145 (99.31%) |
| `packages/backend/src/guard/guard.ts` | 37/37 (100%) | 23/25 (92%) | 8/8 (100%) | 32/32 (100%) |
| `packages/backend/src/docs/query/handlers.ts` | 17/17 (100%) | 4/4 (100%) | 8/8 (100%) | 15/15 (100%) |
| `packages/backend/src/server/backend.ts` | 30/32 (93.75%) | 9/10 (90%) | 10/12 (83.33%) | 28/28 (100%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| Aggregate (summed counters, all 8 files) | 357/360 (99.17%) | 184/189 (97.35%) | 85/88 (96.59%) | 313/314 (99.68%) |
| Aggregate `src/agg` only | 105/105 (100%) | 58/59 (98.31%) | 23/23 (100%) | 93/93 (100%) |

Every scoped file was measured. `manager.ts`, `guard.ts`, `docs/query/handlers.ts`, `server/backend.ts` and `src/index.ts` are whole files that the task touched only in a few lines, so their whole-file numbers include pre-existing code.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/agg/agg.ts:85` (`?? ''` in `stageName`) | Defensive fallback for a stage without keys | Not reachable from the handlers: `parsePipeline` guarantees exactly one key per stage. Justified gap, no test |
| `packages/backend/src/connections/manager.ts:63` (default `createClient` with a real `MongoClient`) | Pre-existing; not changed by this task | Out of task scope. The real client is exercised by the integration tests |
| `packages/backend/src/guard/guard.ts:89-90` (two `cond-expr` branches) | Pre-existing code outside the task's change (lines 48-52) | Out of task scope |
| `packages/backend/src/server/backend.ts:34` (the `log` default and the `link()` throw path) | Pre-existing code, not changed by this task | Out of task scope. The task's 2 lines in this file are covered |

## Unable to test

- Server-side cancel of `agg.createView`: the code has no such mechanism and no requirement asks for one. No follow-up is needed unless the parent wants it.
- The full `npm run test:int` suite was not run. Only the agg integration file was run, because the task criteria name it. The fixer reports that `query.int` passed after the `isOpenClient` move (35 tests). I did not rerun it in this pass.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. This second pass added 11 tests for the fixed behavior (CR-1 `mustComeFirst` edge cases and the command it sends, CR-2 a single `WRITING_STAGES` list, CR-4 `isOpenClient`). All validation passed: focused unit tests, `npm run check` and `agg.int` with Podman.
