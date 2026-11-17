# Test Report

Date: 2026-11-17

Task: ci-windows-macos - CI: unit tests pass on Windows and macOS again (round 2, after the TW-1 fix)

Scope: `git diff 442cca40b560e0f5e8ce16d3ae5240e800e98eda 9ad19862` (base and final HEAD given by the parent). Task commits: 20e804e4 (fixes), b5a51e0a (prettier), 42bacb87 (socks close() tests and round-1 reports), 4e199da9 (TW-1 fix); 9ad19862 merges origin/main. The merge brings no changes under `packages/backend` (`git diff 4e199da9 9ad19862 --stat -- packages/backend` is empty). Working tree clean at HEAD 9ad19862.
Production files changed: `packages/backend/src/ssh/socks.ts`, `packages/backend/src/ssh/tunnel.ts`. Test-only changes: `socks.spec.ts`, `known-hosts.spec.ts`, `tunnel.spec.ts`, `auth/oidc/flows.spec.ts`, `io/bson/bson.spec.ts`.

Requirements:
- `tasks/ci-windows-macos.md` (goal and acceptance criteria, recorded assumptions on SSH agent/Pageant)
- AGENTS.md project notes (OS-neutral tests, no timing asserts, skip only with a reason)
- docs/ARCHITECTURE.md "Coverage"
- `reviews/ci-windows-macos/fixes.md` (TW-1: the `socket.closed` shortcut was removed from socks close())
- Parent instructions (re-run the focused tests and task-scoped coverage, confirm the tests still cover the fix, edit tests only for a real defect)

## Test files changed

- None in round 2. The round-1 test changes in `packages/backend/src/ssh/socks.spec.ts` are committed in 42bacb87 and were not changed (sha256 2e4371923397236bbb2661fe949830bd664021843c8adfe86df10356db6b5957, same as round 1).

## Tests added or updated

Count: 0 in round 2 (round 1: 2 in `socks.spec.ts`, committed in 42bacb87)

Check of the TW-1 fix against the tests:
- socks.ts close() now always registers `socket.once('close', resolve)` and then calls `destroy()` for every socket still in the set. The set-removal listener (`socket.once('close', () => sockets.delete(socket))`, socks.ts:50) is registered when the socket is accepted, so it runs before close()'s listener, and `openSockets()` is 0 when close() resolves. A socket that already emitted `close` has left the set, so close() cannot wait forever on it.
- `close() right after a socket was destroyed still waits until that socket is gone` still runs the case the shortcut got wrong (socket destroyed, `closed` true, `close` not yet emitted) and asserts `openSockets()` is 0 once close() resolves. It passes. `close() stops listening and destroys open sockets; it is idempotent` covers the normal path and the second call returning the same promise. Coverage shows the close() socket lines (socks.ts:86-88) hit 18 times.
- Limit: on Linux the round-1 test also passed with the shortcut in place, so here it does not tell the old code from the new. The ordering it guards against shows up on Windows/macOS; the CI `check` run of `wip/ci-windows-macos` is the evidence for that.

No test change was needed: no defect was found.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| socks close() resolves only after every accepted socket is gone (Windows/macOS failure, incl. TW-1) | `close() stops listening and destroys open sockets; it is idempotent`, `close() right after a socket was destroyed still waits until that socket is gone` | `npx vitest run src/ssh src/io/bson src/auth/oidc` (repo root); `npx vitest run packages/backend/src/ssh/socks.spec.ts -t "close"` | Pass (Linux only) |
| SSH agent: SSH_AUTH_SOCK wins on every OS, else Pageant on Windows, none elsewhere | `defaultSshAgent: SSH_AUTH_SOCK wins on every OS; ...`, `agent method without an agent → SSH_ERROR naming SSH_AUTH_SOCK` (skipped on win32 with reason) | `npx vitest run src/ssh src/io/bson src/auth/oidc` | Pass (Linux) |
| known-hosts, oidc flows, bson tests OS-neutral | existing changed tests in `known-hosts.spec.ts`, `flows.spec.ts`, `bson.spec.ts` | same | Pass (Linux); the win32/macOS branches were not run here |
| AC1: `check` run green on ubuntu, macOS and Windows | - | - | Not run: there is no macOS/Windows here; the parent must use the CI run of `wip/ci-windows-macos` for revision 9ad19862 (or its task commit 4e199da9) |
| AC2: each fix says whether the product or the test was wrong | review of comments in diff | `git diff 442cca40 9ad19862` | Pass (by reading: comments in socks.ts, including the updated close() comment, tunnel.spec.ts, known-hosts.spec.ts, flows.spec.ts, bson.spec.ts) |
| AC3: `npm run check` passes locally | full suite | `npm run check` (repo root) | Pass |

## Focused test execution

Command:

`npx vitest run src/ssh src/io/bson src/auth/oidc` (run from the repo root; it uses the root Vitest config and picks the same backend files) and `npx vitest run packages/backend/src/ssh/socks.spec.ts -t "close"`

Result:

Pass: 9 test files, 282 tests (Linux, Vitest 5.1.0, started 17:40:21). The close() filter: 7 passed, 12 skipped by the filter.

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier --check, tsc for all workspaces, vitest run + renderer ng test)

