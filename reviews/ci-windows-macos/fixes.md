# Fix Report

Date: 2026-11-17

Task: ci-windows-macos — CI: unit tests pass on Windows and macOS again

Scope: current task (findings from reviews/ci-windows-macos/tests.md and review.md)

## Fixed findings

### TW-1 — socks close() `socket.closed` shortcut can resolve before the socket leaves the set

Files changed:
- `packages/backend/src/ssh/socks.ts`

Problem:
In `close()`, `if (socket.closed) resolve()` resolved immediately for a socket that was already destroyed. For `net.Socket`, `closed` turns true when `destroy()` runs, but the `close` event (whose listener removes the socket from `sockets`) is emitted later. Every socket still in the set has not emitted `close` yet, so `close()` could resolve while `openSockets()` still counted it, which is the symptom this task fixes on Windows/macOS.

Fix:
Dropped the shortcut: `close()` now always waits for each remaining socket's `close` event, then calls `destroy()`. The set-removal listener is registered first, so `openSockets()` is 0 when `close()` resolves. Comment updated to explain why.

Validation:
- `npx vitest run src/ssh` (packages/backend) — Pass (6 files, 111 tests, including `close() right after a socket was destroyed still waits until that socket is gone`)
- `npx prettier --check packages/backend/src/ssh/socks.ts` — Pass
- `npx eslint packages/backend/src/ssh/socks.ts` — Pass

## Not fixed

### CR-1 — An inherited Unix-style SSH_AUTH_SOCK on Windows now overrides Pageant

Status:
Accepted without change (parent decision)

Reason:
Edge case (Git Bash / MSYS environment on Windows) covered by the recorded task assumption; no code change needed for this task.

### CR-2 — The late-redirect catch in the OIDC test swallows every error

Status:
Accepted without change (parent decision)

Reason:
The catch is broad, but the test's key token check still holds, so the test still fails if the behavior under test breaks.

## Validation summary

Focused tests:
- `npx vitest run src/ssh` in packages/backend — Pass (111 tests)

Full test suite:
- Not run (parent runs `.taskcheck`)

Lint/type-check/build:
- `npx prettier --check` and `npx eslint` on `packages/backend/src/ssh/socks.ts` — Pass

`.taskcheck`:
- Not run (parent runs it before `done`)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
