# Test Report

Date: 2026-11-17

Task: shell-backend — M4: mongosh host in the backend (final report, round 3, revision 02d12f9)

Scope: task base `735b36d36aa2edab5c72fc2c7dda7f749f430509` (`git merge-base HEAD origin/main`,
given by the parent) to HEAD `02d12f9070f8e5b061be5f3f32a9a8d794037dc7`. Task commits: 2f0b3d7
(impl), 6339ca9 (tests + round-1 reports), 2708094 (fixes, round 2; patch-id equal to the
pre-rebase 20ff545), 92c9fb1 (round-2 tests and reports), 02d12f9 (CR-5 fix). The round-2 base
`00b77872…` and 735b36d differ only in `tasks/*.md`, so both give the same production file set.
Round 3 checked the one production change since round 2: 02d12f9 in
`packages/backend/src/shell/split.ts` (the `COMMAND` argument pattern no longer takes in `//` or
`/*`). The scope also includes the uncommitted test edits listed below. The test-writer changed no
production code. (`reviews/shell-backend/review.md` shows as modified in the working tree; this run
did not touch it.)

Requirements:
- `tasks/shell-backend.md` acceptance criteria and recorded assumptions (exit/quit handling, splitting
  at shell commands, restart notice, cancel = interrupt)
- `reviews/shell-backend/fixes.md` (round 3: CR-5; earlier rounds: TW-1, CR-2, CR-3, CR-4/O-2,
  O-1, O-3, O-4)
- `docs/ARCHITECTURE.md` "Coverage", parent instructions for round 3

## Test files changed

Round 3 (uncommitted):
- `packages/backend/src/shell/split.spec.ts`
- `test/integration/shell.int.spec.ts`

Earlier rounds (committed in 6339ca9 / 92c9fb1): `packages/backend/src/shell/host.spec.ts`,
`split.spec.ts`, `handlers.spec.ts`, `output.spec.ts`, `test/integration/shell.int.spec.ts`,
`connections/manager.spec.ts`, `server/backend.spec.ts`.

## Tests added or updated

Count (round 3): 26. That is 25 unit cases in `split.spec.ts` and 1 integration test. Round 2 added
21 tests and round 1 added the original suites.

Round 3, `split.spec.ts`:
- "CR-5 glued comments end the argument" (13 cases):
  - commands without arguments with a glued comment: `quit/* now */`, `exit//bye\n1`, `it/**/\nx`;
  - `show profile//x\ny` -> `show profile`;
  - two glued block comments (`show dbs/*a*//*b*/`);
  - a `/` inside an argument, with a glued comment after it (`use a/b// c`), and without one
    (`show a/b/c`, `use a*/b`);
  - a trailing `/` before `;` (`use a/;x` -> `use a/`, `x`);
  - `use a/// c` -> `use a` (the comment starts at the first `//`);
  - a glued block comment then `;` (`show profile 5/*a*/;x`);
  - a glued comment after JavaScript at a statement start (`x = 1; use t//c\ny`);
  - a comment after the `;` (`use t;//c\nx` -> `use t`, `//c\nx`).
- "CR-5 not a command" (7 cases): the whole input stays JavaScript for:
  - code after a glued block comment (`use a/*b*/c`);
  - an open glued block comment (`use a/*`, `use a/*/b`);
  - `//` inside a quoted argument (`use "a//b"`);
  - command text inside a string (`print("use t// c")`) or after a JavaScript line comment
    (`db.c.find() // use t//x`);
  - an argument starting with `/` (`use /x`).
- "a long non-command line is rejected quickly (no catastrophic backtracking)" (5 cases):
  - 40k-character lines of glued slashes, many arguments, or only slashes (pass, a few ms);
  - 28 block comments (spaced or glued) followed by code (both **fail**, see TW-2).

Round 3, `shell.int.spec.ts` (real mongosh, MongoDB 8 fixture):
- "a comment glued to a command argument is a comment: the next lines run (CR-5)":
  - `use ${DB}// c\ndb.getName()` (the test database) gives exactly the results
    `switched to db ${DB}` and `${DB}`, with no error;
  - `show dbs/* x */` runs `show dbs` (lists `admin`, no error).

Round 2 (still valid, unchanged code paths except `split.ts`):
- host.spec.ts:
  - crash after an interrupt within the grace period;
  - the restart notice is shown once;
  - completion-started restarts (CR-3): cancel, shared restart, failed restart, closed session;
  - worker exit during close (O-1).
