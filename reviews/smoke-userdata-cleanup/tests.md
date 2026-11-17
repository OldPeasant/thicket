# Test Report

Date: 2026-11-17

Task: smoke-userdata-cleanup - Release: Linux smoke test fails removing the app's user-data folder

Scope: the final revision of the task. The scope is `git diff 350bcb6684121196d4a7f5324d27f92b6b4de3b7..d32f1c59e5c011a446aea7aa6baa0c18f4dc90c2 -- test/`. The parent named the base (the merge-base with origin/main) and the task's commits:
- `4039e23b`: fix. Adds `processes.ts` and changes `fixtures.ts` and `installer.smoke.ts`.
- `df2f71f6`: tests and reports.
- `4fc52fc1`: CR-1/TW-1 fix.
- `0986e8a8`: review report.
- `d32f1c59`: CR-2 tests.

While this run was going on, at 19:14:27, the parent rebased the same five commits onto the new main. HEAD is now `e1e4c755`. `git diff d32f1c59 e1e4c755 -- test/` is empty, and the sha256 of each task file is the same before and after (listed under Coverage). The tested code is therefore identical at both hashes.

Production (harness) files in scope:
- `test/e2e/harness/processes.ts` (new)
- `test/e2e/harness/fixtures.ts`
- `test/e2e/smoke/installer.smoke.ts`

Test file in scope: `test/e2e/smoke/processes.smoke.ts`. Branch: `main`. The task files had no uncommitted changes. The parent was editing `reviews/smoke-userdata-cleanup/review.md` at the same time, which is not test input.

Requirements:
- `tasks/smoke-userdata-cleanup.md`. Goal: teardown waits for the whole app process tree, kills the process group if needed, and `rm` retries as a second line of defence. Acceptance criteria 1-3.
- `reviews/smoke-userdata-cleanup/review.md` (CR-2) and `reviews/smoke-userdata-cleanup/fixes.md` (CR-1/TW-1 fix).
- `AGENTS.md` project notes: OS-neutral tests, no timing-dependent asserts.
- `docs/ARCHITECTURE.md` "Coverage".

## Test files changed

- None in this round. I reviewed the coverage of the final code and found no meaningful gap that a deterministic test could close (see "Coverage"). So no tests were added or edited.
- Task-owned test file, already committed: `test/e2e/smoke/processes.smoke.ts`. It has 20 tests.

## Tests added or updated

Count: 0 in this round. The task's test file has 20 tests in total: 15 from the first round, 1 (comment only) from the fixer, and 4 from d32f1c59 for CR-2.

## Requirement coverage

I ran every row with this command, on Linux (Fedora, kernel 6.19, Node v24.21.0):
`npx playwright test -c test/e2e/smoke/playwright.config.ts processes.smoke.ts installed-app.smoke.ts --output=/tmp/tw-final`
In the table, "focused" means that command.

| Requirement | Tests | Command | Result |
|---|---|---|---|
| Teardown waits for the whole process tree before the folder is removed (a grandchild that outlives the child, the AppImage case) | `returns only after a grandchild that outlives the child has exited` | focused | Pass |
| Kill the process group if it does not exit (SIGTERM, then SIGKILL after graceMs) | `sends SIGKILL to the group when it is still running after graceMs`, `kills the leftover grandchild when the child has exited already` | focused | Pass |
| `terminate: false` (the harness fixture after `app.close()`): no SIGTERM, wait for the group, SIGKILL leftovers | `terminate: false sends no SIGTERM and waits for the group to exit by itself`, `terminate: false still kills members left after graceMs, without SIGTERM`, `terminate: false kills a child still running after graceMs` | focused | Pass |
| Non-detached POSIX child (CR-1/TW-1 fix): signalled alone, SIGTERM then SIGKILL, `terminate: false`, already exited | `sends SIGTERM to the child alone and returns once it has exited`, `sends SIGKILL to a child still running after graceMs`, `terminate: false sends no SIGTERM and kills the child after graceMs`, `terminate: false waits for a child that exits by itself within graceMs`, `returns at once for a child that has exited already` (POSIX block), `ends a running child that was not detached` | focused | Pass (TW-1 regression test now passes) |
| CR-2: SIGKILL escalation of the non-detached branch | `sends SIGKILL to a child still running after graceMs`, `terminate: false sends no SIGTERM and kills the child after graceMs` | focused | Pass |
| `processGroupAlive` / `waitForProcessGroupExit` | `report a running group, time out while it runs and resolve once it is empty`, `a pid that leads no process group is not alive as a group` | focused | Pass |
| `endProcessTree` on any OS: detached child, already exited child, child without a pid | `ends a running detached child`, `returns at once for a child that has exited already`, `returns for a child that never started (no pid)` | focused | Pass. Linux only here. The Windows branch runs only on Windows (release workflow). |
| Removal with retries as a second line of defence | `removes a folder with nested content`, `accepts a folder that does not exist`, `removes a folder a process is still writing into` | focused | Pass |
| Flakiness | the same 49 tests | focused + `--repeat-each=3 --output=/tmp/tw-final-repeat` | Pass, 147 passed |
| AC1: 10 smoke runs against a local AppImage, failures before the fix and none after | `installer.smoke.ts` | not run by the test writer | Not run: needs a locally built AppImage. The parent ran it and recorded it with `tasks.py verify` (20 passed, 0 leaked folders after the fix). |
| AC2: release-like GitHub run | n/a | n/a | Not run: needs a run of the GitHub release workflow. Already skipped with a reason by the parent. |
| AC3: `npm run check` passes | whole check | `npm run check --silent && echo CHECK_OK` | Pass (CHECK_OK) |

