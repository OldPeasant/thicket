# Test Report

Date: 2026-11-17

Task: shell-backend — M4: mongosh host in the backend (final report, round 4, revision 8712197)

Scope: task base `735b36d36aa2edab5c72fc2c7dda7f749f430509` (`git merge-base HEAD origin/main`,
given by the parent and rechecked) to HEAD `871219790eb459a5a9ea6fcb7212cb6df3fbc3bb`.
- Task commits (`git log 735b36d..HEAD`):
  - 2f0b3d7 (impl);
  - 6339ca9 (tests and round-1 reports);
  - 2708094 (round-2 fixes);
  - 92c9fb1 (round-2 tests and reports);
  - 02d12f9 (CR-5 fix);
  - c95f534 (round-3 tests and reports);
  - 8712197 (TW-2 fix).
- Round 4 checked the one production change since round 3: 8712197 in
  `packages/backend/src/shell/split.ts`, the `COMMAND` regex. A block comment body can no longer
  contain `*/`, and a line comment is `\/\/.*(?!.)`.
- The scope also includes the uncommitted test edit listed below. The test-writer changed no
  production code.

Requirements:
- `tasks/shell-backend.md` acceptance criteria and the recorded assumptions (exit/quit handling,
  splitting at shell commands, restart notice, cancel = interrupt)
- `reviews/shell-backend/fixes.md` (round 4: TW-2; earlier rounds: CR-5, TW-1, CR-2, CR-3,
  CR-4/O-2, O-1, O-3, O-4)
- `docs/ARCHITECTURE.md` "Coverage"
- Parent instructions for round 4

## Test files changed

Round 4 (uncommitted):
- `packages/backend/src/shell/split.spec.ts`

Round 3 (committed in c95f534): `split.spec.ts` and `test/integration/shell.int.spec.ts`.

Earlier rounds (committed in 6339ca9 and 92c9fb1):
- `packages/backend/src/shell/host.spec.ts`, `split.spec.ts`, `handlers.spec.ts`, `output.spec.ts`
- `test/integration/shell.int.spec.ts`
- `connections/manager.spec.ts`, `server/backend.spec.ts`

## Tests added or updated

Count (round 4): 25 unit cases added in `split.spec.ts`. One comment was updated in the existing
TW-2 table: its text described the failure and now says that the bug was fixed in 8712197. The
inputs and assertions of that table are unchanged.

Round 4, `split.spec.ts`:
- "a block comment ends at its first */, a line comment at the line end" (13 cases):
  - The block comment ends at its first `*/`:
    - `use a /* x */ b */` now stays one JavaScript piece, as do `use a /* x */ /* y */ */` and
      `use a /* x */ */\nq`. With the old regex, `use a /* x */ b */` was the command `use a`.
  - Stars in block comments:
    - `show dbs /***/;x`, `use a /* **/\nq` and `use a /* * / */\nq`;
    - a mix of comment kinds before CRLF: `use a /* x */ /** y **/ // z\r\nq`.
  - A CR ends a line comment:
    - `use a // c\r` gives `use a`;
    - `use a // c\r// d\nq` gives `use a`, `\nq`;
    - `use a // c\rx` is not a command.
  - U+2028 and U+2029 end a line comment the same way:
    - at the end of the input they count as trailing whitespace;
    - followed by code, the line is not a command. This is the same as before the fix.
- "TW-2 fix: a failing command match stays linear" (11 cases), with a bound of 1000 ms each:
  - Line-comment part:
    - 18 ` //` then U+2028 or CR and code;
    - one line comment of 40000 spaces then U+2028 or CR and code.
  - Block-comment part:
    - 5000 spaced comments, 3000 starred comments and 5000 comments with an inner `/*`, each
      followed by code;
    - 10000 unterminated openers;
    - an unterminated comment of 40000 stars;
    - 20000 stray `*/`;
    - 5000 block comments, a long line comment, U+2028 and code.
- "a command line with many trailing comments still splits (linear success path)" (1 test):
  5000 block comments and 1000 line comments, then a line break, still give `use a`, `\nq`.

