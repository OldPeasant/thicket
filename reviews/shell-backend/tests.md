# Test Report

Date: 2026-11-17

Task: shell-backend — M4: mongosh host in the backend (final report, round 6, revision 6628377)

Scope (round 6): `git diff origin/main...HEAD`, merge-base
`b739b48d188a45b25e68023ffc6cc61f3479e17e` (= origin/main) to HEAD
`662837788fd88af6de9c0c267891dbd3f88857dd`. Round 5 (revision 515cdb8) and rounds 1-4 (revision
8712197) are kept below; round 6 supersedes them where they differ.

# Round 6 (CR-2 / CR-3 fixes, commit 5914df0, and the main merge 6628377)

## Round 6 scope

- Task `shell-backend`; ownership from the parent (task diff `git diff origin/main...HEAD`, base
  `b739b48d`, HEAD `66283778`) and the task file's `touches: packages/backend/src/shell`.
- Focus: commit `5914df0` (fixes for review round 5, CR-2 and CR-3):
  - `shell/host.ts`: `cloneableOptions` (an `AWS_CREDENTIAL_PROVIDER` is called on the host and its
    credentials are posted as data in `awsCredentials`), `postMessage` moved inside the `try` so any
    failure terminates the worker, every open failure goes through `toConnectError`, and `secretsOf`
    masks the AWS secret access key and session token.
  - `shell/protocol.ts`: `awsCredentials` on the `open` message; `withAwsCredentials` (worker side)
    rebuilds a static provider.
  - `shell/worker.ts`: opens with `withAwsCredentials(options, awsCredentials)`.
  - `server/backend.ts`: `ShellHost` built before the `ConnectionManager`; `onStatus` with
    `error`/`disconnected` calls `shells.closeProfile(profileId)`, a failure is logged.
- Merge `6628377`: per the parent, the only conflict was `manager.spec.ts` (both sides' blocks kept);
  the full backend suite (including `manager.spec.ts`) passes on it.
- Not my change: `reviews/shell-backend/review.md` was already modified in the working tree
  (code-reviewer, running in parallel); this round did not touch it.

## Round 6 test files changed (uncommitted)

- `packages/backend/src/shell/host.spec.ts` (sha256 `e268320cc1aabbb3fd35070b4b073083e5316794655de7488546a208b37c3837`)
- `packages/backend/src/server/backend.spec.ts` (sha256 `12e72804665f77230f205fc876429588899c7f2eaf4b11d7fda24f332034fa79`)
- `test/integration/shell.int.spec.ts` (sha256 `98e241d21540e798b1290b8a53a4f0a82400cae9bc86c76a2a69bcf526e48faf`)

## Round 6 tests added

Count: 9 (7 in `host.spec.ts`: 5 open/restart cases and 2 `withAwsCredentials` cases; 1 in
`backend.spec.ts`; 1 integration test).

`host.spec.ts`, `ShellHost.open: driver options cross postMessage (MONGODB-AWS)`:
- `a replacement worker (after a crash) gets freshly resolved AWS credentials, clone-safe`: the
  restart path (`restart` → `startWorker` with `session.config`) calls the provider again, posts
  clone-safe options on the remembered db with the new key id, and the session's config keeps its
  provider function.
- `a restart whose credential provider fails fails the evaluation (secrets masked); the next one
  retries`: the eval rejects with the provider's message, the configured password masked as `****`
  in the error and the logs; the worker made for the failed restart got nothing posted and was
  terminated; the session stays open and the next eval restarts with good credentials.
- `an open cancelled while the credential provider is pending answers CANCELLED and posts nothing`:
  abort during `cloneableOptions` → `CANCELLED`, worker terminated, a late provider answer posts
  nothing, no session.
- `a worker that exits while the credential provider is pending answers INTERNAL`: the early
  rejection of `opened` is not unhandled (the `opened.catch` guard), the open answers INTERNAL with
  the exit code once the provider is done, the worker is terminated.
- `posts only accessKeyId, secretAccessKey, sessionToken and expiration (absent fields left out)`:
  a provider result with an `expiration` Date and an extra function field is reduced to the four
  known fields (no `sessionToken` key when absent), and it clones with the Date intact.

`host.spec.ts`, `withAwsCredentials (worker side)`:
- `adds the provider next to other mechanism properties without changing the input`.
- `builds authMechanismProperties when the options have none`.

`backend.spec.ts`, `startBackend: connections`:
- `a failing shell close on connection loss is logged; the status is still broadcast`: with
  `closeProfile` rejecting, `onStatus` does not throw, the log gets
  `shell: closing the sessions of ssh failed: Error: worker would not stop`, and the renderer still
  receives the `conn.status` broadcast (covers the `.catch` branch of the CR-3 fix).

`test/integration/shell.int.spec.ts`, `shell.open with MONGODB-AWS explicit keys (CR-2)`:
- `posts the options to a real worker (no DataCloneError) and fails as an auth error, masked`: a
  real `ShellHost` with the real `worker.ts` thread and options from `awsAuthOptions` (fictitious
  keys) against the 8.x fixture. The open fails with `AUTH_FAILED` "Received authentication for
  mechanism MONGODB-AWS which is not enabled", i.e. the options crossed the real `postMessage` and
  the worker's driver signed with the rebuilt provider and reached the server. Secret and token are
  not in the message; no session remains. Before 5914df0 this open threw a raw `DataCloneError`
  (not an `RpcError`), so the test fails on the pre-fix code.

Already present from 5914df0 (pass): the 6 `MONGODB-AWS` open tests in `host.spec.ts` and
`a conn.status broadcast to error or disconnected closes that profile’s shell sessions` in
`backend.spec.ts`.

## Round 6 requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `use test; db.c.insertOne({a:1}); db.c.find()` returns the document as EJSON | int `shell.eval > use test; db.c.insertOne({a:1}); db.c.find() returns the document as EJSON` | `npx vitest run --config test/integration/vitest.config.ts test/integration/shell.int.spec.ts` (repo root, 8.x MongoDB container via Podman; first run with `--reporter=verbose`) | Pass |
| AC2: interrupt stops `while(true){}` within 2 s | int `interrupt > stops while(true){} within 2 s and the session goes on` (1807 ms); host grace-timer unit tests | same int command; `npx vitest run` in `packages/backend` | Pass |
| AC3: `complete('db.c.fi')` suggests `find`, `findOne` | int `shell.complete > complete('db.c.fi') suggests find and findOne` | same int command | Pass |
| CR-2: MONGODB-AWS options cross `postMessage` (host resolves the provider, worker rebuilds it) | 3 existing + 3 new host tests, 2 `withAwsCredentials` tests; int `posts the options to a real worker (no DataCloneError) ...` | `npx vitest run src/shell/host.spec.ts` (in `packages/backend`); int command | Pass |
| CR-2: a failing `postMessage` / provider terminates the worker and rejects | existing `a postMessage that throws on open ...`, `a failing credential provider ...`; new restart-provider-failure, cancel-during-provider, exit-during-provider tests | same | Pass |
| CR-2: AWS secret and session token masked in errors and logs | existing `masks the AWS secret access key and session token ...`; new restart test (password masked in provider error); int test | same | Pass |
| CR-3: `error`/`disconnected` status closes the profile's shells; failure logged | existing `a conn.status broadcast to error or disconnected ...`; new `a failing shell close on connection loss is logged ...` | `npx vitest run src/server/backend.spec.ts` (in `packages/backend`) | Pass |
| CR-3 end to end (a real SSH tunnel loss closing shells) | none | Not run: the unit test drives `deps.onStatus` directly (manager.spec covers `tunnelLost` → `onStatus`); no int test kills an SSH tunnel under an open shell | Not run: covered in two halves by unit tests |

## Round 6 focused test execution

Command: `npx vitest run src/shell/host.spec.ts` (in `packages/backend`)

Result: Pass, 60 tests.

Command: `npx vitest run src/server/backend.spec.ts` (in `packages/backend`)

Result: Pass, 48 tests.

Command: `npx vitest run --config test/integration/vitest.config.ts test/integration/shell.int.spec.ts --reporter=verbose`
(repo root, MongoDB 8.x container via Podman), final run 2026-11-17 04:13:08-04:13:22 +01:00

Result: Pass, 1 file, 18 tests (17 earlier + 1 new).

## Round 6 full test execution

Command: `npx vitest run` (in `packages/backend`)

Result: Pass, 33 files, 1444 tests.

Command: `npm run check` (= `.taskcheck`: ESLint, Prettier, type checks of all workspaces, root
vitest, renderer `ng test`), repo root, 2026-11-17 ~04:14-04:15 +01:00

Result: Pass. Root vitest 68 files / 3787 tests; renderer 80 files / 2429 tests. Lint, Prettier and
type checks passed (the script is `&&`-chained; tests run last).

## Round 6 .taskcheck

Result: Pass (`npm run check`, run directly above on the round-6 snapshot).

## Round 6 bugs found

None. No production defect was found in the CR-2/CR-3 fixes.

## Round 6 coverage

Status: verified. Fresh run, all backend tests selected, all passed.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line report). By
inspection of `lcov.info`, every line and branch of the 5914df0 changes in `host.ts` (383-431,
448-459), `protocol.ts` (`withAwsCredentials`) and the new `onStatus` block of `backend.ts` is hit;
`worker.ts` is not instrumented (worker thread), its change is exercised by the integration test.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: task
  `shell-backend`; base `b739b48d188a45b25e68023ffc6cc61f3479e17e` (`git merge-base HEAD
  origin/main`, = origin/main); HEAD `662837788fd88af6de9c0c267891dbd3f88857dd`; file scope from
  `git diff --name-only b739b48 HEAD -- '*.ts'` (parent-supplied task diff).
