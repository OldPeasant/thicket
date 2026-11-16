# Test Report

Date: 2026-11-16

Task: conn-manager - M1: Connection manager: SCRAM, TLS, SRV, test, errors, write guard

Scope: base afb33934c586d6ee50ea8b1f8495038dd102ba66, task commits ddb21a1..c30ad85 (measured HEAD c30ad858dd29e21f38939090d7df4d765b5f3e9a), `git diff afb3393..HEAD`. Second pass on the final revision after the fixer commit c30ad85 (review findings CR-1..CR-4 in `packages/backend/src/connections/manager.ts`), plus one uncommitted test-only change to `packages/backend/src/connections/manager.spec.ts` (this pass). No production change outside the commits.

Requirements:
- tasks/conn-manager.md (goal, 4 acceptance criteria, recorded assumptions)
- docs/ARCHITECTURE.md "Connections", "Write guard", "Coverage" (as updated by c30ad85)
- reviews/conn-manager/review.md (CR-1..CR-4) and reviews/conn-manager/fixes.md for the fixed behavior
- AGENTS.md project notes; parent instructions
- SPEC.md was not re-derived beyond what ARCHITECTURE.md and the task state

## Test files changed

First pass (committed in 2231272):
- `packages/backend/src/connections/options.spec.ts` (new)
- `packages/backend/src/connections/errors.spec.ts` (new)
- `packages/backend/src/connections/manager.spec.ts` (new)
- `packages/backend/src/connections/handlers.spec.ts` (new)
- `packages/backend/src/server/backend.spec.ts` (extended: `describe('startBackend: connections')`, existing tests unchanged)

The fixer's commit c30ad85 added 17 tests for CR-1..CR-4 to `manager.spec.ts` and changed one assertion (a stale connect that fails after close now answers CANCELLED instead of NETWORK_ERROR, per CR-4); that change follows the fixed requirement and does not weaken the test.

Second pass (uncommitted):
- `packages/backend/src/connections/manager.spec.ts`: new `describe('ConnectionManager cancellation and draft secrets: edge cases')`, 9 tests, nothing existing changed.

Not changed and still passing: `packages/backend/src/guard/guard.spec.ts`, `packages/contract/src/backend.spec.ts`, `apps/desktop/src/main/handlers.spec.ts`, `test/integration/conn-manager.int.spec.ts`.

## Tests added or updated

Count: 133 by the test-writer (first pass 124: options 23, errors 46, manager 44, handlers 5, backend wiring 6; second pass 9 in manager.spec.ts). `manager.spec.ts` now has 70 tests in total (44 + 17 by the fixer + 9).

First pass coverage (all unit level, fake driver client, no containers):
- `clientConfig`: URI kept as saved (SRV, replicaSet, directConnection in the URI); default appName `Thicket`; appName/readPreference/timeouts; SCRAM-SHA-1/256 user + password + authSource as driver options with the password never in the URI; user name from the (decoded) URI; secretMode `saved`/`ask` with a user and no password answers AUTH_FAILED "No password for user ..."; secretMode `none` sends the user only; mechanism NONE sets no auth; unparsable URI does not throw; X.509/PLAIN/GSSAPI/OIDC/AWS and SSH answer UNSUPPORTED; TLS CA file only, client certificate with and without passphrase, allow-invalid flags, TLS disabled ignores the TLS fields.
- `classifyCode`/`toConnectError`/`redact`: each class by error name, Node code, server code (18, 334), codeName and message; walk through `cause`, `errors[]`, and a MongoServerSelectionError-like `reason.servers` Map (a non-Map reason ignored); priority AUTH_FAILED > TLS_ERROR > DNS_ERROR > NETWORK_ERROR > TIMEOUT > SERVER_ERROR; cyclic and very deep chains terminate; plain-object wrappers; RpcError pass-through; prefixes; empty and non-Error messages; SERVER_ERROR detail; URI passwords masked and secret values replaced literally.
- `ConnectionManager`: open/close/status/closeAll; concurrent opens share one connect; several profiles open and close independently; close idempotent; close during connecting answers CANCELLED; stale connects don't overwrite a newer open; abort signals; error state until the next open/close; NOT_FOUND / UNSUPPORTED before a client exists; `client()` NOT_CONNECTED; secrets rules; log lines never contain passwords or the TLS passphrase; `test()`, `serverInfo`, `readServerInfo`, `topologyOf`.
- `connHandlers` and `startBackend` wiring over in-memory privileged and renderer ports (`profiles.forConnect`, `secrets.get`, NOT_FOUND/UNSUPPORTED/NOT_CONNECTED/INTERNAL, log prefix without the password).

