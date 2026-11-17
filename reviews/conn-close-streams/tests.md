# Test Report

Date: 2026-11-17

Task: conn-close-streams - conn.close kills the server ops of the profile's running streams

Scope: base 3168a0c1b52322611c986b7d5424b85a9b7bdfb0 .. HEAD c96abd105f3a2ce09b9914997631b902e8531107
(branch main). Task-owned commits: 9261b8a (cancelOnClose + docs.find wiring + unit tests),
686d923 (integration test asserts killOp), c96abd1 (test-only lint fix in manager.spec.ts). The
parent named 7eb8a9a/9fe2c4e; those hashes are not in this history, the commits above carry the
same task subjects (rebased). Ownership established from the commit subjects, the task's `touches`
list and the parent's description. Plus uncommitted test changes by this test-writer (below).

Requirements:
- tasks/conn-close-streams.md acceptance criterion and notes (incl. the recorded assumption that only
  docs.find streams use cancelOnClose)
- docs/ARCHITECTURE.md "Coverage" (task-scoped coverage command)
- Parent instructions (cancelOnClose semantics, CLOSE_CANCEL_GRACE_MS)

## Test files changed

- `packages/backend/src/connections/manager.spec.ts`
- `packages/backend/src/docs/query/handlers.spec.ts`

## Tests added or updated

Count: 11 (9 in manager.spec.ts, 2 in handlers.spec.ts). No existing test was changed.

manager.spec.ts, new block `ConnectionManager.cancelOnClose (edge cases)`:
- a work that throws synchronously rejects with its error and is not waited for by close
- a caller signal that is already aborted gives the work an aborted signal
- a caller abort after the work settled no longer reaches the work signal
- close waits for a work the caller aborted already while its cleanup still runs
- close cancels every running work of the profile and waits for all of them
- closing one profile does not cancel the work of another
- closeAll cancels the running work before closing the clients
- refuses work while the profile is still connecting
- a work that settles after the grace time still answers its own outcome

handlers.spec.ts (`docsQueryHandlers`):
- conn.close kills a running find (killOp, killCursors) before it closes the client
  (asserts the exact command order `find, currentOp, killOp, killCursors, client.close` and the
  stream outcome `CANCELLED` / "The connection was closed"; with the pre-task close order the
  client would be closed first and the find never cleaned up)
