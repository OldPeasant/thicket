# Test Report

Date: 2026-11-17

Task: x509-proxy - M2: X.509, SOCKS5 proxy, read preference and write concern

Scope: `git diff df542a0a2fe259616953e8400d54e9374a1a1310..ceef14d541f2a94dc665d2400caabebd32069f0a`
(task commits 95ee3bc, 62a9668, ceef14d, supplied by the parent worker; HEAD = ceef14d, branch
`main`). The working tree had no uncommitted production changes. The only uncommitted changes are
the four test files listed below.

Requirements:
- `tasks/x509-proxy.md` acceptance criteria and its recorded ASSUMPTION notes (contract shape of
  `proxy`, `readPreferenceTags`, `writeConcern`, `tls.keyFile`, secret kind `proxyPassword`;
  X.509 always uses `$external`; unreadable separate key/cert file is `TLS_ERROR`; `UserNotFound`
  is `AUTH_FAILED` only while connecting; `ERR_OSSL_*` is `TLS_ERROR`)
- `docs/ARCHITECTURE.md` "Connections" (draft gets stored secrets only while connection string,
  auth, TLS, SSH and proxy settings equal the saved profile's) and "Coverage"
- `SPEC.md` (no secret values in renderer/logs), `AGENTS.md`, `docs/QUALITY.md`
- Parent worker instructions (focus areas: errors, manager `matchesSaved` proxy, options edge
  cases, contract schema)

## Test files changed

- `packages/backend/src/connections/errors.spec.ts`
- `packages/backend/src/connections/manager.spec.ts`
- `packages/backend/src/connections/options.spec.ts`
- `packages/contract/src/index.spec.ts`

All changes add tests. No existing test was changed, removed or skipped (`git diff --stat`: 645
insertions, 0 deletions). The only other edit was Prettier formatting of the new code.

## Tests added or updated

Count: 58 (errors.spec 18, manager.spec 12, options.spec 21, contract index.spec 7)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: X.509 user authenticates with generated client cert; wrong cert → AUTH_FAILED | int: `x509.int.spec.ts` (8 tests: bundle, explicit subject, encrypted bundle, separate cert/key, cert without user → AUTH_FAILED on test and open, wrong subject → AUTH_FAILED, foreign CA refused, wrong passphrase → TLS_ERROR). Unit support: `MONGODB-X509` blocks in options.spec (separate files, key file only → AUTH_FAILED, secretMode saved/ask never sends a password, URI user left to driver, accepted by `MongoClient` constructor with/without user), manager.spec `opens an X.509 profile from $external without sending the stored password`, `UserNotFound while opening/testing is AUTH_FAILED` | `npx vitest run --config test/integration/vitest.config.ts x509 proxy` (Docker); `cd packages/backend && npx vitest run src/connections/` | Pass |
| AC2: connection through a SOCKS5 container works | int: `proxy.int.spec.ts` "SOCKS5 proxy" (4 tests: connect with stored proxy password, conn.test, without proxy → DNS_ERROR, wrong proxy password not connected and not logged). Unit support: options.spec SOCKS5 block (no credentials without a user, DB password never used as proxy password, combined with DB auth, accepted by `MongoClient`), manager.spec proxy tests | same as above | Pass |
| AC3: secondaryPreferred routes reads to a secondary (`hello.me`) | int: `proxy.int.spec.ts` "read preference" (secondaryPreferred → secondary, primary default, tag sets) and "write concern" (w: 2, w: 3 unsatisfiable). Unit support: options.spec `read preference with tag sets and the write concern` (real `MongoClient` gets mode + tags + write concern), write-concern edge cases (w 0 / journal false / wtimeoutMS 0 kept, w omitted, custom name) | same as above | Pass |
| Draft with an `id` gets stored secrets only while proxy equals saved (ARCHITECTURE "Connections") | manager.spec: `a draft with an id and the same proxy (keys reordered) gets the stored proxy password`; `a draft with an id but another proxy host/port/user gets no stored secrets` (3); `a draft with an id that removes the proxy ...`; `a draft with an id that adds a proxy without user ...` | `cd packages/backend && npx vitest run src/connections/` | Pass |
| Proxy password never in logs or error messages | manager.spec `the proxy password never reaches log lines or the error message`; options.spec URI checks | same | Pass |
| `UserNotFound` is AUTH_FAILED only while connecting; SERVER_ERROR otherwise | errors.spec "UserNotFound (task x509-proxy)" (code 11, codeName, both; connecting true/false/default; selection-error and cause-chain; string code "11"; other errors unchanged); toConnectError message/detail test; manager.spec `UserNotFound on an open connection (serverInfo) stays SERVER_ERROR` | same | Pass |
| `ERR_OSSL_*` is TLS_ERROR | errors.spec "OpenSSL errors" (3 codes, wrapped cause, ranking vs AUTH/NETWORK, non-prefix code not TLS); toConnectError TLS prefix test | same | Pass |
| Separate cert/key files read by `clientConfig`; unreadable → TLS_ERROR | options.spec: no passphrase when none stored; unreadable cert file names file + ENOENT; directory as key file → TLS_ERROR (EISDIR); no file read while TLS off; key file without cert ignored | same | Pass |
| Contract: `proxy`, `readPreferenceTags` as `{name,value}` pairs (no free-form records), `writeConcern`, `tls.keyFile`, secret kind `proxyPassword` | contract index.spec "profile connection options (task x509-proxy)" (7 tests: proxy valid in profile and draft; port bounds 1/65535 and invalid values, empty host/user, no `password` key; `proxyPassword` accepted by `profiles.setSecret`; tag sets min 1, empty set allowed, empty name/records/extra keys/non-string rejected; write concern w/journal/wtimeoutMS bounds and unknown keys; keyFile non-empty; X.509 profile validates). The existing no-secrets and free-form contract walkers also cover the new schema. | `cd packages/contract && npx vitest run src/index.spec.ts` | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/connections/` (after the last addition: run as part of the coverage command below, 14 files / 673 tests)

`cd packages/contract && npx vitest run src/index.spec.ts` (329 tests)

Result:

Pass. One new test failed at first because its expectation was wrong: a server selection error that is not connecting ranks as TIMEOUT, which outranks SERVER_ERROR. I fixed the test. It did not show a production defect.

## Full test execution

Command:

`npm run check` (lint + Prettier + typecheck + root Vitest projects + renderer `ng test`), run on the final snapshot

`npx vitest run --config test/integration/vitest.config.ts x509 proxy` (Docker, integration)

Result:

Pass: lint and format clean, typecheck clean, root Vitest 48 files / 2989 tests passed, renderer 55
files / 1341 tests passed. Integration: 2 files / 18 tests passed (43.96 s).

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` because `package.json` exists. The final run on the final snapshot passed, in about 80 s for the first run and less for the final one.

## Bugs found

None. No production defect was found for the task's acceptance criteria or documented
assumptions.

## Coverage

Status: verified. I measured whole-file coverage for all four task-changed production TypeScript files. Changed-line coverage was derived by hand from the same lcov output.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: I intersected the new-side added lines of `git diff -U0 df542a0 ceef14d` for the four files with the `DA`/`BRDA` records in the fresh lcov reports. I counted by hand because the provider has no changed-line mode. Production files are unchanged since ceef14d, so the line numbers match. Executable changed lines: errors.ts 4/4, manager.ts 1/1, options.ts 34/34, profiles.ts 3/3, total 42/42 (100%). Branches on changed lines: errors.ts 10/10, manager.ts N/A (0), options.ts 35/36, profiles.ts N/A (0), total 45/46 (97.83%). The uncovered arm is options.ts:160, described below. Changed-branch coverage is only what these BRDA records show.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: x509-proxy; base `df542a0a2fe259616953e8400d54e9374a1a1310`; HEAD `ceef14d541f2a94dc665d2400caabebd32069f0a`; commits 95ee3bc, 62a9668, ceef14d supplied by the parent worker and checked against `git log df542a0..HEAD` and the task's acceptance criteria and notes.
- Source/test snapshot identifier (including uncommitted inputs): sha256 of the files. Production: errors.ts `7b7be33d…a2a1e`, manager.ts `df4fb8c0…da69`, options.ts `c9bb7513…6749`, profiles.ts `6b639526…bc29`. Uncommitted tests: errors.spec.ts `71b469e0…e1bdd`, manager.spec.ts `05115bc9…32e6`, options.spec.ts `7064d999…8144`, index.spec.ts `b2434178…b61bb`. The hashes were the same before the final coverage run and after the final `npm run check`.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/connections/errors.ts`, `packages/backend/src/connections/manager.ts`, `packages/backend/src/connections/options.ts`, `packages/contract/src/profiles.ts`. Excluded: `options.spec.ts` (test), `test/integration/**` (test fixtures and specs, not instrumented by the workspace configs), `docs/ARCHITECTURE.md`, `tasks/raw-cmd-read-pref.md` (docs/board), `packages/backend/package.json` and `package-lock.json` (dependency manifest only). No files were renamed or deleted.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` (workspace config `vitest.shared.ts`, reporters text-summary/json-summary/lcov, reports in `coverage/`).
  - `packages/backend`: `npx vitest run --coverage --coverage.include=src/connections/errors.ts --coverage.include=src/connections/manager.ts --coverage.include=src/connections/options.ts`. It ran all backend specs: 14 files, 673 tests.
  - `packages/contract`: `npx vitest run --coverage --coverage.include=src/profiles.ts`. It ran all contract specs: 4 files, 719 tests.
- Run start/completion time and exit status: backend started 2026-11-17 00:21:21 +01:00, report written 00:21:24, exit 0 with all tests passed. Contract started 00:21:29 +01:00, exit 0 with all tests passed.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-summary.json` sha256 `0d4533fb…acd3fe`, `packages/backend/coverage/lcov.info` sha256 `4433be8e…b7bce`. `packages/contract/coverage/coverage-summary.json` sha256 `e8337e6f…4001`, `packages/contract/coverage/lcov.info` sha256 `faa88545…5cde`.
- Evidence outputs are fresh and inputs stayed unchanged: yes. Vitest cleans `coverage/` on each run. The backend report hash changed from the earlier run, which came before the last test was added. The report contains only the included files. The input hashes were the same after the runs.
- Final run after latest test additions and production fixes: yes. There were no production fixes. The final coverage run came after the last test addition.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/connections/errors.ts` | 91/91 (100%) | 83/84 (98.81%) | 13/13 (100%) | 67/67 (100%) |
| `packages/backend/src/connections/manager.ts` | 164/165 (99.39%) | 90/91 (98.90%) | 35/36 (97.22%) | 141/142 (99.30%) |
| `packages/backend/src/connections/options.ts` | 80/80 (100%) | 84/85 (98.82%) | 5/5 (100%) | 72/72 (100%) |
| `packages/contract/src/profiles.ts` | 22/22 (100%) | 3/4 (75%) | 2/2 (100%) | 22/22 (100%) |
| Aggregate (summed counters, all 4 scoped files measured, none missing) | 357/358 (99.72%) | 260/264 (98.48%) | 55/56 (98.21%) | 302/303 (99.67%) |

Note on `profiles.ts`: zod schema declarations run at import time, so V8 line coverage says little about schema behavior. The new contract tests check the schema behavior instead.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/connections/options.ts:133` (write concern without `w`) | Profile write concern with only `journal`/`wtimeoutMS` | Covered after I added `leaves w to the server default when only journal or wtimeoutMS is set` (branch now 2/2) |
| `packages/backend/src/connections/options.ts:160` (`?? String(error)` arm in `readPem`) | Defensive fallback for a read error without an errno `code` | Not covered. `readFileSync` failures always carry a `code` (ENOENT, EISDIR and EACCES were exercised or are equivalent). This is a non-material gap. |
| `packages/backend/src/connections/errors.ts:181` (`?? 'Connection failed'` arm) | Fallback prefix for an error code without a prefix | Pre-existing line, not changed by this task. Every code that `classifyCode` returns has a prefix. Non-material. |
| `packages/backend/src/connections/manager.ts:63` (default `createClient` → real `MongoClient`) | Production wiring | Pre-existing line, not changed by this task. Unit tests inject a fake client, and the integration tests exercise the real driver path. |
| `packages/contract/src/profiles.ts:52` (`?? ''` arm in `hasPassword`) | Unreachable fallback (`split` always returns at least one element) | Pre-existing line, not changed by this task. Non-material. |

## Unable to test

- I did not test how the driver handles `readPreferenceTags` while `readPreference` is unset or `primary`. The contract comment says tags need a non-primary read preference, but neither the schema nor `clientConfig` enforces it. I could not probe the driver: an ad-hoc exploratory run was not permitted in this environment, and the requirement does not say what should happen (reject in the contract, or report the driver's error). If the `MongoClient` constructor throws there, `ConnectionManager.test()` would surface the raw error, because `createClient` runs outside its try block. That would be a pre-existing structural issue. Follow-up: the parent or the code-reviewer should decide whether to enforce this in the contract (for example in the `conn-ui-m2` form task).
- Duplicate tag names inside one tag set (`[{name:'dc',value:'a'},{name:'dc',value:'b'}]`) silently collapse to the last value. The requirements do not specify this case, so I wrote no test for it. Low risk.
- The renderer form fields for the new options are out of scope (task `conn-ui-m2`).

## Summary

I added tests, and all validation passed. Task-scoped coverage is sufficient and no production defects were found. `npm run check` and `.taskcheck` passed on the final snapshot, and the X.509 and proxy integration tests passed (18/18).
