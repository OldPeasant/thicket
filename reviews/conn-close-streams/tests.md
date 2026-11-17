# Test Report

Date: 2026-11-17

Task: conn-close-streams - conn.close kills the server ops of the profile's running streams

Scope: final revision. Base 3168a0c1b52322611c986b7d5424b85a9b7bdfb0 .. measured HEAD
5236f6cddc6f53e86212ca8da9e860fd8e05b343 (branch main). The parent named HEAD 00fcfe5; during this
run the branch was rebased onto origin/main (merge-base 63423771353f3c92c0cc444563fb05dc8c83153d),
which brought in only `tasks/` commits from other agents plus 5236f6c (new task file
`tasks/conn-close-agg-io-streams.md`). `git diff 00fcfe5..5236f6c` outside `tasks/` is empty, and
`git diff 3168a0c 6342377 -- packages test` (code before the task commits after the rebase) is empty,
so the task code under test is the same as at 00fcfe5. Task-owned commits after the rebase: aeb842e
(cancelOnClose + docs.find wiring + unit tests), 3e02540 (int test asserts killOp), b05922c
(lint fix in manager spec), c01af52 (more cancelOnClose tests, reports), 00d49a5 (CR-1: int test
counts the backend's own killOp commands). Ownership established from commit subjects, the task's
`touches` list and the parent's description. Since the previous report (at c96abd1) the only code
change is `test/integration/docs-query.int.spec.ts` (CR-1, `reviews/conn-close-streams/fixes.md`).

Requirements:
- tasks/conn-close-streams.md acceptance criterion and notes (incl. the assumption that only
  docs.find streams use cancelOnClose and that the int test asserts killOp)
- docs/ARCHITECTURE.md "Coverage" (task-scoped coverage command)
- reviews/conn-close-streams/fixes.md (CR-1) and the parent's instructions

## Test files changed

None in this run. The task's test files (all committed):
- `packages/backend/src/connections/manager.spec.ts`
- `packages/backend/src/docs/query/handlers.spec.ts`
- `test/integration/docs-query.int.spec.ts`

## Tests added or updated

Count: 0 in this run. No gap remained that needed a new test (see Coverage). The 11 tests added
by the previous test-writer run (9 in manager.spec.ts, 2 in handlers.spec.ts) are committed in
c01af52 and were re-run here.

CR-1 check: the conn.close int test now counts `killOp` commands seen by command monitoring on the
backend's own `MongoClient` (`createClient` dep with `monitorCommands: true`) instead of the
server-global `serverStatus` counter. This assertion still tells new from old code:
`killOperations` (`packages/backend/src/docs/query/query.ts:101-120`) sends `killOp` only for ops
its own `currentOp` call finds. With the old close order the client is closed first and mongod 8
interrupts the op on disconnect, so no killOp would be sent by this client. The count is read
right before `conn.close`, and tests within the file run one at a time, so killOps from other
tests in the file or from other spec files cannot satisfy it. Verifying the old-code failure
directly would mean changing production code, which the test-writer may not do; this was not run.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: Integration test: `conn.close` during a slow docs.find ends the stream with CANCELLED and the server op is gone (currentOp check); killed by the backend's own killOp | `cancel > conn.close during a running find ends its stream with CANCELLED and kills the server operation` (real mongod container, mongo8rs) | `npm run test:int -- test/integration/docs-query.int.spec.ts --reporter=verbose` (35 passed; the verbose output lists this test as passed, 50 ms) | Pass |
| conn.close cancels the find and runs its server cleanup before closing the client (unit, ordering) | `conn.close kills a running find (killOp, killCursors) before it closes the client`; manager `close aborts the running work and waits for it before closing the client` | `cd packages/backend && npx vitest run src/connections/manager.spec.ts src/docs/query/handlers.spec.ts` | Pass |
| close waits at most CLOSE_CANCEL_GRACE_MS; late work keeps its own outcome | `closes the client after the grace time when the work does not settle`; `a work that settles after the grace time still answers its own outcome` | same | Pass |
| cancelOnClose robustness: sync throw, pre-aborted signal, listener removal, already-aborted work still awaited, several works, per-profile isolation, closeAll, connecting state | the 9 `ConnectionManager.cancelOnClose (edge cases)` tests | same | Pass |
| A finished find does not delay a later conn.close | `a finished find does not delay a later conn.close` | same | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/connections/manager.spec.ts src/docs/query/handlers.spec.ts`

Result:

Pass (2 files, 141 tests; started 03:56:50, 8.8 s).

Integration:

`npm run test:int -- test/integration/docs-query.int.spec.ts --reporter=verbose`

Result:

Pass (1 file, 35 tests; started 03:57:01, 8.0 s), on HEAD 5236f6c with a clean code tree.

## Full test execution

Command:

`npm run check` (lint, typecheck, root vitest, renderer `ng test`)

Result:

Pass (root vitest 64 files / 3545 tests; renderer 80 files / 2418 tests; lint and typecheck run
before the tests and passed, no errors reported).

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; ran that command directly, see above).

## Bugs found

None. No production defect found for the acceptance criterion or the cancelOnClose contract.

Observation carried over (not a defect, no requirement violated): when the cleanup of a cancelled
find cannot see its operation in `currentOp`, `conn.close` waits for the find's cleanup bound
`CANCEL_SETTLE_MS` (4 s, query.ts:33) before closing the client, so `conn.close` can take about
4-5 s in that case (e.g. missing currentOp privileges). Two existing handler unit tests take about
4 s each for this reason. The parent decides whether that latency is acceptable. Review finding CR-2
(agg.run / io.export / io.import streams) is out of this task's scope and now tracked as
`tasks/conn-close-agg-io-streams.md`.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured from the lcov report: every `DA` line inside the task's added
hunks (manager.ts new lines 61-82, 337-397, 505-514; handlers.ts new lines 27-36) has hits > 0
(manager.ts 28 executable lines incl. 78, 353-393, 509; handlers.ts 4 lines 28-32). The only
zero-hit entries in either file (manager.ts:91 `DA`, `BRDA:91,0,1`, `FNDA:0` for the default
`createClient` arrow; manager.ts:279 `BRDA:279,20,0`) are outside those hunks. Changed-line coverage:
32/32 executable lines (100%). Changed-branch coverage not separately claimed, though no zero-hit
BRDA lies in the task hunks. The production files are byte-identical to the previous run (same
sha256), so the hunk line numbers are unchanged.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: conn-close-streams;
  base 3168a0c1b52322611c986b7d5424b85a9b7bdfb0; measured HEAD
  5236f6cddc6f53e86212ca8da9e860fd8e05b343 (code-identical to 00fcfe5, see Scope); commits aeb842e,
  3e02540, b05922c, c01af52, 00d49a5 (from `git log 3168a0c..HEAD`, task `touches`, parent message).
- Source/test snapshot identifier (including uncommitted inputs): sha256
  manager.ts c35bc224c0cdb977a0bce0f19c528157ebd79d3362bec07b4d77a75b929291ed,
  handlers.ts 2b933212dcc8137cedd3883ba124f9a2b0e70afec6ad6073bba8bfcf5fa43d9c,
  manager.spec.ts 338d177ca873af2d002fb4a69851ebbf188e7e5ef99a4d85f2299eeeb4be7f6c,
  handlers.spec.ts 572b5456c2400e43b15eaba0c762382b3d0bfa83d55601cc32aa0cd62b772420,
  docs-query.int.spec.ts 4884c03293a41a8002da7a689b8b1b476687f586890d086d2f90825a18e52dea.
  All committed; the only uncommitted change in the tree was `reviews/conn-close-streams/review.md`
  (not a test input, not changed by the test-writer). Hashes taken after all runs match the committed
  content at HEAD.
- Exact included files; renamed/deleted/excluded files and reasons: included
  `packages/backend/src/connections/manager.ts`, `packages/backend/src/docs/query/handlers.ts`.
  Excluded: the three spec files (tests). No renames or deletions. Coverage comes from the backend
  unit tests only; the integration run is not instrumented.
- Provider/version, command, working directory, and test selection: @vitest/coverage-v8 5.1.0,
  vitest 5.1.0; in `packages/backend`:
  `npx vitest run --coverage --coverage.include='src/connections/manager.ts' --coverage.include='src/docs/query/handlers.ts' --coverage.reportsDirectory=coverage/conn-close-streams-5236f6c --coverage.reporter=json-summary --coverage.reporter=lcovonly --coverage.reporter=text`
  (all backend unit tests, 29 files / 1202 tests).
- Run start/completion time and exit status: 2026-11-17 03:57:24 (+01:00), 13.1 s; all 29 files /
  1202 tests passed, report generated.
- Generated report paths and report hashes/run identifier:
  `packages/backend/coverage/conn-close-streams-5236f6c/coverage-summary.json`
  sha256 5ee6f7fa2a30cb8cafa824f959da067209d1279741e2f6d4c5d76e3b07bd272f;
  `packages/backend/coverage/conn-close-streams-5236f6c/lcov.info`
  sha256 ae9a2db613a2da484e58cf86ef4f7b9f5c5ec6350cc311b9e4dffae7ee075501 (git-ignored). Both
  hashes equal the previous run's reports, as expected: the production files and unit specs did not
  change, only the (uninstrumented) integration spec did.
- Evidence outputs are fresh and inputs stayed unchanged: new, previously absent report directory
  for this run; input hashes after the runs equal the committed files at HEAD.
- Final run after latest test additions and production fixes: yes (CR-1 is the latest change; no
  production fixes were made).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/connections/manager.ts` | 241/243 (99.17%) | 123/125 (98.40%) | 45/46 (97.82%) | 209/210 (99.52%) |
| `packages/backend/src/docs/query/handlers.ts` | 18/18 (100%) | 4/4 (100%) | 9/9 (100%) | 16/16 (100%) |
| Aggregate (summed counters, both files measured, none excluded) | 259/261 (99.23%) | 127/129 (98.44%) | 54/55 (98.18%) | 225/226 (99.55%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `manager.ts:91` (default `createClient` = `new MongoClient`, statement + function + branch arm) | Pre-existing; unit tests always inject a fake client | Justified gap: outside task hunks; the real driver path runs in the integration tests |
| `manager.ts:279` (branch: closed while the SSH tunnel opened) | Pre-existing connect race | Justified gap: outside task hunks and task scope |

## Unable to test

- Instrumented coverage of the integration path (real driver killOp against mongod) is not
  measured; the integration test itself ran and passed. No follow-up needed for this task.
- Proving the CR-1 assertion fails on the old close order would need a production-code change;
  not done (test-writer may not modify production code). Reasoning above.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. All validation passed
on the final revision (HEAD 5236f6c, code-identical to 00fcfe5).
