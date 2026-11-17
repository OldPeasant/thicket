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

---

# Round 3

Date: 2026-11-17

Task: ci-windows-macos - CI: unit tests pass on Windows and macOS again

Scope: commit e927c64c only (`git show e927c64c`), parent 0c93d4f8. It changes one file, `packages/renderer/src/app/console/shell-console.spec.ts`: the test 'keeps only the newest TRANSCRIPT_LIMIT runs' gets a 60 s timeout and a comment. Reason given by the parent: Windows CI run 44129719492 timed out this test after the 5 s default (849 ms locally), and the loop that kept running broke the tests after it. Rounds 1 and 2 (above) are not re-reviewed.

Requirements:
- tasks/ci-windows-macos.md (criterion 1: green `check` on all three OSes; criterion 2: each fix says whether the product or only the test was wrong)
- AGENTS.md project notes (OS-neutral tests, no timing-dependent asserts)
- docs/ARCHITECTURE.md (renderer tests run through `ng test`)

Git range:
- Branch: main
- HEAD: 944771b4997264fad2487645156a999807b26a2f (the commits after e927c64c change no files under `packages/`)
- Base/start: 0c93d4f88324886ffee557b7b7347419b4655957
- Commits reviewed: 1 (e927c64c9290c91c1c2ee49894ae573a75db69d1); no uncommitted changes

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-3 | The comment names the wrong cause, and the leak into later tests is only made less likely**
    - File: `packages/renderer/src/app/console/shell-console.spec.ts:476-492`
    - Category: Tests
    - Problem: The loop does 202 iterations (`TRANSCRIPT_LIMIT` is 200, `shell-console.ts:47`) with 3 `setTimeout(…, 0)` waits each, about 606 macrotask waits. On Windows a `setTimeout(0)` usually waits for the next system timer tick (about 15.6 ms by default), so the loop takes about 600 × 15.6 ms ≈ 9.5 s there. That is a fixed cost of the platform's timer resolution, not a "too slow" runner, so the comment's wording ("over the 5 s default on the Windows CI runner") hides why. The leak the comment describes comes from the loop using the outer `let` variables `fake`, `view` and `streamNo` (`spec.ts:27-30`), which `beforeEach` and `create()` of the next test reassign. After a timeout, the still-running loop calls `run()` on the next test's component and ends streams on the next test's fake. The 60 s timeout leaves about 6x margin, so this is fine for now, but a timeout would still cascade into unrelated failures.
    - Why it matters: Low. The fix is test-only and correct. A future reader who sees this test slow down, or a later timeout with confusing failures in the following tests, has a misleading explanation to work from.
    - Suggested fix: Optional. Say in the comment that Windows timer resolution (about 15 ms per `setTimeout(0)`) is the cause. To also remove the cascade, make the loop use local copies (`const f = fake, v = view`) and stop when the test has ended, or wait with fewer macrotasks per iteration (for example, wait for `evals()` to grow instead of three fixed `setTimeout(0)` calls).

## Verification notes

- Change: the only code change is the second argument `60_000` to `it(...)` (Vitest timeout per test) plus a three-line comment. Assertions, loop and product code are unchanged, so the test checks the same behavior as before (`runs()` capped at `TRANSCRIPT_LIMIT`, oldest dropped, DOM rows match). A timeout is not a timing-dependent assert, so this agrees with the AGENTS.md rule.
- Product: `ShellConsole.run()` caps the transcript with `[...runs, run].slice(-TRANSCRIPT_LIMIT)` (`shell-console.ts:321`). That code is OS-neutral, so "product correct, test-only" is right.
- Criterion 2: met for this fix. The commit subject says "test-only, product correct", and the test comment starts with "Test-only fix (the product was right)".
- Scope: the task's `touches` list (`packages/backend/src/ssh`, `io/bson`, `auth/oidc`) does not include `packages/renderer`. The change is still within the task goal, because criterion 1 needs a green `check` on all three OSes. This is noted for the parent and is not a code finding.
- Local run on Linux: `npx ng test --include src/app/console/shell-console.spec.ts` in `packages/renderer` gave 1 file and 81 tests passed in 3.96 s. Plain `npx vitest run` on that spec fails in TestBed setup because renderer specs need the Angular builder, which is expected and not related to this change.
- Criterion 1 is still open. Whether run 44129719492's failure is gone on Windows can only be shown by a new `check` run of `wip/ci-windows-macos` (or main after done) that is green on ubuntu, macOS and Windows. I could not run `gh` here. The parent must record that run id or mark the criterion skipped with a reason.

## Review conclusion

No material issues found.