## Focused test execution

Command:

`npx playwright test -c test/e2e/smoke/playwright.config.ts processes.smoke.ts installed-app.smoke.ts --output=/tmp/tw-final`

Result:

Pass: 49 passed (8.3 s), run from 19:13:01. The 20 `processes.smoke.ts` tests include the non-detached ones. `ends a running child that was not detached` took 4 ms, while TW-1 took 5 s before the fix.

Flakiness, the same command with `--repeat-each=3 --output=/tmp/tw-final-repeat --reporter=line`: Pass, 147 passed (26.2 s), 19:13:17 to 19:13:43. No test failed or was retried.

## Full test execution

Command:

`npm run check --silent && echo CHECK_OK` (lint, Prettier, type check, Vitest workspaces, renderer tests)

Result:

Pass. The workspaces had 100 test files and 5240 tests passed. The renderer had 125 files and 4137 tests passed. `CHECK_OK` was printed. This run started at 19:15:54, after the parent's rebase at 19:14:27, so it covers the rebased tree `e1e4c755`. An earlier `npm run check` started at 19:14:15, overlapped the rebase, and is not counted as evidence.

Also run on the d32f1c59 tree, before the rebase:
- `npm run lint`: Pass. ESLint ran with `--max-warnings 0`, and Prettier reported "All matched files use Prettier code style!".
- `npx tsc -p tsconfig.json`: Pass, with no errors.

Not run:
- `installer.smoke.ts`: it needs an AppImage, and the parent ran it for AC1.
- `npm run test:e2e`: the suite that uses `fixtures.ts`. It builds and runs the app, and was outside the requested validation.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, which I ran directly (above) and which exited 0. It does not run the Playwright smoke specs.

## Bugs found

None open. TW-1 from the previous round (`endProcessTree` left a non-detached POSIX child running) is fixed in 4fc52fc1, and its regression test `ends a running child that was not detached` passes. CR-2 (no test for the SIGKILL escalation of that branch) is addressed by d32f1c59, and those tests pass.

## Coverage

Status: unavailable. Coverage is not measured for the e2e harness:
- The project's only coverage tooling is Vitest with `@vitest/coverage-v8` (`docs/ARCHITECTURE.md` "Coverage"), and no Vitest project includes `test/e2e`.
- The helpers run under Playwright Test, which has no configured coverage provider for Node-side code.
- I tried to collect Node's built-in V8 coverage for the Playwright run (`NODE_V8_COVERAGE=/tmp/tw-v8cov-final npx playwright test ... processes.smoke.ts`). The environment's permission system denied that command, so no coverage data was produced. I did not try any other way around it.
- Adding a provider or changing configuration is outside the test writer's authority.

Metric: whole-file coverage of task-changed production files: not measured.
Changed-line coverage: not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source:
  - Task: smoke-userdata-cleanup.
  - Base: 350bcb6684121196d4a7f5324d27f92b6b4de3b7.
  - Measured revision: d32f1c59e5c011a446aea7aa6baa0c18f4dc90c2, rebased during the run to e1e4c755ef7fad370c6440382df62d3cbddfe309 with an identical `test/` tree.
  - The parent named the commits and files.
- Source/test snapshot identifier (sha256, unchanged before and after all runs):
  - `test/e2e/harness/processes.ts`: 4dc5ff6d993abd1d323370dacb3c0a6da98af073c7b4ee99bcab6ee2cd1f614b
  - `test/e2e/harness/fixtures.ts`: 7edc7a5d1fd19e920be2767d950c75629d0e1f4e993b7e714f69e43e8e09679d
  - `test/e2e/smoke/installer.smoke.ts`: 010fee4d15cf2c3a0f37e219435cd0e525e70b6536702fca136ed0b9c94be21b
  - `test/e2e/smoke/processes.smoke.ts`: 7441f61b9efdaa0628d0d0d24d98c8693cffb7ea46817387c8b5077476104a6e
