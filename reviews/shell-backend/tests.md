# Test Report

Date: 2026-11-17

Task: shell-backend — M4: mongosh host in the backend (round 2, after the fixes in 20ff545)

Scope: task base `00b77872e6a71c850815fba8de4d22045dff09e7` (given by the parent) to HEAD
`2708094b5afff8f523c451cf96f3c0829f978343`. The parent named the task commits 1b7bc07 (impl),
723b4b0 (tests + round-1 reports) and 20ff545 (fixes). On `main` they are 2f0b3d7, 6339ca9 and
2708094 after a rebase; `git patch-id --stable` of 20ff545 and 2708094 is identical
(`91a9bfbd33331093af5feabe1c45e280dc495367`), so the reviewed revision is 20ff545 = 2708094. The
other commits in the range (735b36d, 1a5c1bb, efcb4b3, 3733d93) touch only `tasks/*.md`. Plus the
uncommitted test edits listed below (the round-2 test-writer run that died left part of them; this
run fixed and completed them). No production code was changed by the test-writer.
(`reviews/shell-backend/review.md` shows as modified in the working tree; this run did not touch it.)

Requirements:
- `tasks/shell-backend.md` acceptance criteria and recorded assumptions (exit/quit handling, splitting
  at shell commands, restart notice, cancel = interrupt)
- `reviews/shell-backend/fixes.md` (behaviour changed by 20ff545: TW-1, CR-2, CR-3, CR-4/O-2, O-1,
  O-3, O-4)
- `docs/ARCHITECTURE.md` "Coverage", parent instructions for round 2

## Test files changed

- `packages/backend/src/shell/host.spec.ts`
- `packages/backend/src/shell/split.spec.ts`
- `test/integration/shell.int.spec.ts`

## Tests added or updated

Count: 21 (host 8, split 11, integration 2)

Four tests from the interrupted run failed. Each was analysed; all four were wrong test expectations
or harness races, none is a production defect:

| Failing test | Cause | Resolution |
|---|---|---|
| host "the restart notice is shown once: the evaluation after it gets none" (`expected 1 >= 2`) | Harness race: the expected eval count was read after `host.eval` and a `vi.waitFor` poll, by which time the replacement had already got the eval, so it waited for one eval too many. | Count taken before `host.eval`. Passes; also under `--sequence.shuffle` (2 runs). |
| host "cancelling a completion that started a restart only stops waiting..." (`expected +0 to be 1`) | Wrong expectation: the restart notice is emitted but by design not counted as an output of the evaluation (same contract as the existing test "...restarts its worker..." asserting `resolves.toBe(1)` with notice + one result). | Expect `0`; the notice itself is still asserted in `outputs`. |
| split `use test // first\r\ndb.c.find()` (got `'\ndb.c.find()'`) | Wrong expectation: the `\r` is whitespace consumed with the command line, exactly like the existing case `use test\r\ndb.c.find()` -> `'\ndb.c.find()'`. Semantically harmless; the next line still runs (now also checked end-to-end in the integration test). | Expect `['use test', '\ndb.c.find()']`. |
| split `/* first */ use test // then\nx` (got `['/* first */','use test','\nx']`) | Wrong expectation: a comment before a command stays a JS piece of its own, as in the existing case `use test; // switch first` -> `[..., ' // switch first']`. Verified against the real mongosh runtime (integration test): a comment-only piece produces no output. | Expect `['/* first */', 'use test', '\nx']`; added `// note\nuse test\nx`. |

New tests this round:
- host.spec.ts (ShellHost.eval): worker crashing after an interrupt but before the grace ends
  (CANCELLED, no error output, grace timer cleared, notice on next eval); restart notice shown once.
- host.spec.ts (ShellHost.complete, CR-3): cancelling a completion that started a restart only stops
  waiting (restart finishes, no extra worker, next eval gets the notice); an eval cancelled while
  waiting for a completion-started restart is CANCELLED and never runs, the restart goes on; a
  completion waiting on an eval's restart that gets cancelled fails CANCELLED and the next completion
  starts a fresh worker; a completion whose restart fails answers the open error
  (NETWORK_ERROR) and the next eval retries with the notice; a completion restarting a session that
  gets closed answers NOT_FOUND and terminates the replacement.
