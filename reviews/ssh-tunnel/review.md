# Code Review

Date: 2026-11-17

Task: ssh-tunnel - M2: SSH tunnels

Scope: `git diff cfcebdcc839ff046efbb1a4d79dc3a701fa0ef73..5f7e0f7b6444d00379daa21b2edd2730f1fea3d8` (task commits ceb8b32 and 5f7e0f7), committed code only. Unit tests that the test-writer is adding to the working tree at the same time were not reviewed.

Reviewed revision: 5f7e0f7b6444d00379daa21b2edd2730f1fea3d8

Requirements:
- tasks/ssh-tunnel.md (goal, 3 acceptance criteria, 5 recorded assumptions)
- SPEC.md: M2 Connectivity "SSH tunnel" item, section 5 (`known_hosts` in userData), section 6 (security)
- docs/ARCHITECTURE.md: "SSH tunnels" bullet (added by this task) and "Connections" bullet
- AGENTS.md, docs/QUALITY.md

Git range:
- Branch: main
- HEAD: 5f7e0f7b6444d00379daa21b2edd2730f1fea3d8
- Base/start: cfcebdcc839ff046efbb1a4d79dc3a701fa0ef73
- Commits reviewed: 2

Summary: 0 P0, 1 P1, 2 P2, 4 P3

What the reviewer ran:
- Read the full diff and these files in full: `packages/backend/src/ssh/{tunnel,socks,known-hosts,prompts,handlers}.ts`, the changed parts of `connections/manager.ts` and `options.ts`, `server/backend.ts`, `entry.ts`, the contract additions, `apps/desktop` main env and esbuild config, and `test/integration/ssh.int.spec.ts` with its fixture.
- ssh2 1.17 behaviour, from a node script against a blackholed address (10.255.255.1:22): after `client.end()` at 1 s, the client was still open 20 s later (no `close`). After `client.destroy()` at 1 s, it closed at 1006 ms.
- In-memory esbuild bundle of `packages/backend/src/server/entry.ts` with the build script's options: the bundle builds, and `sshcrypto.node` stays a runtime `require` inside ssh2's try/catch, so it falls back to JS. The externals change is fine.
- `new MongoClient('mongodb://a,b/?directConnection=true', {proxyHost…})` throws synchronously (`directConnection option requires exactly one host`). This is the input for CR-2.
- The reviewer could not run unit tests: the Bash permission for vitest was denied. The parent reports the integration suite passed 14/14 against Docker, and the reviewer did not re-run it.

Areas checked with no findings: SOCKS5 parsing (greeting, RFC 1929 auth with a constant-time compare, ATYP v4/domain/v6, early payload forwarded, piping both ways with back pressure, the handshake timeout), local proxy credentials (random per tunnel, bound to 127.0.0.1, never logged), known_hosts semantics (any other key for the host means "changed" and is refused without a prompt, read errors fail closed, appends are serialized, hashed entries are read), prompt IDs (a random UUID per prompt, `NOT_FOUND` once a prompt is over, no prompt is answered for another), secrets kept out of messages and logs (manager log masking, ssh2 messages carry no secrets), contract additions and the no-secrets schema test, the `close()`/open races in `ConnectionManager.connect` (the entry is re-checked after the tunnel opens, the tunnel is closed in the catch, and `close()` is idempotent), and the `THICKET_USER_DATA` wiring.

## P0 Critical

None.

## P1 High

- [ ] **CR-1 | The SSH connect timeout and cancellation don't work while the TCP connect is pending, or when the server stays silent**
    - File: `packages/backend/src/ssh/tunnel.ts:84`, `packages/backend/src/ssh/tunnel.ts:99`
    - Category: Correctness
    - Problem: The timer (`startTimeout`) and `onAbort` both stop the handshake with `client.end()`. In ssh2 1.17, `end()` writes a disconnect message and calls `sock.end()`. On a socket that is still connecting, or one whose peer never closes, this does not close anything. The reviewer confirmed this with a blackholed address: after `end()`, no `close` event arrived within 20 s. `client.destroy()` closed the socket in 3 ms. As a result, for an unreachable or firewalled SSH host:
        - the documented "timeout = `connectTimeoutMS`, default 20 s" (docs/ARCHITECTURE.md, "SSH tunnels") never fires. The connect fails only when the OS TCP connect timeout ends it (about 2 min on Linux).
        - cancelling `conn.test` does not end the call. `test()` awaits `openTunnelFor` with no `abortable`, so the response stays pending until the OS gives up.
        - `conn.close` during a connect aborts `entry.abort`, but the `openSshTunnel` promise stays pending in the same way.
    - Why it matters: An unreachable host (wrong address, firewall drop) is the most common SSH failure. In that case the UI shows "connecting…" or "testing…" for minutes, and Cancel does nothing. The "loading/cancellation must end" rule fails, and so does the timeout this task documented.
    - Suggested fix: In the timeout and abort paths, call `client.destroy()`, or `end()` followed by `destroy()`. Add a unit test that uses a TCP server that accepts and never answers, or a socket that never connects, and assert that the timeout and the abort reject in time.

## P2 Medium

