# Test Report

Date: 2026-11-17

Task: ssh-tunnel - M2: SSH tunnels

Scope: `git diff 88da381ed84ec4f77f2e61499e327e5b5ecac991..e8f41664d0076368ebfaa40da8398fce9a3f8e12`, supplied by the parent worker. Base 88da381 is the claim commit on main (`git merge-base HEAD origin/main`). The range contains the merge f89f243 of the prior owner's work from `origin/wip/ssh-tunnel` (commits 5f68617, 96f7e1c, 8b59ae8, 0ae06ef, c9a83ed, 2f11072, plus merges of main 239b60c, 01df705, 9990ebd) and the CR-8 fix e8f4166. Branch `main`, HEAD `e8f41664d0076368ebfaa40da8398fce9a3f8e12`. The working tree was clean when this run started. The run's only uncommitted change is the test-only edit listed below.

This report replaces the earlier one for revision c9a83ed. That run's tests, integration results and coverage analysis were re-run or re-checked on the final code here.

Requirements:
- tasks/ssh-tunnel.md: goal, 3 acceptance criteria, recorded assumptions
- SPEC.md M2 "SSH tunnel", docs/ARCHITECTURE.md "SSH tunnels" / "Coverage"
- reviews/ssh-tunnel/review.md (CR-1..CR-8) and reviews/ssh-tunnel/fixes.md
- AGENTS.md, docs/QUALITY.md
- Parent instructions: add a unit test for the CR-8 fix, check that manager.spec.ts still covers the task after the merge, run the focused suites, `npm run check`, task-scoped coverage for `packages/backend/src/ssh`, and `npm run test:int -- ssh`

## Test files changed

- `packages/backend/src/ssh/tunnel.spec.ts`: one new test in "openSshTunnel: forwarding and lifetime". `Socket` from `node:net` is now a value import (it was type-only) so the test can spy on `Socket.prototype.connect`. No existing test changed.

## Tests added or updated

Count: 1 added, 0 existing tests changed

- `openSshTunnel: forwarding and lifetime > close() with a peer that stopped answering destroys the SSH socket after 1 s (CR-8)`
  - Setup: an in-process ssh2 server sits behind a TCP relay that has `allowHalfOpen: true`. After the tunnel is ready, the relay goes silent: it stops forwarding and drops its upstream connection, and it never answers the client's FIN. This is the "peer that stopped answering" from CR-8.
  - Capturing the socket: the test finds the client's TCP socket by spying on `Socket.prototype.connect` while the tunnel opens, then removes the spy.
  - Assertions:
    - `tunnel.close()` resolves after the 1 s fallback (between 900 ms and 3 s);
    - the SSH TCP socket is `destroyed` afterwards;
    - the `…: closed` log line is written;
    - `onClosed` is not called, because the owner's own close is not a lost session.
  - Discrimination check: in a temporary experiment, I made the captured socket's `destroy()` a no-op, which simulates the code before the fix. The test then failed with `expected false to be true` on `destroyed`. I reverted the experiment before any recorded run. The test also passed 5 times in a row (`--repeats 4`).

