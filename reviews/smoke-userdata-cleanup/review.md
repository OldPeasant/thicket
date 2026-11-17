# Code Review

Date: 2026-11-17

Task: smoke-userdata-cleanup - Release: Linux smoke test fails removing the app's user-data folder

Scope: `git diff e98271ff..78a8fd70 -- test/` (the whole task: `test/e2e/harness/processes.ts` (new), `test/e2e/harness/fixtures.ts`, `test/e2e/smoke/installer.smoke.ts`, `test/e2e/smoke/processes.smoke.ts` (new)). This is the second review round. The first round reviewed the harness change only, at an earlier, pre-rebase revision. Uncommitted edits to `processes.smoke.ts` in the working tree (a test-writer is still working on it) are out of scope.

Requirements:
- tasks/smoke-userdata-cleanup.md (goal and acceptance criteria)
- AGENTS.md (OS-neutral code and tests, no timing-dependent asserts, `.taskcheck` must finish)
- docs/ARCHITECTURE.md and the existing harness conventions
- reviews/smoke-userdata-cleanup/fixes.md (the fix for CR-1/TW-1)

Git range:
- Branch: main
- HEAD: 78a8fd70c102b75adbb492071ea4c8afe6238397
- Base/start: e98271ff8ff39f87dc57dd94fc4a10c95e12ff35
- Commits reviewed: 3 (e6b6e616, 621690b5, 78a8fd70)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Status of the first-round finding

- **CR-1 (first round) | `endProcessTree` never signalled a non-detached POSIX child: resolved in 78a8fd70.**
  On POSIX, when no process group with the child's pid exists, `endProcessTree` now handles the child on its own (`processes.ts:78-88`). It returns at once if the child has already exited. Otherwise it sends SIGTERM if `terminate` is set, waits up to `graceMs`, then sends SIGKILL and waits up to 5 s more. Checks:
    - Correctness: the early `exited(child)` return is safe. A group leader stays a group member until it is reaped, even as a zombie. libuv reaps it with `waitpid` and runs Node's `onexit` callback, which sets `exitCode`/`signalCode`, in the same native call, so no JavaScript runs in between. "Group not alive and child not marked exited" therefore means the child is still running outside its own group.
    - Detached path: nothing changed except the order of checks. In the old code, a group that was already empty went through `waitForProcessGroupExit` (immediate) and `waitForExit` (immediate, because the leader had been reaped). The new branch returns at the same point. When the group is alive, the code still runs SIGTERM to the group, waits for the group, sends SIGKILL after `graceMs`, and waits for the child.
    - Teardown hang: every wait in the new branch has a limit (`graceMs` + 5 s). The harness fixture (`terminate: false`) and the smoke fixture both still stay well inside the 60 s test timeout.
    - Windows: the `win32` branch is unchanged and comes before the new code.
    - The JSDoc and the `signalGroup` catch comment now describe the real behaviour, so the misleading comment is gone.
    - Regression test: `processes.smoke.ts:259` ("ends a running child that was not detached") runs on every OS. On POSIX it would have failed before the fix: the child would still be running after the 5 s wait. It now passes.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-2 | The SIGKILL escalation of the new non-detached branch has no test**
    - File: `test/e2e/harness/processes.ts:83` (tests: `test/e2e/smoke/processes.smoke.ts:247-299`)
    - Category: Tests
    - Problem: The only non-detached test uses a child that SIGTERM ends, so lines 83-86 (wait `graceMs`, then SIGKILL) never run. The same is true of `terminate: false` with a non-detached child. Both "terminate: false kills a child still running after graceMs" and the SIGKILL group test use detached children on POSIX.
    - Why it matters: This escalation is what keeps a stuck non-detached child from leaking. A regression there, such as returning after the first wait, would go unnoticed.
    - Suggested fix: Add a POSIX case that spawns a non-detached child which ignores SIGTERM (`process.on('SIGTERM', () => undefined)`). Call `endProcessTree(child, { graceMs: 300 })` and assert `child.signalCode === 'SIGKILL'`. Run it with `terminate: false` too if that is cheap.

## Notes (verified, no finding)

- Root cause: unchanged since the first round and still correct. The old `killTree` resolved on the AppImage runtime's `exit`, which happens about 1 ms after SIGTERM. `endProcessTree` instead polls `kill(-pgid, 0)` until the group is empty, and `removeAppDir` adds `rm` retries (`maxRetries: 10`, `retryDelay: 200`) as a second line of defence. In both fixtures, the folder fixture is torn down after the app fixture that depends on it.
- Test quality (`processes.smoke.ts`, committed revision):
    - Readiness is awaited, not slept. The tests poll a pid file that is written atomically with tmp and rename, and wait for the `spawn` and `exit` events. The child installs its SIGTERM handler before it spawns the grandchild, and the grandchild installs its handler before it writes its pid file. So "SIGTERM was sent" and "ignored SIGTERM" cannot race with startup.
    - Timing only appears as margins, never as the expected result. The 500 ms linger and the 300 ms `graceMs` stay far below the 10 s default and the 5 s SIGKILL wait. In the "still writing" `rm` test, the writer stops after 2 s at most, and `removeAppDir` keeps retrying for about 11 s. The asserts check outcomes (marker files, `signalCode`, pid and group liveness), not durations.
    - Leaks: `afterEach` SIGKILLs the child's group, the child and the grandchild, and removes every temp folder with retries, even when an assert fails.
    - OS-neutrality: paths use `path.join` and `os.tmpdir()`. The process-group tests are skipped on Windows with a reason, and the any-OS tests choose `detached` by platform.
- The cleanups call `process.kill` with SIGKILL on pids whose processes may already have exited. In theory the pid could have been reused within milliseconds. This is not reported as a finding, because sequential pid allocation makes it practically impossible inside a test's lifetime.
- Not run by this reviewer: the working tree holds uncommitted test-writer edits to `processes.smoke.ts`, so a local run would not test the committed revision. Validation evidence comes from fixes.md (`processes.smoke.ts` + `installed-app.smoke.ts`: 44 passed; `npm run check` passed). Acceptance criteria #1 and #3 must still be recorded with `tasks.py verify` by the parent worker. #2 is already skipped with a reason.

## Review conclusion

No material issues found.