Result:

Pass: lint and formatting clean, typecheck clean, 99 files / 5219 tests, renderer 125 files / 4137 tests, exit 0 (started 17:41:29).

## .taskcheck

Result:

Not run separately: `.taskcheck` runs `npm run check` (AGENTS.md), which passed above on HEAD 9ad19862.

## Bugs found

None. TW-1 (round 1 observation: the `socket.closed` shortcut in close()) is fixed in 4e199da9. The fix was checked above.

## Coverage

Status: verified (Linux) for the task-changed production files at HEAD 9ad19862.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured as a number. I inspected the v8 statement and branch maps instead. No uncovered statement or branch is in the task-changed lines (socks.ts close(), lines 76-94; tunnel.ts 380-405). Removing the shortcut removed one branch from socks.ts (47 to 45 branch counters, 149 to 147 statements). All close() statements are hit (lines 82-92).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: ci-windows-macos; base 442cca40b560e0f5e8ce16d3ae5240e800e98eda; HEAD 9ad19862; base and HEAD given by the parent; task commits 20e804e4, b5a51e0a, 42bacb87, 4e199da9 found with `git log 442cca40..HEAD`; merge 9ad19862 changes nothing in `packages/backend`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 9ad19862, clean working tree; socks.ts sha256 9147ff47c6920f45252b66e07c620c6379d3263ab045e8fe3052f40f96a89b48; tunnel.ts sha256 1701c0241bfe4304ed62708c63182ea4a0b865dae4cdafd7d59ed23a43fa651d; socks.spec.ts sha256 2e4371923397236bbb2661fe949830bd664021843c8adfe86df10356db6b5957 (same hashes before and after the runs).
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/ssh/socks.ts`, `packages/backend/src/ssh/tunnel.ts`; no renames or deletions; the five spec files are excluded because they are tests.
- Provider/version, command, working directory, and test selection: @vitest/coverage-v8 with Vitest 5.1.0; `npx vitest run src/ssh --coverage --coverage.include='src/ssh/socks.ts' --coverage.include='src/ssh/tunnel.ts' --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text` in `packages/backend`; test selection `src/ssh`: 6 files, 111 tests.
- Run start/completion time and exit status: started 2026-11-17 17:40:36, duration 12.77 s, exit 0, all tests passed.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-final.json` sha256 e5624eedca6900e8e3904aee0b5965fdb1caed3fe836f49a7c0c287a1be6f49e; `packages/backend/coverage/coverage-summary.json` sha256 fba0554c702277f942a3868f92302568567e07ee2c3f0df51b425b7622adff0d (both differ from round 1, so they were regenerated).
- Evidence outputs are fresh and inputs stayed unchanged: yes. The reports were regenerated by this run, and the source hashes did not change.
- Final run after latest test additions and production fixes: yes (after the TW-1 fix in 4e199da9 and the merge 9ad19862; no test edits in round 2).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/ssh/socks.ts` | 142/147 (96.59%) | 38/45 (84.44%) | 27/29 (93.10%) | 132/134 (98.51%) |
| `packages/backend/src/ssh/tunnel.ts` | 183/189 (96.82%) | 92/98 (93.87%) | 36/38 (94.73%) | 167/169 (98.81%) |
| Aggregate (both files, summed counters; no files missing or excluded) | 325/336 (96.72%) | 130/143 (90.90%) | 63/67 (94.02%) | 299/303 (98.67%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `socks.ts:65-67` (server without a TCP address) | Defensive guard, cannot happen when listening on 127.0.0.1:0 | Unchanged code and not reachable; no test |
| `socks.ts:53, 116, 166, 176, 178, 195` (non-Error rejection, `?? 0` fallbacks, re-read after failure) | Defensive fallbacks in handshake parsing | Unchanged code, not part of this task; no test |
| `tunnel.ts:143, 220, 300-302, 369, 445, 455` | Defensive branches in the tunnel and error mapping | Unchanged code, not part of this task; no test |

## Unable to test

- Windows and macOS behaviour (AC1: the win32 branches in known-hosts.spec.ts and tunnel.spec.ts, the socks close ordering on those OSes, and whether the TW-1 fix holds there): only Linux is available here. Follow-up: the parent records the `check` run of `wip/ci-windows-macos` on all three OSes for the final revision.
- On Linux the close() tests cannot tell the old shortcut from the fixed code (both pass), because the ordering problem does not occur here. Only the macOS/Windows CI run checks that.
- `defaultSshAgent('win32', ...)` returning `pageant` is tested as a pure function; a real Pageant connection on Windows is not tested, and doing so is out of scope.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The TW-1 fix is covered by the existing close() tests: all close() lines are hit and the tests pass. The focused tests (282), the coverage run (111) and `npm run check` pass at 9ad19862 on Linux. AC1 still needs the Windows/macOS CI run.

---

# Round 3

Date: 2026-11-17

Task: ci-windows-macos - CI: unit tests pass on Windows and macOS again (round 3, renderer test timeout)

Scope: commit e927c64c9290c91c1c2ee49894ae573a75db69d1 only (given by the parent), measured at HEAD 944771b4997264fad2487645156a999807b26a2f (merge of origin/main; clean working tree before this report was edited). The task commits from rounds 1-2 were rebased onto main and now have new hashes (04122a82, 298efe6d, 16c1b7c3, 10acaa1e); their production files are byte-identical to round 2 (socks.ts sha256 9147ff47..., tunnel.ts sha256 1701c024..., same as the hashes recorded above).

Changed file: `packages/renderer/src/app/console/shell-console.spec.ts` (test only; sha256 0ec88eab98440513eba74a8143cf02fa31b9cede26876e4bdcd0848f8142236c). No production file is changed.

Requirements:
- `tasks/ci-windows-macos.md` (AC1: `check` green on all three OSes; AC2: each fix says whether the product or the test was wrong; AC3: `npm run check` passes locally)
- AGENTS.md project notes (no timing-dependent asserts)
- Parent instructions (Windows CI run 44129719492 timed out this test after 5 s; 849 ms locally; the still-running loop broke the following tests)

## Check of the change

- The only change is the third argument `60_000` to `it('keeps only the newest TRANSCRIPT_LIMIT runs', ...)` plus a comment. The renderer runs on Vitest 5.1.0 (via `ng test`), where the third `it` argument is the per-test timeout, so the change does what it says.
- The test is not a timing assert: it awaits 3 macrotasks per run for 202 runs (`TRANSCRIPT_LIMIT` = 200, shell-console.ts:47) and then asserts on the final state. Its duration only depends on runner speed, so a longer timeout is the correct fix; the product behavior (keeping the newest 200 runs) is unchanged and still asserted (`streamNo`, `runs()` length 200, first `x = 3`, last `x = 202`, 200 `shell-run` rows).
- The comment states the test, not the product, was wrong (AC2).
- The explanation for the follow-on failures is plausible: Vitest does not cancel a timed-out async test body, so the loop kept calling `view.run()`/`fake.end()` while the next tests ran. With the 60 s limit (about 70x the local duration) the loop finishes inside its own test.
- No other renderer spec uses a per-test timeout; this is the only one, which is appropriate for the only test with ~600 real macrotask waits.
- No defect found; no test edited in round 3.

## Test files changed

- None by the test-writer in round 3. The parent's change in e927c64c was reviewed above.

## Tests added or updated

Count: 0 in round 3

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| Shell console keeps only the newest TRANSCRIPT_LIMIT runs, and the test no longer times out on slow runners | `keeps only the newest TRANSCRIPT_LIMIT runs` (and the rest of the spec, which the old overrun broke) | `npx ng test --include src/app/console/shell-console.spec.ts` (in `packages/renderer`) | Pass on Linux: 1 file, 81 tests, 4.34 s |
| AC1: `check` run green on ubuntu, macOS and Windows | - | - | Not run: no Windows/macOS here; the parent must use the CI `check` run of `wip/ci-windows-macos` that contains e927c64c |
| AC2: the fix says the test was wrong | comment in the diff | `git show e927c64c` | Pass (by reading) |
| AC3: `npm run check` passes locally | full suite | `npm --prefix <repo root> run check` | Pass |

## Focused test execution

Command:

`npx ng test --include src/app/console/shell-console.spec.ts` (working directory `packages/renderer`)

Result:

Pass: 1 file, 81 tests, started 18:03:07, duration 4.34 s.

## Full test execution

Command:

`npm run check` (repo root, run as `npm --prefix /home/eric/work/mongo-db-client-agents/agent-2 run check`)

Result:

Pass: eslint and prettier clean, typecheck clean for all workspaces, Vitest 99 files / 5219 tests (started 18:03:45), renderer 125 files / 4137 tests (started 18:04:03), exit 0.

## .taskcheck

Result:

Not run separately: `.taskcheck` runs `npm run check`, which passed above at HEAD 944771b4.

## Bugs found

None in round 3.

## Coverage

Status: not applicable for round 3; the round-2 coverage above remains valid.

Round 3 changes only a test timeout. It changes no production file and no test step or assertion, so it cannot change which production lines are executed. The task-changed production files (`packages/backend/src/ssh/socks.ts`, `tunnel.ts`) have the same sha256 hashes at HEAD 944771b4 as in the round-2 coverage run, and that run did not use the renderer spec. Coverage was therefore not re-measured: the round-2 numbers (aggregate statements 325/336, branches 130/143, functions 63/67, lines 299/303) still describe the current production code. Changed-line coverage for round 3: N/A (no production lines changed).

## Unable to test

- Whether 60 s is enough on the Windows CI runner (and that the follow-on failures are gone there) can only be shown by the Windows `check` run; only Linux is available here. Follow-up: the parent checks the CI run of `wip/ci-windows-macos` that includes e927c64c (the previous failing run was 44129719492).

## Summary (round 3)

Tests and task-scoped coverage are sufficient; no production defects found. The timeout-only change is correct and test-only, the shell-console spec (81 tests) and `npm run check` pass on Linux at HEAD 944771b4, and coverage is unchanged by a timeout-only change. AC1 still needs the Windows/macOS CI run.