manager.spec.ts after the merge: `git diff c9a83ed HEAD -- packages/backend/src/connections/manager.spec.ts` shows only the `isOpenClient` import and its describe block from main. All of the task's manager tests are still present and pass:
- "SSH profiles without an SSH environment fail UNSUPPORTED…"
- the 9 tests in "ConnectionManager SSH tunnels": open/close with the stored SSH secrets, the driver connect failure, the SSH failure, close during open → CANCELLED, conn.test closes its tunnel, CR-2, CR-3, SSH+proxy refused, the connectTimeoutMS wiring.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: sshd container in front of the replica set fixture: password, key, key with passphrase | `ssh.int.spec.ts`: "password: unknown host key → question, trusted → connects to the replica set", "private key without passphrase", "private key with passphrase (sshKeyPassphrase secret)", agent test, the wrong-passphrase / wrong-password / missing-passphrase tests | `npm run test:int -- ssh` (repo root; Docker; testcontainers lscr.io/linuxserver/openssh-server + 2-member mongo replica set) | Pass (15/15) |
| AC1: unknown host key → event, accept → connects | `ssh.int.spec.ts` "backend: host key prompt over the renderer port" tests; unit: `server/backend.spec.ts` SSH host key prompts, `ssh/prompts.spec.ts`, `ssh/tunnel.spec.ts` host key tests | `npm run test:int -- ssh`; `npx vitest run packages/backend/src/ssh packages/backend/src/connections`; `npm run check` | Pass |
| AC2: changed host key → refused with a clear error (int test) | `ssh.int.spec.ts` "a changed host key → refused with a clear error, without asking"; unit: `known-hosts.spec.ts`, `tunnel.spec.ts` changed-key test | same commands | Pass |
| AC3: tunnels closed when the connection closes, no leaked sockets (server connection count) | `ssh.int.spec.ts` "closing the connection closes the tunnel: no SSH session, no member connection left", "a failed driver connect closes its tunnel too", the conn.test tunnel test, "a dropped SSH session → conn.status error broadcast…"; unit: tunnel.spec lifetime tests, tunnel-race.spec, the manager SSH tests | same commands | Pass |
| CR-8: close() must not leave the SSH socket open when the peer never answers | new `tunnel.spec.ts` "close() with a peer that stopped answering destroys the SSH socket after 1 s (CR-8)" | `npx vitest run packages/backend/src/ssh packages/backend/src/connections`; `cd packages/backend && npx vitest run src/ssh/tunnel.spec.ts --repeats 4 -t "CR-8"` | Pass |
| Goal: replica set members reached through forwarded channels | `ssh.int.spec.ts` password test (`hello` through the tunnel names `ssh-rs-b:27017`, a host resolvable only behind sshd) | `npm run test:int -- ssh` | Pass |
| Goal: SRV resolved before tunnelling | none | none | Not testable here: the fixture has no SRV DNS records (see "Unable to test") |
| Regression of CR-1..CR-7 and TW-1..TW-3 | existing tests named in fixes.md | focused command and `npm run test:int -- ssh` | Pass |

## Focused test execution

Command:

`npx vitest run packages/backend/src/ssh packages/backend/src/connections` (repo root, 03:04:09 +01:00, after the new test was final)

Result:

Pass: 9 files, 321 tests

Also run: `cd packages/backend && npx vitest run src/ssh/tunnel.spec.ts --repeats 4 -t "CR-8"`: Pass, 5 runs.

Integration:

`npm run test:int -- ssh` (repo root, Docker, 03:05:05 +01:00, 30.7 s)

Result:

Pass: 1 file, 15 tests, exit 0

## Full test execution

Command:

`npm run check` (repo root: eslint `--max-warnings 0`, prettier --check, tsc for root and all workspaces, root Vitest, renderer `ng test`), started after the last test change

Result:

Pass, exit 0. Root Vitest: 60 files / 3388 tests. Renderer: 72 files / 2154 tests.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, which passed (see above).

## Bugs found

None. The new CR-8 test passes against e8f4166, and no other test failed.

## Coverage

Status: verified for the backend files of this task (whole-file, unit tests) and the contract files. Electron main and build-script changes are not measured (see the exclusions).

