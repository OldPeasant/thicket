# Code Review

Date: 2026-11-17

Task: smoke-userdata-cleanup - Release: Linux smoke test fails removing the app's user-data folder

Scope: `git diff 4387931d..e47d6b7b` (production/harness change only: `test/e2e/harness/processes.ts` (new), `test/e2e/harness/fixtures.ts`, `test/e2e/smoke/installer.smoke.ts`). Test files that test-writer is adding at the same time are out of scope.

Requirements:
- tasks/smoke-userdata-cleanup.md (goal and acceptance criteria)
- AGENTS.md (OS-neutral code and tests, `.taskcheck` must finish)
- docs/ARCHITECTURE.md / existing harness conventions
- Parent context: release run 44136477833 (ENOTEMPTY on `/tmp/thicket-smoke-userdata-*/Cache`); local probe showing the AppImage runtime exits ~1 ms after SIGTERM while Electron processes in its group live on for 0.1-4 s

Git range:
- Branch: main
- HEAD: e47d6b7b
- Base/start: 4387931d22065e33ec3c80aebb39f10c75d67d9a
- Commits reviewed: 1

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | `endProcessTree` never signals a non-detached POSIX child, despite the fallback comment**
    - File: `test/e2e/harness/processes.ts:77`
    - Category: Quality
    - Problem: SIGTERM is only sent when `processGroupAlive(pid)` is true, and the SIGKILL step only runs when `waitForProcessGroupExit` times out. For a child that was not spawned with `detached: true`, `kill(-pid, 0)` fails with ESRCH, so the group counts as gone. Neither signal is sent, `waitForExit(child, 5_000)` times out, and the child is left running. The `signalGroup` catch branch (line 89, "Not a group leader (not detached) ... signal the child alone") cannot be reached in that case, so the comment suggests a fallback that does not exist. Both current callers spawn detached on POSIX: the smoke fixture does this explicitly (`installer.smoke.ts:90`), and Playwright's `launchProcess` uses `detached: process.platform !== "win32"`. So nothing breaks today. The JSDoc does say the child must be detached.
    - Why it matters: A future caller that forgets `detached` would silently leak the app process and wait 5 s, and the comment would lead the reader to expect otherwise.
    - Suggested fix: When `terminate` is set and the group is not alive but the child has not exited, call `child.kill(signal)` (and use the same rule for the SIGKILL step). Otherwise, remove the misleading part of the comment.

## Notes (verified, no finding)

- Root cause addressed: the old `killTree` resolved on the runtime's `exit`, which happens about 1 ms after SIGTERM. It also returned early when the runtime had already exited, without signalling the group. `endProcessTree` now polls `kill(-pgid, 0)` until the whole group is empty, which covers Electron and its helpers that were reparented after the runtime died. As a second line of defence, `rm` retries ENOTEMPTY/EBUSY/EPERM (`maxRetries: 10`, `retryDelay: 200`, linear backoff, about 11 s at worst).
- Process-group semantics: zombies still count as group members until they are reaped. The leader is reaped by Node's SIGCHLD handling while the poll loop yields. Orphaned helpers are reaped by init or a subreaper. EPERM is treated as alive. Every wait has a limit: at most 10 s grace + 5 s + 5 s on POSIX and 10 s + 5 s on Windows. This stays inside the 60 s test timeout and does not run in `.taskcheck` (e2e/smoke are not part of `npm run check`), so teardown cannot hang there.
- Harness fixture: `electronApp` depends on `userDataDir`, so its teardown (close, then the group wait) runs before the folder is removed. `terminate: false` is right after `app.close()`. For the dev Electron, when the group is already empty the wait returns at once, with no added delay. The AppImage path (`demo.e2e.ts` uses `appExecutable`) benefits in the same way.
- Windows: there are no process groups. The harness returns at once after `close()`, and the smoke fixture keeps the earlier `taskkill /T /F` behaviour. The `rm` retries cover EBUSY/EPERM from helpers that are slow to exit. The code is OS-neutral: there are no hard-coded paths, and the POSIX-only calls sit behind `process.platform`.
- Imports: `spawn` and `ChildProcess` are still used in `installer.smoke.ts`, and the new file is covered by the root `tsconfig.json`/eslint.
- Acceptance-criteria evidence was not recorded yet when this review ran (`tasks.py verify`: #1 and #3 unverified, #2 partial). The parent worker must still record it.

## Review conclusion

No material issues found.