Second pass, checking the CR-1..CR-4 behavior beyond the fixer's own tests:
- Waiter counting (CR-3): A and B wait, A cancels, C joins, B cancels; the connect stays alive and C gets `connected` with one client; aborting C after success changes nothing.
- The only caller aborting while the profile is still loading: CANCELLED, entry forgotten, no client is ever created, and the late connect logs "CANCELLED The connection was closed while connecting".
- A new open after every caller cancelled starts a fresh connect; the abandoned client is closed again once its driver connect completes (CR-1), and the new client stays open.
- `test()` with an already aborted signal: CANCELLED, no command sent, client closed at once and again once the connect completes (CR-1).
- A cancelled `test()` whose connect later fails: closed once, no unhandled rejection; a `test()` whose ping fails after connecting is closed exactly once.
- Draft matching (CR-2): the same auth with keys in another order, and changed name/appName/readPreference/timeouts/readOnly/production, still match (stored password used, draft's options applied); a draft that drops the saved profile's auth section gets no stored secrets.
- A CANCELLED answer from main while loading the profile (e.g. privileged port replaced) forgets the entry instead of keeping state `error` (covers `manager.ts:201-202`).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Integration: SCRAM ok / wrong password AUTH_FAILED, TLS without CA TLS_ERROR, unknown host DNS_ERROR, replica set and standalone fixtures | `test/integration/conn-manager.int.spec.ts` (23 tests); unit support: `errors.spec.ts`, `options.spec.ts` | `npm run test:int -- conn-manager` (Podman containers) on c30ad85 + this pass's test change | Pass (23 passed, 28.3 s) |
| AC2 Guard unit tests: read-only refuses every contract write method; production without `confirmed: true` refuses | `guard.spec.ts` (`it.each(WRITE_METHODS)`) | `npm run check` | Pass |
| AC3 Logs mask passwords (test captures log output) | `manager.spec.ts` "log lines never contain passwords or passphrases", "masks a user:password connection string in the log line of a draft test"; `backend.spec.ts` "logs connection events with a prefix and without the password"; `errors.spec.ts` masking tests; int "its typed password never reaches the log" | `npm run check` and `npm run test:int -- conn-manager` | Pass |
| AC4 Several connections open at once and close independently (int test) | int "several connections: open at once and close independently"; unit "several profiles are open at once and close independently" | `npm run test:int -- conn-manager` | Pass |
| CR-1 abandoned connect closed again (open and test) | fixer tests + "a new open after every caller cancelled ...", "test() with an already aborted signal ...", "a cancelled test whose connect later fails ...", "a test whose ping fails after connecting is closed once" | `npx vitest run packages/backend/src/connections/manager.spec.ts` | Pass (70 tests) |
| CR-2 draft secrets only when connection string/auth/TLS/SSH equal the saved profile | fixer tests + "draft matching ignores key order and fields that do not change the target", "a draft that drops the auth section ..." | same | Pass |
| CR-3 per-caller cancel, connect closed when the last waiter cancels | fixer tests + "waiters are counted ...", "the only caller aborting while the profile loads ..." | same | Pass |
| CR-4 CANCELLED after close during connect | fixer tests + "a CANCELLED answer from main ... forgets the entry" | same | Pass |
| Goal: options, error classification, assumptions (close idempotent, error state, "No password", UNSUPPORTED) | `options.spec.ts`, `errors.spec.ts`, `manager.spec.ts`, `backend.spec.ts` | `npm run check` | Pass |
| startBackend wraps write handlers with the guard | none at the startBackend level | n/a | Not testable yet: startBackend registers no `WRITE_METHODS` handler; `guardWrites` itself is covered by `guard.spec.ts` |

## Focused test execution

Command:

`npx vitest run packages/backend/src/connections/manager.spec.ts`

Result:

Pass (70 tests)

## Full test execution

Command:

`npm run check` (lint: ESLint + Prettier; typecheck: root + every workspace; test: root vitest + renderer)

Result:

Pass (root vitest 39 files / 2382 tests; renderer 27 files / 437 tests). `npm run test:int -- conn-manager` -> Pass (23 tests).

The first pass's `npm run check` failure (missing `@playwright/test` in `node_modules`) is resolved; the root typecheck passes now.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`, which passed on the final state described above).

## Bugs found

None. No test exposed a production defect against the acceptance criteria, ARCHITECTURE.md, the recorded assumptions or the CR-1..CR-4 fixes.

Observations (not defects against a stated requirement; no failing test kept):
- The first-pass observations "first caller's abort cancels the shared open" and "close while the profile loads still connects" are resolved by CR-3 and CR-4 and now tested.
- `test()` with an already aborted signal still creates a client and starts its connect before answering CANCELLED (it is closed twice, so nothing leaks); a check before `createClient` would avoid the connect.
- A draft whose only change is `secretMode` (e.g. `saved` to `ask`) no longer matches its saved profile, so other stored secrets such as `tlsKeyPassphrase` are not used for that test. Conservative and in line with CR-2.
- `toConnectError` takes SERVER_ERROR `detail` only from the top-level error, so a server error nested in `cause` yields `detail: {}`.
- A failed open of an unknown profile id keeps a `state: 'error'` entry (NOT_FOUND) in `conn.status` until closed (consistent with the recorded assumption).

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (all files in scope except `backend.ts` are new in this task, so whole-file equals changed-line coverage for them; for `backend.ts` the existing tooling has no changed-line report).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: conn-manager; base afb33934c586d6ee50ea8b1f8495038dd102ba66; HEAD c30ad858dd29e21f38939090d7df4d765b5f3e9a; commits ddb21a1, 351747d, c0ad2b4, 3698c2e, 2231272 (tests), c30ad85 (fixes) from `git log afb3393..HEAD` and the parent's file list.
- Source/test snapshot identifier (including uncommitted inputs): sha256 identical before and after the run: manager.ts 127197e3..., options.ts aad7d495..., errors.ts 0aed11ef..., handlers.ts 9c23a15c..., guard.ts b2b7d1e0..., backend.ts 90a1562d...; tests manager.spec.ts 7bac9335... (uncommitted, this pass), options.spec.ts cb2d3233..., errors.spec.ts 6f0cdb92..., handlers.spec.ts c5db1985..., backend.spec.ts e54d45c4..., guard.spec.ts 540d8471...
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/connections/{errors,handlers,manager,options,index}.ts`, `packages/backend/src/guard/{guard,index}.ts`, `packages/backend/src/server/backend.ts`. The two `index.ts` files are re-exports with 0 executable statements (0/0, N/A). Excluded from this run: `packages/contract/src/backend.ts` (declarative method table, covered by `packages/contract/src/backend.spec.ts`), `apps/desktop/src/main/handlers.ts`, `apps/desktop/src/profiles/handlers.ts`, `apps/desktop/src/main/index.ts` (other workspace; the `profiles.forConnect` handler is covered by `apps/desktop/src/main/handlers.spec.ts`; `main/index.ts` is Electron bootstrap, reachable only through the Electron e2e path, not run here). No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8; `npm run coverage -w packages/backend -- --coverage.include='src/connections/*.ts' --coverage.include='src/guard/*.ts' --coverage.include='src/server/backend.ts' --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json --coverage.reportsDirectory=coverage/conn-manager-pass2-final`; working directory packages/backend; all backend unit tests (8 files, 247 tests). Integration tests are not part of this measurement.
- Run start/completion time and exit status: 2026-11-16 20:54:29 local, duration 2.49 s, exit 0, 247 passed.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/conn-manager-pass2-final/coverage-summary.json` sha256 5f76f7c69b02bea8f2512c0e877bb4143ab317d7c2af5a1ac547b5541cb7b2b0; `packages/backend/coverage/conn-manager-pass2-final/coverage-final.json` sha256 ca0d4cd89342f0a94025d733a700caaff038d1f102b06a43d50694711e9b31b4 (Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: fresh reports directory created by this run; source/test hashes identical before and after.
- Final run after latest test additions and production fixes: yes (after the fixer commit c30ad85 and after this pass's last test addition).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/connections/errors.ts` | 87/87 (100%) | 75/76 (98.68%) | 12/12 (100%) | 65/65 (100%) |
| `packages/backend/src/connections/handlers.ts` | 7/7 (100%) | 4/4 (100%) | 6/6 (100%) | 7/7 (100%) |
| `packages/backend/src/connections/manager.ts` | 163/165 (98.79%) | 89/90 (98.89%) | 34/36 (94.44%) | 141/142 (99.30%) |
| `packages/backend/src/connections/options.ts` | 47/47 (100%) | 53/53 (100%) | 2/2 (100%) | 42/42 (100%) |
| `packages/backend/src/connections/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/guard/guard.ts` | 37/37 (100%) | 23/25 (92%) | 8/8 (100%) | 32/32 (100%) |
| `packages/backend/src/guard/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/server/backend.ts` | 29/31 (93.55%) | 9/10 (90%) | 9/11 (81.82%) | 27/27 (100%) |
| Aggregate (summed counters, files above) | 370/374 (98.93%) | 253/258 (98.06%) | 71/75 (94.67%) | 314/315 (99.68%) |

Aggregate excludes the desktop and contract files listed above (other workspaces, not instrumented in this run).

History: first pass (HEAD 3698c2e) 335/339 statements, 226/231 branches. On c30ad85 before this pass's tests: 369/374 statements, 252/258 branches (`manager.ts:201-202` uncovered); the CANCELLED-from-main test closed that branch.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/connections/manager.ts:57` (default `createClient` = `new MongoClient`) | real driver construction | Exercised by the integration tests (`npm run test:int -- conn-manager`, pass); unit tests inject a fake by design |
| `packages/backend/src/connections/manager.ts:337` (`operation.catch` callback in `abortable` for an already aborted signal) | avoid an unhandled rejection when an abandoned operation later fails | Non-material: the callback only runs when that operation rejects; `open` now checks an aborted signal before connecting, and `test()` with an aborted signal is tested with a connect that succeeds |
| `packages/backend/src/connections/errors.ts:165` (`?? 'Connection failed'`) | fallback prefix | Unreachable: `classifyCode` only returns codes that have a prefix for non-RpcError input |
| `packages/backend/src/guard/guard.ts:84-87` (conditional write method without a `CONDITIONAL_WRITES` entry fails closed) | fail-closed guard | Not reachable with the current contract (only `agg.run` is conditional and has an entry); testing it would require mutating the exported table. Justified gap |
| `packages/backend/src/server/backend.ts:29` (default no-op `log`), `:68` (initial no-op `stop`) | none | Non-material defaults |

## Unable to test

- startBackend's guard wrapping of write handlers: no write handler is registered in startBackend yet, so it cannot be observed end to end; `guardWrites` is unit-tested. Follow-up: the first task that adds a `WRITE_METHODS` handler should add a startBackend-level test.
- Electron main wiring (`apps/desktop/src/main/index.ts` passing `profiles` to `privilegedHandlers`): only reachable through the Electron e2e path, not run here.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. On the final revision (c30ad85 plus 9 uncommitted second-pass tests), `npm run check` (= `.taskcheck`) passes, the conn-manager integration tests pass, and the CR-1..CR-4 behavior is covered by the fixer's tests and the added edge-case tests.