- host.spec.ts (close, O-1): a worker that exits during close instead of answering `closed` ends the
  running evaluation with "The shell session was closed", not the crash text (covers the
  `session.closed ? CLOSED_TEXT` branch added in 20ff545).
- split.spec.ts (TW-1): trailing-comment edge cases (CRLF, `/**/`, `/*/ x */`, `;` inside a block
  comment, `// a; db.c.drop()` swallows the rest of the line, block + line comment, a leading
  comment, a line comment before the command); command with a trailing comment between JS lines;
  an unterminated string at end of input; a regex literal ending at a line break.
- shell.int.spec.ts (real mongosh, MongoDB 8 fixture): comments around a command
  (`/* first */ use DB // then\r\n// note\r\ndb.getName()`) produce only the `use` and
  `db.getName()` results, a `db` event and no error; `exit;` between JS lines prints the notice in
  place and the following line runs (results 2, notice, 4); `quit(1)` fails with the notice; the
  session's variables survive.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `use test; db.c.insertOne({a:1}); db.c.find()` returns the document as EJSON | int `use test; db.c.insertOne({a:1}); db.c.find() returns the document as EJSON` | `npm run test:int -- test/integration/shell.int.spec.ts` (Podman, mongo8 fixture) | Pass |
| AC2: interrupt stops `while(true){}` within 2 s | int `stops while(true){} within 2 s and the session goes on`; host grace-timer tests | same int command; `npx vitest run packages/backend/src/shell` | Pass |
| AC3: `complete('db.c.fi')` suggests `find`, `findOne` | int `complete('db.c.fi') suggests find and findOne`; host `asks the worker and answers its completions` | same | Pass |
| TW-1: a command with trailing comments ends there, the next lines run | split trailing-comment cases (incl. new edge cases); int `runs the lines after a shell command that has a trailing comment`, `comments around a shell command ...` | same | Pass |
| CR-2: exit/quit are not passed to mongosh; session keeps working | split `isExitCommand` tests; int `exit / quit / exit() are refused ...`, `exit between JavaScript lines is refused in place; quit(1) fails ...` | same | Pass |
| CR-3: completion restarts a dead worker; restart shared; notice kept for next eval | host ShellHost.complete restart tests (6 incl. 5 new); int `completion works right after the worker was restarted ...` | same | Pass |
| CR-4/O-2: queued eval of a closed session starts no worker | host `a queued evaluation of a closed session fails and leaves no worker running` | `npx vitest run packages/backend/src/shell` | Pass |
| O-1: worker death under an eval ends it with an error output; told once | host dying-worker tests, `a running evaluation of a closed session ends with an error output`, new close-exit test, new crash-after-interrupt test | same | Pass |
| O-3: cancel during a restart stops it | host `an evaluation cancelled while its worker restarts ...` | same | Pass |
| O-4: unknown session -> rejected promise | host `answers an unknown session with a rejected promise ...` | same | Pass |

## Focused test execution

Command:

`npx vitest run packages/backend/src/shell` (repo root)

Result:

Pass — 4 files, 159 tests (also 2 runs with `--sequence.shuffle`: 159 passed each).

`npm run test:int -- test/integration/shell.int.spec.ts` (Podman, MongoDB 8 container fixture)

Result:

Pass — 16 tests (2 new). Run on the final integration spec (sha256 `1c5406e5…`) and unchanged
production code; the later edits were to unit spec files only.

## Full test execution

Command:

`npm run check` (eslint --max-warnings 0, prettier --check, type checks, vitest, renderer `ng test`)

Result:

Pass — vitest 59 files / 3432 tests, renderer 72 files / 2154 tests. (A first attempt failed only
in `prettier --check` on a coverage output directory this run had created with a custom
`reportsDirectory`; the directory was deleted and the final coverage used the git-ignored default
`coverage/`. Rerun passed.)

## .taskcheck

Result:

