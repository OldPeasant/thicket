# Test Report

Date: 2026-11-17

Task: oidc-auth - M5: OIDC authentication

Scope: task commits c43b477cf3bb1064aa73d1ad55561da847f01185..fbf81a51f04b275d672d4f13be01c31494fbc8cd (893ed51, e0041c1, fe6643f, eb2545e, fbf81a5) on main. The parent supplied the base and commits, and `git merge-base HEAD origin/main` = c43b477 confirms the base. This pass focuses on the review fixes in fbf81a5 (CR-1 `oidcTrustedEndpoint`/`ALLOWED_HOSTS`, CR-2 forgetting refused tokens, CR-3 shared discovery). Uncommitted inputs are only the test files listed below. `reviews/oidc-auth/review.md` was also modified in the working tree by the concurrent code-reviewer; it is not a test input.

Requirements:
- `tasks/oidc-auth.md` acceptance criteria and recorded assumptions (incl. `oidcFlow`, `oidcTrustedEndpoint`, forgetting refused tokens, keychain persistence, headless Chromium)
- `reviews/oidc-auth/review.md` findings CR-1..CR-3 and `reviews/oidc-auth/fixes.md`
- `SPEC.md`, `docs/ARCHITECTURE.md` ("Coverage", OIDC notes), `docs/QUALITY.md`, `AGENTS.md`

## Test files changed

- `packages/backend/src/auth/oidc/oidc.spec.ts`
- `packages/backend/src/connections/options.spec.ts`
- `packages/backend/src/server/backend.oidc.spec.ts` (new)
- `packages/contract/src/index.spec.ts`

## Tests added or updated

Count: 11 (all added; no existing test changed)

- `oidc.spec.ts`:
  - "a cancel that races another failure answers CANCELLED, not the failure"
  - "tokens from an interactive sign-in the server refused are forgotten too, once per connect"
  - "a refusal forgets only that profile's tokens"
- `options.spec.ts`:
  - "a trusted mongodb+srv name is lower-cased like plain hosts"
  - "an unparseable connection string keeps the driver default (the driver reports it)"
- `backend.oidc.spec.ts` (startBackend wiring; a subclass spy records the environment it passes to the real `OidcAuthenticator`):
  - "openBrowser asks main to open the URL over the privileged port"
  - "main's refusal to open the browser rejects openBrowser (the device-flow fallback sees it)"
  - "saveTokens asks main to store, and with null to clear, the profile token cache"
  - "prompt broadcasts oidc.prompt to every connected renderer, not to closed ones"
  - "conn.open of an OIDC profile reaches the driver with the authenticator (not UNSUPPORTED)"
- `contract/index.spec.ts`:
  - "MONGODB-OIDC options: oidcFlow is auto/authCode/deviceCode, oidcTrustedEndpoint a boolean (task oidc-auth)"

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: MongoDB Enterprise + Keycloak, automated code flow (headless browser drives Keycloak login) authenticates | `oidc.int.spec.ts` "authorization code flow: the browser signs in on Keycloak and the connect succeeds" | `npm run test:int -- oidc` (Podman, MongoDB Enterprise + Keycloak fixture, headless Chromium) | Pass |
| AC2: Token reuse, a second connect does not open the browser | `oidc.int.spec.ts` "token reuse: a second connect (also after a restart) does not open the browser"; unit tests in `oidc.spec.ts` "OidcAuthenticator: token cache" | `npm run test:int -- oidc`; `npm run check` | Pass |
| AC3: Device flow works | `oidc.int.spec.ts` "device flow: the user code is shown, approved on Keycloak, and the connect succeeds", "auto flow falls back to the device flow when no browser can be opened" | `npm run test:int -- oidc` | Pass |
| CR-1: `oidcTrustedEndpoint` sets `ALLOWED_HOSTS` to the profile's own hosts; the driver default otherwise; the refusal is AUTH_FAILED and names the option | `options.spec.ts` "MONGODB-OIDC trusted endpoint (ALLOWED_HOSTS)" (8 tests, 2 new); `errors.spec.ts` ALLOWED_HOSTS refusal; new `backend.oidc.spec.ts` "conn.open of an OIDC profile reaches the driver..." | `npm run check`; `npx vitest run src/connections/options.spec.ts` | Pass |
| CR-1: profile schema accepts the new auth fields only with valid values | `index.spec.ts` "MONGODB-OIDC options: ..." | `npm run check` | Pass |
| CR-2: tokens the server refused (AUTH_FAILED) are forgotten, once, only for that profile; other failures keep them | `oidc.spec.ts` refused tests (2 existing + 2 new); `manager.spec.ts` AUTH_FAILED / other failures / failing forget | `npm run check` | Pass |
| CR-3: cancelling one connect during shared discovery does not fail another | `oidc.spec.ts` "cancelling one connect during discovery does not fail another profile's connect" | `npm run check` | Pass |
| Backend wiring: main opens the browser (`oidc.openBrowser`), stores/clears tokens (`oidc.saveTokens`); `oidc.prompt` reaches every renderer | `backend.oidc.spec.ts` (4 tests) | `npx vitest run src/server/backend.oidc.spec.ts`; `npm run check` | Pass |
| Cancelling a sign-in answers CANCELLED even when another failure races it | `oidc.spec.ts` "a cancel that races another failure answers CANCELLED, not the failure" | `npm run check` | Pass |
| Main (Electron) wiring in `apps/desktop/src/main/index.ts` (`shell.openExternal`, `hasProfile`) | none | none | Not run: the Electron entry is not unit-testable; no acceptance criterion names an Electron/e2e run, so `npm run test:electron` / `test:e2e` were not run. The handlers it wires are covered by `apps/desktop/src/oidc/handlers.spec.ts` and `main/handlers.spec.ts` |

