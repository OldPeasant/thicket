# Code Review

Date: 2026-11-17

Task: ssh-tunnel - M2: SSH tunnels (re-review after fixes)

Scope: `git diff 825311f209a12613c39f285c7900abe0571bceb8..c9a83edd7acf4056306032a1ad94d27fac99a564` (task commits 5f68617, 96f7e1c, 8b59ae8, 0ae06ef, c9a83ed), committed code only. The working tree was clean. The review concentrated on the fix code: `tunnel.ts` (`onClosed`, the timeout and abort paths, the `settled` handling, the SOCKS start race), the `manager.ts` status handling (`tunnelLost`, the `test()` cleanup), the `conn.status` broadcast in `backend.ts`, the channel close in `socks.ts`, and the newline handling in `known-hosts.ts`.

Reviewed revision: c9a83edd7acf4056306032a1ad94d27fac99a564

Requirements:
- tasks/ssh-tunnel.md (goal, 3 acceptance criteria, 5 recorded assumptions)
- SPEC.md (M2 SSH tunnel, `known_hosts` in userData, security)
- docs/ARCHITECTURE.md ("SSH tunnels" and "Connections" bullets)
- AGENTS.md, docs/QUALITY.md
- The earlier review (CR-1..CR-7), reviews/ssh-tunnel/fixes.md, reviews/ssh-tunnel/tests.md

Git range:
- Branch: main
- HEAD: c9a83edd7acf4056306032a1ad94d27fac99a564
- Base/start: 825311f209a12613c39f285c7900abe0571bceb8
- Commits reviewed: 5

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Commands run

- `cd packages/backend && npx vitest run src/ssh src/connections src/server`: Pass. 11 files and 395 tests passed, with no unhandled errors.
- `npm run test:int -- ssh` (Docker; sshd fixture in front of the replica set fixture): Pass. 1 file and 15 tests passed in 39 s. These tests cover all three criteria:
    - password, key, and key with passphrase;
    - unknown host key → question → trusted → connects;
    - a changed host key is refused with a clear error;
    - after close, the sshd session count and the member connection count are 0;
    - a dropped session leads to a `conn.status` error broadcast, and a new open reconnects.
- Read-only inspection of the ssh2 1.17 sources (`node_modules/ssh2/lib/client.js`): `end()`, `destroy()`, and the keepalive in `sendKA`/`resetKA`. This is the input for CR-8.

## Status of the earlier findings

- CR-1 (P1, the timeout and abort did not close a pending or silent connect): **Fixed.** The timer and `onAbort` now call `client.destroy()` (tunnel.ts:102-121). A late error after the timer maps to `reason: 'timeout'` (tunnel.ts:207, 230). The regression tests at tunnel.spec.ts:521 and :549 (a hung server and a silent server) and the abort test at :581 pass.
- CR-2 (P2, `conn.test` leaked the tunnel when `createClient` threw): **Fixed.** `createClient` and `connect()` are wrapped, and the catch closes the tunnel (manager.ts, `test()`). The test at manager.spec.ts:1252 covers it.
- CR-3 (P2, a dropped session left the connection "connected"): **Fixed.**
    - `onClosed` fires only for a tunnel that was already returned and only when its owner did not close it (`returned`, and `lost` is skipped once `closing` is set).
    - `tunnelLost` acts only on the current entry in state `connected`. It sets `error`, drops the client and the tunnel, broadcasts through `deps.onStatus`, and closes the client.
    - `startBackend` sends `conn.status` to every connected renderer port. The sidebar already consumes it (`sidebar-tree.service.ts:124`).
    - The next `open` builds a new entry, because `connected` no longer matches.
    - The tests at manager.spec.ts:1271, at tunnel.spec.ts:720, and in the integration test "a dropped SSH session → conn.status error broadcast …" pass.