- a finished find does not delay a later conn.close (fake timers, no grace wait)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: Integration test: `conn.close` during a slow docs.find ends the stream with CANCELLED and the server op is gone (currentOp check), killed via killOp | `cancel > conn.close during a running find ends its stream with CANCELLED and kills the server operation` (existing task test, real mongod container) | `npm run test:int -- test/integration/docs-query.int.spec.ts` (35 passed) and `npx vitest run --config test/integration/vitest.config.ts test/integration/docs-query.int.spec.ts -t "conn.close"` (1 passed, verbose output confirms it executed) | Pass |
| conn.close cancels the find and runs its server cleanup before closing the client (unit level, ordering) | `conn.close kills a running find (killOp, killCursors) before it closes the client`; manager `close aborts the running work and waits for it before closing the client` | `cd packages/backend && npx vitest run src/connections/manager.spec.ts src/docs/query/handlers.spec.ts` | Pass |
| close waits at most CLOSE_CANCEL_GRACE_MS; late work keeps its own outcome | `closes the client after the grace time when the work does not settle`; `a work that settles after the grace time still answers its own outcome` | same | Pass |
| cancelOnClose robustness: sync throw, pre-aborted signal, listener removal, already-aborted work still awaited, several works, per-profile isolation, closeAll, connecting state | the 9 edge-case tests above | same | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/connections/manager.spec.ts src/docs/query/handlers.spec.ts`

Result:

Pass (2 files, 141 tests).

Integration: `npm run test:int -- test/integration/docs-query.int.spec.ts` -> Pass (35 tests, 7.7 s),
run at 03:49:48 on HEAD c96abd1 with the uncommitted test changes.

Lint/types of changed specs: `npx eslint <both specs> --max-warnings 0`, `npx prettier --check
<both specs>`, `npm run typecheck -w packages/backend` -> Pass.

## Full test execution

Command:

`npm run check` (lint, typecheck, root vitest, renderer `ng test`)

Result:

Pass (root vitest 64 files / 3545 tests; renderer 80 files / 2418 tests).

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; ran that command directly, see above).

## Bugs found

None. No production defect was found for the acceptance criterion or the cancelOnClose contract.

Observation (not a defect, no requirement violated): when the cleanup of a cancelled find cannot
see its operation in `currentOp` (e.g. the fake clients in the two pre-existing handler tests
"docs.find ends CANCELLED when conn.close closed its connection meanwhile" and "... closed and
reopened meanwhile"), `conn.close` now waits for the find's cleanup bound `CANCEL_SETTLE_MS` (4 s,
query.ts) before closing the client. Those two existing unit tests now take about 4 s each. In
production this means `conn.close` can take up to about 4-5 s when killOp cannot find the op
(e.g. missing currentOp privileges). The parent may decide whether that latency is acceptable.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured from the lcov report: every `DA` line inside the task's added
hunks (manager.ts new lines 61-82, 337-397, 505-514; handlers.ts new lines 27-36) has hits > 0
(manager.ts 28 executable lines incl. 78, 353-393, 509; handlers.ts 4 lines 28-32). The only
zero-hit `DA`/`BRDA` entries in either file (manager.ts:91, manager.ts:279) are outside those
hunks. Changed-line coverage: 32/32 executable lines (100%). Changed-branch coverage not separately
claimed, though no zero-hit BRDA lies in the task hunks.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: conn-close-streams;
  base 3168a0c1b52322611c986b7d5424b85a9b7bdfb0; HEAD c96abd105f3a2ce09b9914997631b902e8531107;
  commits 9261b8a, 686d923, c96abd1 (from `git log 3168a0c..HEAD`, task `touches`, parent message).
- Source/test snapshot identifier (including uncommitted inputs): sha256
  manager.ts c35bc224c0cdb977a0bce0f19c528157ebd79d3362bec07b4d77a75b929291ed,
  handlers.ts 2b933212dcc8137cedd3883ba124f9a2b0e70afec6ad6073bba8bfcf5fa43d9c,
  manager.spec.ts (uncommitted) 338d177ca873af2d002fb4a69851ebbf188e7e5ef99a4d85f2299eeeb4be7f6c,
  handlers.spec.ts (uncommitted) 572b5456c2400e43b15eaba0c762382b3d0bfa83d55601cc32aa0cd62b772420,
  docs-query.int.spec.ts e6299c9a2291cfdd62b922323e8d40775561ce901eb8222da54cafd72ccef156.
  Production hashes identical before (03:47) and after (03:53) all runs.
- Exact included files; renamed/deleted/excluded files and reasons: included
  `packages/backend/src/connections/manager.ts`, `packages/backend/src/docs/query/handlers.ts`.
  Excluded: `manager.spec.ts`, `test/integration/docs-query.int.spec.ts` (tests). No renames or
  deletions. Coverage is from the backend unit tests only; the integration run is not instrumented.
- Provider/version, command, working directory, and test selection: @vitest/coverage-v8 5.1.0,
  vitest 5.1.0; in `packages/backend`:
  `npx vitest run --coverage --coverage.include='src/connections/manager.ts' --coverage.include='src/docs/query/handlers.ts' --coverage.reportsDirectory=coverage/conn-close-streams-final --coverage.reporter=json-summary --coverage.reporter=lcovonly`
  (all backend unit tests, 29 files / 1202 tests).
- Run start/completion time and exit status: 2026-11-17T03:50:39+01:00 - 03:50:53+01:00; all tests
  passed, report generated. An identical earlier run (03:50:06-03:50:20, dir
  `coverage/conn-close-streams`, json/json-summary/text) gave the same summary (same hash).
- Generated report paths and report hashes/run identifier:
  `packages/backend/coverage/conn-close-streams-final/coverage-summary.json`
  sha256 5ee6f7fa2a30cb8cafa824f959da067209d1279741e2f6d4c5d76e3b07bd272f;
  `packages/backend/coverage/conn-close-streams-final/lcov.info`
  sha256 ae9a2db613a2da484e58cf86ef4f7b9f5c5ec6350cc311b9e4dffae7ee075501 (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: fresh, newly created report directory;
  no source or test file changed between the runs and the final hash check.
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/connections/manager.ts` | 241/243 (99.17%) | 123/125 (98.40%) | 45/46 (97.82%) | 209/210 (99.52%) |
| `packages/backend/src/docs/query/handlers.ts` | 18/18 (100%) | 4/4 (100%) | 9/9 (100%) | 16/16 (100%) |
| Aggregate (summed counters, both files measured, none excluded) | 259/261 (99.23%) | 127/129 (98.44%) | 54/55 (98.18%) | 225/226 (99.55%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `manager.ts:91` (default `createClient` = `new MongoClient`, statement + function + branch arm) | Pre-existing; unit tests always inject a fake client | Justified gap: outside task hunks; exercised by integration tests |
| `manager.ts:279` (branch: closed while the SSH tunnel opened) | Pre-existing connect race | Justified gap: outside task hunks and task scope |

## Unable to test

- Instrumented coverage of the integration path (real driver killOp against mongod) is not
  measured; the integration test itself ran and passed. No follow-up needed for this task.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production
defects found (one latency observation for the parent above).