## Focused test execution

Command:

`npx vitest run src/connections/options.spec.ts src/auth/oidc/oidc.spec.ts` (packages/backend): 2 files, 130 tests passed (before the race test was added). Then `npx vitest run src/auth/oidc/oidc.spec.ts`: 1 file, 50 tests passed.
`npx vitest run src/server/backend.oidc.spec.ts src/server/backend.spec.ts` (packages/backend): 2 files, 45 tests passed.
`npx vitest run src/index.spec.ts -t "MONGODB-OIDC"` (packages/contract): 1 test passed (336 skipped).

Result:

Pass

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier, tsc for every workspace + renderer ngc, vitest, renderer `ng test`), run on the final test snapshot at 2026-11-17T04:22 to 04:23:50+01:00.
`npm run test:int -- oidc` (Podman; MongoDB Enterprise + Keycloak fixture; headless Chromium), 2026-11-17T04:19:23 to 04:20:07+01:00.

Result:

Pass.
- `npm run check`: vitest 68 files / 3717 tests passed; renderer 80 files / 2429 tests passed. Lint and typecheck passed: the `&&` chain reached the test stage.
- `npm run test:int -- oidc`: 1 file / 6 tests passed. It ran before the last unit test was added to `oidc.spec.ts`. That edit is a unit spec only and does not affect the integration suite, and production code was unchanged throughout.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` when `package.json` exists; that command passed as recorded above. `.taskcheck` itself was not invoked separately.

## Bugs found

None. All new tests passed against the production code at fbf81a5. No production code was modified.

## Coverage

Status: verified (backend, contract, desktop workspaces). The integration run was not instrumented.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage, backend only: 399/406 (98.28%). Method: the provider-native lcov `DA` line counters of the final backend run, intersected with the added/modified lines of `git diff -U0 c43b477..HEAD` per file. Removed and non-executable lines are not counted. This says nothing about changed-branch coverage. Changed-line coverage was not measured for contract and desktop; their whole-file numbers are given below.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: oidc-auth; base c43b477cf3bb1064aa73d1ad55561da847f01185; HEAD fbf81a51f04b275d672d4f13be01c31494fbc8cd; commits 893ed51, e0041c1, fe6643f, eb2545e, fbf81a5 (supplied by the parent, matching `git log c43b477..HEAD`); file list from `git diff --stat c43b477..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): production = HEAD fbf81a5 (`git diff HEAD -- packages apps` shows only spec files). Test files, sha256: `oidc.spec.ts` e4559a8aa2f425c7fbc211dd0ad8443e2fbebd24fa728d35981f7d2d27b149cb, `options.spec.ts` efeb09257fbc9bfa25dc3bcb89cdaa3d6ddee4249c6ff8514cd62bdca2221aff, `backend.oidc.spec.ts` 64142b8c7eeee7f7a24f2f9614beae63adfe3e33018e01ad90b81e5bb4e5fa11, `contract/src/index.spec.ts` 83642be98d236a530e632e69135fdc2f2d84d08ddbbf3f4bd40a907b07c2e5c3.
- Exact included files:
  - Backend: `src/auth/oidc/{flows,http,index,oidc,testing}.ts`, `src/connections/{errors,manager,options}.ts`, `src/index.ts`, `src/server/backend.ts`.
  - Contract: `src/{backend,conn,envelope,profiles}.ts`.
  - Desktop: `src/main/{handlers,index}.ts`, `src/oidc/{handlers,index}.ts`.
  - Excluded: specs, `test/integration/**` (incl. the fixture `test/integration/fixtures/oidc.ts`), `docs/ARCHITECTURE.md`, `reviews/**`. No renames or deletions.
  - `packages/backend/src/auth/oidc/testing.ts` is a test helper (FakeIdp) that lives in `src/`; it is measured but is not product behavior.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` (v8), Node 24.22.1. Full workspace suite in each case:
  - `packages/backend`: `npx vitest run --coverage --coverage.reportsDirectory=coverage/oidc-auth-tw-final3 --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=lcovonly --coverage.reporter=text-summary --coverage.include=<each backend file above>`.
  - `packages/contract` and `apps/desktop`: the same with `--coverage.reportsDirectory=coverage/oidc-auth-tw-final` and their file lists.
- Run start/completion time and exit status:
  - Backend: 04:23:54 to 04:24:12+01:00, 32 files / 1347 tests passed.
  - Contract: 04:21:44 to 04:21:45, all tests passed.
  - Desktop: 04:21:46 to 04:21:49, all tests passed.
  - All three commands exited successfully.
- Generated report paths and report hashes/run identifier:
  - `packages/backend/coverage/oidc-auth-tw-final3/`: coverage-summary.json 91214d7a5a25bad56eec265b8485ad70b2efae70bf92aeda117073b6e17f2088, coverage-final.json 0740d32fcada4e4706a8b12d6190d6d75fff7a55e37ef2335bfa903bbb4d180c, lcov.info 4ea2507aab1079c01e377b56eb385b7ebfb9d4a98c804fc682232815824ea2d1.
  - `packages/contract/coverage/oidc-auth-tw-final/coverage-summary.json` 19bd551c003177f1e0c0993a151df177e1b42d129df615d66e268f9807505ced.
  - `apps/desktop/coverage/oidc-auth-tw-final/coverage-summary.json` 7bfa01a4801f9d7b1a412321829250744b3c2cfb59f880ea3151befbe45d11c3.
  - All paths are git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: each run used a new report directory. Test file hashes were the same before (04:22:01) and after the final backend run.
- Final run after latest test additions and production fixes: yes. The fixer's production changes (fbf81a5) predate this pass; the backend run followed the last test edit. The contract and desktop inputs had not changed since their runs.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/auth/oidc/flows.ts` | 191/198 (96.46%) | 118/132 (89.39%) | 33/33 (100%) | 179/184 (97.28%) |
| `packages/backend/src/auth/oidc/http.ts` | 41/41 (100%) | 40/44 (90.9%) | 11/11 (100%) | 36/36 (100%) |
| `packages/backend/src/auth/oidc/oidc.ts` | 115/115 (100%) | 77/86 (89.53%) | 23/23 (100%) | 105/105 (100%) |
| `packages/backend/src/auth/oidc/index.ts` | N/A (re-exports only) | N/A | N/A | N/A |
| `packages/backend/src/auth/oidc/testing.ts` (test helper) | 44/45 (97.77%) | 11/17 (64.7%) | 15/16 (93.75%) | 35/36 (97.22%) |
| `packages/backend/src/connections/errors.ts` | 97/97 (100%) | 87/88 (98.86%) | 14/14 (100%) | 71/71 (100%) |
| `packages/backend/src/connections/manager.ts` | 258/259 (99.61%) | 140/141 (99.29%) | 48/48 (100%) | 224/224 (100%) |
| `packages/backend/src/connections/options.ts` | 109/109 (100%) | 112/113 (99.11%) | 8/8 (100%) | 98/98 (100%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/backend/src/server/backend.ts` | 45/50 (90%) | 11/12 (91.66%) | 16/20 (80%) | 42/45 (93.33%) |
| `packages/contract/src/backend.ts` | 5/5 (100%) | N/A | N/A | 5/5 (100%) |
| `packages/contract/src/conn.ts` | 10/10 (100%) | N/A | 1/1 (100%) | 10/10 (100%) |
| `packages/contract/src/envelope.ts` | 10/10 (100%) | N/A | N/A | 10/10 (100%) |
| `packages/contract/src/profiles.ts` | 23/23 (100%) | 3/4 (75%) | 2/2 (100%) | 23/23 (100%) |
| `apps/desktop/src/main/handlers.ts` | 18/18 (100%) | 10/10 (100%) | 6/6 (100%) | 15/15 (100%) |
| `apps/desktop/src/main/index.ts` | 0/72 (0%) | 0/30 (0%) | 0/29 (0%) | 0/65 (0%) |
| `apps/desktop/src/oidc/handlers.ts` | 23/23 (100%) | 12/12 (100%) | 3/3 (100%) | 21/21 (100%) |
| `apps/desktop/src/oidc/index.ts` | N/A (re-export only) | N/A | N/A | N/A |

Aggregates use summed provider counters:
- Backend, all 10 files incl. `testing.ts`: statements 901/915 (98.46%), branches 596/633 (94.15%), functions 168/173 (97.1%), lines 791/800 (98.87%).
- Contract, 4 files: statements 48/48 (100%), branches 3/4 (75%), functions 3/3 (100%), lines 48/48 (100%).
- Desktop, 4 files: statements 41/113 (36.28%), branches 22/52 (42.3%), functions 9/38 (23.68%), lines 36/101 (35.64%). This figure is dominated by the Electron entry `main/index.ts` (0%). The task added 6 lines to that file; the rest is pre-existing app bootstrap.
- No scoped file is missing from the reports. The re-export barrels have no executable statements (N/A).

Before this pass, the first backend run (`coverage/oidc-auth-tw1`) showed:
- statements 894/915, branches 594/633, functions 164/173, lines 784/800;
- `backend.ts` lines 62-72 (the OIDC environment wiring) uncovered;
- `options.ts` line 213 and `oidc.ts` line 312 uncovered.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/server/backend.ts:62-72` (before) | The authenticator reaches main (`oidc.openBrowser`, `oidc.saveTokens`) and broadcasts `oidc.prompt`; this is the path in the real app (the int test builds its own manager) | Added `backend.oidc.spec.ts` (5 tests); now covered |
| `packages/backend/src/connections/options.ts:213` (before) | `oidcTrustedEndpoint` with an unparseable connection string must not throw or invent hosts | Added "an unparseable connection string keeps the driver default"; now covered |
| `packages/backend/src/auth/oidc/oidc.ts:312` (before) | A cancel racing another failure must answer CANCELLED | Added "a cancel that races another failure answers CANCELLED"; now covered |
| `packages/backend/src/server/backend.ts:72` | The authenticator's `log` sink | Left uncovered: a one-line forwarder to the same `log` the manager uses; low risk |
| `packages/backend/src/server/backend.ts:44,87-88,132` | Not task code (pre-existing default log, `conn.status` broadcast, renderer wiring) | Out of scope |
| `packages/backend/src/auth/oidc/flows.ts:296-298` | `LoopbackReceiver.code()` when the redirect arrived before `code()` was called | Unreachable through `authCodeFlow`: `code()` is registered before the browser opens. Defensive code, left uncovered |
| `packages/backend/src/auth/oidc/flows.ts:395-396` | `abortableSleep` with an already aborted signal | Defensive; the cancel paths around it are tested ("an already aborted signal answers CANCELLED before asking the IdP", "cancelling while waiting between polls") |
| `packages/backend/src/auth/oidc/oidc.ts:158,246`; `http.ts:73` (branch) | IdP with a custom CA (`OidcEnvironment.ca`) | Exercised by the integration run (Keycloak fixture CA), which is not instrumented; left uncovered in the unit tests |
| `packages/backend/src/auth/oidc/oidc.ts:142,223,224,280,294,316,326`; `flows.ts` other branch sides; `http.ts:54,96,115` | `??` / optional-field fallbacks (default clock, missing optional token fields, https vs http request, missing status code) | Non-material fallbacks; left uncovered |
| `packages/backend/src/connections/errors.ts:186`, `manager.ts:322`, `options.ts:231`, `contract/src/profiles.ts:56` | Pre-existing branches not changed by the task | Out of scope |
| `apps/desktop/src/main/index.ts` (whole file) | Electron main wiring of `shell.openExternal` / `hasProfile` for the oidc handlers | Not unit-testable (Electron entry). The handlers it wires are fully covered. No criterion names an Electron run; follow-up only if the parent wants `npm run test:electron` evidence |
| `packages/backend/src/auth/oidc/testing.ts:41` etc. | Test helper (FakeIdp) error path | Test support code, not product behavior |

## Unable to test

- Electron main-process wiring (`apps/desktop/src/main/index.ts`: `shell.openExternal`, `profilesStore().has`) was not executed. It is only reachable in a running Electron app; `npm run test:electron` / `test:e2e` were not run because no acceptance criterion names them. Follow-up is optional; the auth UI task (auth-ui-m5) will drive this path.
- CR-2 (forgetting refused tokens) has no integration test against a real MongoDB refusal; it is covered by unit tests with the real `OidcAuthenticator` plus a fake IdP and by manager tests. A real-server refusal would need a Keycloak token for an identity that MongoDB rejects; this is not required by the acceptance criteria and is not needed for completion.

## Summary

Tests added and all validation passed. Task-scoped coverage is sufficient, and the remaining gaps are justified above. No production defects found.
