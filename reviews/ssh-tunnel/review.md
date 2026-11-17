# Code Review

Date: 2026-11-17

Task: ssh-tunnel - M2: SSH tunnels (third review: final revision after the main merge and the CR-8 fix)

Scope: `git diff 88da381..5857f35` (merge-base with origin/main = 88da381). This includes the earlier owner's work, merged from origin/wip/ssh-tunnel. Only committed code was reviewed, and the working tree was clean. The review concentrated on three changes made since the review of c9a83ed:
1. The merge of main, including the conflict resolution in `packages/backend/src/connections/manager.spec.ts` (merge 239b60c, and later f89f243).
2. e8f4166, which fixes CR-8 in `packages/backend/src/ssh/tunnel.ts` (`close()` and the new `socketOf` helper).
3. 5857f35, which adds a CR-8 regression test in `packages/backend/src/ssh/tunnel.spec.ts` and an updated `reviews/ssh-tunnel/tests.md`.

The review also confirmed that the whole task still meets its acceptance criteria.

Reviewed revision: 5857f358bc6bdc39801ef608c94e5c4fe6966607

Requirements:
- tasks/ssh-tunnel.md (goal, 3 acceptance criteria, 5 recorded assumptions)
- SPEC.md (M2 SSH tunnel, known_hosts in userData, security)
- docs/ARCHITECTURE.md ("SSH tunnels" bullet, lines 201-227)
- AGENTS.md, docs/QUALITY.md
- The earlier review reports (CR-1..CR-8), reviews/ssh-tunnel/fixes.md, reviews/ssh-tunnel/tests.md

Git range:
- Branch: main
- HEAD: 5857f358bc6bdc39801ef608c94e5c4fe6966607
- Base/start: 88da381
- Commits reviewed: 12 (5f68617, 96f7e1c, 8b59ae8, 0ae06ef, c9a83ed, 2f11072, the merges 239b60c, 01df705, 9990ebd and f89f243, then e8f4166 and 5857f35)

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Commands run

- `cd packages/backend && npx vitest run src/ssh src/connections src/server`: Pass. 11 files and 399 tests passed. This is 4 more than at c9a83ed: the CR-8 test, plus the `isOpenClient` tests that came in from main.
- `npm run check` (eslint with `--max-warnings 0`, prettier, type check, unit tests): Pass.
    - Backend and contract: 60 files, 3388 tests.
    - Renderer: 72 files, 2154 tests.
- `npm run test:int -- ssh` (Docker; the sshd fixture in front of the replica set fixture): Pass. 1 file and 15 tests passed in 27 s.
- `git show --cc 239b60c`: inspected the manager.spec.ts conflict resolution.
- Read-only inspection of ssh2 1.17.0 (`node_modules/ssh2/lib/client.js`):
    - `connect()` sets `this._sock` (line 290).
    - `end()` and `destroy()` both check `isWritable` (lines 1180-1188).

## Status of the earlier findings

- CR-1..CR-7: still fixed. The fix code in tunnel.ts, manager.ts, backend.ts, socks.ts and known-hosts.ts has not changed since c9a83ed, apart from the CR-8 lines below. Their regression tests still pass.
- CR-8 (P3, the owner's `close()` left a half-closed socket when the peer stopped answering): **Fixed.**
    - tunnel.ts:274-277: when the 1 s fallback fires, it now destroys the TCP socket through `socketOf(client)` and then resolves.
    - Why this works: ssh2 keeps the socket in `_sock`, set by `connect()`, and `client.destroy()` does nothing after `end()` (it checks `isWritable`). Destroying the socket directly is therefore the right lever.
    - The helper checks the type defensively. If `_sock` is missing, the code falls back to the old behaviour instead of throwing.
    - The fallback timer still fires after a normal `close`. It then calls `destroy()` on a socket that is already closed, which does nothing, and `resolve()` has no further effect. The timer is unref'd.
    - The `close` event that ssh2 emits after the destroy reaches `lost`. `lost` returns early because `closing` is set, so `onClosed` is correctly not called for the owner's own close.
- Regression test (tunnel.spec.ts:761): meaningful.
    - Setup: a relay with `allowHalfOpen` goes silent after `ready`. It unpipes, destroys the upstream, and never answers the client's FIN.
    - Without the fix: ssh2's socket would stay half-closed (`destroyed === false`).
    - With the fix: the test asserts that the socket is destroyed after the 1 s fallback, that `close()` takes 0.9-3 s, and that `onClosed` is not called.
    - The `Socket.prototype.connect` spy is restored right after the open, and again in cleanup.

## Merge resolution

The manager.spec.ts conflict resolution keeps both sides:
- the `KnownHosts`/`SshTunnel` import and the "ConnectionManager SSH tunnels" describe block from the task;
- the `isOpenClient` import and its describe block from main.

`isOpenClient` (manager.ts:450) goes through `manager.client()`. That call already throws for an entry that `tunnelLost` set to `error`, so main's new helper and the task's lost-session handling agree. No other task files conflicted.

## Acceptance criteria (rechecked at 5857f35)

1. Password, key and key-with-passphrase connects through sshd in front of the replica set; an unknown host key → `ssh.hostKey` event → accept → connects. Covered by test/integration/ssh.int.spec.ts, and passing in the run above.
2. A changed host key is refused with a clear error (`SSH_ERROR`, `reason: 'hostKeyChanged'`, and a message that names the known_hosts file). The integration test passes.
3. Tunnels are closed when the connection closes. The integration test checks that the sshd session count and the member connection count are 0 after close, and it passes. The CR-8 fix also closes the remaining gap for a peer that stopped answering.

Areas checked with no new findings:
- the `close()` fallback against a normal close and a lost session;
- the `socketOf` type guard;
- the timer lifetime;
- the docs: ARCHITECTURE.md:209-213 still describes the close behaviour correctly;
- no secrets in the new code or the new test.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found.

All earlier findings (CR-1..CR-8) are fixed, and each has a regression test. The conflict resolution in the main merge is correct. At revision 5857f35, the unit tests, `npm run check` and the SSH integration suite (15 of 15) pass, and together they cover all three acceptance criteria.
