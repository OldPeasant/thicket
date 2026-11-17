# Test Report

Date: 2026-11-17

Task: ldap-auth - M5: LDAP (PLAIN) authentication

Scope: the single task commit. The parent supplied `93bacf787695d90ecc1f72683133558d28f562b7`
(parent `39fbf78`); the working tree's HEAD holds the rebased equivalent
`5e7459187d3ec4edcd17a744b835496507aa96da` (parent `0522253`, two `assume:` commits on top of
`39fbf78`). Both have the same `git patch-id` (`a612a83a06c5daf61c82d5c5bf98c105e08acc19`) and
`git diff 93bacf7 5e74591 -- packages test docs` is empty, so the measured code is the task's code.
Production files in the commit: `packages/backend/src/auth/ldap/ldap.ts` (new),
`packages/backend/src/auth/ldap/index.ts` (new, re-export),
`packages/backend/src/connections/options.ts` (import, `PLAIN` in `SUPPORTED_MECHANISMS`, the
`ldapAuthOptions` branch). Test-only/fixture files: `ldap.spec.ts`, `options.spec.ts`,
`test/integration/fixtures/ldap.ts`, `test/integration/ldap.int.spec.ts`; docs: `docs/ARCHITECTURE.md`.
Uncommitted inputs at measurement: only the three test files listed below (no production edits).

Requirements:
- `tasks/ldap-auth.md` acceptance criterion: "Integration test: LDAP user authenticates; wrong
  password → AUTH_FAILED (Enterprise + OpenLDAP fixtures)", plus its two recorded assumptions
  (PLAIN always uses `$external`; fixture images and LDAP setup)
- `SPEC.md` "Must LDAP (PLAIN) — needs MongoDB Enterprise or Atlas"; test fixtures "MongoDB Enterprise + OpenLDAP for LDAP"
- `docs/ARCHITECTURE.md` LDAP paragraph (user from profile else URI, `password` secret, `$external`,
  AUTH_FAILED rules) and "Coverage" section
- Parent instructions (unit + integration review, task-scoped coverage for `src/auth/ldap` and `options.ts`)

## Test files changed

- `packages/backend/src/auth/ldap/ldap.spec.ts`
- `packages/backend/src/connections/options.spec.ts`
- `test/integration/ldap.int.spec.ts`

## Tests added or updated

Count: 9 new test cases (1 in `ldap.spec.ts`; 6 in `options.spec.ts`, one of them an `it.each`
with 3 rows; 2 in `ldap.int.spec.ts`) and one helper extended (`ldapProfile` takes `authSource`).
No existing test was changed in behavior, weakened or skipped.

- `ldapAuthOptions` › uses the password typed at connect with secretMode 'ask'
- `clientConfig` › PLAIN: the driver resolves the decoded URI user against $external, overriding
  URI auth options (percent-encoded `carol%40corp.example.test`, URI `authSource=admin` and
  `authMechanism=SCRAM-SHA-256`; checks the real `MongoClient(...).options.credentials`)
- `clientConfig` › PLAIN: keeps the TLS options next to the LDAP credentials
- `clientConfig` › PLAIN: answers AUTH_FAILED with no password / secretMode 'none' / no user name
  anywhere (message never contains the password)
- `clientConfig` › PLAIN: an unparseable connection string without a profile user is AUTH_FAILED, not a crash
- Integration › authenticates against $external even with authSource/authMechanism set elsewhere
  (profile `authSource: 'admin'` and URI `authSource=admin&authMechanism=SCRAM-SHA-256`, against the
  real Enterprise server; confirms the `$external` assumption end to end)
- Integration › answers AUTH_FAILED for a wrong password typed at connect (secretMode ask), not in
  the message or logs

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC: LDAP user authenticates (Enterprise + OpenLDAP) | `ldap.int.spec.ts`: authenticates an LDAP user with the saved password; authenticates with the password typed at connect (secretMode ask); takes the user name from the connection string; authenticates against $external even with authSource/authMechanism set elsewhere | `npm run test:int -- ldap` (Podman, `mongodb/mongodb-enterprise-server:8.0-ubuntu2204` + `osixia/openldap:1.5.0`) | Pass (8/8) |
| AC: wrong password → AUTH_FAILED | `ldap.int.spec.ts`: answers AUTH_FAILED for a wrong password, without logging it; answers AUTH_FAILED for a wrong password typed at connect (secretMode ask); answers AUTH_FAILED for a user the directory does not know | `npm run test:int -- ldap` | Pass |
| No password / `secretMode: 'none'` / no user → AUTH_FAILED (ARCHITECTURE) | `ldap.spec.ts` AUTH_FAILED cases; `options.spec.ts` PLAIN AUTH_FAILED `it.each` + unparseable URI case; integration "without a password, before connecting" | `npx vitest run --root packages/backend src/auth/ldap src/connections`; `npm run test:int -- ldap` | Pass |
| Always `$external` (task assumption) | `ldap.spec.ts` "always uses $external"; `options.spec.ts` mapping + driver-credentials test; integration authSource/authMechanism override test | both commands above | Pass |
| User from profile, else connection string (decoded) | `ldap.spec.ts` URI/profile precedence; `options.spec.ts` decoded URI user; integration "takes the user name from the connection string" | both commands above | Pass |
| Passwords never in URI, error messages or logs | `options.spec.ts` (URI, messages); integration wrong-password tests (message, logs), saved-password test (logs) | both commands above | Pass |