- Source/test snapshot identifier: HEAD 6628377 plus the three uncommitted spec files above (hashes
  listed). Production hashes: `shell/host.ts` `0bf12174…`, `shell/protocol.ts` `ea027397…`,
  `shell/worker.ts` `1f545221…`, `server/backend.ts` `473dae39…`, `shell/split.ts` `791da1bf…`.
  Taken before the coverage run and rechecked after it: unchanged.
- Exact included files: `packages/backend/src/shell/{handlers,host,index,output,protocol,runtime,split,worker}.ts`,
  `packages/backend/src/connections/manager.ts`, `packages/backend/src/index.ts`,
  `packages/backend/src/server/backend.ts`, `packages/backend/src/server/entry.ts`.
  Excluded: `apps/desktop/scripts/build.mjs` (build script), `package-lock.json`,
  `packages/backend/package.json` (configuration), spec files. No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` (v8),
  vitest 5.1.0; working directory `packages/backend`; `npx vitest run --coverage --coverage.include='src/shell/handlers.ts' --coverage.include='src/shell/host.ts' --coverage.include='src/shell/index.ts' --coverage.include='src/shell/output.ts' --coverage.include='src/shell/protocol.ts' --coverage.include='src/shell/runtime.ts' --coverage.include='src/shell/split.ts' --coverage.include='src/shell/worker.ts' --coverage.include='src/server/backend.ts' --coverage.include='src/server/entry.ts' --coverage.include='src/connections/manager.ts' --coverage.include='src/index.ts'`;
  all tests (33 files, 1444 passed).
- Run start/completion time and exit status: started 2026-11-17 04:13:49 +01:00, duration 13.16 s;
  reports written 04:14:03; all test files passed and the summary was printed (the shell wrapper
  piped the output through `tail`, so the raw exit status was not captured separately).
- Generated report paths and hashes (git-ignored): `packages/backend/coverage/coverage-summary.json`
  sha256 `e9ff6410fbbc0c3dc3440869ee26fc8efd2d9cbd322f2696875a9909fb8b3f8c`;
  `packages/backend/coverage/lcov.info`; `packages/backend/coverage/lcov-report/`.
- Freshness: every entry in `coverage/` has the 04:14:03 mtime of this run; the summary differs from
  round 5 (`host.ts` 219 statements instead of 202, `protocol.ts` now has executable code).
- Final run after latest test additions and production fixes: yes (no production change after
  5914df0; the run includes all round-6 tests).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/shell/host.ts` | 209/219 (95.43%) | 90/102 (88.23%) | 48/54 (88.88%) | 183/184 (99.45%) |
