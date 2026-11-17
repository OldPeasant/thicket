# Test Report

Date: 2026-11-17

Task: smoke-userdata-cleanup - Release: Linux smoke test fails removing the app's user-data folder

Scope: `git diff 4387931d22065e33ec3c80aebb39f10c75d67d9a..19e332eddd58eca336fb33ce9cca2e62514043c5`.
The task's code commit was named to the test writer as `e47d6b7b`. After a rebase it is now
`19e332ed`, with an identical `git patch-id --stable` (311fd6e2f8f1…). The other commits in the
range (`3e216684`, `e0c51081`) change only `tasks/`. Production (harness) files in scope:
`test/e2e/harness/processes.ts` (new), `test/e2e/harness/fixtures.ts`, `test/e2e/smoke/installer.smoke.ts`.
Branch `main`. The tested tree has no uncommitted changes besides this report and the new test file.

Requirements:
- `tasks/smoke-userdata-cleanup.md`: goal (make teardown reliable: the whole app process tree has
  exited before the folder is removed, with a kill of the process group if needed, plus `rm` retries
  as a second line of defence) and acceptance criteria 1-3
- Parent instructions: focused tests for `processes.ts` (a grandchild that outlives the child, SIGKILL
  escalation, `terminate: false`, a non-detached child, `removeAppDir`); OS-neutral; no timing asserts
- `AGENTS.md` project notes (OS-neutral tests, `os.tmpdir()`); existing smoke helper test conventions in
  `test/e2e/smoke/installed-app.smoke.ts`

## Test files changed

- `test/e2e/smoke/processes.smoke.ts` (new). It lives in the smoke suite because the release workflow
  runs `npm run test:smoke` on every OS, and the tests need no app or installer.

## Tests added or updated

Count: 15

Fixtures: a Node "child" is spawned detached (its own process group). It starts a Node "grandchild"
in the same group, like the AppImage runtime starts Electron and its helpers. The grandchild records a
SIGTERM it receives as the marker file `sigterm`. Before it exits on its own, it writes `done`.
Readiness and outcomes are observed through files and `exit` events polled with `expect.poll`. No
assertion depends on timing. The only durations are grace periods and how long the grandchild lingers.
The POSIX process-group tests are skipped on Windows, with the reason in the test.

## Requirement coverage

Command for all rows: `npx playwright test -c test/e2e/smoke/playwright.config.ts installed-app.smoke.ts processes.smoke.ts --output=test-results/tw-smoke` (Linux, Fedora, kernel 6.19)

