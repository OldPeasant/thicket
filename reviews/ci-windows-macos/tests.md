# Test Report

Date: 2026-11-17

Task: ci-windows-macos - CI: unit tests pass on Windows and macOS again

Scope: `git diff 442cca40b560e0f5e8ce16d3ae5240e800e98eda 20e804e4e54cd019f8078d7250ff37221ed6fcf3` (one task commit, 20e804e4, given by the parent; HEAD = 20e804e4 on main, plus the uncommitted test edit below).
Production files changed: `packages/backend/src/ssh/socks.ts`, `packages/backend/src/ssh/tunnel.ts`. Test-only changes: `known-hosts.spec.ts`, `tunnel.spec.ts`, `auth/oidc/flows.spec.ts`, `io/bson/bson.spec.ts`.

Requirements:
- `tasks/ci-windows-macos.md` (goal and acceptance criteria, recorded assumptions on SSH agent/Pageant)
- AGENTS.md project notes (OS-neutral tests, no timing asserts, skip only with a reason)
- docs/ARCHITECTURE.md "Coverage"
- Parent instructions (check socks close() with an already-closed socket and that close resolves only after sockets are gone)

## Test files changed

- `packages/backend/src/ssh/socks.spec.ts`

## Tests added or updated

Count: 2

- Updated `close() stops listening and destroys open sockets; it is idempotent`: now asserts `openSockets()` is 0 directly after `await close()`, before waiting for the clients to see the close. Before, the assertion came after awaiting the client sockets, so it did not prove that close() itself resolves only after the sockets are gone (the Windows/macOS regression). Strengthened, not weakened.
- Added `close() right after a socket was destroyed still waits until that socket is gone`: destroys the remote side of a forwarded connection; in the remote's `error` listener (after the server's own handler has destroyed the client socket, so `socket.closed` is already true but `close` not yet emitted) it calls `close()`, then asserts `openSockets()` is 0 once close() resolves. Coverage confirms it is the test that reaches the `if (socket.closed) resolve()` branch (socks.ts:85, branch hits [1,0] when run alone). Deterministic: ordering is controlled by event listeners, no delays.