Metric: whole-file coverage of task-changed production files. These files include code from before this task, and pre-existing tests also count toward the hits.
Changed-line coverage: not measured. The configured tooling produces no changed-line report, and this run did not intersect lcov with the diff.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: ssh-tunnel; base `88da381ed84ec4f77f2e61499e327e5b5ecac991` (from the parent); HEAD `e8f41664d0076368ebfaa40da8398fce9a3f8e12`; file scope from `git diff --stat 88da381 HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD e8f4166 plus an uncommitted change to `packages/backend/src/ssh/tunnel.spec.ts`, sha256 `f8212d14323fbdfaafc6bbf4e55702dbf407b39de63955d8008d88634628e56c`. `tunnel.ts` sha256 is `567157cf4e7df56ba29c58e415e4d769b4b5f37da54bfe89ac27b4acb1f3b267`. Both hashes were the same before and after the coverage, check and integration runs. `git status` shows no other modified file.
- Exact included files:
  - backend: `src/ssh/{tunnel,socks,known-hosts,prompts,handlers,index}.ts`, `src/connections/{manager,options}.ts`, `src/server/{backend,entry}.ts`, `src/index.ts`
  - contract: `src/conn.ts`, `src/envelope.ts`
- Excluded:
  - `packages/renderer/src/app/api/api.service.ts`: type-only change.
  - `apps/desktop/scripts/build.mjs`: build configuration.
  - `apps/desktop/src/main/index.ts`: Electron bootstrap. Not measured, because `npm run test:electron` was not run.
  - `docs/`, `package-lock.json`, `packages/backend/package.json`, spec files, `test/integration/**`, `reviews/`: not production code.
  - No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8 5.1.0.
  - In `packages/backend`: `npx vitest run --coverage --coverage.reportsDirectory=coverage/ssh-tunnel-cr8-run1 --coverage.include='src/ssh/tunnel.ts' --coverage.include='src/ssh/socks.ts' --coverage.include='src/ssh/known-hosts.ts' --coverage.include='src/ssh/prompts.ts' --coverage.include='src/ssh/handlers.ts' --coverage.include='src/ssh/index.ts' --coverage.include='src/connections/manager.ts' --coverage.include='src/connections/options.ts' --coverage.include='src/server/backend.ts' --coverage.include='src/server/entry.ts' --coverage.include='src/index.ts' --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json`. All backend unit tests ran (25 files).
  - In `packages/contract`: `npx vitest run --coverage --coverage.reportsDirectory=coverage/ssh-tunnel-cr8-run1 --coverage.include='src/conn.ts' --coverage.include='src/envelope.ts' --coverage.reporter=text --coverage.reporter=json-summary`.
  - The integration tests are not part of these numbers.
- Run start/completion time and exit status:
  - backend: 2026-11-17T03:04:36+01:00 to 03:04:49, 1048 tests passed, exit 0;
  - contract: 03:05:41, 728 tests passed, exit 0.
- Generated report paths and report hashes/run identifier (all git-ignored):
  - `packages/backend/coverage/ssh-tunnel-cr8-run1/coverage-summary.json`, sha256 `43f8a3ed592a83de1b6798ea778bb1aaf1688e6ddf8a50924d5ed3bfd6ee7858`;
  - `packages/backend/coverage/ssh-tunnel-cr8-run1/coverage-final.json`, sha256 `0e13f4176831f6738d0c95b99eb13e1e5d9ae2aedcbb216d0d2ba2d0264f1906`;
  - `packages/contract/coverage/ssh-tunnel-cr8-run1/`.
- Evidence outputs are fresh and inputs stayed unchanged: both report directories are new and did not exist before this run. The snapshot hashes were unchanged.
- Final run after latest test additions and production fixes: yes. The run was after the CR-8 test and after the CR-8 fix e8f4166.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/ssh/tunnel.ts` | 180/186 (96.77%) | 90/98 (91.83%) | 35/37 (94.59%) | 165/167 (98.80%) |
| `packages/backend/src/ssh/socks.ts` | 139/144 (96.52%) | 38/45 (84.44%) | 23/25 (92.00%) | 129/131 (98.47%) |
| `packages/backend/src/ssh/known-hosts.ts` | 66/67 (98.50%) | 45/46 (97.82%) | 14/14 (100%) | 53/54 (98.14%) |
| `packages/backend/src/ssh/prompts.ts` | 28/29 (96.55%) | 8/9 (88.88%) | 8/8 (100%) | 24/24 (100%) |
| `packages/backend/src/ssh/handlers.ts` | 3/3 (100%) | N/A | 2/2 (100%) | 3/3 (100%) |
| `packages/backend/src/ssh/index.ts` | N/A (re-exports only) | N/A | N/A | N/A |
| `packages/backend/src/connections/manager.ts` | 212/214 (99.06%) | 113/115 (98.26%) | 40/41 (97.56%) | 184/185 (99.45%) |
| `packages/backend/src/connections/options.ts` | 84/84 (100%) | 94/95 (98.94%) | 5/5 (100%) | 76/76 (100%) |
| `packages/backend/src/server/backend.ts` | 40/44 (90.90%) | 11/12 (91.66%) | 13/16 (81.25%) | 37/39 (94.87%) |
| `packages/backend/src/server/entry.ts` | 0/6 (0%) | 0/4 (0%) | 0/1 (0%) | 0/6 (0%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/contract/src/conn.ts` + `envelope.ts` (combined provider total) | 18/18 (100%) | N/A | 1/1 (100%) | 18/18 (100%) |
| **Backend aggregate (provider total, 11 files)** | 753/778 (96.78%) | 399/424 (94.10%) | 140/149 (93.95%) | 672/686 (97.95%) |
| **packages/backend/src/ssh only (summed)** | 416/429 (96.96%) | 181/198 (91.41%) | 82/86 (95.34%) | 374/379 (98.68%) |

The aggregates leave out `apps/desktop/src/main/index.ts` (not measured), `apps/desktop/scripts/build.mjs` (build configuration) and `packages/renderer/src/app/api/api.service.ts` (type-only).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/ssh/tunnel.ts:272-277` (CR-8 fallback: destroy the socket after 1 s) | CR-8 / AC3: no SSH socket is left open when `close` never arrives | Test added (CR-8 test). Now covered |
| `packages/backend/src/ssh/tunnel.ts:443` (`socketOf` returns undefined when `_sock` is missing or has no `destroy`) | Defensive guard against a change in ssh2's private field | Not reachable through the public API: `close()` runs only after `connect()`, which sets `_sock`. Justified gap. If an ssh2 upgrade renames `_sock`, the fallback becomes a silent no-op; the new CR-8 test would catch that because it asserts `destroyed` |
| `packages/backend/src/ssh/tunnel.ts:143` | Connect settled while `knownHosts.check` was running | Narrow race guard (same as the previous report). Low risk |
| `packages/backend/src/ssh/tunnel.ts:203-204` | Default no-op `failConnect` / `onSessionError` before they are assigned | Placeholders. They are replaced before ssh2 can emit anything |
| `packages/backend/src/ssh/tunnel.ts:220` | `ready` after the connect already failed | Defensive. ssh2 does not emit `ready` after `close`/`error` |
| `packages/backend/src/ssh/tunnel.ts:300-302` | `forwardOut` requested after the tunnel started closing | The SOCKS server closes first. Narrow race, and the result is a SOCKS refusal either way |
| `packages/backend/src/ssh/tunnel.ts:369, 382, 433` | Error without `code`; Windows `pageant` default; non-Error throwables | The platform branch cannot run on Linux. The others are formatting fallbacks |
| `packages/backend/src/ssh/socks.ts:66-67` and its branch fallbacks | `server.address()` null; `?? 0` fallbacks; the 30 s handshake timeout | Defensive or unreachable. Unchanged from the previous report |
| `packages/backend/src/ssh/known-hosts.ts:88` | Non-ENOENT read error inside `trust()` | `check()` reads the file first and fails closed (tested). Low risk |
| `packages/backend/src/ssh/prompts.ts:30` | Second `finish` for the same prompt | Idempotency guard. Its observable behaviour is tested |
| `packages/backend/src/connections/manager.ts:77, 265` | Default MongoClient factory; entry replaced while the tunnel opened | The factory is exercised by the integration suite. Line 265 is reachable only when a tunnel resolves after abort, and the tunnel rejects with CANCELLED in that case (tested) |
| `packages/backend/src/server/backend.ts:69-70` | CR-3 `conn.status` broadcast when a tunnel is lost | Covered by the integration test "a dropped SSH session → conn.status error broadcast…" (passed in this run). Unit tests cannot reach a connected state without MongoDB |
| `packages/backend/src/server/backend.ts:42, 113` | Code from before this task | Outside this task's changes |
| `packages/backend/src/server/entry.ts:7-15` | Process entry: `THICKET_USER_DATA` → `userData` | Electron utility-process bootstrap. Its effect is covered through `startBackend({ userData })` in the integration tests. Justified gap |
| `packages/backend/src/connections/options.ts:178` | `?? String(error)` fallback | Code from before this task |

## Unable to test

- SRV resolved before tunnelling (a goal, not an acceptance criterion): the fixture has no DNS server with SRV records, and adding one is new infrastructure. The implementation leaves `mongodb+srv://` resolution to the driver on the client side, which resolves it before any SOCKS socket opens. Follow-up only if SRV evidence is wanted.
- `apps/desktop/src/main/index.ts` (`THICKET_USER_DATA` passed to the backend fork): `npm run test:electron` was not run.
- The host key prompt dialog in the renderer is outside this task (left to conn-ui-m2).

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found. The CR-8 fix has a unit test that fails when the 1 s socket destroy does nothing and passes against e8f4166. manager.spec.ts still covers all of the task's manager behaviour after the merge. The focused suites (321 tests), `npm run check` (3388 + 2154 tests) and `npm run test:int -- ssh` (15/15, Docker) all pass. Coverage of `packages/backend/src/ssh` is 96.96% statements, 91.41% branches and 98.68% lines. The remaining gaps are defensive code, a platform branch or bootstrap code, each justified above.