- Exact included files; renamed/deleted/excluded files and reasons: none are measured. All three scoped files are Playwright-only harness code with no coverage provider.
- Provider/version, command, working directory, and test selection: none, because the V8 attempt was denied before it ran.
- Run start/completion time and exit status: n/a.
- Generated report paths and report hashes/run identifier: none.
- Evidence outputs are fresh and inputs stayed unchanged: n/a, because there is no coverage output. The test runs above used the snapshot listed.
- Final run after latest test additions and production fixes: yes for the test runs. Coverage: n/a.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `test/e2e/harness/processes.ts` | N/A | N/A | N/A | N/A |
| `test/e2e/harness/fixtures.ts` | N/A | N/A | N/A | N/A |
| `test/e2e/smoke/installer.smoke.ts` | N/A | N/A | N/A | N/A |

The tables below come from reading the code against the tests, not from a coverage report.

`processes.ts` branches that the Linux run exercises, in order:
- `endProcessTree`:
  - `pid === undefined`
  - the non-group branch: already exited, SIGTERM then exit, SIGTERM then SIGKILL, `terminate: false` then SIGKILL, `terminate: false` with exit within graceMs
  - the group branch: SIGTERM and the group drains, SIGTERM then SIGKILL, the child already exited with a grandchild left, `terminate: false` with the group draining, `terminate: false` then SIGKILL
  - the final `waitForExit`
- `waitForExit`: the early return, the exit event, and the timeout.
- `waitForProcessGroupExit`: the timeout and the drain.
- `processGroupAlive`: alive and ESRCH.
- `removeAppDir`: a nested tree, a missing folder, and a folder being written to concurrently.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `test/e2e/harness/processes.ts:66-77`, the `win32` branch (`taskkill /T /F`, `child.kill('SIGKILL')`) | ending the app on Windows | The `endProcessTree on any OS` tests cover it, but they only run on Windows (release workflow `npm run test:smoke`), not here. |
| `test/e2e/harness/processes.ts:18-19`, the EPERM branch of `processGroupAlive` | a group member owned by another user | Not tested: it needs a process of another user, which cannot be set up without privileges. Low risk. |
| `test/e2e/harness/processes.ts:100-103`, the catch in `signalGroup` (the group emptied between the liveness check and the signal) | a race window of microseconds | Not tested: it cannot be triggered deterministically without injecting faults into `process.kill`. Code reading: it falls back to `child.kill(signal)` only if the child has not exited, which is safe. Justified gap. |
| `test/e2e/harness/fixtures.ts`, the electronApp teardown (`endProcessTree(..., { terminate: false })`) and `removeAppDir` | the e2e app's helpers are gone before `userDataDir` is removed | Not run by the test writer, because `npm run test:e2e` builds and runs the app. The `terminate: false` and `removeAppDir` behavior is tested directly above. |
| `test/e2e/smoke/installer.smoke.ts`, the appBrowser teardown (`endProcessTree(child)`) and `removeAppDir` | the AppImage tree is gone before the folder is removed | It needs an AppImage. The parent ran it 10 times for AC1 (20 passed, 0 leaked folders). |

## Unable to test

- Windows and macOS behavior: there is no such machine here. The OS-neutral tests run there in `npm run test:smoke` in the release workflow, and CI `check` runs on the `wip/` branch. No follow-up is needed beyond watching the next release run.
- AC1 and AC2 (an AppImage run and a GitHub release-like run): outside what the test writer can run here. The parent recorded AC1 and skipped AC2 with a reason.
- `processGroupAlive` EPERM and the race catch in `signalGroup`: see the gaps above. They need no follow-up.
- Task-scoped coverage: no configured provider for Playwright-run code, and my attempt to collect V8 coverage was denied. If a human wants numbers, a follow-up task could add a coverage setup for `test/e2e`.

## Summary

Tests and task-scoped behavior coverage are sufficient, and no production defects were found. Coverage percentages could not be measured (see Coverage). No tests were added in this round:
- The 20 `processes.smoke.ts` tests cover every behavior of the final `processes.ts` that can be exercised on Linux, including the TW-1 fix and the CR-2 SIGKILL escalation.
- The focused run passed (49 tests), as did `--repeat-each=3` (147 tests).
- `npm run lint`, `npx tsc -p tsconfig.json` and `npm run check` passed.
