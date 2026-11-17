# Test Report

Date: 2026-11-17

Task: shell-backend — M4: mongosh host in the backend

Scope: `git diff 160d1d584f71ecb632361988b7c8d6ecafde703a..71c0e305bffbfb51cb0593c6c17552fca90e8c3b`
(base given by the parent; HEAD on `main` is 71c0e30 "shell-backend: mongosh host in worker threads",
plus `assume:` commits that only touch `tasks/shell-backend.md`). The parent named the task commit
0124b5f; HEAD 71c0e30 is the same change after a rebase, and the diff covers the same files. Uncommitted
changes are test files only (listed below). No production code was changed by the test-writer.

Requirements:
- `tasks/shell-backend.md` acceptance criteria and recorded assumptions
- `docs/mongosh.md` (design), `SPEC.md` M4, `docs/ARCHITECTURE.md` ("Coverage", "Conventions")
- Parent instructions (unit tests for output/host/handlers/backend wiring/configOf, split edge cases)

## Test files changed

- `packages/backend/src/shell/output.spec.ts` (new)
- `packages/backend/src/shell/host.spec.ts` (new)
- `packages/backend/src/shell/handlers.spec.ts` (new)
- `packages/backend/src/shell/split.spec.ts` (extended)
- `packages/backend/src/connections/manager.spec.ts` (extended: `configOf`)
- `packages/backend/src/server/backend.spec.ts` (extended: shell wiring, `conn.close` closes shells)
- `test/integration/shell.int.spec.ts` (extended: 2 cases)

## Tests added or updated

Count: 112 (output 24, host 35, handlers 12, split 30, manager 5, backend 4, integration 2)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `use test; db.c.insertOne({a:1}); db.c.find()` returns the document as EJSON | int `shell.eval > use test; db.c.insertOne({a:1}); db.c.find() returns the document as EJSON` (existing); unit `resultOutput > a cursor batch: the documents as an EJSON array…`, `splitShellInput > splits shell commands out of "use test; …"` | `npx vitest run --config test/integration/vitest.config.ts shell --reporter=verbose` (Podman/Testcontainers, MongoDB 8 fixture); `cd packages/backend && npx vitest run src/shell` | Pass |
| AC2: interrupt stops `while(true){}` within 2 s | int `interrupt > stops while(true){} within 2 s and the session goes on` (1646 ms); unit `host.spec` `an evaluation that does not stop is terminated after interruptGraceMs and restarted on the same db` (999 ms kept / 1000 ms terminated, fake timers), `cancel interrupts cooperatively…`, `honours a custom interruptGraceMs` | same as above | Pass |
| AC3: `complete('db.c.fi')` suggests `find`, `findOne` | int `shell.complete > complete('db.c.fi') suggests find and findOne`; unit `ShellHost.complete > asks the worker and answers its completions`, `shellHandlers > shell.complete of "db.c.fi" …` | same as above | Pass |
| Assumption: evaluations of a session are queued; a cancelled queued eval is dropped | `host.spec` `queues evaluations of a session…`, `an evaluation cancelled while queued is dropped…`, `sessions do not wait for each other` | `npx vitest run src/shell/host.spec.ts` | Pass |
| Assumption: cancel = interrupt, worker replaced after 1 s, restart notice on next eval, same db kept | `host.spec` restart tests, `messages of a replaced worker are ignored`, `a worker that dies during an evaluation…`, `a failed restart fails the evaluation; the next evaluation tries again`, `an evaluation cancelled while its worker restarts is not run` | same | Pass |
| Open failure maps like a connect error, secrets masked, worker terminated; `UNSUPPORTED` without worker | `host.spec` `ShellHost.open` (8 tests); `backend.spec` `shell.open answers UNSUPPORTED without a shell worker once connected` | `npx vitest run src/shell/host.spec.ts src/server/backend.spec.ts` | Pass |
| `NOT_FOUND` for unknown sessions (eval/complete/close) | `host.spec`, `handlers.spec`, `backend.spec` `serves shell.*…`, int `answers NOT_FOUND for an unknown session` | unit + int commands above | Pass |
| Assumption: conn.close also closes that profile's shell sessions | `backend.spec` `conn.close also closes the shell sessions of that profile, after the connection`, `conn.close answers only once the shell sessions are closed`; `host.spec` `closeProfile closes only the sessions of that profile`; int `closeProfile (conn.close) ends every session of the profile` | unit + int commands above | Pass |
| `ConnectionManager.configOf` (open config, secrets resolved; NOT_CONNECTED otherwise) | `manager.spec` `ConnectionManager.configOf (task shell-backend)` (5 tests) | `npx vitest run src/connections/manager.spec.ts` | Pass |
| Output typing: canonical EJSON, cursor batches, "it" hint, Help without value, cross-realm vm errors, codeName | `output.spec.ts` (24 tests) | `npx vitest run src/shell/output.spec.ts` | Pass |
| Assumption: input split at shell commands at a statement start | `split.spec.ts` (47 cases) | `npx vitest run src/shell/split.spec.ts` | Fail: 1 test (TW-1) |
| Same, end to end | int `shell.eval > runs the lines after a shell command that has a trailing comment` | int command above | Fail (TW-1) |
| shell.eval not write-guarded (SPEC M4) | `backend.spec` `serves shell.*…` (read-only production profile → NOT_FOUND, not READ_ONLY), `handlers.spec` served stream test | unit command | Pass |
| Bundled `shell-worker.cjs` runs in the Electron utilityProcess (build.mjs entry) | — | — | Not run: needs Electron packaging/e2e; the parent's assumption already records it as unverified |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/shell src/connections/manager.spec.ts src/server/backend.spec.ts`
(run file by file during development)

