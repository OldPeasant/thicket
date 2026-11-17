# Test Report

Date: 2026-11-17

Task: agg-backend — M3: Aggregation run, stage preview, explain, views

Scope: `git diff ba696c99c3ba716ce6d844e1faa810eaff2ccc9f..bb56df6065edfe7490d71a276c1431e6c73f8ea5` on branch `main` (HEAD `bb56df6065edfe7490d71a276c1431e6c73f8ea5`). Task commits `a0a1ffafeb239733d7ed7029dd80e0afcc4bc084` (handlers) and `bb56df6065edfe7490d71a276c1431e6c73f8ea5` (integration tests), supplied by the parent worker and confirmed with `git log`. No uncommitted production changes. The only uncommitted inputs are the two new spec files below and this report (plus `reviews/agg-backend/review.md`, which another helper wrote and which this report does not cover).

Requirements:
- `tasks/agg-backend.md` acceptance criteria and recorded assumptions (preview samples with `$limit` in natural order and puts it after a must-be-first stage; explain defaults to `executionStats`; `$out`/`$merge` are explained only with `queryPlanner`; previewStage refuses `$out`/`$merge`; each stage is a plain document with exactly one key)
- `packages/contract/src/agg.ts` (method params, defaults sampleSize 100 and limit 20)
- `docs/ARCHITECTURE.md` "Coverage" and "Conventions"; `AGENTS.md`; `docs/QUALITY.md`
- Parent worker instructions (unit tests that follow `docs/query/query.spec.ts` and `handlers.spec.ts`)

## Test files changed

- `packages/backend/src/agg/agg.spec.ts` (new, 72 tests)
- `packages/backend/src/agg/handlers.spec.ts` (new, 19 tests)
- `test/integration/agg.int.spec.ts`: unchanged. The 14 existing tests already cover both acceptance criteria against a real server, and I found no real gap.

## Tests added or updated