No test added for `defaultSshAgent`: the task's own test covers all six input combinations (win32 with set/undefined/empty SSH_AUTH_SOCK, linux/darwin with set/undefined/empty), and every branch of it and of the changed `authConfig` agent lookup is covered. The test-only changes (known-hosts, oidc flows, bson) were read and are OS-neutral: `path.normalize` for the bson expectation, an explicit win32 branch with a reason for known-hosts, and the oidc test accepting either outcome of a genuine race between the late request and the receiver closing, with `await Promise.all(background)`.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| socks close() resolves only after every accepted socket is gone (Windows/macOS failure) | `close() stops listening and destroys open sockets; it is idempotent`, `close() right after a socket was destroyed still waits until that socket is gone` | `cd packages/backend && npx vitest run src/ssh src/io/bson src/auth/oidc` | Pass (Linux only) |
| SSH agent: SSH_AUTH_SOCK wins on every OS, else Pageant on Windows, none elsewhere | `defaultSshAgent: SSH_AUTH_SOCK wins on every OS; ...`, `agent method without an agent → SSH_ERROR naming SSH_AUTH_SOCK` (skipped on win32 with reason) | same | Pass (Linux) |
| known-hosts, oidc flows, bson tests OS-neutral | existing changed tests in `known-hosts.spec.ts`, `flows.spec.ts`, `bson.spec.ts` | same | Pass (Linux); the win32/macOS branches were not run here |
| AC1: `check` run green on ubuntu, macOS and Windows | - | - | Not run: there is no macOS/Windows here; the parent must use the CI run of `wip/ci-windows-macos` |
| AC2: each fix says whether the product or the test was wrong | review of comments in diff | `git diff 442cca40 20e804e4` | Pass (by reading: comments in socks.ts, tunnel.spec.ts, known-hosts.spec.ts, flows.spec.ts, bson.spec.ts) |
| AC3: `npm run check` passes locally | full suite | `npm run check` (repo root) | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/ssh src/io/bson src/auth/oidc`

Result:

Pass: 9 test files, 282 tests (Linux, Node v24.21.0, Vitest 5.1.0). `npx vitest run src/ssh/socks.spec.ts`: 19 passed.

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier --check, tsc for all workspaces, vitest run + renderer ng test)

Result:

Pass: lint and formatting clean, typecheck clean, 99 files / 5219 tests, renderer 125 files / 4137 tests, exit 0.

## .taskcheck

Result:

Not run separately: `.taskcheck` runs `npm run check` (AGENTS.md), which passed above.

## Bugs found

None confirmed.

Observation for the parent and the CI run (not a confirmed defect): in `socks.ts` close(), `if (socket.closed) resolve()` skips waiting for a socket that is already destroyed but whose `close` event has not fired yet. Node sets `closed` as soon as `destroy()` runs, but emits `close` only after the handle closed, and any socket still in the set has not emitted `close` (its `delete` listener is registered first). So this shortcut could bring back the "still counted after close()" symptom on platforms where the server's close callback runs first. On Linux the new test passes. The new test runs exactly this case, so the Windows/macOS CI run of `wip/ci-windows-macos` will show whether it is a problem there. If it fails, always waiting for `close` for sockets still in the set is the fix.

## Coverage

Status: verified (Linux) for the task-changed production files.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured as a number. I inspected the v8 branch map instead. No uncovered statement or branch is in the changed lines (socks.ts 76-92, tunnel.ts 380-405). Both outcomes of `socket.closed` at socks.ts:85 are hit, and so are both outcomes of `env.agent ??` and all three outcomes of `defaultSshAgent`.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: ci-windows-macos; base 442cca40b560e0f5e8ce16d3ae5240e800e98eda; HEAD 20e804e4e54cd019f8078d7250ff37221ed6fcf3; task commit and base given by the parent and checked with `git diff --stat` (6 files, all in the task's `touches`).
- Source/test snapshot identifier (including uncommitted inputs): HEAD 20e804e4 plus the uncommitted `socks.spec.ts` sha256 2e4371923397236bbb2661fe949830bd664021843c8adfe86df10356db6b5957; socks.ts sha256 78de79d6f7606341217bcb74623d1d6071a0712f37a0c796fcc894c2310654a3; tunnel.ts sha256 1701c0241bfe4304ed62708c63182ea4a0b865dae4cdafd7d59ed23a43fa651d.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/ssh/socks.ts`, `packages/backend/src/ssh/tunnel.ts`; no renames or deletions; the four spec files are excluded because they are tests.
- Provider/version, command, working directory, and test selection: @vitest/coverage-v8 with Vitest 5.1.0; `npx vitest run src/ssh --coverage --coverage.include='src/ssh/socks.ts' --coverage.include='src/ssh/tunnel.ts' --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text` in `packages/backend`; test selection is `src/ssh`: 6 files, 111 tests.
- Run start/completion time and exit status: 2026-11-17 17:35:16 (first run, reports written 17:35:44) and a rerun at 17:35:54 that produced the same report; both exit 0 with all tests passing.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-final.json` sha256 5f21ce4e0b79a5f7309e4033e0665881393500380db05b2fa095d563fd0667b9 (same in both runs); `packages/backend/coverage/coverage-summary.json` sha256 ade22cad3dda536949f8fc6bc4459543b9582d7e5b639f4a94c2657f3bc6f41d.
- Evidence outputs are fresh and inputs stayed unchanged: yes. Both runs regenerated the reports, and the sources were not edited between or during the runs.
- Final run after latest test additions and production fixes: yes (after both socks.spec.ts edits; no production fixes made).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/ssh/socks.ts` | 144/149 (96.64%) | 40/47 (85.10%) | 27/29 (93.10%) | 133/135 (98.51%) |
| `packages/backend/src/ssh/tunnel.ts` | 183/189 (96.82%) | 92/98 (93.87%) | 36/38 (94.73%) | 167/169 (98.81%) |
| Aggregate (both files, summed counters; no files missing or excluded) | 327/338 (96.74%) | 132/145 (91.03%) | 63/67 (94.02%) | 300/304 (98.68%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `socks.ts:65-67` (server without a TCP address) | Defensive guard, cannot happen when listening on 127.0.0.1:0 | Unchanged code and not reachable; no test |
| `socks.ts:53, 115, 165, 175, 177, 194` (non-Error rejection, `?? 0` fallbacks, re-read after failure) | Defensive fallbacks in handshake parsing | Unchanged code, not part of this task; no test |
| `tunnel.ts:143, 220, 300-302, 369, 445, 455` | Defensive branches in the tunnel and error mapping | Unchanged code, not part of this task; no test |

## Unable to test

- Windows and macOS behaviour (AC1: the win32 branches in known-hosts.spec.ts and tunnel.spec.ts, the socks close ordering on those OSes): only Linux is available here. Follow-up: the parent records the `check` run of `wip/ci-windows-macos` on all three OSes.
- `defaultSshAgent('win32', ...)` returning `pageant` is tested as a pure function; a real Pageant connection on Windows is not tested, and doing so is out of scope.

## Summary

Tests added and all validation passed on Linux. No production defects were confirmed. One possible problem in socks.ts close() (the `socket.closed` shortcut) is covered by a new test whose Windows/macOS CI result the parent should check.
