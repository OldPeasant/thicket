# Code Review

Date: 2026-11-17

Task: ci-windows-macos - CI: unit tests pass on Windows and macOS again

Scope: committed task changes `git diff 442cca40...9ad19862 -- packages` (round 2). The task commits on the first-parent line are 20e804e4, b5a51e0a, 42bacb87 and 4e199da9. The merge commit 9ad19862 brings in origin/main and changes only `tasks/` files. Round 1 reviewed up to b5a51e0a. This round reviews the full task diff again and focuses on the round-2 changes in `packages/backend/src/ssh/socks.ts` and `socks.spec.ts`.

Requirements:
- tasks/ci-windows-macos.md (goal, acceptance criteria, recorded assumptions)
- SPEC.md (SSH tunnel: password, private key or SSH agent)
- docs/ARCHITECTURE.md (SSH agent: `SSH_AUTH_SOCK` / `pageant`)
- AGENTS.md project notes (OS-neutral code and tests, no timing-dependent asserts, skips only with a reason)
- reviews/ci-windows-macos/tests.md and fixes.md (TW-1, and the decisions on CR-1 and CR-2 from round 1)

Git range:
- Branch: main
- HEAD: 9ad19862f9dc75ef363f379a4cfe6e1e24f0cab1
- Base/start: 442cca40
- Commits reviewed: 5 (20e804e4, b5a51e0a, 42bacb87, 4e199da9, merge 9ad19862 which changes only tasks/); no uncommitted changes

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | An inherited Unix-style SSH_AUTH_SOCK on Windows now overrides Pageant** (carried over from round 1; the parent accepted it without a change)
    - File: `packages/backend/src/ssh/tunnel.ts:399`
    - Category: Correctness
    - Problem: On win32, `defaultSshAgent` returns any non-empty `SSH_AUTH_SOCK`. ssh2 sends a value that is not a `\\.\pipe\...` path to `CygwinAgent`. So a Git Bash/MSYS `SSH_AUTH_SOCK=/tmp/ssh-.../agent.N` now replaces Pageant for users who start Thicket from such a shell.
    - Why it matters: The impact is narrow and the recorded assumption covers it. The UI text still matches. The resulting connection error could be hard to diagnose.
    - Suggested fix: Optional. Name the agent path in the SSH_ERROR, or extend the assumption so a human can confirm this case.

- [ ] **CR-2 | The late-redirect catch in the OIDC test swallows every error** (carried over from round 1; the parent accepted it without a change)
    - File: `packages/backend/src/auth/oidc/flows.spec.ts:429`
    - Category: Tests
    - Problem: `.catch(() => ({ status: 'closed', ... }))` maps every rejection of the late `redirectBack` to `'closed'`, including failures that have nothing to do with the closed connection.
    - Why it matters: The risk is small. The key property, that only `code-1` reaches the token endpoint, is still asserted.
    - Suggested fix: Optional. Map only fetch network errors (`TypeError`) to `'closed'` and rethrow anything else.

## Verification notes

- socks `close()` after the TW-1 fix (`socks.ts:76-93`): this is correct on all three OSes. The `sockets.delete` listener is the first `close` listener (`socks.ts:50`) and runs synchronously when `close` is emitted. So a socket that is still in the set has not emitted `close` yet. Waiting for that event with `once('close')` always ends: net.Socket emits `close` after `destroy()`, and `emitClose` is on by default. Removing the `socket.closed` shortcut closes the gap that TW-1 describes, where `closed` is already true but `close` has not been emitted. The snapshot `[...sockets]` is taken after `server.close()`, so no new sockets are accepted. `??=` keeps the call idempotent. When `close()` resolves, `openSockets()` is 0. The comment explains why and that this fixes the product, not the test.
- New and strengthened socks tests (`socks.spec.ts:343-345`, `359-377`): the idempotency test now asserts `openSockets() === 0` right after `await close()`, before the clients see the close. This is a stronger check than before and matches the regression. The new test calls `close()` from inside the remote's `error` listener. Ordering comes from listeners, not delays, and `vi.waitFor` polls the condition. So the test is deterministic and OS-neutral. The client socket has an error listener (`socks.spec.ts:19`), so the reset after the server destroys it does not cause an unhandled error.
- Earlier changes were re-checked against the current code and are unchanged since round 1: `defaultSshAgent`, the win32 skip with a reason in `tunnel.spec.ts`, the win32 branch in `known-hosts.spec.ts`, `path.normalize` in `bson.spec.ts`, and the OIDC `await Promise.all(background)`. The round-1 assessment still holds.
- Criterion 2: the commit messages and code/test comments say for each fix whether the product (socks close ordering, SSH agent on Windows) or only the test (known-hosts, bson, OIDC, the no-agent skip) was wrong.
- Criterion 1 (green `check` on ubuntu, macOS and Windows): this needs CI. I could not check it in this review because `gh` was refused here. The parent must record a green run id of `wip/ci-windows-macos` (or main after done) for all three OSes, or mark the criterion skipped with a reason. I did not treat it as a code finding.
- Locally on Linux: `npx vitest run` on socks, tunnel, known-hosts, bson and oidc/flows specs gave 5 files and 208 tests passed. `npx vitest run src/ssh/socks.spec.ts -t close` gave 7 tests passed. I did not run the full `npm run check` (criterion 3 belongs to the parent).

## Review conclusion

No material issues found.
