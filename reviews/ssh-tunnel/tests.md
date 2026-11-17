# Test Report

Date: 2026-11-17

Task: ssh-tunnel - M2: SSH tunnels

Scope: `git diff 48a81f64f61270691cffa7b1c64d2ad913e39295..cecc8b95ea2ea3e828091bed36b96a2157c625ce` (task commits d254fa5, d37a8eb, 287d3bd, cecc8b9, supplied by the parent worker), plus this run's uncommitted test-only changes listed below. Branch `main`, HEAD `cecc8b95ea2ea3e828091bed36b96a2157c625ce`. The working tree was clean when this run started.

Requirements:
- tasks/ssh-tunnel.md: goal, 3 acceptance criteria, 5 recorded assumptions
- SPEC.md M2 "SSH tunnel" and docs/ARCHITECTURE.md "SSH tunnels" / "Coverage"
- reviews/ssh-tunnel/review.md (CR-1..CR-7) and reviews/ssh-tunnel/fixes.md: used to target the regression tests at the fixed behaviour
- AGENTS.md, docs/QUALITY.md

## Test files changed

- `packages/backend/src/ssh/tunnel-race.spec.ts`: one new test. The existing module mock gained a `fail` hook. The existing test is unchanged.
- `packages/backend/src/connections/manager.spec.ts`: one new test, appended to "ConnectionManager SSH tunnels"
- `test/integration/ssh.int.spec.ts`: one new integration test (new describe block)
- `test/integration/fixtures/ssh.ts`: new fixture helper `dropSshSessions()`. It kills the test user's sshd session processes with `pkill -KILL -f ': thicket'` inside the sshd container. No shell is used, so the pattern cannot match the pkill command itself.

## Tests added or updated

Count: 3 added, 0 existing tests changed

- `openSshTunnel: the local port cannot start > closes the SSH session and fails with SSH_ERROR; onClosed is not called`: an in-process ssh2 server, with `startLocalSocks` made to reject. Asserts `SSH_ERROR` "Cannot open the local tunnel port: …", that the authenticated SSH session is closed on the server side within 3 s, and that `onClosed` is not called. This covers the no-leak requirement (criterion 3) on an error path that no test reached before (tunnel.ts:312-315).
- `ConnectionManager SSH tunnels > the profile's connectTimeoutMS is the SSH handshake timeout; without it the tunnel's default applies`: checks the documented "timeout = `connectTimeoutMS`, default 20 s" wiring (manager.ts:182-184, a branch no test reached before).
- `SSH tunnel lost while connected (backend, CR-3) > a dropped SSH session → conn.status error broadcast, tunnel port closed; open again reconnects`: real backend (`startBackend`), real sshd and replica set containers. The test answers the host key prompt, connects, kills the SSH session in the container, and then asserts:
  - a `conn.status` broadcast with `state: 'error'`, `SSH_ERROR` "SSH tunnel was closed";
  - `conn.status` reports the error state;
  - a new `conn.open` reconnects without a second host key question;
  - `conn.serverInfo` reports `replicaSet` through the new tunnel;
  - the sshd connection count goes back to its starting value after close.

  This test covers the CR-3 fix end to end, including the `onStatus` broadcast wiring in `server/backend.ts:67-69`, which no unit test reaches.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: sshd container in front of the replica set fixture: password, key, key with passphrase | `ssh.int.spec.ts`: "password: unknown host key → question, trusted → connects to the replica set", "private key without passphrase", "private key with passphrase (sshKeyPassphrase secret)", plus "agent: signs with a key the agent holds", "an encrypted key without its passphrase…", "a wrong passphrase…", "a wrong password…" | `npm run test:int -- ssh` (Docker, testcontainers: lscr.io/linuxserver/openssh-server + 2-member mongo 8 replica set) | Pass |
