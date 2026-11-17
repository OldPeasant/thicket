# Code Review

Date: 2026-11-17

Task: ci-windows-macos - CI: unit tests pass on Windows and macOS again

Scope: committed changes of the task, `git diff 442cca40 b5a51e0a` (task commit 20e804e4 plus the prettier-only commit b5a51e0a on flows.spec.ts, reviewed at the coordinator's request)

Requirements:
- tasks/ci-windows-macos.md (goal, acceptance criteria, recorded assumptions)
- SPEC.md (SSH tunnel: password, private key or SSH agent)
- docs/ARCHITECTURE.md (SSH agent: `SSH_AUTH_SOCK` / `pageant`)
- AGENTS.md project notes (OS-neutral code and tests, skips only with a reason)
- Renderer help text `packages/renderer/src/app/connections/connection-editor.html:427` ("SSH_AUTH_SOCK, or Pageant on Windows")
- ssh2 `createAgent` in `node_modules/ssh2/lib/agent.js:391`

Git range:
- Branch: main
- HEAD: b5a51e0a147c49dacda71d76832a96d51f288d80
- Base/start: 442cca40
- Commits reviewed: 2 (20e804e4, b5a51e0a); no uncommitted changes

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | An inherited Unix-style SSH_AUTH_SOCK on Windows now overrides Pageant**
    - File: `packages/backend/src/ssh/tunnel.ts:399`
    - Category: Correctness
    - Problem: `defaultSshAgent` returns any non-empty `SSH_AUTH_SOCK` on win32. A value that is not a `\\.\pipe\...` path goes to ssh2's `CygwinAgent` (`agent.js:391-397`). Git Bash/MSYS `ssh-agent` sets values like `/tmp/ssh-XXXX/agent.N`, which Node on Windows resolves to a drive-root path that does not exist. A Pageant user who starts Thicket from such a shell used Pageant before this change, but now gets an agent connection error.
    - Why it matters: This is a narrow behaviour change on Windows. The task allows it and the recorded assumption covers it, and the UI text ("SSH_AUTH_SOCK, or Pageant on Windows") still matches. But the failure would be hard for a user to diagnose.
    - Suggested fix: Optional. Keep the decision, but name the agent path in the SSH_ERROR when the agent connection fails, or mention the case in the assumption so a human can confirm it. Do not change it silently.

- [ ] **CR-2 | The late-redirect catch in the OIDC test swallows every error**
    - File: `packages/backend/src/auth/oidc/flows.spec.ts:429`
    - Category: Tests
    - Problem: `.catch(() => ({ status: 'closed', ... }))` turns any rejection of the late `redirectBack` into `'closed'`, including a body-read failure or a bug in the helper, and not only the expected connection refusal or reset after `closeAllConnections()`.
    - Why it matters: The important property (only `code-1` reaches the token endpoint, line 445) is still asserted, so the risk is small. The catch only weakens what the fifth answer can tell you.
    - Suggested fix: Optional. Map only fetch network errors (`TypeError` from `fetch`) to `'closed'` and rethrow anything else.

## Verification notes

- socks `close()` (product fix): this is sound on all three OSes. The set-removal listener (`socks.ts:50`) is registered before the listener added in `close()`, so `openSockets()` is already 0 when `close()` resolves. `socket.closed` exists on the supported Node (>=24.15). `??=` keeps `close()` idempotent. Sockets missing from the snapshot are already closed, and no new ones arrive after `server.close()`.
- `defaultSshAgent` (product fix): it matches ssh2's dispatch. `\\.\pipe\openssh-ssh-agent` goes to OpenSSHAgent, `pageant` to PageantAgent, and other win32 paths to CygwinAgent. Empty and unset are handled the same way. Linux and macOS behaviour is unchanged, including the error message. It matches the docs and the UI text. The new unit test injects the platform, so all OSes are covered on every OS. The skipped no-agent test gives its reason, and that behaviour cannot occur on Windows.
- known-hosts: Windows reports ENOENT for a path below a file, and `entries()` maps ENOENT to "no entries", so `'unknown'` is the correct product result. The test was wrong, not the product. The Unix branch is unchanged.
- bson `metadataPath`: `path.join` returns native separators, and `path.normalize(expected)` gives the same strings on win32 (`\dumps\shop\orders.metadata.json`; `orders.metadata.json` stays relative). It is a no-op on POSIX, so the Linux assertion is as strict as before.
- OIDC flow test: `await Promise.all(background)` fixes the real race (the fifth answer could be pushed after the assertions ran) and the unhandled rejection. Both outcomes for the late request (404 or closed) are valid, because the receiver closes in `finally` (`flows.ts:226`).
- Criterion 2: the commit message and test comments say for each fix whether the product or the test was wrong.
- Criterion 1: no `check` run for `wip/ci-windows-macos` was visible (`gh run list -w check -b wip/ci-windows-macos -L 3` returned nothing). The parent must record a green run id for all three OSes before `done`. I did not judge this as a code finding.
- Locally (Linux): `npx vitest run` on the five affected spec files gave 5 files and 208 tests passed. I did not run the full `npm run check`.

## Review conclusion

No material issues found.