Pass — `.taskcheck` runs `npm run check`; result above.

## Bugs found

None. The four failing tests from the interrupted run were test errors (see table above), not
production defects.

## Coverage

Status: verified for unit-test coverage; `runtime.ts` and `worker.ts` run only inside worker threads
(integration tests) and are not instrumented by the configured provider.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line report).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `shell-backend`,
  base `00b77872e6a71c850815fba8de4d22045dff09e7`, HEAD `2708094b5afff8f523c451cf96f3c0829f978343`;
  task commits 2f0b3d7/6339ca9/2708094 (rebased 1b7bc07/723b4b0/20ff545, patch-id checked for the
  fix commit); file scope from `git diff --name-status <base> HEAD`, intervening commits only
  touch `tasks/`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 2708094 + uncommitted test
  files: `host.spec.ts` sha256 `4dc301661884e49b3466c0424c2b4c1f8a0736dbe0be754d42cd4df0877c0696`,
  `split.spec.ts` `462f42a56b9a422b1ebb811f91f754116ac5974e27d7488923a97b2d3acb263b`,
  `shell.int.spec.ts` `1c5406e5c2133f58390d896fffb991854710890c1c37f0c7def55f948f69fa08`.
  Production files unmodified in the working tree (`git status`).
- Exact included files: `packages/backend/src/` `shell/{handlers,host,index,output,protocol,runtime,split,worker}.ts`,
  `connections/manager.ts`, `index.ts`, `server/backend.ts`, `server/entry.ts`. Excluded:
  `apps/desktop/scripts/build.mjs` (build script, no unit tests or coverage in the backend
  workspace); spec files and `test/integration/shell.int.spec.ts` (tests). No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` with
  vitest 5.1.0, Node v24.21.0; in `packages/backend`:
  `npx vitest run --coverage --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text-summary --coverage.include=<each file above>`;
  all backend unit tests (24 files, 1100 tests).
- Run start/completion time and exit status: started 2026-11-17 03:14:10 (+01:00), duration 6.16 s,
  exit 0, all tests passed.
- Generated report paths and report hashes/run identifier:
  `packages/backend/coverage/coverage-summary.json` sha256 `13c4010245bfa9cfbc367a4f9665aba008954a6c5e317013f4c4bee75b81b9be`,
  `packages/backend/coverage/coverage-final.json` sha256 `8b39e23b33b9cb61421370057b5c41f591fcad963eb5014a9ac305517f119070`
  (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: vitest cleans the reports directory before
  the run; spec hashes above were taken after the run and match the tested files; no edits after it.
- Final run after latest test additions and production fixes: yes (production last changed in
  20ff545; all test additions precede this run).

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/shell/host.ts` | 192/202 (95.04%) | 80/92 (86.96%) | 46/52 (88.46%) | 168/169 (99.41%) |
| `packages/backend/src/shell/split.ts` | 134/134 (100%) | 114/114 (100%) | 12/12 (100%) | 114/114 (100%) |
| `packages/backend/src/shell/output.ts` | 32/32 (100%) | 47/48 (97.92%) | 8/8 (100%) | 30/30 (100%) |
| `packages/backend/src/shell/handlers.ts` | 13/13 (100%) | 4/4 (100%) | 7/7 (100%) | 11/11 (100%) |
| `packages/backend/src/shell/runtime.ts` | 0/67 (0%) | 0/12 (0%) | 0/17 (0%) | 0/59 (0%) |
| `packages/backend/src/shell/worker.ts` | 0/42 (0%) | 0/17 (0%) | 0/7 (0%) | 0/35 (0%) |
| `packages/backend/src/shell/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/shell/protocol.ts` | N/A (0/0, types only) | N/A | N/A | N/A |
| `packages/backend/src/connections/manager.ts` | 175/177 (98.87%) | 91/93 (97.85%) | 38/39 (97.44%) | 152/153 (99.35%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| `packages/backend/src/server/backend.ts` | 38/41 (92.68%) | 10/12 (83.33%) | 11/14 (78.57%) | 36/37 (97.30%) |
| `packages/backend/src/server/entry.ts` | 0/6 (0%) | 0/2 (0%) | 0/1 (0%) | 0/6 (0%) |
| **Aggregate (summed counters, all 12 files above)** | 585/715 (81.82%) | 346/394 (87.82%) | 122/157 (77.71%) | 512/615 (83.25%) |

Aggregate includes `runtime.ts`, `worker.ts` and `entry.ts` at 0% (not instrumentable by unit
tests, see below); excluded: `apps/desktop/scripts/build.mjs`. Compared with round 1 (pre-fix
revision), `split.ts` is now fully covered and the new `CLOSED_TEXT` branch of the worker `exit`
handler in `host.ts` is covered.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `shell/runtime.ts` (all), `shell/worker.ts` (all) | mongosh evaluation, exit/quit refusal, interrupt, completion | Run inside `worker_threads` spawned by the host; the v8 provider does not instrument them. Exercised by the 16 integration tests (AC1–AC3, exit/quit, comments, interrupt, completion after restart) — all pass. Measuring would need provider/config changes outside test-writer authority. |
| `server/entry.ts:9-19` | Process entry point wiring | Bootstrap, not unit-tested in the project; out of the changed behaviour of 20ff545. |
| `shell/host.ts:89, 92` | Default `new Worker(url)` and default no-op `log` | Used only with the real worker (integration tests); unit tests inject fakes. Non-material. |
| `shell/host.ts:156` (`signal.aborted` after `ensureWorker` resolved) | Abort landing between restart completion and its continuation | Only reachable in a microtask window (aborts during the restart reject in `abortable`). Defensive; no deterministic test without reaching into internals. |
| `shell/host.ts:174#1, 225#1, 282#1` | Implicit `else` for unrelated message types to an eval/completion id or during close | Defensive; the worker protocol never sends those. Non-material. |
| `shell/host.ts:192#1` | Grace timer firing after the eval finished or the worker changed | `finally` clears the timer first; defensive. |
| `shell/host.ts:275#0` | `closeSession` on an already closed session | The session is removed from the map in the same step, so callers get NOT_FOUND first; the concurrent-close test covers the public behaviour. Defensive. |
| `shell/host.ts:291, 299, 348, 385` | `.catch(() => undefined)` callbacks of `worker.terminate()` | Only run if `terminate()` rejects; harmless swallow. Non-material. |
| `shell/host.ts:334#1` | `clear` when a newer restart replaced `session.restarting` | Not reachable with the current single-restart sequencing. Defensive. |
| `shell/host.ts:345#0` | `restart` on a closed session before starting a worker | `runEval` checks `closed` first and `complete` cannot find a closed session. Defensive (CR-4 behaviour is covered by the queued-eval test). |
| `shell/host.ts:364-365` | `startWorker` without `workerUrl` during a restart | `open` refuses first (tested); unreachable in a restart. |
| `shell/host.ts:403#1` | `openFailed` error without `code` | Minor mapping path from the impl commit; error mapping itself is covered by the open/restart failure tests. Low risk; not added. |
| `shell/output.ts:80#1` | `EJSON.stringify` returning a non-string/blank | Defensive. Unchanged from round 1. |
| `connections/manager.ts:65, 269-270`; `server/backend.ts:40, 60, 64#1, 103` | Default callbacks / a defensive branch in wiring | Not changed by 20ff545; covered in round 1 to the same level. Non-material. |

## Unable to test

- Coverage of `runtime.ts` / `worker.ts`: behaviour is tested end-to-end (integration), but the
  provider does not instrument worker threads; no follow-up needed unless the project wants worker
  coverage (would need tooling configuration).
- Running the worker inside the real Electron `utilityProcess` / the bundled `shell-worker.cjs`:
  not in this scope (recorded as an assumption by the parent); not run.

## Summary

Tests added and all validation passed. The four failing tests left by the interrupted run were
wrong expectations / a harness race (fixed in the tests, reasons above); no production defects
found. Behaviour changed in 20ff545 (trailing comments, exit/quit, completion-triggered restarts,
close-time worker exit) is covered by unit and integration tests.