| AC1: unknown host key → event, accept → connects | `ssh.int.spec.ts`: "backend: host key prompt over the renderer port > unknown host key → ssh.hostKey event, conn.trustHostKey → connects; known_hosts in userData", "a host key in known_hosts is not asked about again", "a rejected unknown host key → SSH_ERROR, nothing saved"; unit: `server/backend.spec.ts` "startBackend: SSH host key prompts" (4 tests), `ssh/prompts.spec.ts` (13 tests) | `npm run test:int -- ssh`; `cd packages/backend && npx vitest run src/ssh src/connections src/server/backend.spec.ts` | Pass |
| AC2: changed host key → refused with a clear error (int test) | `ssh.int.spec.ts` "a changed host key → refused with a clear error, without asking"; unit: `ssh/known-hosts.spec.ts`, `ssh/tunnel.spec.ts` changed-key tests | same two commands | Pass |
| AC3: tunnels closed when the connection closes, no leaked sockets (server connection count) | `ssh.int.spec.ts` "closing the connection closes the tunnel: no SSH session, no member connection left" (sshd and both mongod connection counts back to 0), "a failed driver connect closes its tunnel too", "conn.test through the tunnel … closes the tunnel"; new: "a dropped SSH session → conn.status error broadcast …" (sshd count restored); new unit: "the local port cannot start > closes the SSH session …"; existing unit tests: tunnel-race (CR-6), manager CR-2 test, socks TW-2 channel test | same two commands | Pass |
| Goal: replica set members reached through per-member forwarded channels | `ssh.int.spec.ts` password test (`hello` from the secondary returns `me: ssh-rs-b:27017`, names resolvable only behind sshd) | `npm run test:int -- ssh` | Pass |
| Goal: SRV resolved before tunnelling | none | none | Not testable here: the fixture has no SRV DNS records, so no test resolves an SRV name. The implementation leaves SRV resolution to the driver (tunnel.ts doc comment). See "Unable to test". |
| Review fixes CR-1..CR-7, TW-1..TW-3 (regression) | existing tests named in fixes.md (tunnel.spec, tunnel-race.spec, manager.spec, known-hosts.spec, socks.spec); new CR-3 integration test | `cd packages/backend && npx vitest run src/ssh src/connections src/server/backend.spec.ts`; `npm run test:int -- ssh` | Pass |
| Documented SSH timeout = profile `connectTimeoutMS` | new manager test "the profile's connectTimeoutMS is the SSH handshake timeout…" | `cd packages/backend && npx vitest run src/connections/manager.spec.ts` | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/ssh src/connections src/server/backend.spec.ts` (before adding tests)

Result:

Pass: 10 files, 354 tests

Commands (after adding tests):

`cd packages/backend && npx vitest run src/ssh/tunnel-race.spec.ts`: Pass, 2 tests

`cd packages/backend && npx vitest run src/connections/manager.spec.ts`: Pass, 91 tests. The first attempt of the new test failed because the test had no stored DB password for its two new profile ids. That was a test setup mistake, not a product defect, and it was fixed in the test.

`npm run test:int -- ssh` (repo root, Docker available, 2026-11-17 02:30:44-02:31:26 +01:00)

Result:

Pass: 1 file, 15 tests (14 existing + 1 new). The integration test files did not change after this run.

## Full test execution

Command:

`npm run check` (repo root: lint, type check, backend/main/contract Vitest, renderer `ng test`), run after the last test change

Result:

Pass: exit 0. Root Vitest 58 files / 3282 tests (before the manager test was added); renderer 71 files / 2014 tests. The renderer dependency problem noted in fixes.md no longer occurs. Also ran `npx eslint --max-warnings 0`, `npx prettier --check` on every changed test file and `npx tsc -p tsconfig.json --noEmit` (root and packages/backend): Pass.

## .taskcheck

Result:

Pass: `.taskcheck` runs `npm run check` because package.json exists. That command passed with exit 0 at 2026-11-17 02:36 +01:00, after the last test change.

## Bugs found

None. No new test exposed a production defect. All tests pass against HEAD cecc8b9 with no production changes.

## Coverage

Status: verified (unit-test coverage of task-changed backend and contract files; Electron main and build-script changes not measured, see below)

Metric: whole-file coverage of task-changed production files. These files include code from before this task, and pre-existing tests also count toward the hits.
Changed-line coverage: not measured. The configured tooling produces no changed-line report, and this run did not intersect lcov with the diff.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: ssh-tunnel; base `48a81f64f61270691cffa7b1c64d2ad913e39295`; HEAD `cecc8b95ea2ea3e828091bed36b96a2157c625ce`; commits d254fa5, d37a8eb, 287d3bd, cecc8b9 as supplied by the parent worker; file scope from `git diff --stat` of that range.
- Source/test snapshot identifier (including uncommitted inputs): HEAD cecc8b9 plus uncommitted test-only changes to the 4 test files above. sha256 over `packages/backend/src/ssh/*.ts packages/backend/src/connections/*.ts packages/backend/src/server/backend.ts test/integration/ssh.int.spec.ts test/integration/fixtures/ssh.ts` = `f106a72aa29941904d388e22f0c4713f84b45393d4c56ee860b6232e3ce364e1`, identical before and after the final run. No production file differs from HEAD (`git status`: only the 4 test files are modified).
- Exact included files: backend `src/ssh/{tunnel,socks,known-hosts,prompts,handlers,index}.ts`, `src/connections/{manager,options}.ts`, `src/server/{backend,entry}.ts`, `src/index.ts`; contract `src/conn.ts`, `src/envelope.ts`. Excluded:
  - `packages/renderer/src/app/api/api.service.ts`: type-only change (a type import and an interface member), nothing executable.
  - `apps/desktop/scripts/build.mjs`: build configuration (esbuild externals). The reviewer exercised it by bundling (review.md); `npm run check` does not run it.
  - `apps/desktop/src/main/index.ts`: Electron main bootstrap (the `THICKET_USER_DATA` env for the backend fork). Not measured: unit Vitest does not run it, and `npm run test:electron` was not run. Its effect, known_hosts in userData, is covered on the backend side by the integration tests through `startBackend({ userData })`.
  - `docs/ARCHITECTURE.md`, `package-lock.json`, `packages/backend/package.json`, the `*.spec.ts` files, `reviews/`: not production code.
  - No renames and no deleted files in scope.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8 5.1.0. In `packages/backend`: `npx vitest run --coverage --coverage.reportsDirectory=coverage/ssh-tunnel-run3 --coverage.include='src/ssh/tunnel.ts' --coverage.include='src/ssh/socks.ts' --coverage.include='src/ssh/known-hosts.ts' --coverage.include='src/ssh/prompts.ts' --coverage.include='src/ssh/handlers.ts' --coverage.include='src/ssh/index.ts' --coverage.include='src/index.ts' --coverage.include='src/server/entry.ts' --coverage.include='src/connections/manager.ts' --coverage.include='src/connections/options.ts' --coverage.include='src/server/backend.ts' --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json` (all backend unit tests, 23 files). In `packages/contract`: `npx vitest run --coverage --coverage.reportsDirectory=coverage/ssh-tunnel-run2 --coverage.include='src/conn.ts' --coverage.include='src/envelope.ts' --coverage.reporter=text --coverage.reporter=json-summary`. Integration tests are not part of these numbers.
- Run start/completion time and exit status: backend 2026-11-17T02:36:20+01:00 to 02:36:33, 23 files / 943 tests passed, exit 0. Contract 2026-11-17T02:34:34+01:00, 728 tests passed, exit 0. The contract files did not change after that run.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/ssh-tunnel-run3/coverage-summary.json` sha256 `e0bb04378e30b20734a6504c45bc4753227b96269d5f3dfb305ee5529a5c6b87`, `coverage-final.json` sha256 `904de7efce811439970ad08dd62340d31e7ecf765dac0b67aa489a7e08ec20a7`; `packages/contract/coverage/ssh-tunnel-run2/coverage-summary.json` sha256 `d9ab2a16c287c4d700f9455307124429c9c85e800415118f22810d42696941b5`. All are git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: each run wrote a new, previously nonexistent reports directory. The snapshot hash was the same before and after the backend run.
- Final run after latest test additions and production fixes: yes. The run came after all 3 test additions. The production fixes (cecc8b9) were already committed before this run started.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/ssh/tunnel.ts` | 176/182 (96.70%) | 85/92 (92.39%) | 33/35 (94.28%) | 161/163 (98.77%) |
| `packages/backend/src/ssh/socks.ts` | 139/144 (96.52%) | 38/45 (84.44%) | 23/25 (92.00%) | 129/131 (98.47%) |
| `packages/backend/src/ssh/known-hosts.ts` | 66/67 (98.50%) | 45/46 (97.82%) | 14/14 (100%) | 53/54 (98.14%) |
| `packages/backend/src/ssh/prompts.ts` | 28/29 (96.55%) | 8/9 (88.88%) | 8/8 (100%) | 24/24 (100%) |
| `packages/backend/src/ssh/handlers.ts` | 3/3 (100%) | N/A | 2/2 (100%) | 3/3 (100%) |
| `packages/backend/src/ssh/index.ts` | N/A (re-exports only) | N/A | N/A | N/A |
| `packages/backend/src/connections/manager.ts` | 209/211 (99.05%) | 113/115 (98.26%) | 39/40 (97.50%) | 181/182 (99.45%) |
| `packages/backend/src/connections/options.ts` | 84/84 (100%) | 94/95 (98.94%) | 5/5 (100%) | 76/76 (100%) |
| `packages/backend/src/server/backend.ts` | 40/44 (90.90%) | 11/12 (91.66%) | 13/16 (81.25%) | 37/39 (94.87%) |
| `packages/backend/src/server/entry.ts` | 0/6 (0%) | 0/4 (0%) | 0/1 (0%) | 0/6 (0%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/contract/src/conn.ts` | 8/8 (100%) | N/A | 1/1 (100%) | 8/8 (100%) |
| `packages/contract/src/envelope.ts` | 10/10 (100%) | N/A | N/A | 10/10 (100%) |
| **Aggregate (summed counters, 13 files above)** | 764/789 (96.83%) | 394/418 (94.26%) | 138/147 (93.88%) | 683/697 (97.99%) |

The aggregate leaves out `apps/desktop/src/main/index.ts` (not measured), `apps/desktop/scripts/build.mjs` (build configuration) and `packages/renderer/src/app/api/api.service.ts` (type-only).

Before this run's test additions (run1, same backend file set without index.ts/entry.ts/ssh/index.ts), the tunnel.ts lines were 159/163 and manager.ts branches 112/115. The new tests covered tunnel.ts:312-315 and manager.ts:182-184.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/ssh/tunnel.ts:312-315` (before) | AC3: a failed local SOCKS start must not leak the SSH session | Test added: "the local port cannot start > closes the SSH session …", now covered |
| `packages/backend/src/connections/manager.ts:182-184` (before) | Documented SSH timeout = profile `connectTimeoutMS` | Test added: "the profile's connectTimeoutMS is the SSH handshake timeout…", now covered |
| `packages/backend/src/server/backend.ts:67-69` | CR-3: `conn.status` broadcast to renderers when a tunnel is lost | Covered by the new integration test (real sshd session killed). Unit tests cannot reach a connected state without a MongoDB, so the line stays uncovered in the unit numbers |
| `packages/backend/src/server/backend.ts:41,111` | Code from before this task (`link()` without a privileged port; a log callback) | Outside this task's changes |
| `packages/backend/src/server/entry.ts:7-17` | Process entry: `THICKET_USER_DATA` → `userData` | Bootstrap code that runs only in the Electron utility process. The behaviour it feeds (known_hosts in userData) is covered through `startBackend({ userData })` in integration. Justified gap |
| `packages/backend/src/ssh/tunnel.ts:143` | Connect settled while `knownHosts.check` was running (no question asked) | Narrow race guard with a side effect similar to the CR-5 test path ("server closing while the user is asked"). Not added: forcing it would need a known_hosts read stalled exactly during the handshake. Low risk |
| `packages/backend/src/ssh/tunnel.ts:220` | `ready` after the connect already failed | Defensive. ssh2 does not emit `ready` after `close`/`error`. Not reachable in practice |
| `packages/backend/src/ssh/tunnel.ts:295-297` | `forwardOut` requested after the tunnel started closing | The SOCKS server is closed first, before new CONNECTs reach this callback. A narrow race, and its result is a SOCKS "refused" either way. Justified gap |
| `packages/backend/src/ssh/tunnel.ts:364, 377 (win32 / unset SSH_AUTH_SOCK fallback), 428` | Error without `code`; Windows `pageant` default; non-Error throwables | The platform branch cannot run on Linux CI. The other two are formatting fallbacks. The `SSH_AUTH_SOCK` path itself is covered |
| `packages/backend/src/ssh/socks.ts:51,53,65-67,105,149,155,165,167,184` | Socket error swallow; non-Error log; `server.address()` null (unreachable for a TCP listen); read after an earlier failure; 30 s handshake timeout; `?? 0` fallbacks after fixed-length reads | Defensive or unreachable code. The handshake timeout (line 149) protects a localhost-only port with random credentials, and testing it would need a real 30 s wait or fake timers on real sockets. Justified gap, low risk |
| `packages/backend/src/ssh/known-hosts.ts:88` | Non-ENOENT read error while checking the trailing newline before `trust()` | `check()` reads the same file first and fails closed on read errors (tested), so `trust()` is not reached with an unreadable file in normal use. Low risk |
| `packages/backend/src/ssh/prompts.ts:30` | `finish` called a second time for the same prompt | Idempotency guard. The "only the first answer counts" tests cover the observable behaviour |
| `packages/backend/src/connections/manager.ts:77, 265` | Default `new MongoClient` factory (tests inject one; integration uses the real one); entry replaced while the tunnel opened | The factory is exercised by the integration suite. Line 265 is reachable only if a tunnel resolves after its abort signal fired, and openSshTunnel rejects with CANCELLED in that case (tested: "close() while the tunnel opens aborts it and answers CANCELLED") |
| `packages/backend/src/connections/options.ts:178` | `?? String(error)` fallback for a PEM read error without a code | Code from before this task |

## Unable to test

- SRV resolved before tunnelling (task goal): the integration fixture has no DNS server with SRV records, and adding one would mean new test infrastructure. The implementation leaves `mongodb+srv://` resolution to the driver, which resolves it on the client side before it opens SOCKS sockets (tunnel.ts doc comment, docs/ARCHITECTURE.md). Not verified by a test. Follow-up only if the parent wants SRV evidence: a fixture with a DNS container, or a unit test of the driver options. This is a task goal, not one of the 3 acceptance criteria.
- `apps/desktop/src/main/index.ts` (`THICKET_USER_DATA` passed to the backend fork): `npm run test:electron` was not run, so the Electron main process path was not executed in this run. The backend side of the behaviour is covered.
- Host key prompt UI: the renderer dialog is out of scope for this task (task assumption: left to conn-ui-m2).

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found. All 3 acceptance criteria are covered by integration tests that were executed against Docker (`npm run test:int -- ssh`, 15/15). The new tests cover the CR-3 lost-session path end to end, the no-leak behaviour when the local SOCKS port fails to start, and the `connectTimeoutMS` → SSH timeout wiring. `npm run check` (`.taskcheck`) passes. The remaining gaps are defensive or bootstrap code, and each one is justified above. SRV-before-tunnel and the Electron main env wiring were not executed in this run.
