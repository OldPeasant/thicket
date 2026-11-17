# Code Review

Date: 2026-11-17

Task: smoke-userdata-cleanup - Release: Linux smoke test fails removing the app's user-data folder

Scope: `git diff 350bcb6684121196d4a7f5324d27f92b6b4de3b7..d32f1c59 -- test/`. This covers the whole task: `test/e2e/harness/processes.ts` (new), `test/e2e/harness/fixtures.ts`, `test/e2e/smoke/installer.smoke.ts` and `test/e2e/smoke/processes.smoke.ts` (new). This is the third review round. It checks the second round's CR-2 and reviews the final code again in full. Only committed code is reviewed. The working tree was clean at the time of review.

Requirements:
- tasks/smoke-userdata-cleanup.md (goal and acceptance criteria)
- AGENTS.md (OS-neutral code and tests, no timing-dependent asserts, `.taskcheck` must finish)
- docs/ARCHITECTURE.md and the existing harness conventions
- reviews/smoke-userdata-cleanup/review.md (second round) and fixes.md

Git range:
- Branch: main
- HEAD: d32f1c59e5c011a446aea7aa6baa0c18f4dc90c2
- Base/start: 350bcb6684121196d4a7f5324d27f92b6b4de3b7
- Commits reviewed: 5 (4039e23b, df2f71f6, 4fc52fc1, 0986e8a8, d32f1c59). 0986e8a8 changes only `reviews/`. The code changes are in the other four.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Status of the second-round finding

- **CR-2 (second round) | The SIGKILL escalation for a non-detached child had no test. Resolved in d32f1c59.**
  d32f1c59 adds the describe block "endProcessTree with a child that leads no process group (POSIX)" (`processes.smoke.ts:220-313`). It contains five tests:
    - **SIGTERM path:** the child exits from its SIGTERM handler (`exitCode === 0`) and the `sigterm` marker exists.
    - **SIGKILL escalation:** a child ignores SIGTERM. With `graceMs: 300`, the test asserts that the `sigterm` marker exists and that `signalCode === 'SIGKILL'`. This exercises `processes.ts:83-86`. If the code returned after the first wait, the child would still be running with `signalCode === null` and the test would fail.
    - **`terminate: false` with a stuck child:** the test asserts SIGKILL and no `sigterm` marker.
    - **`terminate: false` with a child that exits by itself within `graceMs`:** the test asserts `exitCode === 4` and `signalCode === null`, so the child was waited for and not killed.
    - **Child that has already exited:** the test wraps `child.kill` and asserts that no signal is sent.

  `startLoneChild` waits for a `ready` file. The child writes that file only after it installs its SIGTERM handler, so the handler cannot race with startup. The helper also asserts the precondition: `processGroupAlive(pid)` is `false` for the non-detached child, so the new branch is actually the one under test. The block is skipped on Windows, with the reason given in the skip.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Notes (verified, no finding)

- **Root cause and fix**, checked again on the final code:
    - The old `killTree` in `installer.smoke.ts` resolved on the AppImage runtime's `exit`. That event fires about 1 ms after SIGTERM, while Electron and its helpers in the same process group keep writing into userData.
    - `endProcessTree` (`processes.ts:61-97`) waits until `kill(-pgid, 0)` reports the group empty. It escalates to SIGKILL after `graceMs`, and every wait has a limit (`graceMs` + 5 s + 5 s).
    - `removeAppDir` adds `rm` retries (`maxRetries: 10`, `retryDelay: 200`) as the second line of defence the task asks for.
    - Teardown order is correct in both fixtures. The folder fixture is torn down after the app fixture that depends on it, and the comments at `fixtures.ts:65` and `installer.smoke.ts:72` say so.
    - The harness fixture (`fixtures.ts:99-101`) calls `endProcessTree(app.process(), { terminate: false })` after `app.close()`. This matches the task's "check `test/e2e/harness` for the same pattern". Playwright's `_electron.launch` spawns the app detached on POSIX, so the group wait applies there.
- **Windows:** the `win32` branch of `endProcessTree` keeps the old `taskkill /T /F` behaviour. It adds a bounded `waitForExit` and a SIGKILL fallback, and the `taskkill` spawn has an `error` listener. The removed `killTree` had no such listener.
- **OS-neutrality:** the tests build paths with `path.join` and `os.tmpdir()`, and POSIX-only blocks are skipped on Windows with a reason. The "any OS" tests choose `detached` by platform.
- **Timing:** the asserts check outcomes (marker files, `exitCode`/`signalCode`, pid and group liveness), never durations. Both "SIGTERM was sent first" tests (the group variant and the new lone-child one) assume that the child's SIGTERM handler writes its marker within the 300 ms `graceMs`. That is a margin, not the measured result. The handler is a single synchronous `writeFileSync`, and the second round already accepted the same pattern for the group test. So this is not reported as a finding.
- **Cleanup:** `afterEach` SIGKILLs every spawned child (and its group, if the child was detached) and every grandchild, and removes every temp folder with retries, even when an assert fails.
- **Reviewer run:** `npx playwright test -c test/e2e/smoke/playwright.config.ts processes.smoke.ts --output=/tmp/cr-final --repeat-each 3` at d32f1c59 (Linux) gave 60 passed (24.7 s).
- **Not run by this reviewer:**
    - ESLint. The permission to run it was denied.
    - `npm run check`.
    - The AppImage smoke runs.

  The parent worker must record acceptance criterion #3 (`npm run check`) with `tasks.py verify`. #1 is already verified, and #2 is already skipped with a reason. The macOS and Windows CI results for `wip/smoke-userdata-cleanup` were not checked here.

## Review conclusion

No material issues found.
