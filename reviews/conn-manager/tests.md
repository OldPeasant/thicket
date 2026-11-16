# Test Report

Date: 2026-11-16

Task: conn-manager - M1: Connection manager: SCRAM, TLS, SRV, test, errors, write guard

Scope: base afb33934c586d6ee50ea8b1f8495038dd102ba66, task commits ddb21a1..3698c2e (HEAD 3698c2ed31bb649042e861eff06a88c95eb305ff), `git diff afb3393..HEAD`, plus the uncommitted test files listed below (no production changes outside the commits).

Requirements:
- tasks/conn-manager.md (goal, 4 acceptance criteria, 5 recorded assumptions)
- docs/ARCHITECTURE.md "Connections", "Write guard", "Coverage"
- AGENTS.md project notes; parent instructions (unit tests for packages/backend/src/connections, startBackend wiring)
- SPEC.md was not re-derived beyond what ARCHITECTURE.md and the task state

## Test files changed

- `packages/backend/src/connections/options.spec.ts` (new)
- `packages/backend/src/connections/errors.spec.ts` (new)
- `packages/backend/src/connections/manager.spec.ts` (new)
- `packages/backend/src/connections/handlers.spec.ts` (new)
- `packages/backend/src/server/backend.spec.ts` (extended: new `describe('startBackend: connections')`, existing tests unchanged)

Not changed (already present in the task commits and still passing): `packages/backend/src/guard/guard.spec.ts`, `packages/contract/src/backend.spec.ts`, `apps/desktop/src/main/handlers.spec.ts`, `test/integration/conn-manager.int.spec.ts`.

## Tests added or updated

Count: 124 (options 23, errors 46, manager 44, handlers 5, backend wiring 6; counts are vitest test cases incl. `it.each` rows)

