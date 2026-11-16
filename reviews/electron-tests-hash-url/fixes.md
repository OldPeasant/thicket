# Fix Report

Date: 2026-11-16

Task: electron-tests-hash-url - Fix npm run test:electron: 5 specs expect the URL without the router's #/ (pre-existing on main)

Scope: current task; findings from `reviews/electron-tests-hash-url/review.md` (base 05d2ce2, HEAD 476778c)

## Fixed findings

### CR-1 — `startupOutput` resolves before the spawned Electron has exited; no SIGKILL fallback

Files changed:
- `apps/desktop/test/helpers.ts`

Problem:
`finish()` called `child.kill()` and resolved or rejected right away. The caller's
`rm(userData)` could then run while Electron was still writing into the temp folder during its
graceful quit. Also, nothing force-killed an app whose quit hung.

Fix:
`finish()` now sends SIGTERM and settles only after the child's `exit` event. If `exit` has not
fired after 5 s, it sends SIGKILL. It settles at once when the child has already exited (the
exit-before-match path), or when `error` fired without a pid (the binary could not be spawned, so
no `exit` follows). Behavior is otherwise unchanged: same resolve value, same error messages, same
timeout.

Validation:
- `npm run test:electron` (Linux, headless Ozone, no DISPLAY/xvfb) — Pass (5 files, 26 tests)
- After the run, `pgrep -af agent-2/node_modules/electron` found no leftover Electron processes — Pass
- `npm run check` — Pass

### CR-2 — The startup pattern can match a partly received line

Files changed:
- None by the fixer. The test-writer already changed this in commit 476778c.

Problem:
`/\[main\] secret storage: \S+/` could match a chunk that ended in the middle of a word.

Fix:
Verified at `apps/desktop/test/app.electron.spec.ts:98`. The pattern is now
`/\[main\] secret storage: \S+ \([^)\n]*\)/`. It needs the backend in parentheses and the closing
`)`, so it matches only a complete level token. This is the anchor the reviewer suggested.

Validation:
- `npm run test:electron` — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `npm run test:electron` — Pass, 26/26 (headless, no xvfb)

Full test suite:
- `npm run check` (unit suites: root 2317 tests, renderer 511 tests) — Pass

Lint/type-check/build:
- `npm run check` (eslint, prettier --check, tsc for all workspaces, ngc) — Pass

`.taskcheck`:
- Pass (it runs `npm run check`, which passed above)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