- split.spec.ts: trailing-comment edge cases (TW-1).
- int:
  - comments around a command (CRLF, leading block comment);
  - `exit;` between JavaScript lines, and `quit(1)`.

The four failing tests left by the interrupted round-2 run were test errors and were fixed then.
None was a production defect.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `use test; db.c.insertOne({a:1}); db.c.find()` returns the document as EJSON | int `use test; db.c.insertOne({a:1}); db.c.find() returns the document as EJSON` | `npx vitest run --config test/integration/vitest.config.ts shell` (Podman, mongo8 fixture) | Pass |
| AC2: interrupt stops `while(true){}` within 2 s | int `stops while(true){} within 2 s and the session goes on`; host grace-timer tests | same int command; `npx vitest run packages/backend/src/shell` | Pass |
| AC3: `complete('db.c.fi')` suggests `find`, `findOne` | int `complete('db.c.fi') suggests find and findOne`; host `asks the worker and answers its completions` | same | Pass |
| CR-5: a comment glued to a command argument is a comment; a single `/` stays in the argument | split `CR-5 glued comments end the argument` (13), `CR-5 not a command` (7), fixer's 6 `trailing comment edge cases`; int `a comment glued to a command argument is a comment ... (CR-5)` | same | Pass |
| TW-1: a command with trailing comments ends there, the next lines run | split trailing-comment cases; int `runs the lines after a shell command that has a trailing comment`, `comments around a shell command ...` | same | Pass |
| Robustness of the command recogniser (TW-2, not an AC) | split `a long non-command line is rejected quickly ...` (5) | `npx vitest run packages/backend/src/shell` | **Fail** (2 of 5: 28 block comments then code, 3.3 to 6.1 s) |
| CR-2: exit/quit are not passed to mongosh; session keeps working | split `isExitCommand` tests; int `exit / quit / exit() are refused ...`, `exit between JavaScript lines ...` | same | Pass |
| CR-3: completion restarts a dead worker; restart shared; notice kept for next eval | host ShellHost.complete restart tests; int `completion works right after the worker was restarted ...` | same | Pass |
| CR-4/O-2: queued eval of a closed session starts no worker | host `a queued evaluation of a closed session fails and leaves no worker running` | `npx vitest run packages/backend/src/shell` | Pass |
| O-1: worker death under an eval ends it with an error output; told once | host dying-worker, close-exit and crash-after-interrupt tests | same | Pass |
| O-3: cancel during a restart stops it | host `an evaluation cancelled while its worker restarts ...` | same | Pass |
| O-4: unknown session -> rejected promise | host `answers an unknown session with a rejected promise ...` | same | Pass |

## Focused test execution

Command:

`npx vitest run packages/backend/src/shell` (repo root)

Result:

Fail: 4 files, 188 passed and 2 failed (the TW-2 timing tests). All CR-5 and earlier cases pass.

Command:

`npx vitest run --config test/integration/vitest.config.ts shell` (Podman, MongoDB 8 container
fixture)

Result:

Pass: 1 file, 17 tests (1 new). Run on the final integration spec (sha256 `02615a2e…`, unchanged by
the later Prettier run).

## Full test execution

Command:

`npm run check` (eslint --max-warnings 0, prettier --check, type checks, vitest, renderer `ng test`)

Result:

Fail.
- eslint, prettier and the type checks pass. A first attempt failed Prettier on the new
  `split.spec.ts`. The file was formatted with `npx prettier --write` and the check was run again.
- vitest: 59 files, 3461 passed and 2 failed (the TW-2 tests).
- The renderer `ng test` did not run because the chain stops at the vitest failure.

## .taskcheck

Result:

Fail. `.taskcheck` runs `npm run check` (result above) and stays failing until TW-2 is fixed.

## Bugs found

### Exponential backtracking in the shell-command recogniser for a run of block comments

Finding ID:

`TW-2`

Test:

- `splitShellInput > a long non-command line is rejected quickly (no catastrophic backtracking):
  28 block comments then code`
- `... 28 glued block comments then code`

(`packages/backend/src/shell/split.spec.ts:198-218`)

Production source:

`packages/backend/src/shell/split.ts:89-90` (`COMMAND`, trailing-comment group
`(?:(?:\/\*.*?\*\/|\/\/.*)[^\S\n]*)*`)

Requirement:

Console input is split at shell commands (task assumption). The splitter runs on every
`shell.eval` in the worker (`runtime.ts:113`) and must finish in time linear in the input length,
whatever the user types.

Expected behavior:

