# Fix Report

Date: 2026-11-17

Task: ssh-tunnel - M2: SSH tunnels

Scope: current task. The findings are CR-1 to CR-7 from `reviews/ssh-tunnel/review.md`, plus the five failing test-writer unit tests (and one unhandled error) in `packages/backend/src/ssh/{known-hosts,tunnel}.spec.ts` at HEAD 2888225. Base commit 6533158. All changes are in the working tree and are not committed.

## Fixed findings

### CR-1 — SSH connect timeout and cancel did not end a pending TCP connect or a silent server

Files changed:
- `packages/backend/src/ssh/tunnel.ts`

Problem:
The timer and the abort handler called `client.end()`. On a socket that is still connecting, or whose peer never answers, that closes nothing. Two test-writer tests failed because of this: "hung server → timeout" never settled within 3 s, and "reads but never answers" ended as a generic "SSH connection … failed" error instead of `timeout`.

Fix:
The timeout and abort paths, and cleanup after a failed connect, now call `client.destroy()`. Errors that arrive after the timer fired map to `SSH_ERROR` with `reason: 'timeout'`. A single error listener now covers the whole connect phase, so the late error no longer ends up as a generic error.

Validation:
- `npx vitest run src/ssh/tunnel.spec.ts` (packages/backend), tests "a hung server … → SSH_ERROR timeout after readyTimeoutMS" and "a server that accepts and reads but never answers → SSH_ERROR timeout" — Pass

### CR-2 — `conn.test` leaked the tunnel when the driver client could not be created

Files changed:
- `packages/backend/src/connections/manager.ts`
- `packages/backend/src/connections/manager.spec.ts`

Problem:
`createClient(uri, options)` and `client.connect()` ran outside any cleanup. If `new MongoClient` threw synchronously, the SSH session and the local SOCKS port stayed open.

Fix:
Both calls are now wrapped. On a throw, the tunnel is closed and the original error is rethrown, so the error semantics are the same as before. New unit test: "conn.test closes its tunnel when the driver client cannot be created (CR-2)".

Validation:
- `npx vitest run src/connections` — Pass

### CR-3 — A dropped SSH session left the connection "connected" for good

Files changed:
- `packages/backend/src/ssh/tunnel.ts`
- `packages/backend/src/connections/manager.ts`
- `packages/backend/src/server/backend.ts`
- `docs/ARCHITECTURE.md`
- `packages/backend/src/ssh/tunnel.spec.ts`
- `packages/backend/src/connections/manager.spec.ts`

Problem:
When the SSH session ended after `ready`, the tunnel closed its local port, but the manager entry stayed `connected` with the dead tunnel. `open` returned at once and never rebuilt the tunnel. The code comment claimed the driver reported the loss.

Fix:
- `openSshTunnel` has a new option `onClosed`. It is called once, after the local port is closed, when a tunnel that was already returned closes without the owner calling `close()`.
- `ConnectionManager.connect` passes `onClosed` as `tunnelLost`. If the entry is still the current one and `connected`, `tunnelLost` sets it to `error` (`SSH_ERROR`, "The SSH tunnel was closed (connection to the SSH server lost); open it again"), drops the client and tunnel, logs, calls the new `deps.onStatus`, and closes the client. Because the entry is no longer `connected`, the next `open` builds a new tunnel and client.
- `startBackend` wires `onStatus` to a `conn.status` broadcast to every renderer. `BROADCAST_STREAMS.connStatus` with a `ConnStatus` payload already exists in the contract, and the sidebar already consumes it.
- The misleading comment is replaced, and docs/ARCHITECTURE.md describes the behaviour.
- New tests:
  - tunnel: "a lost SSH session calls onClosed once; the owner's own close() does not (CR-3)"
  - manager: "a tunnel lost while connected → error state broadcast, client closed, next open rebuilds (CR-3)"

Validation:
- `npx vitest run src/ssh src/connections` — Pass

### CR-4 — A cancel during the private key file read was ignored

Files changed:
- `packages/backend/src/ssh/tunnel.ts`

Problem:
The abort listener was added after `await authConfig(...)`. A signal aborted during that await never fired the listener, so the handshake ran on and asked the host key question. The test-writer test "an abort right after the call … → CANCELLED" failed with `{ result: 'connected', asked: 1 }`.

Fix:
`signal.aborted` is checked again after `authConfig` and before the client is created.

Validation:
- `npx vitest run src/ssh/tunnel.spec.ts`, test "an abort right after the call (before the SSH connect starts) → CANCELLED" — Pass

### CR-5 — The host key question outlived a failed handshake

Files changed:
- `packages/backend/src/ssh/tunnel.ts`
- `packages/backend/src/ssh/tunnel.spec.ts`

Problem:
When the connection closed while the user was being asked, the question was not aborted, a late "trust" still appended the key, the timer was re-armed on a finished client, and the error said only "closed the connection".

Fix:
- A `settled` flag is set when the connect promise fails or becomes ready, and the failure path aborts `asking`.
- `startTimeout` does nothing once the connect has settled.
- `verify` returns `false` without saving the key when the connect settled while the user was deciding.
- The close error now says "closed the connection while waiting for the answer to the host key question".

Writing this test exposed a further defect. Calling ssh2's `hostVerifier` callback after the connection is gone throws `TypeError: protocol._destruct is not a function` inside a promise chain, which is an unhandled rejection in the backend process. The callback is now skipped once the connect has settled. New test: "the server closing while the user is asked → question aborted, clear error, a late "trust" saves nothing (CR-5)". It drops the connection through a TCP relay, because a server-side `conn.end()` during key exchange trips an ssh2 server bug.

