# Test Report

Date: 2026-11-16

Task: docs-query-backend - M1: Query documents with paging, counts, cancel and slices (round 2, on the fixed code)

Scope: `git diff 247acedc87e0788703663c036292690d324a96a6..7ee7b7e0da749cf2a7d10933f837a177fbd97c1e` (branch `main`). The parent gave base 8afb705 and HEAD 0216b68. Before this run the branch was rebased onto 247aced (`git merge-base HEAD origin/main`), which only adds two `assume:` commits to `tasks/docs-query-backend.md`. `git diff 0216b68 7ee7b7e` and `git diff 8afb705 247aced` both touch only `tasks/docs-query-backend.md`, so the code under test is the same as 0216b68. Task commits: 85e272a, ae050c9, f4a9cbb, 3fb3177 (the fixes for CR-1..CR-7 and TW-1), 7ee7b7e (core classifier tests and the fixer report). Uncommitted inputs: only the three test files listed below. `reviews/docs-query-backend/review.md` was also modified in the working tree, but not by me (most likely the concurrent code-reviewer).

Requirements:
- `tasks/docs-query-backend.md`: the 3 acceptance criteria and the recorded assumptions
- `SPEC.md` (streams, cancel kills the server operation, `$slice` loading), `docs/ARCHITECTURE.md` ("Coverage"), `docs/QUALITY.md`
- `reviews/docs-query-backend/review.md` (CR-1..CR-7), round 1 `tests.md` (TW-1), `reviews/docs-query-backend/fixes.md`
- The doc comments of `Operation.cleanUp`, `getDocument`, `getSlice`, `buildFind`, `docsQueryHandlers` and `serve()`

## Test files changed

- `packages/backend/src/docs/query/query.spec.ts` (3 tests added in `Operation cancel`)
- `packages/backend/src/docs/query/handlers.spec.ts` (1 test added)
- `packages/backend/src/server/rpc.spec.ts` (3 tests added in `serve: streams`)

## Tests added or updated

Count: 7 added. No existing test was changed, weakened or skipped.

- `Operation cancel > probing stops once the interrupted command answers (never seen in currentOp); its cursor is killed` (CR-1: the retry loop ends as soon as the reply arrives, not after 4 s, and the reply's cursor is killed)
- `Operation cancel > a late reply whose cursor is already exhausted (id 0) needs no killCursors` (CR-1)
- `Operation cancel > an abort during a count aggregation that is never in currentOp still ends when it fails` (CR-1, the count path and a failing reply)
- `docsQueryHandlers > docs.find ends CANCELLED when its connection was closed and reopened meanwhile` (CR-3: the "different client" branch of `isOpenClient`. The existing test only covered `NOT_CONNECTED`)
- `serve: streams > a repeated cancel neither restarts the grace time nor sends CANCELLED twice` (CR-7)
- `serve: streams > a cancelled producer that settles in time clears its grace timer` (CR-7)
- `serve: streams > stop() with several running streams drops all of them, cancelled or not` (CR-7/TW-1: nothing is sent and nothing is reported, also for a producer that rejects with a non-RpcError after stop)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: 10 000-doc fixture paged forward/backward/last in range and skip mode equals a plain sorted find | `docs-query.int.spec.ts` "docs.find paging in range/skip mode (10 000 docs)" (forward, backward/last per sort, jump + next/previous) | `npm run test:int -- test/integration/docs-query.int.spec.ts` (replica-set container) | Pass (35/35 in the file) |
| AC2: cancelling a slow query ends CANCELLED and the server op is gone (currentOp check) | `docs-query.int.spec.ts` "cancel": slow find stream, cancel right after the response (CR-1, 3 rounds, `$currentOp` with `idleCursors: true` empty), between batches, slow count, conn.close during find (CR-3) | same | Pass |
| AC2 unit level: kill retry until the op shows up, stop as soon as the reply settles, late cursor kill, cursor id 0 | `query.spec.ts` `Operation cancel` (incl. the 3 new tests) | `cd packages/backend && npx vitest run src/docs/query src/server/rpc.spec.ts src/server/backend.spec.ts` | Pass |
| AC3: getSlice items n..m of a 50 000-item array without sending the whole document (response size asserted) | `docs-query.int.spec.ts` "docs.get and docs.getSlice on a 50 000-item array" | `npm run test:int -- test/integration/docs-query.int.spec.ts` | Pass |
| CR-2: sliceAbove keeps inclusion projections (`$slice` expression) | `query.spec.ts` "inclusion projection ..." tests; `projection.spec.ts` `isInclusion`/`isIncluded`; integration "docs.get with sliceAbove keeps the inclusion projection %s" | focused unit command + `npm run check` + integration command | Pass |
| CR-3: conn.close ends a running find CANCELLED | `handlers.spec.ts` (closed; closed and reopened, new); integration "conn.close during a running find ends its stream with CANCELLED" | focused unit command + integration command | Pass |
| CR-4: getSlice refuses array indexes, NOT_FOUND through arrays | `query.spec.ts` `getSlice` (numeric components, parent checks, message); integration "getSlice follows nested documents but refuses paths through arrays and array indexes" | same | Pass |
| CR-5: before/fromEnd need limit > 0 | `query.spec.ts` "refuses %s (the backward read would buffer everything)", "after needs no limit"; integration "refuses before and fromEnd without a limit" | same | Pass |
| CR-6: `$eq` id filters | `query.spec.ts` "matches the id literally ..." + filter expectations; integration "docs.get and getSlice match an operator-looking id literally" | same | Pass |
| CR-7 / TW-1: stop() sends nothing more for streams; grace timers cleared | `rpc.spec.ts` TW-1 test, "stop() after a cancel clears the grace timer", plus the 3 new tests | focused unit command | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/docs/query src/server/rpc.spec.ts src/server/backend.spec.ts`

Result:

Pass (4 files, 185 tests)

## Full test execution

Command:

`npm run check` (eslint + prettier, tsc/ngc, root `vitest run`, renderer `ng test`)

Result:

Pass: root vitest 46 files and 2829 tests (2822 before plus the 7 new tests), renderer 44 files and 831 tests. My first run with the new tests failed lint because of an unused variable in one of my new rpc tests. I fixed the test, and the re-run passed.

Also run:

`npm run test:int -- test/integration/docs-query.int.spec.ts` -> Pass: 1 file, 35 tests, 18.8 s (started 22:44:01). No integration test was added in this round. The existing integration tests already cover every fixed behavior against a real server.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`, which passed. See above.)