| `packages/backend/src/shell/protocol.ts` | 4/4 (100%) | 2/2 (100%) | 2/2 (100%) | 3/3 (100%) |
| `packages/backend/src/shell/split.ts` | 134/134 (100%) | 114/114 (100%) | 12/12 (100%) | 114/114 (100%) |
| `packages/backend/src/shell/output.ts` | 32/32 (100%) | 47/48 (97.91%) | 8/8 (100%) | 30/30 (100%) |
| `packages/backend/src/shell/handlers.ts` | 13/13 (100%) | 4/4 (100%) | 7/7 (100%) | 11/11 (100%) |
| `packages/backend/src/shell/runtime.ts` | 0/67 (0%) | 0/12 (0%) | 0/17 (0%) | 0/59 (0%) |
| `packages/backend/src/shell/worker.ts` | 0/42 (0%) | 0/17 (0%) | 0/7 (0%) | 0/35 (0%) |
| `packages/backend/src/shell/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/connections/manager.ts` | 249/252 (98.80%) | 124/127 (97.63%) | 47/48 (97.91%) | 217/218 (99.54%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| `packages/backend/src/server/backend.ts` | 53/56 (94.64%) | 16/18 (88.88%) | 16/19 (84.21%) | 50/51 (98.03%) |
| `packages/backend/src/server/entry.ts` | 0/6 (0%) | 0/4 (0%) | 0/1 (0%) | 0/6 (0%) |
| **Aggregate (summed counters, all 12 files above)** | 695/826 (84.14%) | 397/448 (88.61%) | 140/175 (80.00%) | 609/712 (85.53%) |

`packages/backend/src/shell` alone (8 files, summed): statements 392/511 (76.71%), branches
257/299 (85.95%), functions 77/107 (71.96%), lines 341/436 (78.21%); `runtime.ts` and `worker.ts`
(0%, worker threads) are included. Excluded beside the aggregate: `apps/desktop/scripts/build.mjs`.
`manager.ts` and `backend.ts` are whole-file numbers and include code merged from main.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `shell/host.ts:365#0, 366` (`startWorker` without `workerUrl`) | Defensive: `open` already checks `workerUrl` first, and restarts only happen for opened sessions | Unreachable; non-material. |
| `shell/host.ts` (90#1, 93#1, 157#0, 175#1, 193#1, 226#1, 276#0, 283#1, 335#1, 346#0, 444#1; 6 anonymous functions) | Same locations as round 5 (lines shifted by the 5914df0 changes): default `new Worker`, default log, race guards | Same justifications as the round-4/5 gap tables. None are in the 5914df0 code. |
| `server/backend.ts:68` (shell `log` prefix callback) | Shell log lines get the `shell: ` prefix | ShellHost logs only from real-worker paths (integration); non-material. |
| `server/backend.ts:49#1, 102#1` | Default `log`; `if (connClose)` false | Default callback / defensive; non-material. |
| `connections/manager.ts:93#1, 286#0, 441#0, 442` | Default `MongoClient` factory; merged main branch; `configOf` without a stored config | Real driver only / not task-owned / defensive (as in round 5). |
| `shell/runtime.ts` (all), `shell/worker.ts` (all, incl. the `withAwsCredentials` call) | mongosh evaluation, interrupt, completion, AWS open in the worker | Run inside `worker_threads`, not instrumented by v8; the 18 integration tests exercise them and pass (the new int test covers the worker's AWS open). |
| `server/entry.ts` (all) | Process entry wiring | Bootstrap; not unit-tested in this project. |
| `shell/output.ts:80#1` | Unchanged | Defensive (see earlier rounds). |

## Round 6 unable to test

- A real MONGODB-AWS login succeeding through the shell: no AWS-enabled MongoDB fixture exists
  (Atlas AWS IAM is a human task per AGENTS.md). The integration test proves the credentials reach
  the server from the worker, not a successful AWS login.
- CR-3 end to end (an SSH tunnel dropping under an open shell): verified in two halves by unit
  tests (manager `tunnelLost` → `onStatus`; `onStatus` → `closeProfile`); no integration test kills
  a tunnel with an open shell. Follow-up optional.
- `build.mjs` / the bundled `shell-worker.cjs` in the Electron `utilityProcess`: unchanged from
  round 5 (recorded assumption).

## Round 6 summary

Tests added and all validation passed. The CR-2 fix holds on the restart path, under cancellation
and early worker exit, and against a real worker thread (no `DataCloneError`; the AWS mechanism
reaches the server; secrets masked). The CR-3 wiring logs a failing shell close without breaking the
status broadcast. Backend unit suite 1444 passed, shell integration 18/18 (Podman), `npm run check`
pass, fresh task-scoped coverage for 6628377. No production defects found.

# Round 5 (final code after the main merges 369c532 and 515cdb8)

## Round 5 scope

- Task `shell-backend`; task ownership from the parent (task diff `git diff origin/main...HEAD`)
  and the task file's `touches: packages/backend/src/shell`.
- Since round 4, main was merged twice (369c532, 515cdb8). The shell code itself
  (`packages/backend/src/shell/*.ts`) is byte-identical to round 4 (same sha256 for `split.ts`
  `791da1bf…`, `split.spec.ts` `cd56ce59…`; integration spec `02615a2e…`).
- Focus: the merge-resolution lines.
  - `packages/backend/src/server/backend.ts`: `shellHandlers(connections, shells)` spread next to
    `connHandlers`/`sshHandlers`/`indexHandlers`/browse/docs/agg/io inside `guardWrites`; the
    `conn.close` wrapper calls `shells.closeProfile(profileId)` after the connection closed.
  - `packages/backend/src/index.ts`: `export * from './shell'` next to `./ssh`, `./indexes`.
  - `packages/backend/src/connections/manager.ts`: `configs` WeakMap wrapping `createClient`,
    `configOf()`.
  - `packages/backend/src/server/entry.ts`: `shellWorker: join(__dirname, 'shell-worker.cjs')`.
  - `apps/desktop/scripts/build.mjs` (externals + `shell-worker.cjs` entry) and
    `packages/backend/package.json` (four `@mongosh/*` deps): inspected, correct; not unit-testable
    in the backend workspace (build script / configuration).
- Result of the inspection: the resolutions keep the shell wiring intact. Shell handlers are
  registered alongside every other group, the `conn.close` wrapper is the one served (no later
  spread overwrites it), and the package entry re-exports shell next to ssh and indexes.

## Round 5 test files changed (uncommitted)

- `packages/backend/src/server/backend.spec.ts` (sha256
  `7cff54c753045d09e3972c091380cd3e563a2eb155487cc2b851c51cf12b178a`)
- `packages/backend/src/index.spec.ts` (sha256
  `2a0d5882ac4aa256223e251c5c4d890d7c50678418fb64b0817d6c2dbfee4a90`)

## Round 5 tests added

Count: 3.
- `backend.spec.ts` > `startBackend: connections` > `serves shell.* next to the conn, ssh, idx,
  docs, agg and io handlers (merged wiring)`: one handler table holds `conn.close`,
  `conn.trustHostKey`, `idx.*`, `docs.find`, `agg.run`, `io.import` and all four `shell.*`
  methods as functions. Guards against a merge dropping one group's spread.
- `backend.spec.ts` > `conn.close of a profile without shell sessions still answers {}
  (closeProfile is a no-op)`: the real `ShellHost.closeProfile` (spied, not mocked) is called with
  the profile id and the answer stays `{}`.
- `index.spec.ts` > `exports the shell, ssh, indexes and server APIs side by side from the package
  entry`: `ShellHost`, `shellHandlers`, `splitShellInput`, `isExitCommand`, `toEjson`,
  `RESTARTED_TEXT`, `sshHandlers`, `KnownHosts`, `indexHandlers`, `startBackend`,
  `ConnectionManager` are exported from `src/index.ts`.
- Already present (round 1-2, still passing): `serves shell.*; shell.open needs an open
  connection ...`, `conn.close also closes the shell sessions of that profile, after the
  connection`, `conn.close answers only once the shell sessions are closed`, `shell.open answers
  UNSUPPORTED without a shell worker once connected`, and the `configOf` tests in
  `manager.spec.ts`.

## Round 5 requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `use test; db.c.insertOne({a:1}); db.c.find()` returns the document as EJSON | int `shell.eval > use test; db.c.insertOne({a:1}); db.c.find() returns the document as EJSON` | `npx vitest run --config test/integration/vitest.config.ts test/integration/shell.int.spec.ts --reporter=verbose` (repo root, MongoDB container via Podman, HEAD 515cdb8) | Pass (79 ms) |
| AC2: interrupt stops `while(true){}` within 2 s | int `interrupt > stops while(true){} within 2 s and the session goes on`; host grace-timer unit tests | same int command; `npx vitest run` in `packages/backend` | Pass (1761 ms) |
| AC3: `complete('db.c.fi')` suggests `find`, `findOne` | int `shell.complete > complete('db.c.fi') suggests find and findOne`; handlers/host unit tests | same | Pass |
| Merge resolution: shell handlers registered alongside the other groups | `serves shell.* next to the conn, ssh, idx, docs, agg and io handlers (merged wiring)` (new), `serves shell.*; shell.open needs an open connection ...` | `npx vitest run src/index.spec.ts src/server/backend.spec.ts` (in `packages/backend`) | Pass |
| Merge resolution: `conn.close` still closes the profile's shell sessions | `conn.close also closes the shell sessions ...`, `conn.close answers only once ...`, `conn.close of a profile without shell sessions still answers {}` (new); int `shell.close > closeProfile (conn.close) ends every session of the profile` | same unit command; int command | Pass |
| Merge resolution: package exports intact | `exports the shell, ssh, indexes and server APIs side by side from the package entry` (new); `npm run typecheck` (no TS2308 ambiguous re-export) | same unit command; `npm run check` | Pass |
| Merge resolution: `configOf` after the manager merge | `manager.spec.ts` `configOf` cases; `shell.open answers UNSUPPORTED without a shell worker once connected` | `npx vitest run` in `packages/backend` | Pass |
| Bundling (`build.mjs` externals, `shell-worker.cjs` entry) | none (build script) | Not run: no unit test surface; the desktop build was not part of this round | Not run: outside the backend unit/int suites |

## Round 5 focused test execution

Command: `npx vitest run src/index.spec.ts src/server/backend.spec.ts` (in `packages/backend`)

Result: Pass, 2 files, 48 tests.

Command: `npx vitest run --config test/integration/vitest.config.ts test/integration/shell.int.spec.ts --reporter=verbose`
(repo root, MongoDB container via Podman), 2026-11-17 04:00:56-04:01:10 +01:00

Result: Pass, 1 file, 17 tests.

## Round 5 full test execution

Command: `npx vitest run` (in `packages/backend`)

Result: Pass, 33 files, 1414 tests.

Command: `npm run check` (= `.taskcheck`: `eslint . --max-warnings 0 && prettier --check .`,
type checks of all workspaces incl. renderer `ngc`, root vitest, renderer `ng test`)

Result: Pass. Root vitest 68 files / 3757 tests passed; renderer 80 files / 2418 tests passed.
Lint, Prettier and type checks passed (the script is `&&`-chained, tests ran last).

## Round 5 .taskcheck

Result: Pass (`.taskcheck` runs `npm run check`, run directly above on the round-5 snapshot).

## Round 5 bugs found

None. No production defects were found in the merge-resolution lines. The round-4 observation
(lone CR / U+2028 ending a line comment) is unchanged and is not a finding.

## Round 5 coverage

Status: verified. Fresh run, exit status 0, all backend tests selected.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line report).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: task
  `shell-backend`; merge-base `1ec66b38860e9925cd05c63d8ca088ca93ace3d6`; HEAD
  `515cdb8ab181c7697c121441ae903f883f68f2c5`; file scope from `git diff --stat origin/main...HEAD`
  (parent-supplied task diff).
- Source/test snapshot identifier: HEAD 515cdb8 plus the two uncommitted spec files above
  (hashes listed). Production hashes: `server/backend.ts` `623e56a9…`, `shell/host.ts`
  `66cd6cb8…`, `shell/split.ts` `791da1bf…`, `index.ts` `6d1994c7…`. Taken before the first run
  and rechecked after the last run: unchanged.
- Exact included files: `packages/backend/src/shell/{handlers,host,index,output,protocol,runtime,split,worker}.ts`,
  `packages/backend/src/connections/manager.ts`, `packages/backend/src/index.ts`,
  `packages/backend/src/server/backend.ts`, `packages/backend/src/server/entry.ts`.
  Excluded: `apps/desktop/scripts/build.mjs` (build script, no coverage in the backend workspace),
  `package-lock.json` and `packages/backend/package.json` (configuration), spec files. No renames
  or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8`, vitest
  5.1.0; working directory `packages/backend`; `npx vitest run --coverage --coverage.include='src/shell/handlers.ts' --coverage.include='src/shell/host.ts' --coverage.include='src/shell/index.ts' --coverage.include='src/shell/output.ts' --coverage.include='src/shell/protocol.ts' --coverage.include='src/shell/runtime.ts' --coverage.include='src/shell/split.ts' --coverage.include='src/shell/worker.ts' --coverage.include='src/server/backend.ts' --coverage.include='src/server/entry.ts' --coverage.include='src/connections/manager.ts' --coverage.include='src/index.ts'`;
  all tests (33 files, 1414 tests passed).
- Run start/completion time and exit status: started 2026-11-17 04:00:25 +01:00, duration
  12.65 s, exit status 0; reports written 04:00:38.
- Generated report paths and hashes (git-ignored): `packages/backend/coverage/coverage-summary.json`
  sha256 `87e3da554560f98a122570654ba96f81c7dbe7599aa5ce52df6b53a6169d139a`;
  `packages/backend/coverage/lcov.info`; `packages/backend/coverage/lcov-report/`.
- Freshness: vitest cleans the reports directory before a run; every file in `coverage/` has the
  04:00:38 mtime of this run; the summary differs from round 4 (`backend.ts` and `manager.ts`
  grew with the merged main code).
- Final run after latest test additions and production fixes: yes (no production change since;
  run includes the three round-5 tests).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/shell/host.ts` | 192/202 (95.04%) | 80/92 (86.95%) | 46/52 (88.46%) | 168/169 (99.40%) |
| `packages/backend/src/shell/split.ts` | 134/134 (100%) | 114/114 (100%) | 12/12 (100%) | 114/114 (100%) |
| `packages/backend/src/shell/output.ts` | 32/32 (100%) | 47/48 (97.91%) | 8/8 (100%) | 30/30 (100%) |
| `packages/backend/src/shell/handlers.ts` | 13/13 (100%) | 4/4 (100%) | 7/7 (100%) | 11/11 (100%) |
| `packages/backend/src/shell/runtime.ts` | 0/67 (0%) | 0/12 (0%) | 0/17 (0%) | 0/59 (0%) |
| `packages/backend/src/shell/worker.ts` | 0/42 (0%) | 0/17 (0%) | 0/7 (0%) | 0/35 (0%) |
| `packages/backend/src/shell/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/shell/protocol.ts` | N/A (0/0, types only) | N/A | N/A | N/A |
| `packages/backend/src/connections/manager.ts` | 220/223 (98.65%) | 114/117 (97.43%) | 42/43 (97.67%) | 192/193 (99.48%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| `packages/backend/src/server/backend.ts` | 48/53 (90.56%) | 12/14 (85.71%) | 14/18 (77.77%) | 45/48 (93.75%) |
| `packages/backend/src/server/entry.ts` | 0/6 (0%) | 0/4 (0%) | 0/1 (0%) | 0/6 (0%) |
| **Aggregate (summed counters, all 12 files above)** | 640/773 (82.79%) | 371/422 (87.91%) | 129/165 (78.18%) | 561/666 (84.23%) |

`packages/backend/src/shell` alone (8 files, summed): statements 371/490 (75.71%), branches
245/287 (85.37%), functions 73/103 (70.87%), lines 323/418 (77.27%); `runtime.ts` and
`worker.ts` (0%, worker threads) are included in these sums. Excluded beside the aggregate:
`apps/desktop/scripts/build.mjs`. `manager.ts` and `backend.ts` are whole-file numbers and include
code merged from main (SSH, status broadcast), so they are not comparable to round 4.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `server/backend.ts:91` (shell `log` prefix callback) | Shell log lines get the `shell: ` prefix | ShellHost only logs from real-worker paths (integration); non-material. |
| `server/backend.ts:95#1` (`if (connClose)` false) | `connHandlers` always defines `conn.close` | Defensive; unreachable. Wrapper itself covered by 3 unit tests and 1 int test. |
| `server/backend.ts:49#1, 76-77` | Default `log`; `conn.status` broadcast from merged main code | Not task-owned (status broadcast) / default callback. Non-material. |
| `connections/manager.ts:378#0, 379` (`configOf` without a stored config) | Client registered without going through the wrapped `createClient` | Impossible with the current constructor (every client goes through the wrapper). Defensive. |
| `connections/manager.ts:79#1, 272#0` | Default `MongoClient` factory; branch from merged main code | Real driver only / not task-owned. Non-material. |
| `shell/runtime.ts` (all), `shell/worker.ts` (all) | mongosh evaluation, exit/quit refusal, interrupt, completion | Run inside `worker_threads`, not instrumented by v8 coverage; the 17 integration tests exercise them and pass. |
| `server/entry.ts` (all) | Process entry wiring (`shellWorker` path) | Bootstrap; not unit-tested in this project. Non-material. |
| `shell/host.ts` (89#1, 92#1, 156#0, 174#1, 192#1, 225#1, 275#0, 282#1, 334#1, 345#0, 364#0, 365, 403#1) | Unchanged since round 4 | Same justifications as the round-4 gap table below. |
| `shell/output.ts:80#1` | Unchanged since round 4 | Defensive (see below). |

## Round 5 unable to test

- `apps/desktop/scripts/build.mjs` changes (externals, `shell-worker.cjs` entry): build script, no
  test surface in this round; the bundled worker inside the Electron `utilityProcess` remains
  unverified (recorded assumption).
- Coverage of `runtime.ts`/`worker.ts` (worker threads) as in round 4.

## Round 5 summary

Tests added and all validation passed. The merge resolutions keep shell handlers registered
alongside the other groups, `conn.close` still closes the profile's shell sessions, and the package
exports are intact. Three guard tests were added; backend unit suite 1414 passed, shell
integration 17/17 (Podman), `npm run check` pass. Task-scoped coverage is fresh for 515cdb8. No
production defects found.

# Earlier rounds (1-4, revision 8712197, kept for history)

Round-4 scope: task base `735b36d36aa2edab5c72fc2c7dda7f749f430509` (`git merge-base HEAD origin/main`,
given by the parent and rechecked) to HEAD `871219790eb459a5a9ea6fcb7212cb6df3fbc3bb`.
- Task commits (`git log 735b36d..HEAD`):
  - 2f0b3d7 (impl);
  - 6339ca9 (tests and round-1 reports);
  - 2708094 (round-2 fixes);
  - 92c9fb1 (round-2 tests and reports);
  - 02d12f9 (CR-5 fix);
  - c95f534 (round-3 tests and reports);
  - 8712197 (TW-2 fix).
- Round 4 checked the one production change since round 3: 8712197 in
  `packages/backend/src/shell/split.ts`, the `COMMAND` regex. A block comment body can no longer
  contain `*/`, and a line comment is `\/\/.*(?!.)`.
- The scope also includes the uncommitted test edit listed below. The test-writer changed no
  production code.

Requirements:
- `tasks/shell-backend.md` acceptance criteria and the recorded assumptions (exit/quit handling,
  splitting at shell commands, restart notice, cancel = interrupt)
- `reviews/shell-backend/fixes.md` (round 4: TW-2; earlier rounds: CR-5, TW-1, CR-2, CR-3,
  CR-4/O-2, O-1, O-3, O-4)
- `docs/ARCHITECTURE.md` "Coverage"
- Parent instructions for round 4

## Test files changed

Round 4 (uncommitted):
- `packages/backend/src/shell/split.spec.ts`

Round 3 (committed in c95f534): `split.spec.ts` and `test/integration/shell.int.spec.ts`.

Earlier rounds (committed in 6339ca9 and 92c9fb1):
- `packages/backend/src/shell/host.spec.ts`, `split.spec.ts`, `handlers.spec.ts`, `output.spec.ts`
- `test/integration/shell.int.spec.ts`
- `connections/manager.spec.ts`, `server/backend.spec.ts`

## Tests added or updated

Count (round 4): 25 unit cases added in `split.spec.ts`. One comment was updated in the existing
TW-2 table: its text described the failure and now says that the bug was fixed in 8712197. The
inputs and assertions of that table are unchanged.

Round 4, `split.spec.ts`:
- "a block comment ends at its first */, a line comment at the line end" (13 cases):
  - The block comment ends at its first `*/`:
    - `use a /* x */ b */` now stays one JavaScript piece, as do `use a /* x */ /* y */ */` and
      `use a /* x */ */\nq`. With the old regex, `use a /* x */ b */` was the command `use a`.
  - Stars in block comments:
    - `show dbs /***/;x`, `use a /* **/\nq` and `use a /* * / */\nq`;
    - a mix of comment kinds before CRLF: `use a /* x */ /** y **/ // z\r\nq`.
  - A CR ends a line comment:
    - `use a // c\r` gives `use a`;
    - `use a // c\r// d\nq` gives `use a`, `\nq`;
    - `use a // c\rx` is not a command.
  - U+2028 and U+2029 end a line comment the same way:
    - at the end of the input they count as trailing whitespace;
    - followed by code, the line is not a command. This is the same as before the fix.
- "TW-2 fix: a failing command match stays linear" (11 cases), with a bound of 1000 ms each:
  - Line-comment part:
    - 18 ` //` then U+2028 or CR and code;
    - one line comment of 40000 spaces then U+2028 or CR and code.
  - Block-comment part:
    - 5000 spaced comments, 3000 starred comments and 5000 comments with an inner `/*`, each
      followed by code;
    - 10000 unterminated openers;
    - an unterminated comment of 40000 stars;
    - 20000 stray `*/`;
    - 5000 block comments, a long line comment, U+2028 and code.
- "a command line with many trailing comments still splits (linear success path)" (1 test):
  5000 block comments and 1000 line comments, then a line break, still give `use a`, `\nq`.

Round-4 inputs are bounded on purpose:
- A temporary probe spec (`zz-probe-tmp.spec.ts`) timed the old regex and was deleted before
  the final runs. Its results:

  | Input (old regex, before the fix) | Time |
  |---|---:|
  | 12 ` //`, then U+2028 and code | 5 ms |
  | 16 ` //`, then U+2028 and code | 450 ms |
  | 18 ` //`, then U+2028 and code | 4.8 s |
  | Line comment of 10000 spaces, then U+2028 and code | 231 ms |
  | Line comment of 20000 spaces, then U+2028 and code | 881 ms |
  | Line comment of 20000 spaces, then CR and code | 835 ms |

- The fixed regex took at most 1.1 ms on every input above.
- The line-comment part of TW-2 was therefore also exponential before 8712197, not only
  quadratic. 8712197 fixes both parts.
- So the new 18-comment and 40000-space cases fail against the old regex within seconds. They do
  not hang.

Round 3 (still valid):
- `split.spec.ts`:
  - "CR-5 glued comments end the argument" (13 cases);
  - "CR-5 not a command" (7 cases);
  - "a long non-command line is rejected quickly (no catastrophic backtracking)" (5 cases,
    including the two 28-block-comment TW-2 regressions).
- `shell.int.spec.ts`: "a comment glued to a command argument is a comment: the next lines run
  (CR-5)", run against real mongosh.

Round 2 (still valid):
- `host.spec.ts`:
  - crash after an interrupt within the grace period;
  - the restart notice is shown once;
  - restarts started by a completion (CR-3);
  - worker exit during close (O-1).
- `split.spec.ts`: TW-1 trailing-comment cases.
- Integration:
  - comments around a command (CRLF, a leading block comment);
  - `exit;` between JavaScript lines;
  - `quit(1)`.

Round 1 added the original suites.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `use test; db.c.insertOne({a:1}); db.c.find()` returns the document as EJSON | int `use test; db.c.insertOne({a:1}); db.c.find() returns the document as EJSON` | `npx vitest run --config test/integration/vitest.config.ts shell` (Podman, mongo8 fixture) | Pass |
| AC2: interrupt stops `while(true){}` within 2 s | int `stops while(true){} within 2 s and the session goes on`; host grace-timer tests | same int command; `npx vitest run packages/backend/src/shell` | Pass |
| AC3: `complete('db.c.fi')` suggests `find`, `findOne` | int `complete('db.c.fi') suggests find and findOne`; host `asks the worker and answers its completions` | same | Pass |
| TW-2: command recognition is linear in the input length (fixed in 8712197) | split `a long non-command line is rejected quickly ...` (5), `TW-2 fix: a failing command match stays linear` (11), `... linear success path` (1) | `npx vitest run packages/backend/src/shell` | Pass |
| TW-2 fix semantics: a block comment ends at its first `*/`; a line comment ends at CR/U+2028/U+2029 | split `a block comment ends at its first */, a line comment at the line end` (13) | same | Pass |
| CR-5: a comment glued to a command argument is a comment; a single `/` stays in the argument | split `CR-5 glued comments end the argument` (13), `CR-5 not a command` (7), `trailing comment edge cases`; int `a comment glued to a command argument is a comment ... (CR-5)` | unit and int commands above | Pass |
| TW-1: a command with trailing comments ends there, the next lines run | split trailing-comment cases; int `runs the lines after a shell command that has a trailing comment`, `comments around a shell command ...` | same | Pass |
| CR-2: exit/quit are not passed to mongosh; session keeps working | split `isExitCommand` tests; int `exit / quit / exit() are refused ...`, `exit between JavaScript lines ...` | same | Pass |
| CR-3: completion restarts a dead worker; restart shared; notice kept for next eval | host ShellHost.complete restart tests; int `completion works right after the worker was restarted ...` | same | Pass |
| CR-4/O-2: queued eval of a closed session starts no worker | host `a queued evaluation of a closed session fails and leaves no worker running` | `npx vitest run packages/backend/src/shell` | Pass |
| O-1: worker death under an eval ends it with an error output; told once | host dying-worker, close-exit and crash-after-interrupt tests | same | Pass |
| O-3: cancel during a restart stops it | host `an evaluation cancelled while its worker restarts ...` | same | Pass |
| O-4: unknown session -> rejected promise | host `answers an unknown session with a rejected promise ...` | same | Pass |

## Focused test execution

Command:

`npx vitest run packages/backend/src/shell` (repo root)

Result:

Pass: 4 files and 215 tests. That is the 190 tests from round 3 plus the 25 new ones. The
two round-3 TW-2 tests now pass.

Command:

`npx vitest run --config test/integration/vitest.config.ts shell` (Podman, MongoDB 8 container
fixture)

Result:

Pass: 1 file, 17 tests. The integration spec has not changed since round 3 (sha256 `02615a2e…`).

## Full test execution

Command:

`npm run check` (eslint --max-warnings 0, prettier --check, type checks, root vitest, renderer
`ng test`)

Result:

Pass.
- Lint, Prettier and the type checks pass.
- Root vitest: 59 files, 3488 tests passed.
- Renderer `ng test`: 72 files, 2154 tests passed.
- The run was on the final `split.spec.ts` (sha256 `cd56ce59…`).

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, which passed (see above). It was not invoked separately.

## Bugs found

### Exponential backtracking in the shell-command recogniser (fixed in 8712197)

Finding ID:

`TW-2` — **fixed in 8712197**, verified in round 4.

Test:

- `splitShellInput > a long non-command line is rejected quickly (no catastrophic backtracking):
  28 block comments then code`
- `... 28 glued block comments then code`
- Round 4 regressions: `TW-2 fix: a failing command match stays linear: *` (11 cases).

Production source:

`packages/backend/src/shell/split.ts:92-93` (`COMMAND`)

Requirement:

- Console input is split at shell commands (task assumption).
- The splitter runs on every `shell.eval` in the worker (`runtime.ts`), so it must finish in
  linear time in the input length, whatever the user types.

Expected behavior:

A line with many comments followed by code is rejected as a command in linear time. The input is
then evaluated as JavaScript.

Actual behavior:

- Before 8712197, both comment branches could match in several ways:
  - the block comment's lazy `.*?` could span several comments;
  - the line comment `\/\/.*` could stop at any position.
- A failing match therefore tried every grouping of the comments:
  - 28 block comments took 3 to 6 s;
  - 18 line comments then U+2028 and code took 4.8 s;
  - 10000 comments never finished.
- After 8712197, all 18 timing cases pass. Each new case takes about 1 ms or less, against a bound
  of 1000 ms.

Severity:

Low (was). It is now resolved.

Fix required:

No. It was fixed by the fixer in 8712197; the regression tests pass.

Behaviour change from the fix, now covered by tests:
- `use a /* x */ b */` is no longer the command `use a`. The whole line goes to mongosh, as
  JavaScript reads it.
- This matches `skipBlockComment` in the same file.

Observation, not a finding (unchanged by 8712197, no requirement covers it):
- A line comment ended by a lone CR, U+2028 or U+2029 and followed by code is not recognised
  as a command, e.g. `use a // c` + U+2028 + `x`. The whole input then goes to mongosh as one piece.
- JavaScript treats these characters as line terminators, but a REPL user practically never types
  them.
- The tests document the current behaviour. The parent may decide whether this matters.

No new production defects were found in round 4.

## Coverage

Status: verified. The full backend unit suite ran with all tests selected. Its exit status was 0
and it wrote a fresh report.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line report).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source:
  - Task `shell-backend`.
  - Base `735b36d36aa2edab5c72fc2c7dda7f749f430509` (`git merge-base HEAD origin/main`, rechecked).
  - HEAD `871219790eb459a5a9ea6fcb7212cb6df3fbc3bb`.
  - Task commits are listed under Scope.
  - The file scope comes from `git diff --name-status 735b36d HEAD`.
- Source/test snapshot identifier (including uncommitted inputs):
  - HEAD 8712197 plus one uncommitted test file. `git diff --name-only HEAD` shows only
    `packages/backend/src/shell/split.spec.ts`.
  - `packages/backend/src/shell/split.spec.ts` sha256
    `cd56ce596aa2bd1b0fe5222101e3fe5e9f28ae68852748333e845015aa1a66b1`
  - `packages/backend/src/shell/split.ts` sha256
    `791da1bffba4cfab2258b71f995a81475c1469e27bd4fce51bef3b4114d5f623` (committed)
  - `test/integration/shell.int.spec.ts` sha256
    `02615a2e4e5b1e2b72319d5f1ed839f12361a7fd19149fe1e3a919ca70a63a71` (committed)
- Exact included files:
  - `packages/backend/src/shell/{handlers,host,index,output,protocol,runtime,split,worker}.ts`
  - `packages/backend/src/connections/manager.ts`
  - `packages/backend/src/index.ts`
  - `packages/backend/src/server/backend.ts`
  - `packages/backend/src/server/entry.ts`
- Excluded files:
  - `apps/desktop/scripts/build.mjs`: a build script, with no unit tests or coverage in the
    backend workspace;
  - `package-lock.json` and `packages/backend/package.json`: configuration;
  - spec files and the integration spec: tests.
- No renames or deletions.
- Provider/version, command, working directory, and test selection:
  - Provider: `@vitest/coverage-v8` with vitest 5.1.0.
  - Working directory: `packages/backend`.
  - Command: `npx vitest run --coverage --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text-summary --coverage.include=src/...`, with one `--coverage.include` per
    included file above. Paths are relative to `packages/backend`.
  - Test selection: all tests, with no `-t` filter. 24 files and 1156 tests passed.
- Run start/completion time and exit status:
  - Started 2026-11-17 03:36:58 (+01:00) and ran for 6.45 s.
  - Exit status 0.
  - The reports were written at 03:37:05.
- Generated report paths and report hashes/run identifier: the reports are git-ignored
  (`.gitignore:6`, `coverage/`).
  - `packages/backend/coverage/coverage-summary.json` sha256
    `13c4010245bfa9cfbc367a4f9665aba008954a6c5e317013f4c4bee75b81b9be`
  - `packages/backend/coverage/coverage-final.json` sha256
    `d58aef76aa3526ee8fb1b2bbba09675f5e02c72549c36342dbb6b43c917b2cff`
- Evidence outputs are fresh and inputs stayed unchanged:
  - Vitest cleans the reports directory before a run. Both files have the mtime of this run
    (03:37:05).
  - `coverage-final.json` differs from round 3, because it contains the new `split.ts` statement
    map.
  - `coverage-summary.json` has the same hash as in round 3. All counters are identical, and that
    file contains no timestamps.
  - The spec and source hashes above were taken both before and after the run, and they did not
    change.
- Final run after latest test additions and production fixes: yes. It ran on revision 8712197 with
  the final round-4 tests.

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/shell/host.ts` | 192/202 (95.04%) | 80/92 (86.96%) | 46/52 (88.46%) | 168/169 (99.41%) |
| `packages/backend/src/shell/split.ts` | 134/134 (100%) | 114/114 (100%) | 12/12 (100%) | 114/114 (100%) |
| `packages/backend/src/shell/output.ts` | 32/32 (100%) | 47/48 (97.92%) | 8/8 (100%) | 30/30 (100%) |
| `packages/backend/src/shell/handlers.ts` | 13/13 (100%) | 4/4 (100%) | 7/7 (100%) | 11/11 (100%) |
| `packages/backend/src/shell/runtime.ts` | 0/67 (0%) | 0/12 (0%) | 0/17 (0%) | 0/59 (0%) |
| `packages/backend/src/shell/worker.ts` | 0/42 (0%) | 0/17 (0%) | 0/7 (0%) | 0/35 (0%) |
| `packages/backend/src/shell/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/shell/protocol.ts` | N/A (0/0, types only) | N/A | N/A | N/A |
| `packages/backend/src/connections/manager.ts` | 175/177 (98.87%) | 91/93 (97.85%) | 38/39 (97.44%) | 152/153 (99.35%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| `packages/backend/src/server/backend.ts` | 38/41 (92.68%) | 10/12 (83.33%) | 11/14 (78.57%) | 36/37 (97.30%) |
| `packages/backend/src/server/entry.ts` | 0/6 (0%) | 0/2 (0%) | 0/1 (0%) | 0/6 (0%) |
| **Aggregate (summed counters, all 12 files above)** | 585/715 (81.82%) | 346/394 (87.82%) | 122/157 (77.71%) | 512/615 (83.25%) |

About the aggregate:
- It includes `runtime.ts`, `worker.ts` and `entry.ts` at 0%. Unit tests cannot instrument them
  (see below).
- Excluded: `apps/desktop/scripts/build.mjs`.

About `split.ts`:
- It stays at 100% on every metric.
- Coverage counts a regex as one statement, so the metric cannot show which paths in the regex
  ran. The round-4 semantic and timing tables cover those paths instead: block-comment body,
  `*` not followed by `/`, `(?!.)` at CR, U+2028, U+2029 and the end of the input.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `shell/split.ts:92-93` (regex performance, not a coverage metric) | Linear-time command recognition (TW-2) | Fixed in 8712197. There are 17 timing regressions with bounded inputs, and they pass. |
| `shell/runtime.ts` (all), `shell/worker.ts` (all) | mongosh evaluation, exit/quit refusal, interrupt, completion, splitting in the worker | These run inside `worker_threads` started by the host, and the v8 provider does not instrument worker threads. The 17 integration tests exercise them, and all pass. Measuring them would need provider or config changes outside test-writer authority. |
| `server/entry.ts:9-19` | Process entry point wiring | Bootstrap code; the project does not unit-test it. Non-material. |
| `shell/host.ts:89, 92` | Default `new Worker(url)` and default no-op `log` | Used only with the real worker (integration tests); unit tests inject fakes. Non-material. |
| `shell/host.ts:156` (`signal.aborted` after `ensureWorker` resolved) | Abort landing between restart completion and its continuation | Only reachable in a microtask window. Defensive; no deterministic test without reaching into internals. |
| `shell/host.ts:174#1, 225#1, 282#1` | Implicit `else` for unrelated message types | Defensive; the worker protocol never sends those. |
| `shell/host.ts:192#1` | Grace timer firing after the eval finished | `finally` clears the timer first. Defensive. |
| `shell/host.ts:275#0` | `closeSession` on an already closed session | Callers get NOT_FOUND first; the concurrent-close test covers the public behaviour. Defensive. |
| `shell/host.ts:291, 299, 348, 385` | `.catch(() => undefined)` of `worker.terminate()` | Only runs if `terminate()` rejects. Non-material. |
| `shell/host.ts:334#1, 345#0, 364-365` | `clear` after a newer restart; restart of a closed session; `startWorker` without `workerUrl` | Not reachable with the current sequencing; callers check first. Defensive. |
| `shell/host.ts:403#1` | `openFailed` error without `code` | Minor mapping path; error mapping is covered by open/restart failure tests. Low risk. |
| `shell/output.ts:80#1` | `EJSON.stringify` returning a non-string or blank value | Defensive. |
| `connections/manager.ts:65, 269-270`; `server/backend.ts:40, 60, 64#1, 103` | Default callbacks and a defensive branch in wiring | Non-material. Unchanged since round 1. |

## Unable to test

- Coverage of `runtime.ts` and `worker.ts`: the provider does not instrument worker threads. The
  integration tests cover their behaviour end to end. No follow-up is needed unless the project
  wants worker coverage, which would need tooling configuration.
- Running the worker inside the real Electron `utilityProcess` with the bundled
  `shell-worker.cjs`: outside this scope (the parent recorded this as an assumption). Not run.
- Timing bounds are wall-clock based, with a generous limit of 1000 ms against about 1 ms
  measured. On a heavily loaded machine they could flake. No flake was seen.

## Summary

Tests added and all validation passed.
- TW-2 is fixed in 8712197:
  - the two round-3 regressions pass;
  - 25 new unit cases cover the new comment semantics and the linear matching of both comment
    branches, with bounded inputs.
- The probe showed that the old line-comment branch was also exponential (18 comments took
  4.8 s). The new tests would catch a regression of either branch within seconds.
- Validation results:
  - `npx vitest run packages/backend/src/shell`: 215 passed;
  - integration (Podman): 17 passed;
  - `npm run check`: pass.
- Task-scoped coverage is fresh for revision 8712197:
  - `split.ts` is at 100%;
  - the aggregate is 81.82% of statements;
  - the remaining gaps are worker-thread files and defensive paths, justified above.
- No production defects remain open.