Round-4 inputs are bounded on purpose:
- A temporary probe spec (`zz-probe-tmp.spec.ts`) timed the old regex and was deleted before
  the final runs. Its results:

  | Input (old regex, before the fix) | Time |
  |---|---:|
  | 12 ` //`, then U+2028 and code | 5 ms |
  | 16 ` //`, then U+2028 and code | 450 ms |
  | 18 ` //`, then U+2028 and code | 4.8 s |
  | Line comment of 10000 spaces, then U+2028 and code | 231 ms |
  | Line comment of 20000 spaces, then U+2028 and code | 881 ms |
  | Line comment of 20000 spaces, then CR and code | 835 ms |

- The fixed regex took at most 1.1 ms on every input above.
- The line-comment part of TW-2 was therefore also exponential before 8712197, not only
  quadratic. 8712197 fixes both parts.
- So the new 18-comment and 40000-space cases fail against the old regex within seconds. They do
  not hang.

Round 3 (still valid):
- `split.spec.ts`:
  - "CR-5 glued comments end the argument" (13 cases);
  - "CR-5 not a command" (7 cases);
  - "a long non-command line is rejected quickly (no catastrophic backtracking)" (5 cases,
    including the two 28-block-comment TW-2 regressions).
- `shell.int.spec.ts`: "a comment glued to a command argument is a comment: the next lines run
  (CR-5)", run against real mongosh.

Round 2 (still valid):
- `host.spec.ts`:
  - crash after an interrupt within the grace period;
  - the restart notice is shown once;
  - restarts started by a completion (CR-3);
  - worker exit during close (O-1).
- `split.spec.ts`: TW-1 trailing-comment cases.
- Integration:
  - comments around a command (CRLF, a leading block comment);
  - `exit;` between JavaScript lines;
  - `quit(1)`.

Round 1 added the original suites.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `use test; db.c.insertOne({a:1}); db.c.find()` returns the document as EJSON | int `use test; db.c.insertOne({a:1}); db.c.find() returns the document as EJSON` | `npx vitest run --config test/integration/vitest.config.ts shell` (Podman, mongo8 fixture) | Pass |
| AC2: interrupt stops `while(true){}` within 2 s | int `stops while(true){} within 2 s and the session goes on`; host grace-timer tests | same int command; `npx vitest run packages/backend/src/shell` | Pass |
| AC3: `complete('db.c.fi')` suggests `find`, `findOne` | int `complete('db.c.fi') suggests find and findOne`; host `asks the worker and answers its completions` | same | Pass |
| TW-2: command recognition is linear in the input length (fixed in 8712197) | split `a long non-command line is rejected quickly ...` (5), `TW-2 fix: a failing command match stays linear` (11), `... linear success path` (1) | `npx vitest run packages/backend/src/shell` | Pass |
| TW-2 fix semantics: a block comment ends at its first `*/`; a line comment ends at CR/U+2028/U+2029 | split `a block comment ends at its first */, a line comment at the line end` (13) | same | Pass |
| CR-5: a comment glued to a command argument is a comment; a single `/` stays in the argument | split `CR-5 glued comments end the argument` (13), `CR-5 not a command` (7), `trailing comment edge cases`; int `a comment glued to a command argument is a comment ... (CR-5)` | unit and int commands above | Pass |
| TW-1: a command with trailing comments ends there, the next lines run | split trailing-comment cases; int `runs the lines after a shell command that has a trailing comment`, `comments around a shell command ...` | same | Pass |
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

Pass: 4 files and 215 tests. That is the 190 tests from round 3 plus the 25 new ones. The
two round-3 TW-2 tests now pass.

Command:

`npx vitest run --config test/integration/vitest.config.ts shell` (Podman, MongoDB 8 container
fixture)

Result:

Pass: 1 file, 17 tests. The integration spec has not changed since round 3 (sha256 `02615a2e…`).

## Full test execution

Command:

`npm run check` (eslint --max-warnings 0, prettier --check, type checks, root vitest, renderer
`ng test`)

Result:

Pass.
- Lint, Prettier and the type checks pass.
- Root vitest: 59 files, 3488 tests passed.
- Renderer `ng test`: 72 files, 2154 tests passed.
- The run was on the final `split.spec.ts` (sha256 `cd56ce59…`).

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, which passed (see above). It was not invoked separately.