Count: 91 (72 in `agg.spec.ts`, 19 in `handlers.spec.ts`)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: preview of stage 2 of 3 matches running the first 2 stages (int) | `agg.int.spec.ts` "preview of stage 2 of 3 matches running the first 2 stages", "samples sampleSize input documents and returns at most limit" | `npx vitest run --config test/integration/vitest.config.ts agg.int` (Podman containers) | Pass (14/14) |
| AC1: explain returns winning plan (int) | `agg.int.spec.ts` "explains a find and returns the winning plan (index used)", "explains an aggregate and returns the winning plan" | same | Pass |
| AC2: `$out` on read-only refused; on production requires confirmed (int) | `agg.int.spec.ts` "refuses $out on a read-only profile, even confirmed", "$out on production requires confirmed", "$merge on production requires confirmed", "read-only profiles still run reading pipelines" | same | Pass |
| parsePipeline: array of one-key plain stages, lossless; INVALID_PARAMS for invalid EJSON, a non-array, empty/multi-key/array/null/string/number/BSON-wrapper stage (1-based position in the message) | `agg.spec.ts` describe `parsePipeline` (12 tests) | `cd packages/backend && npx vitest run src/agg/` | Pass |
| writesTo: `$out`/`$merge` stage names only | `writesTo` "is true for a $out or $merge stage anywhere, false otherwise" | same | Pass |
| previewPipeline: defaults 100/20, explicit sample/limit, empty pipeline, sample after a must-be-first stage (`$geoNear`, `$documents`, `$search`, `$vectorSearch`, `$collStats`, `$indexStats`), not moved for a later `$geoNear`, `$out`/`$merge` refused | `previewPipeline` (13 tests) | same | Pass |
| buildAggregate: minimal shape; batchSize/collation (relaxed)/hint (document or name)/allowDiskUse (incl. false)/maxTimeMS; `$out` kept; INVALID_PARAMS for unreadable pipeline/collation/hint | `buildAggregate` (7 tests) | same | Pass |
| streamAggregate batching: events of batchSize over the first batch and getMore batches, one comment, raw (`promoteLongs:false`); default 100 per event; getMore loop without batchSize; no empty events; `$out` delivers 0; prebuilt command; invalid pipeline sends nothing; mid-stream server error kills the cursor; mapped NOT_FOUND; aborted before start; abort during aggregate -> killOp by comment + killCursors of the late cursor | `streamAggregate` (11 tests) | same | Pass |
| previewStage: command shape (pipeline, `cursor.batchSize = limit`, maxTimeMS), defaults, getMore until limit then killCursors, truncates to limit, `$out`/`$merge`/invalid refused before sending, server error mapping, abort | `previewStage` (7 tests) | same | Pass |
| buildExplained: find built exactly like `buildFind` (no `kind`), invalid find filter, aggregate with collation/hint, `$out`/`$merge` refused for default/executionStats/allPlansExecution, allowed with queryPlanner, unreadable pipeline | `buildExplained` (8 tests) | same | Pass |
| explain: default verbosity executionStats, explicit verbosity for a find, `$out` sends nothing unless queryPlanner, SERVER_ERROR mapping, abort | `explain` (5 tests) | same | Pass |
| createView error mapping: command shape, collation, INVALID_PARAMS before sending, NamespaceExists -> SERVER_ERROR with serverCode/codeName, NamespaceNotFound -> NOT_FOUND, unknown -> INTERNAL, RpcError passed on unchanged | `createView` (6 tests) | same | Pass |
| Handlers: method set; NOT_CONNECTED for all four; agg.run opens a stream and runs nothing before it starts; invalid params refused before a stream; needs a streaming server; CANCELLED when the connection is closed (and when it is closed and reopened); failure passed on while open; previewStage/explain/createView answer; CANCELLED at once on request cancel | `handlers.spec.ts` describe `aggHandlers` (15 tests) | same | Pass |
| Handlers served through `serve` with the contract: data events of batchSize + end; contract rejects a non-array pipeline; `$out` preview refused; a stream cancel kills the server op and cursor before CANCELLED | `handlers.spec.ts` describe `aggHandlers served` (4 tests) | same | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/agg/`

Result:

Pass (2 files, 91 tests). On the first run one test failed because the test itself was wrong: it expected a synchronous throw, but `streamAggregate` evaluates its default `built` argument inside the async function, so it rejects. I fixed the test to expect a rejection. That is correct behavior, not a defect.

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier --check, typecheck, `vitest run` for all workspaces, renderer `ng test`)

Result:

Pass (vitest 55 files / 3251 tests; renderer 71 files / 2014 tests). The first attempt failed in `prettier --check` on the new `agg.spec.ts`. I formatted it with `npx prettier --write` (only test files) and the rerun passed.

Command:

`npx vitest run --config test/integration/vitest.config.ts agg.int` (repo root, Podman containers)

Result:

Pass (1 file, 14 tests)

## .taskcheck

Result:

Pass: `.taskcheck` runs `npm run check`, which passed (see above). I did not invoke `.taskcheck` separately.

## Bugs found

None. No test exposed behavior that violates the acceptance criteria, the contract or the recorded assumptions.

Observation (not a defect against any requirement, recorded for the parent): `agg.createView` cancels the way `abortable` does. The request answers CANCELLED at once, but `createView` sends `create` without an operation `comment` and with no killOp. A view whose request was cancelled may therefore still be created on the server. The SPEC and the task do not require cancelling a view creation, so I added no failing test for it.

## Unable to test

- Cancelling `agg.createView` server-side: the code has no such mechanism and there is no requirement for one (see the observation under Bugs found). No follow-up is required unless the parent decides it is wanted.
- The full `npm run test:int` suite was not run. Only the agg integration file was run, as the task criteria name it.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found.

## Coverage

Status: verified (whole-file coverage of the task-changed production files, fresh run on the final snapshot)

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured with a dedicated tool. Every file that has added lines reports 100% line coverage (122/122 lines), so all executable added lines were executed. This does not prove changed-branch coverage.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `agg-backend`; base `ba696c99c3ba716ce6d844e1faa810eaff2ccc9f`; HEAD `bb56df6065edfe7490d71a276c1431e6c73f8ea5`; commits `a0a1ffa`, `bb56df6` supplied by the parent and checked with `git diff --stat ba696c99..HEAD`
- Source/test snapshot identifier (including uncommitted inputs): sha256 `agg.ts` 42a72fc7cf0dcb416bb64d5c27075870a46fc8ae80c79fd33796d9db10d84d38, `handlers.ts` f8f5f31e5bb9b2b8b326ce0008a0c09462baec11e2ae18c288fa7911946f8440, `index.ts` 4a6c737cc85d0ca5dda66ba12a6d82deb7637efad343e6635e8be00591932bdc, `server/backend.ts` 62d36b9b2d5b2c45bbda3321040686d5c4b34844655db7f188d2e6555b02e7fe, `src/index.ts` dfdf15938ca83128cf3ca1728130a4b8f1a2a9096ac061aa86c9e7911a013632, uncommitted `agg.spec.ts` 383b4f9a3adcd51e8ed9de2bac9556fdd63819416a5da8069d2fff053c807d09, uncommitted `handlers.spec.ts` d9c0a5eb8b53dc46e134d2e8dede23ced2301ab7b5ec12e56097bc3c10a17ab7 (identical before and after the runs)
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/agg/agg.ts`, `src/agg/handlers.ts`, `src/agg/index.ts` (re-exports, 0 executable statements), `src/server/backend.ts` (wiring: 1 import + 1 spread), `src/index.ts` (1 re-export). Excluded `test/integration/agg.int.spec.ts` (test file). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8`; in `packages/backend`: `npx vitest run --coverage --coverage.include='src/agg/agg.ts' --coverage.include='src/agg/handlers.ts' --coverage.include='src/agg/index.ts' --coverage.include='src/server/backend.ts' --coverage.include='src/index.ts' --coverage.reportsDirectory=coverage/agg-backend-final --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json`; selection: the whole backend unit suite (20 files, 919 tests). Integration tests are not part of this measurement.
- Run start/completion time and exit status: 2026-11-17T02:27:37+01:00 to 02:27:44+01:00, all tests passed. A confirming rerun into `coverage/agg-backend-final2` (02:27:56+01:00, json-summary only) exited 0.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/agg-backend-final/coverage-summary.json` sha256 950ee4a9144afbdb4910c5bb62291be8240a4fbd2698dc20575bd35f8e18c3fb (identical in `coverage/agg-backend-final2/`); `coverage-final.json` sha256 ad92c75606631be51470e3d71f17777cd3433bf6404b41f440c6c277ea5b8b04 (Git-ignored)
- Evidence outputs are fresh and inputs stayed unchanged: both runs wrote to new, previously absent directories, and the source/test hashes were the same before and after
- Final run after latest test additions and production fixes: yes (no production fixes were made)

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/agg/agg.ts` | 85/85 (100%) | 49/50 (98%) | 15/15 (100%) | 76/76 (100%) |
| `packages/backend/src/agg/handlers.ts` | 19/19 (100%) | 4/4 (100%) | 8/8 (100%) | 17/17 (100%) |
| `packages/backend/src/agg/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/backend/src/server/backend.ts` | 30/32 (93.75%) | 9/10 (90%) | 10/12 (83.33%) | 28/28 (100%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| Aggregate (summed counters, all 5 files) | 135/137 (98.54%) | 62/64 (96.88%) | 33/35 (94.29%) | 122/122 (100%) |
| Aggregate `src/agg` only (new code) | 104/104 (100%) | 53/54 (98.15%) | 23/23 (100%) | 93/93 (100%) |

No scoped file is missing or unmeasured.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/agg/agg.ts:87` (`?? ''` in `stageName`) | Defensive fallback for a stage without keys | Not reachable: `parsePipeline` guarantees exactly one key per stage. Justified gap, no test |
| `packages/backend/src/server/backend.ts:34` (the `log` default and the `link()` throw path) | Pre-existing code, not changed by this task | Out of task scope. The task's 2 lines in this file (import, `...aggHandlers(connections)`) are covered |