- [ ] **CR-2 | `conn.test` leaks the SSH tunnel when the driver client cannot be created**
    - File: `packages/backend/src/connections/manager.ts:107`
    - Category: Correctness
    - Problem: In `test()`, the tunnel is opened at line 96. `this.createClient(uri, options)` (line 107) and `client.connect()` (line 108) run outside the `try` whose `finally` closes the tunnel. Only the `clientConfig` call was wrapped. `new MongoClient(...)` throws synchronously for connection strings that the contract accepts, for example `mongodb://a,b/?directConnection=true` or an unknown URI option (reviewer reproduction above). When it throws, the SSH session, its keepalive, and the local SOCKS listener stay open until the backend exits. `connect()` does not have this problem, because its catch closes `entry.tunnel`.
    - Why it matters: Users test drafts while they are still editing the connection string, so a malformed string is likely input to `conn.test`. Each such test leaks one SSH session to the user's server. This contradicts criterion 3 ("tunnels closed … no leaked sockets") on an untested path.
    - Suggested fix: Move `createClient` and `client.connect()` inside the `try`, or wrap them so `tunnel?.close()` runs on a synchronous throw. Add a unit test with a `createClient` that throws and a fake `openTunnel`, and assert that the tunnel is closed.

- [ ] **CR-3 | A dropped SSH session leaves the connection "connected" for good, and the code comment says otherwise**
    - File: `packages/backend/src/ssh/tunnel.ts:200-224`, `packages/backend/src/connections/manager.ts:192`
    - Category: Correctness
    - Problem: When the SSH session ends after `ready` (keepalive failure, server restart, network blip), `close()` runs. It closes the local SOCKS port for good, and nothing ever reopens it. The manager is not told: the entry keeps `state: 'connected'` and the dead tunnel, and `open()` returns `connected` at once (line 192) without building a new tunnel. Every later operation fails with a network error until the user explicitly closes and reopens the connection. Without SSH, the driver recovers from the same blip by itself. The comment at tunnel.ts:200-201 says the driver "reports the connection as lost", but nothing in the manager does that.
    - Why it matters: A short network interruption permanently breaks a tunnelled connection without telling the user, and "Open" does not repair it.
    - Suggested fix: Give `openSshTunnel` an `onClosed` callback, or an event, that fires when the tunnel closes unexpectedly. Have the manager use it to mark the entry `error` (or remove it) and broadcast the status, so that the next `open` builds a new tunnel. If this belongs to a later task, fix the comment and record the limitation as an assumption.

## P3 Low

- [ ] **CR-4 | A cancel during the private key file read is ignored**
    - File: `packages/backend/src/ssh/tunnel.ts:75-86`
    - Category: Correctness
    - Problem: `signal.aborted` is checked before `await authConfig(...)` (which reads the key file). The abort listener is added after that await. `addEventListener('abort')` on a signal that is already aborted never fires. So a cancel that arrives during the read lets the handshake run to the end, and it can still broadcast a host key prompt for a cancelled connect. The manager does discard the tunnel afterwards.
    - Why it matters: A narrow window, but the result is a user-visible prompt for a cancelled operation, plus wasted SSH work.
    - Suggested fix: Check `signal?.aborted` again after `authConfig` and before `new Client()`, or register the listener before the await.

- [ ] **CR-5 | The host key question outlives a handshake that has already failed**
    - File: `packages/backend/src/ssh/tunnel.ts:119-138`
    - Category: Correctness
    - Problem: If the SSH connection closes while the user is deciding, the connect is rejected but `asking` is not aborted. sshd's default `LoginGraceTime` is 120 s, and the prompt waits up to 5 min. As a result:
        - the prompt stays open, and a later "trust" still appends the key to known_hosts;
        - the error says only "closed the connection";
        - `finally { startTimeout() }` arms a new 20 s timer on a client that is already finished.
    - Why it matters: The dialog (conn-ui-m2) would show a question whose connect is already gone, and the error does not explain why the connect failed.
    - Suggested fix: Abort `asking` from the connect promise's `close` and `error` handlers. In `verify`, restart the timer only if the connect is still pending. Optionally, mention the prompt in the error, for example "the server closed the connection while waiting for the host key answer".

- [ ] **CR-6 | A race between SSH session close and SOCKS start leaves the local port open**
    - File: `packages/backend/src/ssh/tunnel.ts:203-250`
    - Category: Correctness
    - Problem: `close()` reads `socks` when it runs. If the SSH session closes between `ready` and the end of `startLocalSocks` (`client.on('close')` at line 224), `close()` finishes while `socks` is still `undefined`. The SOCKS server that starts afterwards is assigned and returned in the tunnel. Every later `tunnel.close()` returns the memoized `closing` promise, so that listener is never closed.
    - Why it matters: A small window, but it leaks a listening port, and the manager believes the tunnel was closed.
    - Suggested fix: After `startLocalSocks` resolves, check `closing`, and if it is set, close `socks` and throw. Alternatively, close `socks` in a step that also runs after `closing` has been set.

- [ ] **CR-7 | The architecture doc describes the wrong error for a cancelled host key prompt**
    - File: `docs/ARCHITECTURE.md:217-218`
    - Category: Quality
    - Problem: The doc says that "no", the timeout, no window "or a cancelled connect fail with `SSH_ERROR` (`reason: 'hostKeyRejected'`)". In the code, a cancelled connect fails with `CANCELLED` (`tunnel.ts:175` and `:194`), and the manager maps a close-while-connecting to `CANCELLED` too.
    - Why it matters: conn-ui-m2 will build the dialog and its error handling from this doc.
    - Suggested fix: Change the doc to say that a cancelled connect ends with `CANCELLED`.

## Review conclusion

Material issues found; fix before completing the task.

CR-1 (P1) and CR-2 (P2) are verified defects in the timeout, cancellation and cleanup paths. Both have small fixes. The three acceptance criteria themselves are implemented, and the committed integration tests cover them (password, key, key with passphrase, unknown key → event → trusted, changed key refused, sshd and mongod connection counts back to 0 after close). The reviewer did not re-run those integration tests.
