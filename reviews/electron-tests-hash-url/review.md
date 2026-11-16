# Code Review

Date: 2026-11-16

Task: electron-tests-hash-url - Fix npm run test:electron: 5 specs expect the URL without the router's #/ (pre-existing on main)

Scope: `git diff 05d2ce2..2be44e9` (test code in `apps/desktop/test` only). HEAD `d8a7282` has the same code as `2be44e9`; it only adds an assumption line to `tasks/electron-tests-hash-url.md`.

Requirements:
- `tasks/electron-tests-hash-url.md` (acceptance criterion: `npm run test:electron` passes on Linux, headless or xvfb-run)
- `AGENTS.md` (Evidence, project notes: never write secrets/test data into real profiles)
- Parent instructions: review correctness, robustness (process cleanup, flakiness, temp dirs, no writes into a real user profile), and whether the assertions still mean something
- Existing code: `apps/desktop/src/main/index.ts` (THICKET_USER_DATA, `[main] secret storage:` log), `packages/contract/src/profiles.ts` (`profiles.save` shape)

Git range:
- Branch: main
- HEAD: d8a728227b582cf90b6ed2afdc83d2584343f63f
- Base/start: 05d2ce25865280d4dbef57652bc2f441c334fa53
- Commits reviewed: 1 (2be44e9)

Summary: 0 P0, 0 P1, 1 P2, 1 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | `startupOutput` resolves before the spawned Electron has exited, so the caller deletes its userData folder while it is still shutting down, and nothing force-kills a process that does not exit**
    - File: `apps/desktop/test/helpers.ts:68-75` (used at `apps/desktop/test/app.electron.spec.ts:94-102`)
    - Category: Tests
    - Problem: `finish()` calls `child.kill()` (SIGTERM) and resolves/rejects right away. Electron treats SIGTERM as a graceful quit: `before-quit` runs, `host.stop()` stops the backend utilityProcess, and Chromium flushes its files (Local State, Preferences, caches) into userData. `THICKET_USER_DATA` calls `app.setPath('userData', ...)` before ready, so Chromium writes into the same temp folder. The caller's `finally { await rm(userData, { recursive: true, force: true }) }` runs during that shutdown. `rm` can fail with ENOTEMPTY/EBUSY when files appear while it walks the folder, which fails the test. It can also "succeed" and leave a re-created folder behind. If the graceful quit hangs, no SIGKILL fallback exists and nobody waits for `exit`, so an orphaned Electron, with its GPU/zygote and backend children, keeps running after the spec.
    - Why it matters: This is the robustness the task restores. The race is timing-dependent, so `test:electron` can become flaky on slower CI machines, and stray Electron processes pile up across runs.
    - Suggested fix: Make `finish()` wait for the child's `exit` before it resolves or rejects. Send SIGTERM, then SIGKILL if `exit` has not fired after a short grace period (for example 5 s). Skip the kill when the child has already exited (the `exit`-before-match path). The caller's `rm` then runs only after the process is gone.

## P3 Low

- [ ] **CR-2 | The startup pattern can match a partly received line**
    - File: `apps/desktop/test/app.electron.spec.ts:98`
    - Category: Tests
    - Problem: `startupOutput` tests the pattern on every chunk, and `/\[main\] secret storage: \S+/` already matches when a chunk ends mid-word (for example `...secret storage: we`). The helper then resolves and kills the app, and `toContain('[main] secret storage: weak')` fails. Small writes to a pipe usually arrive in one piece, so this is unlikely, but nothing guarantees it.
    - Why it matters: It is a small extra source of flakiness that is easy to remove.
    - Suggested fix: Anchor on what main always prints after the level, for example `/\[main\] secret storage: \S+ \(/` (the backend in parentheses follows the level) or require the trailing newline.

## Notes (not findings)

- **Correctness of the changes:**
  - `APP_URL` (`/^thicket:\/\/app\/(index\.html)?(#\/)?$/`) and the two-value check in `dev.electron.spec.ts` still reject any navigation away from the app origin. The tests for blocked navigation, `window.open` and frame navigation therefore still prove that navigation was blocked.
  - The regex also accepts `thicket://app/` and `thicket://app/index.html#/`. That is a little looser than the comment says, but it does not hide a real failure.
  - The `profiles.save` params match `packages/contract/src/profiles.ts`. Using the returned id for `setSecret`/`clearSecret`, and checking that `secrets.bin` does not contain that id, keeps the original intent.
- **Meaning of the startup-log assertion:** It now compares the level logged by a second process with the level that `profiles.secretStorage` reports in the first. The two processes run on the same machine with the same environment and without `--password-store`, so the comparison is still meaningful, but it is weaker than the old same-process check. That is acceptable given the Playwright limitation the assumption describes. The second process uses a temp `THICKET_USER_DATA` and opens no profile writes, so it cannot touch the real profile.
- **Out of scope, pre-existing:** The main `launchApp(output)` in `app.electron.spec.ts:25` (not changed by this diff) runs without `THICKET_USER_DATA`, so that spec still uses the developer's real userData folder. If that matters, it belongs in a separate task.
- **Evidence:** `python tasks.py verify electron-tests-hash-url` shows criterion #1 as not yet recorded. The parent worker still has to run `npm run test:electron` (headless or xvfb-run) and record the result.

## Review conclusion

Material issues found; fix before completing the task. The fixes themselves are correct and the assertions still mean something. Only CR-1 (process cleanup and temp-folder race in the new helper) should be fixed. CR-2 is optional.