- CR-4 (P3, a cancel during the key file read was ignored): **Fixed.** tunnel.ts:90 checks `signal.aborted` again after `authConfig`.
- CR-5 (P3, the host key question outlived a failed handshake): **Fixed.**
    - `failConnect` aborts `asking`.
    - `startTimeout` does nothing once the connect has settled.
    - `verify` returns `false` without saving the key when the connect settled in the meantime.
    - The `hostVerifier` callback is no longer called after the connect settled, which avoids ssh2's `_destruct` TypeError.
    - The error message now mentions the host key question.
    - The test at tunnel.spec.ts:335 covers it.
- CR-6 (P3, a race between session close and SOCKS start leaked the local port): **Fixed.** tunnel.ts:316-322 closes the late SOCKS server and rejects. `onClosed` is not called because `returned` is still false. tunnel-race.spec.ts covers it.
- CR-7 (P3, the doc gave the wrong error for a cancelled prompt): **Fixed.** docs/ARCHITECTURE.md:220-222 now says that a cancelled connect fails with `CANCELLED`.

The fixer's additional fixes, checked:
- TW-1 (known_hosts without a trailing newline): correct. The check runs inside the serialized write, and a CRLF file ends in `0x0a`, so it gets no extra separator.
- TW-2 (`remote.resume()` in `done`): correct. `done` is idempotent, and calling `resume()` on a destroyed stream is harmless.
- TW-3 (one persistent `error` listener): correct. Errors before `ready` go to the idempotent `failConnect`, and errors after `ready` go to `onSessionError` → `lost`.

Areas checked with no new findings:
- `tunnelLost` against concurrent `close`, replace and re-open.
- The tunnel is lost while the entry is still `connecting`. The driver connect fails, and the catch closes the already-closed tunnel, which is idempotent.
- Errors and closes after the connect settled.
- The broadcast payload matches the `ConnStatus` contract.
- Renderer ports are removed from the broadcast set when they disconnect.
- No secrets are added to the new log or error messages.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-8 | The owner's `close()` does not close the SSH socket when the peer has stopped answering**
    - File: `packages/backend/src/ssh/tunnel.ts:268-273`
    - Category: Correctness
    - Problem: `close()` stops the SSH session with `client.end()`. If `close` does not arrive, it gives up after 1 s. The fix for CR-1 established that `end()` only half-closes a socket whose peer does not answer, and the comment at tunnel.ts:100-101 says so. In ssh2 1.17:
        - `end()` calls `sock.end()`, which sets `writable` to false;
        - `destroy()` only acts while the socket is still writable (`client.js:1187-1188`), so a later `client.destroy()` would do nothing;
        - the keepalive clears its interval on its next tick once the socket is no longer writable (`sendKA`).

      So if the user closes a connection after the network has silently gone away, and before the 45 s keepalive has noticed it, the TCP socket stays open after `close()` resolves. It stays open until the kernel gives up retransmitting the FIN, which takes many minutes. During that time nothing in Thicket tracks or closes the socket.
    - Why it matters: This is a narrow resilience gap for criterion 3 ("tunnels closed … no leaked sockets"), and only in a degraded network. The local SOCKS port and the channels are closed correctly. The integration test passes because a healthy sshd answers the disconnect message.
    - Suggested fix: When the 1 s wait in `close()` expires without `close`, destroy the underlying socket. `client.destroy()` will not work after `end()`, so either call `destroy()` instead of `end()` on that path, or keep a reference to the socket (the ssh2 `sock` connect option lets the caller supply it) and call `destroy()` on it. Optionally, add a unit test against a server that stops answering after `ready`.

## Review conclusion

No material issues found.

All seven earlier findings (CR-1..CR-7) are fixed, and each has a regression test. The fix code introduces no new defect beyond the low-priority CR-8, which may be fixed or recorded at the parent's discretion. Unit tests pass (395 of 395), and the SSH integration suite passes against Docker (15 of 15). Together they cover the three acceptance criteria.