A line such as `use a /**/ /**/ … /**/ x` (n block comments followed by code) is rejected as a
command in time linear in its length, and the input is evaluated as JavaScript.

Actual behavior:

The lazy `.*?` of the block-comment branch can also span several comments (`/**/ /**/` matches as
one comment). So when the line does not end in `;`, a line break or the end of the input, the
engine tries every grouping of the comments, which is 2^n attempts. Measured on this machine:

| Comments | Time |
|---:|---:|
| 18 | 6 ms |
| 20 | 23 ms |
| 22 | 80 ms |
| 28 | 3.3 to 6.1 s |
| 30 (extrapolated) | about 20 s |
| 40 (extrapolated) | hours |

An earlier probe with 10,000 comments never finished.
- The evaluation hangs in the worker. The cooperative interrupt cannot run, so a cancel only takes
  effect after the host's 1 s grace, when it terminates the worker and the session state is lost.
- The backend main thread is not blocked.
- The pattern is the same in 2708094 (both regexes timed alike: 22 comments, 88.9 ms before CR-5
  and 87.2 ms after). CR-5 did not introduce it and did not make it worse. It dates from the TW-1
  trailing-comment fix.

Suggested direction (for the fixer, not prescriptive): make the block-comment body unable to
contain `*/`, for example `\/\*(?:[^*]|\*(?!\/))*\*\/`, or match the comments with a small loop
instead of the regex.

Severity:

Low. It needs many comments on one command line followed by code and stays inside the session's
worker. It still breaks a session on plausible pasted input and makes `.taskcheck` fail through
the regression tests.

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: partial-failed for the full suite; verified as a diagnostic run that deselects only the
TW-2 timing tests.
- The full coverage run (`npx vitest run --coverage …` with all tests) exits non-zero because of the
  2 TW-2 failures. Vitest wrote no report: `packages/backend/coverage/` did not exist after it.
- A second run with the same includes adds
  `-t '^(?!.*no catastrophic backtracking).*$'`. It deselects the 5 cases of that one table (2
  failing, 3 passing) and passes. Its numbers are below. The deselected cases add no new `split.ts`
  lines or branches: the file is 100% covered without them.
- `runtime.ts` and `worker.ts` run only inside worker threads and are not instrumented by the
  configured provider.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line report).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `shell-backend`.
  Base `735b36d36aa2edab5c72fc2c7dda7f749f430509` (`git merge-base HEAD origin/main`). HEAD
  `02d12f9070f8e5b061be5f3f32a9a8d794037dc7`. Task commits 2f0b3d7, 6339ca9, 2708094, 92c9fb1 and
  02d12f9. File scope comes from `git diff --name-status 735b36d HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 02d12f9 plus uncommitted
  test files. Production files are unmodified in the working tree (`git diff HEAD` on non-spec
  sources is empty).
  - `packages/backend/src/shell/split.spec.ts` sha256
    `ad27e4b196362a81fbce1ad34f994ba1ebf72af16a05eab1a549799fc6c5dbab`
  - `test/integration/shell.int.spec.ts` sha256
    `02615a2e4e5b1e2b72319d5f1ed839f12361a7fd19149fe1e3a919ca70a63a71`
  - `host.spec.ts` sha256 `4dc30166…` (committed, unchanged)
- Exact included files: `packages/backend/src/` `shell/{handlers,host,index,output,protocol,runtime,split,worker}.ts`,
  `connections/manager.ts`, `index.ts`, `server/backend.ts`, `server/entry.ts`.
  - Excluded: `apps/desktop/scripts/build.mjs` (build script, no unit tests or coverage in the
    backend workspace), `package-lock.json` and `packages/backend/package.json` (configuration),
    spec files and the integration spec (tests).
  - No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` with
  vitest 5.1.0, Node v24.21.0, in `packages/backend`:
  `npx vitest run -t '^(?!.*no catastrophic backtracking).*$' --coverage --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text-summary --coverage.include=src/...` (one `--coverage.include` per included file above, paths relative to
  `packages/backend`).
  All 24 backend unit files ran: 1126 tests passed and 5 were deselected (skipped).
- Run start/completion time and exit status: started 2026-11-17 03:24:26 (+01:00), duration 6.88 s,
  all selected tests passed, and the summary was written at 03:24:33. The run without `-t` started
  at 03:24:04 and failed (2 tests), with no report.