What they cover (all unit level, fake driver client, no containers):
- `clientConfig`: URI kept as saved (SRV, replicaSet, directConnection in the URI); default appName `Thicket`; appName/readPreference/timeouts; SCRAM-SHA-1/256 user + password + authSource as driver options with the password never in the URI; user name from the (decoded) URI; secretMode `saved`/`ask` with a user and no password answers AUTH_FAILED "No password for user ..."; secretMode `none` sends the user only; mechanism NONE sets no auth; unparsable URI does not throw; X.509/PLAIN/GSSAPI/OIDC/AWS and SSH answer UNSUPPORTED; TLS CA file only, client certificate with and without passphrase, allow-invalid flags, TLS disabled ignores the TLS fields.
- `classifyCode`/`toConnectError`/`redact`: each class by error name, Node code, server code (18, 334), codeName and message; walk through `cause`, `errors[]`, and a MongoServerSelectionError-like `reason.servers` Map (and a non-Map reason ignored); the documented priority order AUTH_FAILED > TLS_ERROR > DNS_ERROR > NETWORK_ERROR > TIMEOUT > SERVER_ERROR; cyclic and very deep chains terminate; plain-object wrappers; RpcError pass-through; readable prefixes; empty and non-Error messages; SERVER_ERROR detail (serverCode, codeName, non-integer code dropped); URI passwords masked and secret values replaced literally (regex characters, empty secrets ignored).
- `ConnectionManager`: open with stored password; already-connected open does not reconnect; concurrent opens share one connect; several profiles open at once and close independently; close idempotent / unknown id no-op; close swallows driver close errors; closeAll; close during connecting gives CANCELLED and closes the client; a stale connect (success or failure) after close does not overwrite a newer open; abort signal (pending and already aborted) gives CANCELLED and forgets the entry; a failing connect with a signal keeps its classified error; failed open keeps state `error` with the classified error until the next open/close; NOT_FOUND / UNSUPPORTED fail before a client is created; `client()` NOT_CONNECTED while connecting, after failure, for unknown ids; secrets rules (request password wins, `ask` ignores the stored password but keeps tlsKeyPassphrase, loadSecrets NOT_FOUND or null means no secrets, other loadSecrets errors pass through, drafts without id don't load secrets); log lines never contain stored/typed passwords or the TLS passphrase, also when the driver error text contains them or a draft URI has `user:password@`; `test()` ping/latency/serverInfo/close-in-finally, classified failures, abort, latency never negative; `serverInfo` (sharded/enterprise/raw EJSON, NOT_CONNECTED, classified errors); `readServerInfo` fallbacks; `topologyOf` for every branch.
- `connHandlers`: exactly the five conn.* methods; conn.test by profileId and by draft + password; open/status (one, unknown, all)/serverInfo/close sequence; the request signal cancels conn.open.
- `startBackend` wiring (fake parentPort, in-memory privileged and renderer ports): conn.* served next to backend.*; conn.open loads the profile via `profiles.forConnect` and secrets via `secrets.get` over the privileged port (AUTH_FAILED "No password", status `error`, close, status `disconnected`); NOT_FOUND from main and UNSUPPORTED for SSH reach the renderer; conn.serverInfo NOT_CONNECTED; conn.open before the privileged port exists answers INTERNAL; backend log lines carry the `connections:` prefix and never the typed password.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Integration: SCRAM ok / wrong password AUTH_FAILED, TLS without CA TLS_ERROR, unknown host DNS_ERROR, replica set and standalone fixtures | `test/integration/conn-manager.int.spec.ts` (23 tests, existing); unit support: `errors.spec.ts`, `options.spec.ts` | `npm run test:int -- conn-manager` (Podman containers) | Pass (23 passed, 29.1 s) |
| AC2 Guard unit tests: read-only refuses every contract write method; production without `confirmed: true` refuses | `guard.spec.ts` (existing, `it.each(WRITE_METHODS)`) | `npm run test` (root vitest) | Pass |
| AC3 Logs mask passwords (test captures log output) | `manager.spec.ts` "log lines never contain passwords or passphrases", "masks a user:password connection string in the log line of a draft test"; `backend.spec.ts` "logs connection events with a prefix and without the password"; `errors.spec.ts` masking tests; int test "its typed password never reaches the log" | `npx vitest run packages/backend/src/connections packages/backend/src/server/backend.spec.ts` and `npm run test:int -- conn-manager` | Pass |
| AC4 Several connections open at once and close independently (int test) | int "several connections: open at once and close independently"; unit `manager.spec.ts` "several profiles are open at once and close independently" | `npm run test:int -- conn-manager` | Pass |
| Goal: options from profile + secrets (SCRAM-SHA-1/256, TLS CA file, allow-invalid, SRV, directConnection) | `options.spec.ts` | `npx vitest run packages/backend/src/connections/options.spec.ts` | Pass |
| Goal: error classification incl. TIMEOUT and priority | `errors.spec.ts` | `npx vitest run packages/backend/src/connections/errors.spec.ts` | Pass |
| Assumptions: conn.close idempotent; failed open keeps state `error`; "No password" AUTH_FAILED; SSH/other mechanisms UNSUPPORTED | `manager.spec.ts`, `options.spec.ts`, `backend.spec.ts` | `npx vitest run packages/backend/src/connections/manager.spec.ts` | Pass |
| startBackend serves conn.* and loads profiles via `profiles.forConnect` | `backend.spec.ts` "startBackend: connections" | `npx vitest run packages/backend/src/server/backend.spec.ts` | Pass |
| startBackend wraps write handlers with the guard | none at the startBackend level | n/a | Not testable yet: startBackend registers no `WRITE_METHODS` handler, so the wrapping is not observable; `guardWrites` itself is covered by `guard.spec.ts` |

## Focused test execution

Command:

`npx vitest run packages/backend/src/connections/options.spec.ts` (likewise errors, manager, handlers, and `packages/backend/src/server/backend.spec.ts`)

Result:

Pass (options 23, errors 46, manager 44, handlers 5, backend.spec 19 incl. 6 new)

## Full test execution

Command:

`npm run lint` -> Pass (ESLint 0 warnings, Prettier clean)

`npm run typecheck --workspaces --if-present` -> Pass (desktop, contract, core, backend, renderer)

`npm run test` -> Pass (root vitest 39 files / 2354 tests incl. the new ones; renderer 27 files / 437 tests)

`npm run test:int -- conn-manager` -> Pass (23 tests)

`npm run check` -> Fail, not caused by this task or these tests: the root `tsc -p tsconfig.json` step reports `Cannot find module '@playwright/test'` (and follow-on implicit-any errors) in `playwright.config.ts` and `test/e2e/**`. `@playwright/test` is declared in the root `package.json` devDependencies but is not present in `node_modules` in this clone. All errors are in e2e files outside the task diff. Lint, the workspace typechecks and all unit tests pass when run individually (above). The test-writer may not install dependencies.

## .taskcheck

Result:

Fail (same root cause: `.taskcheck` runs `npm run check`; missing `@playwright/test` in `node_modules`). The parent needs `npm install` (or `npm ci`) in this clone before `tasks.py done`.

## Bugs found

None. No test exposed a production defect against the acceptance criteria, ARCHITECTURE.md or the recorded assumptions.

Observations for the parent (not defects against a stated requirement; no failing test kept):
- Concurrent `conn.open` calls share one connect, including the first caller's abort signal: if the first renderer request is cancelled, the second caller sharing the promise also gets CANCELLED (`manager.ts` `open`, `entry.opening`). Behavior not specified.
- `conn.close` while `loadProfile`/`loadSecrets` is still pending does not stop the connect: the client is still created and connected, then closed with CANCELLED (correct result, wasted connect).
- `toConnectError` takes SERVER_ERROR `detail` only from the top-level error, so a server error nested in `cause` yields `detail: {}`.
- A failed open of an unknown profile id leaves a `state: 'error'` entry (NOT_FOUND) in `conn.status` until closed (consistent with the recorded assumption).

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (all files in scope except `backend.ts` are new in this task, so whole-file equals changed-line coverage for them; for `backend.ts` the existing tooling has no changed-line report).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: conn-manager; base afb33934c586d6ee50ea8b1f8495038dd102ba66; HEAD 3698c2ed31bb649042e861eff06a88c95eb305ff; commits ddb21a1, 351747d, c0ad2b4, 3698c2e from `git diff --stat afb3393..HEAD` and the parent's file list.
- Source/test snapshot identifier (including uncommitted inputs): sha256 before and after the run identical: manager.ts d2733e64..., options.ts aad7d495..., errors.ts 0aed11ef..., handlers.ts 9c23a15c..., guard.ts b2b7d1e0..., backend.ts 90a1562d...; tests manager.spec.ts 07313573..., options.spec.ts cb2d3233..., errors.spec.ts 6f0cdb92..., handlers.spec.ts c5db1985..., backend.spec.ts e54d45c4..., guard.spec.ts 540d8471...
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/connections/{errors,handlers,manager,options,index}.ts`, `packages/backend/src/guard/{guard,index}.ts`, `packages/backend/src/server/backend.ts`. The two `index.ts` files are re-exports with 0 executable statements (reported 0/0, N/A). Excluded from this run: `packages/contract/src/backend.ts` (declarative method table, covered by `packages/contract/src/backend.spec.ts`), `apps/desktop/src/main/handlers.ts`, `apps/desktop/src/profiles/handlers.ts`, `apps/desktop/src/main/index.ts` (other workspace; `profiles.forConnect` handler covered by the existing `apps/desktop/src/main/handlers.spec.ts`; `main/index.ts` is Electron bootstrap, exercised only by the Electron e2e path, not run here). No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8; `npm run coverage -w packages/backend -- --coverage.include='src/connections/*.ts' --coverage.include='src/guard/*.ts' --coverage.include='src/server/backend.ts' --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json --coverage.reportsDirectory=coverage/conn-manager-final`; working directory packages/backend; all backend unit tests (8 files, 221 tests). Integration tests are not part of this measurement.
- Run start/completion time and exit status: 2026-11-16 20:40:25 local, duration 2.29 s, exit 0, 221 passed.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/conn-manager-final/coverage-summary.json` sha256 e5aeee7c956c91f9eecc7a42eef6214eacb7a17e3e4efa47deb7f4d25952d2f1; `packages/backend/coverage/conn-manager-final/coverage-final.json` sha256 f3ff33be4928933ce13bc4abe817f0527c88b26a5a91cd52d3605b85866fb1bf (Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: fresh reports directory created by this run; source/test hashes identical before and after.
- Final run after latest test additions and production fixes: yes (after the last test additions; no production fixes were made).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/connections/errors.ts` | 87/87 (100%) | 75/76 (98.68%) | 12/12 (100%) | 65/65 (100%) |
| `packages/backend/src/connections/handlers.ts` | 7/7 (100%) | 4/4 (100%) | 6/6 (100%) | 7/7 (100%) |
| `packages/backend/src/connections/manager.ts` | 128/130 (98.46%) | 62/63 (98.41%) | 28/30 (93.33%) | 110/111 (99.10%) |
| `packages/backend/src/connections/options.ts` | 47/47 (100%) | 53/53 (100%) | 2/2 (100%) | 42/42 (100%) |
| `packages/backend/src/connections/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/guard/guard.ts` | 37/37 (100%) | 23/25 (92%) | 8/8 (100%) | 32/32 (100%) |
| `packages/backend/src/guard/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/server/backend.ts` | 29/31 (93.55%) | 9/10 (90%) | 9/11 (81.82%) | 27/27 (100%) |
| Aggregate (summed counters, files above) | 335/339 (98.82%) | 226/231 (97.84%) | 65/69 (94.20%) | 283/284 (99.65%) |

Aggregate excludes the desktop and contract files listed above (other workspaces, not instrumented in this run).

Before the new tests the same files were already partly covered by guard.spec.ts and backend.spec.ts only; the first measurement after adding the bulk of the tests was 333/339 statements, 225/231 branches; two more tests (TLS with CA file only, failing connect with a signal) closed `options.ts:67` and `manager.ts:250-251`.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/connections/manager.ts:53` (default `createClient` = `new MongoClient`) | real driver construction | Exercised by the integration tests (`npm run test:int -- conn-manager`, pass); unit tests inject a fake by design |
| `packages/backend/src/connections/manager.ts:238` (`operation.catch` on an already-aborted signal) | avoid an unhandled rejection when the abandoned connect later fails | Non-material: only runs when the abandoned operation rejects later; the CANCELLED path itself is tested |
| `packages/backend/src/connections/errors.ts:165` (`?? 'Connection failed'`) | fallback prefix | Unreachable: `classifyCode` only returns codes that have a prefix for non-RpcError input |
| `packages/backend/src/guard/guard.ts:84-87` (conditional write method without a `CONDITIONAL_WRITES` entry fails closed) | fail-closed guard | Not reachable with the current contract (only `agg.run` is conditional and has an entry); testing it would require mutating the exported table. Left as a justified gap |
| `packages/backend/src/server/backend.ts:29` (default no-op `log`), `:68` (initial no-op `stop`) | none | Non-material defaults |

## Unable to test

- startBackend's guard wrapping of write handlers: no write handler is registered in startBackend yet, so it cannot be observed end to end; `guardWrites` is unit-tested. Follow-up: the first task that adds a `WRITE_METHODS` handler should add a startBackend-level test.
- Electron main wiring (`apps/desktop/src/main/index.ts` passing `profiles` to `privilegedHandlers`): only reachable via the Electron e2e path, not run here.
- `npm run check` / `.taskcheck` could not pass in this clone because `@playwright/test` is missing from `node_modules` (environment, needs `npm install`; not done by the test-writer).

## Summary

Tests added and all task tests pass; task-scoped coverage is sufficient and no production defects were found. `npm run check` / `.taskcheck` currently fail only on the root typecheck of e2e files because `@playwright/test` is not installed in this clone; the parent must restore dependencies and re-run `.taskcheck` before `tasks.py done`.