## Focused test execution

Command:

`npx vitest run --root packages/backend src/auth/ldap src/connections` (repo root)

Result:

Pass: 5 files, 261 tests (254 before the additions).

`npm run test:int -- ldap` (repo root, Podman socket via `DOCKER_HOST`)

Result:

Pass: 1 file, 8 tests (6 before the additions), ~13 s.

## Full test execution

Command:

`npx vitest run --coverage --coverage.include=...` in `packages/backend` (whole backend workspace,
see Coverage) and `npm run check` via `.taskcheck`

Result:

Pass: backend 29 files / 1175 tests; `npm run check`: lint and typecheck passed, root Vitest 64 files /
3515 tests passed, renderer 72 files / 2154 tests passed. The full integration suite (`npm run test:int`
without a filter) was not run; only the LDAP file, which is what the criterion names.

## .taskcheck

Result:

Pass (`sh .taskcheck` → `npm run check`, run on the working tree with the new tests).

## Bugs found

None. No production defect was found; all new tests passed against the task code without changes.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: 9/9 executable changed lines (100%). Method: `lcov.info` `DA` entries of the
same run intersected with the commit's added lines: `ldap.ts` is new (all 7 `DA` lines are added
lines, all hit); in `options.ts` the added lines 8 (import) and 31 (`'PLAIN'` set element, part of
the statement at line 25, hit 17) have no `DA` entry of their own, lines 66 (hit 276) and 67 (hit 7)
are both hit. Changed-branch coverage was not separately measured (the only uncovered branch in
scope is on a pre-existing line, below).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `ldap-auth`;
  base `39fbf78` (parent of the supplied `93bacf7`); measured HEAD `5e7459187d3ec4edcd17a744b835496507aa96da`
  (rebased, same patch-id as `93bacf7`); scope from the parent's file list, confirmed with
  `git show --stat 93bacf7`.
- Source/test snapshot identifier (including uncommitted inputs): sha256 `ldap.ts` b3454443…6d82,
  `index.ts` d3ca3386…9712, `options.ts` 9ac8e42d…969f, `ldap.spec.ts` 0e6fed82…be0,
  `options.spec.ts` caa443a1…cf1, `ldap.int.spec.ts` c7a7291b…244e, `fixtures/ldap.ts` 34450df9…2dba;
  identical before and after the coverage run.
- Exact included files; renamed/deleted/excluded files and reasons: included
  `src/auth/ldap/ldap.ts`, `src/auth/ldap/index.ts`, `src/connections/options.ts` (workspace
  `packages/backend`). Excluded: `test/integration/fixtures/ldap.ts` and the spec files (test code),
  `docs/ARCHITECTURE.md` (documentation). No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0 with
  Vitest 5.1.0; `npx vitest run --coverage --coverage.include='src/auth/ldap/ldap.ts'
  --coverage.include='src/auth/ldap/index.ts' --coverage.include='src/connections/options.ts'` in
  `packages/backend`; all backend unit tests (the integration test is not instrumented; it runs the
  built `@thicket/backend` in another Vitest project).
- Run start/completion time and exit status: started 2026-11-17 03:34:54 +01:00, reports written
  03:35:16; all 1175 tests passed, coverage summary printed (exit 0).
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-summary.json`
  (sha256 426f6ddd6376d95fd8eee9b706c5abcd84181e8ccaaabd216e7746abbcab322d),
  `packages/backend/coverage/lcov.info` (sha256
  323957aff5ebf895d1c501c3e4ea1154d7562de17e9094dd8ed5d4fd66eebc1f), `coverage/lcov-report/`; git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: report mtimes 03:35:16 fall inside this
  run; the summary contains exactly the three included files; input hashes unchanged after the run.
- Final run after latest test additions and production fixes: yes (no production fixes were made;
  the run includes all added tests).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/auth/ldap/ldap.ts` | 7/7 (100%) | 8/8 (100%) | 1/1 (100%) | 7/7 (100%) |
| `packages/backend/src/auth/ldap/index.ts` | N/A (0/0, re-export only) | N/A | N/A | N/A |
| `packages/backend/src/connections/options.ts` | 88/88 (100%) | 98/99 (98.99%) | 5/5 (100%) | 80/80 (100%) |
| Aggregate (summed counters, all 3 files measured, none missing) | 95/95 (100%) | 106/107 (99.07%) | 6/6 (100%) | 87/87 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/connections/options.ts:191` (`BRDA:191,48,1,0`, `?? String(error)` in `readPem`) | Pre-existing TLS PEM read error fallback for an error without `code`; not part of this task | Left uncovered: outside the task's changes, not reachable with ordinary `readFileSync` errors |

## Unable to test

- Atlas LDAP is not tested here (no Atlas access); the criterion names only the Enterprise + OpenLDAP fixtures, which ran.
- LDAP over TLS (`ldapTransportSecurity tls`) and LDAP authorization queries are not exercised; the
  task assumption records the fixture as plain LDAP with user-to-DN mapping and roles from `$external`.
  No follow-up needed for this criterion.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found.