Result:

Fail — 1 failing test (TW-1, `split.spec.ts`); all other new and existing tests pass.

`npx vitest run --config test/integration/vitest.config.ts shell --reporter=verbose` (Podman fixtures):
11 passed, 1 failed (TW-1 end-to-end).

## Full test execution

Command:

`npm run check` (eslint + prettier + typecheck + `vitest run` for all workspaces)

Result:

Fail — lint, prettier and typecheck pass; vitest: 58 files passed, 1 failed; 3390 tests passed,
1 failed (TW-1). The renderer test step (`npm run test -w packages/renderer`) did not run because the
`&&` chain stops at the vitest failure.

## .taskcheck

Result:

Fail — `.taskcheck` runs `npm run check` (see above); fails only on TW-1.

## Bugs found

### A shell command line with a trailing comment swallows the rest of the input

Finding ID:

`TW-1`

Test:

`packages/backend/src/shell/split.spec.ts` > `splitShellInput > a command line with a trailing comment still ends the command (the next lines run)`;
`test/integration/shell.int.spec.ts` > `shell.eval > runs the lines after a shell command that has a trailing comment`

Production source:

`packages/backend/src/shell/split.ts:83-100` (`COMMAND` regex / `commandAt`)

Requirement:

Task assumption "Console input is split into pieces at shell commands (use/show/it/exit/quit at a
statement start) because mongosh's evaluator would read 'use test; db.c.find()' as switching to db
'test;'"; AC1 (multi-statement console input runs every statement).

Expected behavior:

`use test // switch first\ndb.c.find()` splits into `['use test', '\ndb.c.find()']`; the find runs.

Actual behavior:

`COMMAND` takes `//`, `switch`, `first` as arguments of `use`, so `commandAt` rejects it (`use` needs
exactly one argument) and the whole input stays one piece. mongosh's evaluator
(`shell-evaluator.js:39`, `input.split(/\s+/)`) then runs `use("test", "//", "switch", "first",
"db.c.find()")`: it switches the database and silently drops the following lines. Verified against the
real server: the integration test gets `already on db shell_…` as the only result, no `db.getName()`
result. Same for `show dbs // …` and `it // …`. A line comment after a command should end the command
(and be dropped), like `use test; // …` already does.

Severity:

Medium (silent loss of user input; data-changing statements after the comment are not run and
nothing tells the user).

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### Observations (no failing test; parent decides whether in scope)