Validation:
- `npx vitest run src/ssh/tunnel.spec.ts` — Pass, no unhandled errors

### CR-6 — A race between the SSH session closing and the SOCKS port starting left the local port open

Files changed:
- `packages/backend/src/ssh/tunnel.ts`
- `packages/backend/src/ssh/tunnel-race.spec.ts` (new)

Problem:
If the session closed while `startLocalSocks` was still running, `close()` saw `socks === undefined`. The port that started afterwards was returned and never closed.

Fix:
After `startLocalSocks` resolves, if `closing` is already set, the new SOCKS server is closed and the call fails with `SSH_ERROR` ("… closed the connection"). `onClosed` is not called in this case, because the caller never received a tunnel. New test file `tunnel-race.spec.ts` uses a module mock (only in that file) to hold `startLocalSocks` until the session is gone. It asserts the rejection, that the late port is closed, and that `onClosed` is not called. I confirmed the test fails when the guard is disabled ("promise resolved … instead of rejecting").

Validation:
- `npx vitest run src/ssh/tunnel-race.spec.ts` — Pass (Fail with the guard disabled)

### CR-7 — The architecture doc gave the wrong error for a cancelled host key prompt

Files changed:
- `docs/ARCHITECTURE.md`

Problem:
The doc said that a cancelled connect fails with `SSH_ERROR` / `hostKeyRejected`.

Fix:
The doc now says: "no", the timeout, or no window → `SSH_ERROR` `hostKeyRejected`. A cancelled connect ends the question and fails with `CANCELLED`. A server that closes the connection meanwhile also ends the question (`SSH_ERROR`).

Validation:
- `npm run lint` (prettier --check covers docs) — Pass

### TW-1 — known_hosts: trust appended to a file without a trailing newline

Files changed:
- `packages/backend/src/ssh/known-hosts.ts`

Problem:
`trust()` appended the new line directly. If the file did not end with a newline (a hand-edited file, which the task's assumption expects), the new entry was glued onto the last line. The test "keeps both entries when the existing file has no trailing newline" failed: it got 'changed'. The test is correct and the production code was wrong.

Fix:
Before appending, `trust()` reads the file inside the serialized write. If the file is non-empty and does not end with `\n`, a newline is written first. A missing file is still created as before.

Validation:
- `npx vitest run src/ssh/known-hosts.spec.ts` — Pass

### TW-2 — A socket closed by the driver did not free its forwarded channel

Files changed:
- `packages/backend/src/ssh/socks.ts`

Problem:
When the local SOCKS socket closed, `remote.destroy()` sent the SSH channel close. But `socket.pipe` had already unpiped the channel, and an ssh2 client channel emits `close` only after its readable side ends. So the channel never emitted `close`, and the tunnel kept counting it and holding on to it. The test "a socket the driver closes frees its forwarded channel" failed: it got 2 instead of 1. The test is correct and the production code was wrong.

Fix:
After destroying it, `done()` calls `remote.resume()`, so the remaining data drains, the channel reaches `end`, and it emits `close`.

Validation:
- `npx vitest run src/ssh` — Pass (the socks.spec tests still pass)

### TW-3 — Unhandled "All configured authentication methods failed" from the agent-auth test

Files changed:
- `packages/backend/src/ssh/tunnel.ts`

Problem:
This was a production defect, not a test fault. The connect phase used `client.once('error', …)`. With an unreachable agent, ssh2 emits two errors: first the agent's error, then "All configured authentication methods failed". The second error had no listener, which is an uncaught exception that would crash the backend process.

Fix:
The client now has one persistent `error` listener for its whole life. Before `ready`, it fails the connect; extra errors are ignored because `failConnect` is idempotent. After `ready`, it logs the error and closes the tunnel.

Validation:
- `npx vitest run src/ssh src/server/backend.spec.ts` — Pass, 0 unhandled errors

## Not fixed

None. Every supplied finding was valid and in scope.

## Validation summary

Focused tests:
- `cd packages/backend && npx vitest run src/ssh src/server/backend.spec.ts src/connections` — Pass, 10 files, 354 tests, no unhandled errors. Before the fixes: 5 failed and 1 unhandled error.

Full test suite:
- `npx vitest run` (repo root, all backend, main and contract projects) — Pass, 58 files, 3281 tests
- `npm run test:int -- ssh` (Docker, `test/integration/ssh.int.spec.ts`, sshd in front of the replica set fixture) — Pass, 14/14
- `npm run test -w packages/renderer` — Not run, for the environmental reason below

Lint/type-check/build:
- `npm run lint` (eslint --max-warnings 0, prettier --check) — Pass
- `npx tsc -p tsconfig.json` (root) and `npm run typecheck -w @thicket/backend` — Pass
- `npm run check` — Fail, outside this task. Lint passes. Typecheck then fails in `packages/renderer` (`src/app/raw-editor/raw-editor.ts`: cannot find `@codemirror/view` and `@lezer/highlight`). Those dependencies were added to `packages/renderer/package.json` by the raw-editor task (commit 4eadd9f), but they are not installed in this clone's `node_modules`. The fixer may not install dependencies, so the parent worker needs to run `npm install` (or `npm ci`) and re-run `npm run check`. None of these fixes touch the renderer.

`.taskcheck`:
- Not run separately. It runs `npm run check`, which fails for the environmental reason above.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed. The only exception is `npm run check`: its renderer typecheck fails because CodeMirror dependencies from another task are not installed in this clone. Run `npm install`, then re-run `npm run check` / `.taskcheck` before `tasks.py done`.
