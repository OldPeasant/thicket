# Test Report

Date: 2026-11-17

Task: aws-auth - M5: AWS IAM authentication (round 2, final revision)

Scope: final revision `ec1217934ed12fab2d28ad49f9fde716c80714fd` ("Merge origin/main (ssh-tunnel) into
aws-auth"). Task base `f6c3558cfc957963775e8799e1dc79f5c118716a` (round 1). Because the merge
brought in the whole ssh-tunnel task, the task's own changes were isolated as
`git diff ec12179^2 ec12179` (merged main side to final): production changes are exactly
`packages/backend/src/auth/aws/{aws.ts,index.ts}`, `packages/backend/src/connections/options.ts`
(import, `MONGODB-AWS` in `SUPPORTED_MECHANISMS`, the `awsAuthOptions` branch) and
`packages/backend/src/connections/errors.ts` (`MongoAWSError` in `AUTH_NAMES`), plus the
`@aws-sdk/credential-providers` dependency and `docs/ARCHITECTURE.md`. Since round 1
(`a53e280`), the task commits `3eaa142` (round-1 tests and reports) and `e8d2b94` (CR-2: comment-only
change in `aws.ts` and `docs/ARCHITECTURE.md`, fixer report) were added; the merge made `clientConfig`
take a `tunnel` argument (ssh-tunnel) and `ConnectionManager` open a tunnel before calling it.
Uncommitted inputs at measurement: only the two test files below (no production edits).

Requirements:
- `tasks/aws-auth.md` acceptance criteria (unit tests: option mapping for explicit keys and default
  chain; real Atlas verification is the human task `aws-verify`) and its two recorded assumptions
- `SPEC.md` M5 "AWS IAM (MONGODB-AWS): access key / secret / session token, or the default AWS
  credential chain"
- `docs/ARCHITECTURE.md` MONGODB-AWS paragraph (AUTH_FAILED rules, `$external`, secret masking),
  SSH tunnel notes and "Coverage" section
- Parent instructions (round 2): re-run focused tests, `npm run check` and task-scoped coverage on
  the final code; add tests only for gaps left by the merge (e.g. MONGODB-AWS with an SSH tunnel)

## Test files changed

Round 2 (uncommitted):
- `packages/backend/src/connections/options.spec.ts`
- `packages/backend/src/connections/manager.spec.ts`

Round 1 (committed in `3eaa142`, unchanged in round 2): `errors.spec.ts`, `manager.spec.ts`,
`options.spec.ts`; the task's own `packages/backend/src/auth/aws/aws.spec.ts` is unchanged.

## Tests added or updated

Count: round 2 adds 8 tests (0 existing tests changed); round 1 added 15 test definitions
(17 executed cases), still present and passing.

Round 2, the merge interaction of MONGODB-AWS with the SSH tunnel (all values fictitious):
- `options.spec.ts`, `describe('clientConfig MONGODB-AWS (task aws-auth)') > describe('through an SSH tunnel (after task ssh-tunnel)')`:
  - `combines the tunnel proxy with the AWS options; the driver accepts both` (the tunnel's
    `proxyPassword` does not clash with the AWS credential provider; real `MongoClient` constructor
    keeps proxy options and `MONGODB-AWS`/`$external` credentials)
  - `default chain through a tunnel: proxy options only, no credential provider`
  - `needs the open tunnel before any AWS check` (`INTERNAL`, not `AUTH_FAILED`)
  - `a missing AWS secret is still AUTH_FAILED with a tunnel`
- `manager.spec.ts`, `describe('ConnectionManager MONGODB-AWS through an SSH tunnel (task aws-auth, after ssh-tunnel)')`:
  - `open: the driver gets the tunnel proxy and the AWS credential provider together` (tunnel closed
    once with the connection)
  - `open: a missing AWS secret after the tunnel opened is AUTH_FAILED and closes the tunnel` (no
    client created, status `error`/`AUTH_FAILED`)
  - `test: a user name in the connection string is AUTH_FAILED and closes the tunnel`
  - `test: a MongoAWSError through the tunnel is AUTH_FAILED, masked, and the tunnel is closed`

Round 1 tests are listed in the round-1 report (commit `3eaa142`): `MongoAWSError` classification
(7 cases), manager MONGODB-AWS flow (7), `clientConfig` MONGODB-AWS edge cases (3).

## Requirement coverage

Command for all rows marked Pass:
`cd packages/backend && npx vitest run src/auth/aws src/connections/options.spec.ts src/connections/manager.spec.ts src/connections/errors.spec.ts`

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: option mapping for explicit keys (key ID = user name, secret typed or saved, optional saved session token, `$external`, provider not `auth`) | `aws.spec.ts` "explicit keys" (task's own); `options.spec.ts` "maps MONGODB-AWS explicit keys ...", "replaces another authSource ...", "keeps appName, TLS and proxy ...", "combines the tunnel proxy with the AWS options ..."; `manager.spec.ts` round-1 MONGODB-AWS block, "open: the driver gets the tunnel proxy and the AWS credential provider together" | focused command above | Pass |
| AC1: option mapping for the default chain (mechanism + `$external`, no provider, no secrets) | `aws.spec.ts` "default credential chain"; `options.spec.ts` "maps MONGODB-AWS without an access key ID ...", "default chain through a tunnel ..."; `manager.spec.ts` "default chain: no provider and no secrets are passed; ..." | focused command above | Pass |
| A user name in the connection string / a missing secret is AUTH_FAILED before the driver (ARCHITECTURE), also with an SSH tunnel, and the tunnel is not leaked | `aws.spec.ts`, `options.spec.ts` "answers AUTH_FAILED for a user name ...", "a missing AWS secret is still AUTH_FAILED with a tunnel", "needs the open tunnel before any AWS check"; `manager.spec.ts` "open: a missing AWS secret after the tunnel opened ...", "test: a user name in the connection string ... closes the tunnel" | focused command above | Pass |
| `MongoAWSError` (also nested) is AUTH_FAILED (errors.ts change) | `errors.spec.ts` "MongoAWSError (task aws-auth)" (7 cases); `manager.spec.ts` "default chain: ... a chain failure is AUTH_FAILED", "test: a MongoAWSError through the tunnel ..." | focused command above | Pass |
| AWS secrets never reach logs, error messages or status | `manager.spec.ts` "open: the stored secret and token never reach ...", "test: a typed secret is used and masked ...", "test: a MongoAWSError through the tunnel is AUTH_FAILED, masked ..."; `errors.spec.ts` "toConnectError ... removes secret values" | focused command above | Pass |
| AC2: real Atlas verification | none (human task `aws-verify`) | not run | Not testable: needs Atlas / a real AWS IAM setup, which the task assigns to humans |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/auth/aws src/connections/options.spec.ts src/connections/manager.spec.ts src/connections/errors.spec.ts`

Result:

Pass: 4 files, 252 tests (2026-11-17 03:20 +0100, on the final test snapshot).

## Full test execution

Command:

`npm run check` (repository root: `npm run lint && npm run typecheck && npm run test`)

Result:

Pass (2026-11-17 03:20-03:21 +0100, final snapshot): the `&&` chain reached its last stage, so
ESLint/Prettier and all workspace type checks passed; root Vitest 61 files / 3424 tests passed;
renderer `ng test` 72 files / 2154 tests passed; no npm error output. `npm run lint` was also run
on its own afterwards: ESLint clean, "All matched files use Prettier code style!".

Integration tests (`npm run test:int`) were not run: the acceptance criteria are unit tests only,
and there is no MONGODB-AWS container fixture (real AWS is the human task `aws-verify`).

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, which passed on the final snapshot above.

## Bugs found

None. No test failed against the final production code. The merge composes correctly: tunnel
proxy options and AWS options coexist in the driver options, and an AUTH_FAILED raised by
`awsAuthOptions` after the tunnel is open closes the tunnel in both `open` and `test`.

Observation carried over from round 1 (not a defect against any stated requirement): a typed
`password` of `''` wins over a saved `awsSecretAccessKey` (`??` keeps empty strings); the driver
then refuses with `MongoMissingCredentialsError` (AUTH_FAILED), as on the SCRAM path.

## Coverage

Status: verified (fresh run on the final source/test snapshot, exit 0, all tests passed).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured by intersecting `lcov.info` `DA` records with the added/modified
lines of `git diff -U0 ec12179^2 ec12179` (task changes relative to the merged main): 17/17
executable changed lines hit (100%): `aws.ts` 12/12 (new file), `options.ts` lines 24, 62, 63, 64 =
4/4, `errors.ts` line 53 = 1/1 (import line, the remaining lines of the `SUPPORTED_MECHANISMS`
literal and comments carry no `DA` record). Changed-branch coverage was not computed.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `aws-auth`;
  base `f6c3558cfc957963775e8799e1dc79f5c118716a`; measured HEAD
  `ec1217934ed12fab2d28ad49f9fde716c80714fd`; task-owned changes isolated with
  `git diff ec12179^2 ec12179` (the merge's main parent is `5ae4d00`), which lists the same four
  production files as round 1 plus dependency manifests, docs, tests and reviews.
- Source/test snapshot identifier (including uncommitted inputs): HEAD `ec12179` plus uncommitted
  `options.spec.ts` and `manager.spec.ts`; sha256: `aws.ts` b360cae168ba...eea6c, `index.ts`
  cc9b2a397109...a6dd, `options.ts` 11e999ce1f28...0a00, `errors.ts` 4d2b910e231b...f895,
  `aws.spec.ts` 04a7b08a365b...7238, `options.spec.ts` 87bb45db4305...3874, `errors.spec.ts`
  4a153c7409e4...19ae, `manager.spec.ts` 5cb2d9486401...f96f (taken 03:20:11, rechecked identical
  after the coverage run).
- Exact included files; renamed/deleted/excluded files and reasons: included
  `packages/backend/src/auth/aws/aws.ts`, `packages/backend/src/auth/aws/index.ts`,
  `packages/backend/src/connections/options.ts`, `packages/backend/src/connections/errors.ts`.
  Excluded: `*.spec.ts` (tests), `docs/ARCHITECTURE.md` (documentation), `packages/backend/package.json`
  and `package-lock.json` (manifests), `reviews/` (reports). Files changed by the merged ssh-tunnel
  task (`manager.ts`, `ssh/*`, `server/*`, contract) are not task-owned and are excluded. No renames
  or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with
  `@vitest/coverage-v8`; `npx vitest run --coverage --coverage.include='src/auth/aws/aws.ts'
  --coverage.include='src/auth/aws/index.ts' --coverage.include='src/connections/options.ts'
  --coverage.include='src/connections/errors.ts'` in `packages/backend`; test selection: the whole
  backend workspace (26 files, 1084 tests).
- Run start/completion time and exit status: start 2026-11-17 03:22:08 +0100, completed 03:22:34
  +0100; all 1084 tests passed, coverage summary printed (exit 0).
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-summary.json`
  sha256 3f2d7efa5bb0b9e1cf89fc5717028be0af83db3f94692f7eb645df2cace37766;
  `packages/backend/coverage/lcov.info` sha256
  8573c8a0847c69ab5d6a7b45583700828f720c3be53fe8d79db1d509c83d6a74; `packages/backend/coverage/lcov-report/`
  (all Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: yes. All report files have mtime 03:22:34,
  after the run start; their hashes differ from the round-1 reports; the summary contains exactly the
  four scoped files; the snapshot hashes were identical before and after.
- Final run after latest test additions and production fixes: yes (run after the last test edit; no
  production changes were made in round 2).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/auth/aws/aws.ts` | 14/14 (100%) | 14/14 (100%) | 2/2 (100%) | 12/12 (100%) |
| `packages/backend/src/auth/aws/index.ts` | N/A (0/0, re-export only) | N/A | N/A | N/A |
| `packages/backend/src/connections/options.ts` | 86/86 (100%) | 96/97 (98.97%) | 5/5 (100%) | 78/78 (100%) |
| `packages/backend/src/connections/errors.ts` | 91/91 (100%) | 83/84 (98.81%) | 13/13 (100%) | 67/67 (100%) |
| Aggregate (summed counters, all 4 scoped files measured, none missing) | 191/191 (100%) | 193/195 (98.97%) | 20/20 (100%) | 157/157 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/connections/errors.ts:182` (`PREFIX[code] ?? 'Connection failed'`, fallback arm) | Defensive fallback; every code `classifyCode` returns has a prefix | Not changed by this task; unreachable without a new error code. No test added |
| `packages/backend/src/connections/options.ts:187` (`readPem`: `?? String(error)` for an error without `code`; line 169 in round 1, moved by the merge) | TLS file read error without a Node error code (task x509-proxy) | Not changed by this task; no AWS behavior. No test added |

## Unable to test

- Real MONGODB-AWS authentication against Atlas or AWS STS (explicit keys, session token, default
  chain sources), also through a real SSH tunnel: needs real AWS/Atlas, assigned to the human task
  `aws-verify`. Follow-up: that task.
- The driver's own default chain failing at run time (it would reach the EC2 instance metadata
  endpoint) was not run, to keep tests offline and deterministic; the wrapping is reproduced with
  the real driver class `MongoAWSError` (round 1).

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production
defects found.