## Bugs found

None. Every fixed behavior (CR-1..CR-7, TW-1) behaves as its finding and doc comment require, and no new test failed against the production code.

## Coverage

Status: verified.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured. The configured tooling (`@vitest/coverage-v8`) has no changed-line mode.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `docs-query-backend`; base 247acedc87e0788703663c036292690d324a96a6 (`git merge-base HEAD origin/main`, after the parent's rebase from 8afb705, which differs only in `tasks/`); HEAD 7ee7b7e0da749cf2a7d10933f837a177fbd97c1e (code identical to 0216b68); files from `git diff --name-only 247aced..HEAD -- '*.ts'`.
- Source/test snapshot identifier (sha256, the same before and after the coverage runs):
  - `packages/backend/src/server/rpc.ts` eedd830bedec8ab604fa3dfad117d2d552d67223c51f0d7e5134ae04a55a3a4c
  - `packages/backend/src/docs/query/query.ts` a97c0aa355bb729666fd1cfd91427a21d660aca1f1ba5af036981687542b694e
  - `packages/backend/src/docs/query/handlers.ts` d1b02c77ba9b5f3d2a85b53c41f4886491f7e779e4294684fc8aed88a9d41a90
  - `packages/backend/src/docs/query/index.ts` 72ac4d32acd07ec9857250e0a204f3a0462320946f32ea1190ce531539c4b0b1
  - `packages/backend/src/server/backend.ts` 9b6672fc52b2d3d5c798472d853620b67fa999aab04373dcc6ab1ca0be6d0c96
  - `packages/backend/src/index.ts` e7f76183ebeea8436dbffcb513ae659985ff6aace2800f581ac7ba0b3ea1a566
  - `packages/backend/src/browse/browse.ts` 9ed0914a91cea196c63d703413623911163816086bd302f1b80377bc7f0d4f44
  - `packages/contract/src/docs.ts` d1a7c453b09614b051c52cbbe5238cbd94d09a0938c357152723d6a9ee114515
  - `packages/core/src/paging/projection.ts` 3116a143a94a50137b0db10e483c79c49d2724edf7857fc6ffc0093441746792
  - tests (uncommitted): `rpc.spec.ts` ce0d2981c5a956d44ea15dbdb3ca9e6a44533e81993905388349b17b374285ac (after the lint fix), `query.spec.ts` 802faee91812ba699b7901381ca1a6ee191ee2a271d34ca545205d51f152abfa, `handlers.spec.ts` 87c13282df31759c7ceee4265bdfdf8a83acd7a306f7e1c846d9f6819fddb05d; committed: `backend.spec.ts` 65a3310fda166a39f0cf770ae05bfa6960d830a373b8e7d3896bf2c2f4a62e18, `core/src/paging/projection.spec.ts` 294fb1e79fea492d318bd97e6f8b65de0e02f5df40c291380be54165e0954604
- Exact included files: the 9 production files above. Excluded: `docs/ARCHITECTURE.md` (documentation); `packages/contract/src/index.spec.ts`, `packages/core/src/paging/projection.spec.ts`, the backend `*.spec.ts` files and `test/integration/docs-query.int.spec.ts` (tests). No renamed or deleted files.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0 on Vitest 5.1.0. In `packages/backend`: `npx vitest run --coverage --coverage.include='src/server/rpc.ts' --coverage.include='src/docs/query/query.ts' --coverage.include='src/docs/query/handlers.ts' --coverage.include='src/docs/query/index.ts' --coverage.include='src/server/backend.ts' --coverage.include='src/index.ts' --coverage.include='src/browse/browse.ts'` (whole backend unit suite, nothing deselected). In `packages/contract`: `npx vitest run --coverage --coverage.include='src/docs.ts'`. In `packages/core`: `npx vitest run --coverage --coverage.include='src/paging/projection.ts'`. Integration tests are not part of the coverage runs.
- Run start/completion time and exit status: the final backend run wrote its report at 22:46:42 +0100: 12 files, 520 tests passed, exit 0. It was re-run after the lint-only test fix, and the report is byte-identical to the first run's (22:45:21). The contract run wrote its report at 22:45:32 and the core run at 22:45:34, both all passed, exit 0.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-summary.json` a0b6be8f147aa37818f1bc5aab8c2c7b11564ce528997fbdc7c5cb460c60a1df, `packages/backend/coverage/lcov.info` ef4fe308ab73cb817cd39be2fdc5e56ca226a51a38f277101b3e2025221f8087, `packages/contract/coverage/coverage-summary.json` 62fbb664c1128ce7ceb3ae75231385b1436d2cf45961489b06decc83646b8c4c, `packages/core/coverage/coverage-summary.json` 47f834a9253ff5c9a13a39fc23743e93f4e136cedfd498a44a75e63e389999ea. All git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes. Vitest cleans `coverage/` before each run, the file times match the run times, and the production and test hashes were the same before and after.
- Final run after latest test additions and production fixes: yes. The fixes (3fb3177, 7ee7b7e) and all 7 new tests are included.

Values below use covered/total (percentage). Zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/docs/query/query.ts` | 242/242 (100%) | 189/190 (99.47%) | 44/44 (100%) | 204/204 (100%) |
| `packages/backend/src/docs/query/handlers.ts` | 20/20 (100%) | 4/4 (100%) | 9/9 (100%) | 18/18 (100%) |
| `packages/backend/src/docs/query/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/backend/src/server/rpc.ts` | 175/176 (99.43%) | 85/88 (96.59%) | 34/35 (97.14%) | 151/151 (100%) |
| `packages/backend/src/server/backend.ts` | 29/31 (93.54%) | 9/10 (90%) | 9/11 (81.81%) | 27/27 (100%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| `packages/backend/src/browse/browse.ts` | 170/170 (100%) | 128/131 (97.7%) | 34/34 (100%) | 140/140 (100%) |
| `packages/contract/src/docs.ts` | 9/9 (100%) | 9/9 (100%) | 3/3 (100%) | 9/9 (100%) |
| `packages/core/src/paging/projection.ts` | 40/40 (100%) | 47/47 (100%) | 15/15 (100%) | 25/25 (100%) |
| Aggregate (summed counters, all 9 files) | 686/689 (99.56%) | 471/479 (98.33%) | 148/151 (98.01%) | 575/575 (100%) |

All 9 scoped files were measured. None is missing or excluded from the aggregate.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `query.ts:56` branch (`String(error)` for a non-Error thrown by `EJSON.parse`) | Defensive message formatting | Justified gap: the bson parser throws only Error instances |
| `rpc.ts:131` branch + function (default `onError`) | Logging fallback | Trivial; every unit test passes `onError`. The integration test serves without it |
| `rpc.ts:135` branch (method not in table in `startStream`) | Unreachable: only validated methods reach a handler | Justified gap |
| `rpc.ts:182` branch (method without a `stream` schema: data passed unvalidated) | A non-streaming method opening a stream | Defensive; no contract method does this. Justified gap |
| `backend.ts:31` branch, 2 functions (default `log`, privileged-link callbacks) | Code older than this task (the task added 2 wiring lines) | Out of task scope; the task's wiring is covered by `backend.spec.ts` "serves the docs.* query handlers ..." |
| `browse.ts:219`, `:293`, `:306` branches | Code older than this task (the task only added `export`) | Out of task scope |

The previously uncovered paths of the fixed behavior are now covered. These are the stop of the CR-1 probe loop on a settled reply, the CR-3 replaced-client branch, and the CR-7 grace-timer clear on settle. `query.ts`, `handlers.ts` and `projection.ts` have no uncovered statements or lines.

## Unable to test

- The CR-1 race "command not yet in currentOp" depends on server timing. The integration test "cancelling right after the docs.find response ..." tries to hit it in 3 rounds, but it cannot force the op to be invisible on the first probe. The unit tests "an operation not yet in currentOp is probed again ..." and the new "probing stops once the interrupted command answers ..." pin the logic deterministically. No follow-up is needed.
- conn.close replacing the client with a new one while a find fails (CR-3, new unit test) is not covered by an integration test. The existing integration test covers close without reopen. Low risk, no follow-up needed.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. All 3 acceptance criteria pass against the real replica-set container (35/35 integration tests). `npm run check` and `.taskcheck` pass with the 7 new unit tests. Task-scoped coverage over 9 files is 99.56% statements, 98.33% branches, 98.01% functions and 100% lines. The remaining gaps are defensive code or code older than this task.