## Bugs found

### Exponential backtracking in the shell-command recogniser (fixed in 8712197)

Finding ID:

`TW-2` — **fixed in 8712197**, verified in round 4.

Test:

- `splitShellInput > a long non-command line is rejected quickly (no catastrophic backtracking):
  28 block comments then code`
- `... 28 glued block comments then code`
- Round 4 regressions: `TW-2 fix: a failing command match stays linear: *` (11 cases).

Production source:

`packages/backend/src/shell/split.ts:92-93` (`COMMAND`)

Requirement:

- Console input is split at shell commands (task assumption).
- The splitter runs on every `shell.eval` in the worker (`runtime.ts`), so it must finish in
  linear time in the input length, whatever the user types.

Expected behavior:

A line with many comments followed by code is rejected as a command in linear time. The input is
then evaluated as JavaScript.

Actual behavior:

- Before 8712197, both comment branches could match in several ways:
  - the block comment's lazy `.*?` could span several comments;
  - the line comment `\/\/.*` could stop at any position.
- A failing match therefore tried every grouping of the comments:
  - 28 block comments took 3 to 6 s;
  - 18 line comments then U+2028 and code took 4.8 s;
  - 10000 comments never finished.
- After 8712197, all 18 timing cases pass. Each new case takes about 1 ms or less, against a bound
  of 1000 ms.

Severity:

Low (was). It is now resolved.

Fix required:

No. It was fixed by the fixer in 8712197; the regression tests pass.

Behaviour change from the fix, now covered by tests:
- `use a /* x */ b */` is no longer the command `use a`. The whole line goes to mongosh, as
  JavaScript reads it.
- This matches `skipBlockComment` in the same file.

Observation, not a finding (unchanged by 8712197, no requirement covers it):
- A line comment ended by a lone CR, U+2028 or U+2029 and followed by code is not recognised
  as a command, e.g. `use a // c` + U+2028 + `x`. The whole input then goes to mongosh as one piece.
- JavaScript treats these characters as line terminators, but a REPL user practically never types
  them.
- The tests document the current behaviour. The parent may decide whether this matters.

No new production defects were found in round 4.

## Coverage

Status: verified. The full backend unit suite ran with all tests selected. Its exit status was 0
and it wrote a fresh report.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line report).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source:
  - Task `shell-backend`.
  - Base `735b36d36aa2edab5c72fc2c7dda7f749f430509` (`git merge-base HEAD origin/main`, rechecked).
  - HEAD `871219790eb459a5a9ea6fcb7212cb6df3fbc3bb`.
  - Task commits are listed under Scope.
  - The file scope comes from `git diff --name-status 735b36d HEAD`.
- Source/test snapshot identifier (including uncommitted inputs):
  - HEAD 8712197 plus one uncommitted test file. `git diff --name-only HEAD` shows only
    `packages/backend/src/shell/split.spec.ts`.
  - `packages/backend/src/shell/split.spec.ts` sha256
    `cd56ce596aa2bd1b0fe5222101e3fe5e9f28ae68852748333e845015aa1a66b1`
  - `packages/backend/src/shell/split.ts` sha256
    `791da1bffba4cfab2258b71f995a81475c1469e27bd4fce51bef3b4114d5f623` (committed)
  - `test/integration/shell.int.spec.ts` sha256
    `02615a2e4e5b1e2b72319d5f1ed839f12361a7fd19149fe1e3a919ca70a63a71` (committed)
- Exact included files:
  - `packages/backend/src/shell/{handlers,host,index,output,protocol,runtime,split,worker}.ts`
  - `packages/backend/src/connections/manager.ts`
  - `packages/backend/src/index.ts`
  - `packages/backend/src/server/backend.ts`
  - `packages/backend/src/server/entry.ts`
- Excluded files:
  - `apps/desktop/scripts/build.mjs`: a build script, with no unit tests or coverage in the
    backend workspace;
  - `package-lock.json` and `packages/backend/package.json`: configuration;
  - spec files and the integration spec: tests.