| Requirement | Tests | Command | Result |
|---|---|---|---|
| Teardown waits for the whole process tree before the folder is removed (a grandchild that outlives the child) | `returns only after a grandchild that outlives the child has exited` | above | Pass |
| Kill the process group if it does not exit (SIGTERM, then SIGKILL after graceMs) | `sends SIGKILL to the group when it is still running after graceMs`, `kills the leftover grandchild when the child has exited already` | above | Pass |
| `terminate: false` (used after Playwright's `app.close()`): no SIGTERM, wait for the group, SIGKILL leftovers after graceMs | `terminate: false sends no SIGTERM and waits for the group to exit by itself`, `terminate: false still kills members left after graceMs, without SIGTERM`, `terminate: false kills a child still running after graceMs` | above | Pass |
| `processGroupAlive` / `waitForProcessGroupExit` | `report a running group, time out while it runs and resolve once it is empty`, `a pid that leads no process group is not alive as a group` | above | Pass |
| `endProcessTree` on any OS: detached child, already exited child, child without pid | `ends a running detached child`, `returns at once for a child that has exited already`, `returns for a child that never started (no pid)` | above | Pass (Linux only here; Windows/macOS run in the release workflow) |
| `endProcessTree` with a non-detached child (fallback "signal the child alone" in `signalGroup`) | `ends a running child that was not detached` | above | **Fail**, see TW-1 |
| Removal with retries as a second line of defence | `removes a folder with nested content`, `accepts a folder that does not exist`, `removes a folder a process is still writing into` | above | Pass |
| AC1: 10 smoke runs against a local AppImage, failures before the fix, none after | none added (needs an AppImage). The parent's run: 10 repeats under CPU load, 20 passed, 0 leaked folders (all 20 leaked before) | not run by the test writer | Not run: needs a locally built AppImage. The parent ran it. |
| AC2: release-like GitHub run | n/a | n/a | Not run: needs a GitHub workflow run |
| AC3: `npm run check` passes | whole suite | `npm run check` | Pass |

## Focused test execution

Command:

`npx playwright test -c test/e2e/smoke/playwright.config.ts processes.smoke.ts --output=test-results/tw-processes`

Result:

Fail: 14 passed, 1 failed (`ends a running child that was not detached`, TW-1). A repeat run with
`--repeat-each=3` over `installed-app.smoke.ts processes.smoke.ts` gave 129 passed and 3 failed. All 3
failures were TW-1, and no other test was flaky.

## Full test execution

Command:

`npx playwright test -c test/e2e/smoke/playwright.config.ts installed-app.smoke.ts processes.smoke.ts --output=test-results/tw-smoke`

Result:

Fail: 43 passed, 1 failed (TW-1). `installer.smoke.ts` was not run because it needs an AppImage; the
parent ran it. The e2e suite (`npm run test:e2e`, which uses `fixtures.ts`) was not run by the test
writer.

`npm run lint`: Pass. `npx tsc -p tsconfig.json`: Pass (no output).

## .taskcheck

Result:

Pass. `npm run check` (what `.taskcheck` runs) exited 0. It does not run Playwright specs.

## Bugs found

### endProcessTree leaves a non-detached child running on POSIX

Finding ID:

`TW-1`

Test:

`test/e2e/smoke/processes.smoke.ts` › `endProcessTree on any OS` › `ends a running child that was not detached`

Production source:

`test/e2e/harness/processes.ts:76` (`if (terminate && processGroupAlive(pid)) signalGroup(pid, child, 'SIGTERM');`)

Requirement:

The fallback in `signalGroup` is commented "Not a group leader (not detached) or already gone: signal
the child alone", and the task goal says to make sure the app has exited before its folder is removed.

Expected behavior:

When the child is not detached, `endProcessTree(child)` signals the child alone and returns after it
has exited. When it is still running after `graceMs`, it is killed.

Actual behavior:

A non-detached child leads no process group, so `processGroupAlive(pid)` is `false` and no SIGTERM is
sent. `waitForProcessGroupExit` then returns `true` at once, so the SIGKILL branch never runs. The
final `waitForExit(child, 5_000)` times out, and `endProcessTree` returns after 5 s with the child
still running. The fallback in `signalGroup` can never be reached for this case. Reproduced in 4 of
4 runs (5.0 s each).

Severity:

Low. Both current callers spawn detached on POSIX: `installer.smoke.ts` sets `detached: process.platform !== 'win32'`,
and Playwright's process launcher does the same. The JSDoc also says the child "must have been spawned
with `detached: true`". So this does not affect the fixed teardown. It is still a trap for future
callers, and the code contradicts its own fallback comment.

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.` One option: when the child has
not exited and `processGroupAlive(pid)` is `false`, signal and wait for the child itself (the POSIX
equivalent of the Windows branch). The other option is for the parent to decide that non-detached
children are unsupported. In that case, remove the fallback and its comment, and have
`endProcessTree` reject or document it. The failing test would then have to be revisited
deliberately by the parent, not skipped.

## Coverage

Status: unavailable. Coverage is not measured for the e2e harness. The project's only coverage
tooling is Vitest with `@vitest/coverage-v8` (`docs/ARCHITECTURE.md` "Coverage"), and no Vitest
project includes `test/e2e`. The helpers run under Playwright Test, which has no configured coverage
provider for Node-side test code. Adding one would change configuration outside the test writer's
authority.

Metric: whole-file coverage of task-changed production files: not measured.
Changed-line coverage: not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: smoke-userdata-cleanup;
  base 4387931d22065e33ec3c80aebb39f10c75d67d9a; HEAD 19e332eddd58eca336fb33ce9cca2e62514043c5. The task
  code commit was named by the parent (e47d6b7b, the same patch-id as 19e332ed).
- Source/test snapshot identifier (including uncommitted inputs): `test/e2e/harness/processes.ts`
  sha256 1e8965eb663f2fc417cb895f3639ad149269585e9aba7ccb48ce5a1992d5bbdb (committed);
  `test/e2e/smoke/processes.smoke.ts` (untracked) sha256 c9c75262c0128933f6f0dd1747202728e7c7650d462c1e12f12a0fc76cf4bab6
- Exact included files; renamed/deleted/excluded files and reasons: none are measured. All three
  scoped files are Playwright-only test harness code with no coverage provider.
- Provider/version, command, working directory, and test selection: none
- Run start/completion time and exit status: n/a
- Generated report paths and report hashes/run identifier: none
- Evidence outputs are fresh and inputs stayed unchanged: n/a (no coverage output)
- Final run after latest test additions and production fixes: n/a. The test runs above used the final
  test file. No production fix has been made yet (TW-1 is open).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `test/e2e/harness/processes.ts` | N/A | N/A | N/A | N/A |
| `test/e2e/harness/fixtures.ts` | N/A | N/A | N/A | N/A |
| `test/e2e/smoke/installer.smoke.ts` | N/A | N/A | N/A | N/A |

Behavioral gaps (from reading the code, not from a coverage report):

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `test/e2e/harness/processes.ts` Windows branch (`taskkill /T /F`, `child.kill('SIGKILL')`) | ending the app on Windows | The `endProcessTree on any OS` tests cover it, but they only run on Windows in the release workflow, not here |
| `test/e2e/harness/processes.ts` `processGroupAlive` EPERM branch | a group member owned by another user | Not tested: needs a process of another user (not reproducible without privileges) |
| `test/e2e/harness/fixtures.ts` electronApp teardown (`endProcessTree(..., { terminate: false })`) | the e2e app's helpers are gone before `userDataDir` is removed | Not run by the test writer (`npm run test:e2e` builds and runs the app). The `terminate: false` behavior is tested directly |
| `test/e2e/smoke/installer.smoke.ts` appBrowser teardown | the AppImage tree is gone before the folder is removed | Needs an AppImage. The parent ran it 10 times (20 passed, 0 leaked folders) |

## Unable to test

- Windows and macOS behavior: there is no such machine here. The OS-neutral tests will run there in
  `npm run test:smoke` (release workflow). This needs no follow-up beyond watching the next release run.
- AC1 and AC2 (an AppImage run and a GitHub release-like run): outside what the test writer can run
  here. The parent recorded its own AppImage evidence.
- `processGroupAlive` EPERM: it needs a process owned by another user.

## Summary

Tests added; a production defect (TW-1, Low) was discovered and must be passed to the `fixer` before
task completion. The parent may instead decide that non-detached children are out of scope, and
resolve it explicitly. All other new tests pass, including the main task scenario: `endProcessTree`
returns only after a grandchild that outlives the child has exited, and SIGKILL escalation works.
