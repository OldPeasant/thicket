# Code Review

Date: 2026-11-16

Task: electron-tests-hash-url - Fix npm run test:electron: 5 specs expect the URL without the router's #/ (pre-existing on main)

Scope: round 2 on the final code, `git diff 05d2ce2..c307e38 -- apps/` (test code in `apps/desktop/test` only). The commits also add `tasks/` and `reviews/` files, which are not code.

Requirements:
- `tasks/electron-tests-hash-url.md` (acceptance criterion: `npm run test:electron` passes on Linux, headless or xvfb-run; recorded assumption about the secrets spec and the startup-log check)
- `AGENTS.md` (Evidence; project notes: never write secrets or test data into real profiles)
- Round-1 review (CR-1, CR-2) and `reviews/electron-tests-hash-url/fixes.md`
- Existing code: `apps/desktop/src/main/index.ts` (THICKET_USER_DATA, `secret storage: <level> (<backend>)` log at line 177, no single-instance lock), `apps/desktop/vitest.electron.config.ts` (60 s test and hook timeouts), `packages/contract/src/profiles.ts`

Git range:
- Branch: main
- HEAD: c307e38769642f6d4e196caa6dacab505131c008
- Base/start: 05d2ce25865280d4dbef57652bc2f441c334fa53
- Commits reviewed: 4 (0878900, d8a7282, 476778c, c307e38); no uncommitted changes

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Verification of round-1 findings

- **CR-1 (P2, `startupOutput` cleanup): fixed.** `apps/desktop/test/helpers.ts:56-105`. `finish()` now sends SIGTERM and settles only after the child's `exit` event. It sends SIGKILL if `exit` has not fired after 5 s. I checked each path:
  - Pattern matched: SIGTERM is sent, and the promise settles after the `exit` promise registered at line 69. The later `exit` listener (line 100) then sees `settled` and does nothing. The caller's `rm(userData)` runs only after the process has exited.
  - Exit before match: `exited` is set first, so the promise settles right away with the "app exited" error, and no kill is sent to a dead pid.
  - Spawn failure (`error` without a pid): settles right away. No `exit` follows, so nothing hangs.
  - Timeout: the 20 s timeout plus the 5 s SIGKILL grace stays below the 60 s `testTimeout` in `vitest.electron.config.ts`.
  - The SIGKILL timer is cleared on exit, so no stray timer keeps running.
- **CR-2 (P3, partial-line match): fixed.** `apps/desktop/test/app.electron.spec.ts:98` now waits for `/\[main\] secret storage: \S+ \([^)\n]*\)/`. That only matches once the closing `)` of `log(\`secret storage: ${status.level} (${status.backend})\`)` has arrived, so the level word is complete. The assertion `toContain(\`[main] secret storage: ${status.level} (\`)` is exact for the level.

## Notes (not findings)

- **The rest of the diff is unchanged since round 1 and still correct.** `APP_URL` and the two-value check in `dev.electron.spec.ts` still reject any URL off the app origin, so the blocked-navigation, `window.open` and frame-navigation tests still prove what they claim. The `profiles.save` params match the contract. The secrets spec uses the returned id and still checks that `secrets.bin` does not contain it. The extra start uses a temp `THICKET_USER_DATA` that is removed in `finally`. Main has no single-instance lock, so this second start cannot collide with the running Playwright instance.
- **Edge case I left out on purpose:** the helper listens for `exit`, not `close`. Data that is still in the pipe when the process exits could be missed. That only matters on the exit-before-match error path, where the app quitting by itself during startup is already a failure. It is not worth a finding.
- **Out of scope, pre-existing:** the main `launchApp(output)` in `app.electron.spec.ts:25` runs without `THICKET_USER_DATA`. This diff did not change that.
- **Evidence:** `python tasks.py verify electron-tests-hash-url` still shows criterion #1 as unrecorded. `fixes.md` reports `npm run test:electron` (headless Ozone, no xvfb) -> 26/26 passed on the fixed code. The parent worker must record that run, or a fresh one, with `tasks.py verify` before `done`. I did not run the suite myself.

## Review conclusion

No material issues found.