- No renames or deletions.
- Provider/version, command, working directory, and test selection:
  - Provider: `@vitest/coverage-v8` with vitest 5.1.0.
  - Working directory: `packages/backend`.
  - Command: `npx vitest run --coverage --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text-summary --coverage.include=src/...`, with one `--coverage.include` per
    included file above. Paths are relative to `packages/backend`.
  - Test selection: all tests, with no `-t` filter. 24 files and 1156 tests passed.
- Run start/completion time and exit status:
  - Started 2026-11-17 03:36:58 (+01:00) and ran for 6.45 s.
  - Exit status 0.
  - The reports were written at 03:37:05.
- Generated report paths and report hashes/run identifier: the reports are git-ignored
  (`.gitignore:6`, `coverage/`).
  - `packages/backend/coverage/coverage-summary.json` sha256
    `13c4010245bfa9cfbc367a4f9665aba008954a6c5e317013f4c4bee75b81b9be`
  - `packages/backend/coverage/coverage-final.json` sha256
    `d58aef76aa3526ee8fb1b2bbba09675f5e02c72549c36342dbb6b43c917b2cff`
- Evidence outputs are fresh and inputs stayed unchanged:
  - Vitest cleans the reports directory before a run. Both files have the mtime of this run
    (03:37:05).
  - `coverage-final.json` differs from round 3, because it contains the new `split.ts` statement
    map.
  - `coverage-summary.json` has the same hash as in round 3. All counters are identical, and that
    file contains no timestamps.
  - The spec and source hashes above were taken both before and after the run, and they did not
    change.
- Final run after latest test additions and production fixes: yes. It ran on revision 8712197 with
  the final round-4 tests.

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

About the aggregate:
- It includes `runtime.ts`, `worker.ts` and `entry.ts` at 0%. Unit tests cannot instrument them
  (see below).
- Excluded: `apps/desktop/scripts/build.mjs`.

About `split.ts`:
- It stays at 100% on every metric.
- Coverage counts a regex as one statement, so the metric cannot show which paths in the regex
  ran. The round-4 semantic and timing tables cover those paths instead: block-comment body,
  `*` not followed by `/`, `(?!.)` at CR, U+2028, U+2029 and the end of the input.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `shell/split.ts:92-93` (regex performance, not a coverage metric) | Linear-time command recognition (TW-2) | Fixed in 8712197. There are 17 timing regressions with bounded inputs, and they pass. |
| `shell/runtime.ts` (all), `shell/worker.ts` (all) | mongosh evaluation, exit/quit refusal, interrupt, completion, splitting in the worker | These run inside `worker_threads` started by the host, and the v8 provider does not instrument worker threads. The 17 integration tests exercise them, and all pass. Measuring them would need provider or config changes outside test-writer authority. |
| `server/entry.ts:9-19` | Process entry point wiring | Bootstrap code; the project does not unit-test it. Non-material. |
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

- Coverage of `runtime.ts` and `worker.ts`: the provider does not instrument worker threads. The
  integration tests cover their behaviour end to end. No follow-up is needed unless the project
  wants worker coverage, which would need tooling configuration.
- Running the worker inside the real Electron `utilityProcess` with the bundled
  `shell-worker.cjs`: outside this scope (the parent recorded this as an assumption). Not run.
- Timing bounds are wall-clock based, with a generous limit of 1000 ms against about 1 ms
  measured. On a heavily loaded machine they could flake. No flake was seen.

## Summary

Tests added and all validation passed.
- TW-2 is fixed in 8712197:
  - the two round-3 regressions pass;
  - 25 new unit cases cover the new comment semantics and the linear matching of both comment
    branches, with bounded inputs.
- The probe showed that the old line-comment branch was also exponential (18 comments took
  4.8 s). The new tests would catch a regression of either branch within seconds.
- Validation results:
  - `npx vitest run packages/backend/src/shell`: 215 passed;
  - integration (Podman): 17 passed;
  - `npm run check`: pass.
- Task-scoped coverage is fresh for revision 8712197:
  - `split.ts` is at 100%;
  - the aggregate is 81.82% of statements;
  - the remaining gaps are worker-thread files and defensive paths, justified above.
- No production defects remain open.