- Generated report paths and report hashes/run identifier (git-ignored by `.gitignore:6`
  `coverage/`; no non-ignored coverage folder was created):
  - `packages/backend/coverage/coverage-summary.json` sha256
    `13c4010245bfa9cfbc367a4f9665aba008954a6c5e317013f4c4bee75b81b9be`
  - `packages/backend/coverage/coverage-final.json` sha256
    `3457446c360b7704f9ca3a15f23cd15b739b069a185d42704211491f5833a4f7`
- Evidence outputs are fresh and inputs stayed unchanged: the coverage directory did not exist
  before this run (the failed run had cleaned it). The spec hashes above were taken after the run.
  No edits were made after it.
- Final run after latest test additions and production fixes: yes for revision 02d12f9 and the
  current tests. A fix for TW-2 will make it stale.

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

The aggregate includes `runtime.ts`, `worker.ts` and `entry.ts` at 0%; unit tests cannot instrument
them (see below). Excluded: `apps/desktop/scripts/build.mjs`.

The CR-5 regex change keeps `split.ts` at 100% for every metric, with the same counters as in
round 2. Coverage counts regex execution as one statement, so it cannot show which regex paths ran;
the CR-5 table cases cover those paths.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `shell/split.ts:89-90` (regex performance, not a coverage metric) | Linear-time command recognition | TW-2 tests added. They fail and need a production fix. |
| `shell/runtime.ts` (all), `shell/worker.ts` (all) | mongosh evaluation, exit/quit refusal, interrupt, completion, splitting in the worker | Run inside `worker_threads` spawned by the host, which the v8 provider does not instrument. Exercised by the 17 integration tests (AC1 to AC3, exit/quit, comments incl. CR-5, interrupt, completion after restart), all passing. Measuring them would need provider or config changes outside test-writer authority. |
| `server/entry.ts:9-19` | Process entry point wiring | Bootstrap, not unit-tested in the project. Non-material. |
| `shell/host.ts:89, 92` | Default `new Worker(url)` and default no-op `log` | Used only with the real worker (integration tests); unit tests inject fakes. Non-material. |
| `shell/host.ts:156` (`signal.aborted` after `ensureWorker` resolved) | Abort landing between restart completion and its continuation | Only reachable in a microtask window. Defensive; no deterministic test without reaching into internals. |
| `shell/host.ts:174#1, 225#1, 282#1` | Implicit `else` for unrelated message types | Defensive; the worker protocol never sends those. |
| `shell/host.ts:192#1` | Grace timer firing after the eval finished | `finally` clears the timer first. Defensive. |
| `shell/host.ts:275#0` | `closeSession` on an already closed session | Callers get NOT_FOUND first; the concurrent-close test covers the public behaviour. Defensive. |
| `shell/host.ts:291, 299, 348, 385` | `.catch(() => undefined)` of `worker.terminate()` | Only runs if `terminate()` rejects. Non-material. |
| `shell/host.ts:334#1, 345#0, 364-365` | `clear` after a newer restart; restart of a closed session; `startWorker` without `workerUrl` | Not reachable with the current sequencing; callers check first. Defensive. |
| `shell/host.ts:403#1` | `openFailed` error without `code` | Minor mapping path; error mapping is covered by open/restart failure tests. Low risk. |
| `shell/output.ts:80#1` | `EJSON.stringify` returning a non-string or blank value | Defensive. |
| `connections/manager.ts:65, 269-270`; `server/backend.ts:40, 60, 64#1, 103` | Default callbacks and a defensive branch in wiring | Non-material. Unchanged since round 1. |

## Unable to test

- Coverage of `runtime.ts` and `worker.ts`: the integration tests cover their behaviour end to end,
  but the provider does not instrument worker threads. No follow-up is needed unless the project
  wants worker coverage, which would need tooling configuration.
- Running the worker inside the real Electron `utilityProcess` and the bundled `shell-worker.cjs`:
  outside this scope (recorded as an assumption by the parent); not run.
- Full coverage with every test selected: blocked by TW-2 (no report on failure). Rerun after the
  fix.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task
completion.
- CR-5 (02d12f9) is correct: all 20 new unit edge cases and the new real-mongosh integration test
  pass. They cover `/` inside arguments, `show profile`, `it`/`exit`/`quit` with glued comments,
  and comments inside strings versus after commands.
- The new robustness tests found TW-2: exponential backtracking in the trailing-comment group of
  `COMMAND`. It has been present since 2708094 and was not caused by CR-5.
- Its two regression tests fail, so `npm run check` and `.taskcheck` fail until it is fixed.
- Coverage of task files is unchanged from round 2 (`split.ts` 100%), measured with only the TW-2
  timing table deselected.