- O-1 (Low): a worker that exits unexpectedly during an evaluation ends that `shell.eval` stream
  normally (`end`, no `error` output); the user only learns about it from the restart notice on the
  next input (`host.ts:151`, the `exit` message resolves `done` like `evalDone`). Test
  `a worker that dies during an evaluation ends it…` only asserts that it settles.
- O-2 (Low): a queued evaluation of a session closed meanwhile (e.g. by `conn.close`) starts a fresh
  worker that connects to the server before failing `NOT_FOUND` (`host.ts:289-296`: `closeSession`
  marks the session dead, `ensureWorker` restarts it before checking `closed`). Test
  `a queued evaluation of a closed session fails and leaves no worker running` asserts the outcome
  (NOT_FOUND, every worker terminated, the queued code never posted), not the extra connect.
- O-3 (Low): the restart in `ensureWorker` ignores the evaluation's abort signal
  (`startWorker(..., session.db)` without `signal`), so a cancel during a slow reconnect waits for the
  open to finish (the RPC layer's 5 s `STREAM_CANCEL_GRACE_MS` still answers CANCELLED).
- O-4 (Low): `ShellHost.eval` throws `NOT_FOUND` synchronously instead of returning a rejected
  promise; the handler checks `host.has` first, so it is not visible over RPC.

## Coverage

Status: verified (task-scoped whole-file coverage, unit suite of `packages/backend`, with the one
known-failing TW-1 test deselected so the run could exit 0; a run including it exits 1 because of
TW-1 only).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (no changed-line tooling configured).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `shell-backend`,
  base 160d1d584f71ecb632361988b7c8d6ecafde703a, HEAD 71c0e305bffbfb51cb0593c6c17552fca90e8c3b;
  file scope from the parent's list and `git diff --stat 160d1d5..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): sha256 over the sha256sums of
  `packages/backend/src/shell/*.ts`, `connections/manager{,.spec}.ts`, `server/backend{,.spec}.ts`,
  `server/entry.ts`, `test/integration/shell.int.spec.ts` =
  `a514d23c70073f1b3a193a432773385181eb6616462d0f0fa2ab1a852618498f` before and after the final run.
- Exact included files: `src/shell/{split,output,runtime,worker,host,handlers,protocol,index}.ts`,
  `src/connections/manager.ts`, `src/server/backend.ts`, `src/server/entry.ts` (packages/backend).
  Excluded: `packages/backend/src/index.ts` (one re-export line), `packages/backend/package.json`,
  `package-lock.json` (configuration), `apps/desktop/scripts/build.mjs` (build script, no unit
  tests in the project for it), tests, `tasks/`.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` with
  vitest 5.1.0, Node 24.21.0; in `packages/backend`:
  `npx vitest run --coverage --coverage.reportsDirectory=coverage/shell-backend-tw2 --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text-summary --coverage.include='src/shell/split.ts' … --coverage.include='src/server/entry.ts' -t '^(?!.*trailing comment)'`
  (all 24 backend spec files; 1058 passed, 1 skipped = TW-1 deselected).
- Run start/completion time and exit status: started 2026-11-17 02:58:46 (+01:00), ~6 s, exit 0.
- Generated report paths and report hashes/run identifier:
  `packages/backend/coverage/shell-backend-tw2/coverage-summary.json`
  (sha256 `27b0ba041b2aa08492199a48be7e45320443dd9a179e5a1f3afd40121295fa0e`), `coverage-final.json`
  (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: new report directory for this run; snapshot
  hash identical before and after.
- Final run after latest test additions and production fixes: yes (no production fixes yet; after
  TW-1 is fixed, coverage must be re-run).

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/shell/split.ts` | 130/132 (98.48%) | 113/114 (99.12%) | 11/11 (100%) | 111/112 (99.1%) |
| `packages/backend/src/shell/output.ts` | 32/32 (100%) | 47/48 (97.91%) | 8/8 (100%) | 30/30 (100%) |
| `packages/backend/src/shell/host.ts` | 167/174 (95.97%) | 63/72 (87.5%) | 43/48 (89.58%) | 145/146 (99.31%) |
| `packages/backend/src/shell/handlers.ts` | 13/13 (100%) | 4/4 (100%) | 7/7 (100%) | 11/11 (100%) |
| `packages/backend/src/shell/runtime.ts` | 0/59 (0%) | 0/10 (0%) | 0/16 (0%) | 0/51 (0%) |
| `packages/backend/src/shell/worker.ts` | 0/42 (0%) | 0/17 (0%) | 0/7 (0%) | 0/35 (0%) |
| `packages/backend/src/shell/protocol.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/shell/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/connections/manager.ts` | 175/177 (98.87%) | 91/93 (97.84%) | 38/39 (97.43%) | 152/153 (99.34%) |
| `packages/backend/src/server/backend.ts` | 38/41 (92.68%) | 10/12 (83.33%) | 11/14 (78.57%) | 36/37 (97.29%) |
| `packages/backend/src/server/entry.ts` | 0/6 (0%) | 0/2 (0%) | 0/1 (0%) | 0/6 (0%) |
| Aggregate (summed counters, all 11 files above) | 555/676 (82.1%) | 328/372 (88.17%) | 118/151 (78.14%) | 485/581 (83.47%) |

The aggregate includes `runtime.ts`, `worker.ts` and `entry.ts` at 0%: they run only inside a
worker thread / Electron utilityProcess, which the unit run does not instrument. Integration
coverage of the worker threads was not measured (the project's coverage setup covers unit runs only).
`manager.ts` and `backend.ts` are whole-file numbers that include pre-existing code.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `src/shell/runtime.ts:21-159`, `src/shell/worker.ts:12-74` | The mongosh runtime: eval, EJSON results, completions, interrupt (all three ACs) | Exercised end to end by the 12 integration tests in a real worker thread against MongoDB 8 (AC1-3 pass); not instrumented by V8 coverage in worker threads. Justified gap. |
| `src/server/entry.ts:9-19` | utilityProcess entry, passes `shell-worker.cjs` path | Needs Electron; not unit-testable without the utilityProcess. Gap; covered only by the parent's e2e/packaging assumption. |
| `src/shell/host.ts:79, 82` | default `new Worker(url)` / no-op log | Default factory used by the integration tests (real workers); trivial. |
| `src/shell/host.ts:241` | `closeSession` re-entry guard | Practically unreachable: the session leaves the map synchronously on the first close (concurrent close test added, covers the outcome). |
| `src/shell/host.ts:257, 265, 331` | `terminate().catch` handlers | Defensive; a rejecting `terminate` is not a behavior of the task. |
| `src/shell/host.ts:311` | second `UNSUPPORTED` check in `startWorker` | Unreachable (open checks first; restarts need an opened session). |
| `src/shell/split.ts:125, 166` | backslash escape at end of string / regex hitting a line break | Edge of unterminated literals; behavior covered by `unterminated literals…` tests. |
| `src/shell/output.ts:80#1` | EJSON text that is blank | Not producible by `BSON.EJSON.stringify` for defined values. |
| `src/server/backend.ts:60, 64#1` | shell log prefix; `conn.close` handler missing | Log prefix needs a real worker start; `conn.close` always exists. Minor. |
| `src/connections/manager.ts:270` | `configOf` with a client without recorded config | Defensive: every client goes through the wrapping `createClient`. |

## Unable to test

- The bundled `apps/desktop/dist/shell-worker.cjs` inside the real Electron utilityProcess (build.mjs
  entry, esbuild externals): needs an Electron build/e2e run; not run here. Follow-up as recorded in
  the task's assumptions.
- Coverage of `runtime.ts`/`worker.ts` as numbers: code runs in worker threads that V8 coverage does
  not report in this setup; behavior verified by the integration tests instead.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion.
(TW-1, Medium: a trailing `//` comment on a shell command line makes the rest of the input be silently
dropped; failing unit and integration tests are in place. Acceptance criteria 1-3 pass in the
integration suite. O-1..O-4 are low-severity observations for the parent to triage.)
