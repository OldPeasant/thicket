# Test Report

Date: 2026-11-17

Task: aws-auth - M5: AWS IAM authentication

Scope: task commits on `main`, base `f6c3558cfc957963775e8799e1dc79f5c118716a`, measured HEAD
`a53e280717bede8a7501290892c56be39584d886` (`git diff f6c3558..a53e280`). The parent named the task
commit `5cb24af8a5660d172d196a5de5308d2b18f2a59e`; `a53e280` is its rebased copy with the identical
`git patch-id` (`cec01833c1c9b31d6d7f4ce72fbf57b88df7c570` for both). The other two commits in the range
(`42c134d`, `00b7787`) only touch `tasks/aws-auth.md`. Production changes: new
`packages/backend/src/auth/aws/{aws.ts,index.ts}`, modified `packages/backend/src/connections/options.ts`
and `packages/backend/src/connections/errors.ts`, plus the `@aws-sdk/credential-providers` dependency
(`packages/backend/package.json`, `package-lock.json`) and a `docs/ARCHITECTURE.md` note.
Uncommitted inputs at measurement: only the three test files below (no production edits).

Requirements:
- `tasks/aws-auth.md` acceptance criteria (unit tests: option mapping for explicit keys and default
  chain; real Atlas verification is the human task `aws-verify`) and its two recorded assumptions
- `SPEC.md` M5 "AWS IAM (MONGODB-AWS): access key / secret / session token, or the default AWS
  credential chain"; "AWS IAM needs Atlas or a real AWS setup: a human-verified task"
- `docs/ARCHITECTURE.md` MONGODB-AWS paragraph (AUTH_FAILED rules, `$external`, secret masking) and
  "Coverage" section
- Parent instructions: cover `MongoAWSError` classification incl. nested cause, and the
  manager-level flow (stored `awsSecretAccessKey`/`awsSessionToken` reach the provider and are masked
  in logs)

## Test files changed

- `packages/backend/src/connections/errors.spec.ts`
- `packages/backend/src/connections/manager.spec.ts`
- `packages/backend/src/connections/options.spec.ts`

The task's own `packages/backend/src/auth/aws/aws.spec.ts` and its changes to `options.spec.ts` were
reviewed and left unchanged.

## Tests added or updated

Count: 15 new test definitions (17 executed cases), 0 existing tests changed.

- `errors.spec.ts`, `describe('MongoAWSError (task aws-auth)')` (uses the real driver class
  `MongoAWSError` from `mongodb` 7.9.0, built with a `cause` like `aws_temporary_credentials.js` does):
  - `the real driver class is AUTH_FAILED, with and without connecting`
  - `is found as the cause of a wrapping driver error` (one and two wrapper levels)
  - `is found in the servers of a server selection failure (outranks its TIMEOUT)`
  - `outranks a network cause inside it: %s` (ECONNREFUSED, ETIMEDOUT, ENOTFOUND; 3 cases)
  - `toConnectError answers AUTH_FAILED with its prefix and removes secret values`
- `manager.spec.ts`, `describe('ConnectionManager MONGODB-AWS (task aws-auth)')`:
  - `open: the stored secret access key and session token reach the credential provider`
  - `open: the stored secret and token never reach log lines, the error or the status`
  - `test: a typed secret is used and masked in the logs, and wins over the stored one`
  - `secretMode 'ask': the stored secret access key is not used; the typed one is`
  - `a saved access key ID without a stored secret answers AUTH_FAILED before creating a client`
  - `default chain: no provider and no secrets are passed; a chain failure is AUTH_FAILED`
  - `a draft with an id and the same AWS auth gets the stored secret; another key ID gets none`
- `options.spec.ts`, `describe('clientConfig MONGODB-AWS (task aws-auth)')`:
  - `answers AUTH_FAILED for a user name in the connection string, before the driver sees it`
  - `replaces another authSource, also one in the connection string, with $external` (real
    `MongoClient` constructor checks `credentials.source`)
  - `keeps appName, TLS and proxy options next to the AWS options` (real `MongoClient` accepts them;
    the secret is not in the driver's serialized credentials)

All values are fictitious (`AKIAFICTITIOUS...`, `fictitious/aws+Secret+...`).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: option mapping for explicit keys (key ID = user name, secret typed or saved, optional saved session token, `$external`, provider not `auth`) | `aws.spec.ts` "explicit keys" (7, task's own); `options.spec.ts` "maps MONGODB-AWS explicit keys ..." (task's own), "replaces another authSource ...", "keeps appName, TLS and proxy ..."; `manager.spec.ts` "open: the stored secret access key and session token ...", "test: a typed secret ...", "secretMode 'ask' ...", "a saved access key ID without a stored secret ...", "a draft with an id and the same AWS auth ..." | `cd packages/backend && npx vitest run src/connections/errors.spec.ts src/connections/manager.spec.ts src/connections/options.spec.ts src/auth/aws` | Pass |
| AC1: option mapping for the default chain (no user name: mechanism + `$external` only, no provider, no secrets; driver can load `@aws-sdk/credential-providers`) | `aws.spec.ts` "default credential chain" (2, task's own); `options.spec.ts` "maps MONGODB-AWS without an access key ID ..." (task's own); `manager.spec.ts` "default chain: no provider and no secrets are passed; ..." | same command | Pass |
| A user name in the connection string is AUTH_FAILED (ARCHITECTURE) | `aws.spec.ts` "answers AUTH_FAILED for a user name in the connection string"; `options.spec.ts` "answers AUTH_FAILED for a user name in the connection string, before the driver sees it" | same command | Pass |
| A chain without credentials (`MongoAWSError`) is AUTH_FAILED, also nested (ARCHITECTURE, errors.ts change) | `errors.spec.ts` "MongoAWSError (task aws-auth)" (7 cases); `manager.spec.ts` "default chain: ... a chain failure is AUTH_FAILED" | same command | Pass |
| Stored/typed AWS secrets never reach logs, error messages or status (AGENTS/ARCHITECTURE secret rules) | `manager.spec.ts` "open: the stored secret and token never reach ...", "test: a typed secret is used and masked ..."; `errors.spec.ts` "toConnectError answers AUTH_FAILED ... removes secret values" | same command | Pass |
| AC2: real Atlas verification | none (human task `aws-verify`) | not run | Not testable: needs Atlas / a real AWS IAM setup, which the task assigns to humans |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/connections/errors.spec.ts src/connections/manager.spec.ts src/connections/options.spec.ts src/auth/aws`

Result:

Pass (4 files, 229 tests; run before the final formatting pass). The final coverage run below
re-executed all of these files on the final test snapshot: 21 files, 960 tests, all passed.

## Full test execution

Command:

`npm run check` (repository root; lint + Prettier, type check of all workspaces, root Vitest
projects and renderer `ng test`)

Result:

Pass, final run at 2026-11-17 03:15 +0100 on the final snapshot: ESLint and Prettier clean, all
workspace type checks passed, Vitest 56 files / 3292 tests passed, renderer 72 files / 2154 tests
passed, followed by the success marker. An earlier run in this session failed on my own test code
(Prettier formatting of two new test blocks, then TS2322 for an `unknown` `cause` parameter in
`errors.spec.ts`); both were fixed in the tests before the final run.

Integration tests (`npm run test:int`) were not run: the acceptance criteria are unit tests only,
and there is no MONGODB-AWS container fixture (real AWS is the human task `aws-verify`).

## .taskcheck

Result:

Pass. `.taskcheck` is `if [ -f package.json ]; then npm run check; ...`, so the final
`npm run check` run above is its command.

## Bugs found

None. No test failed against the production code.

Observation, not a defect against any stated requirement: in `awsAuthOptions` a typed `password` of
`''` wins over a saved `awsSecretAccessKey` (`??` keeps empty strings), and the driver then refuses
with `MongoMissingCredentialsError`, which is classified `AUTH_FAILED`. This matches how the
SCRAM path treats a typed empty password, so no test was written to change it.

## Coverage

Status: verified (fresh run on the final source/test snapshot, exit 0).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured separately by intersecting the provider's `lcov.info` `DA` records
with the added/modified lines of `git diff -U0 f6c3558 a53e280`: 17/17 executable changed lines hit
(100%): `aws.ts` 12/12 (new file), `options.ts` lines 23, 50, 51, 52 = 4/4, `errors.ts` line 53 = 1/1;
the `import` line and comments are not executable. Changed-branch coverage was not computed; for
information, both arms of the provider branch records on the changed `options.ts` lines 50 and 52 were hit.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `aws-auth`; base
  `f6c3558cfc957963775e8799e1dc79f5c118716a` (from the parent); measured HEAD
  `a53e280717bede8a7501290892c56be39584d886`; task code commit `a53e280` (= `5cb24af` named by the
  parent, same patch-id); file scope from `git diff --stat f6c3558..HEAD`, which matches the parent's
  list.
- Source/test snapshot identifier (including uncommitted inputs): HEAD `a53e280` plus uncommitted test
  files, sha256: `aws.ts` d0f7d310cc60...4e1d, `index.ts` cc9b2a397109...a6dd, `options.ts`
  f54f3bfad451...4022, `errors.ts` 4d2b910e231b...f895, `aws.spec.ts` 04a7b08a365b...7238,
  `options.spec.ts` 6eac308d8264...1f09, `errors.spec.ts` 4a153c7409e4...19ae, `manager.spec.ts`
  3e85ee46ab34...b802 (taken at 03:16:04, rechecked unchanged at 03:16:21).
- Exact included files; renamed/deleted/excluded files and reasons: included
  `packages/backend/src/auth/aws/aws.ts`, `packages/backend/src/auth/aws/index.ts`,
  `packages/backend/src/connections/options.ts`, `packages/backend/src/connections/errors.ts`. Excluded:
  `*.spec.ts` (tests), `docs/ARCHITECTURE.md` (documentation), `packages/backend/package.json` and
  `package-lock.json` (dependency manifests, no executable code). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with
  `@vitest/coverage-v8` 5.1.0; `npx vitest run --coverage --coverage.include='src/auth/aws/aws.ts'
  --coverage.include='src/auth/aws/index.ts' --coverage.include='src/connections/options.ts'
  --coverage.include='src/connections/errors.ts'` in `packages/backend` (the form from
  `docs/ARCHITECTURE.md` "Coverage"); test selection: the whole backend workspace (21 files, 960 tests).
- Run start/completion time and exit status: start 2026-11-17 03:16:06 +0100, reports written
  03:16:17 +0100; exit 0 (all tests passed).
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-summary.json`
  sha256 e6974d935622c17c7f032dd9c9233641dbcb4f249592b8cf7c240d1b93b3691a;
  `packages/backend/coverage/lcov.info` sha256
  8ce77a2dedb83a390378ddfab414095f074492123a058b80bb2221000396d298; `packages/backend/coverage/lcov-report/`
  (all Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: yes. Vitest cleaned the directory (an older
  `doc-paging/` subfolder from another run disappeared), every report file has an mtime after the run
  start, and the snapshot hashes were identical before and after. A first coverage run at 03:11
  (before the formatting/type fix of the tests) produced byte-identical reports.
- Final run after latest test additions and production fixes: yes (no production fixes were made;
  the run is after the last test edit).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/auth/aws/aws.ts` | 14/14 (100%) | 14/14 (100%) | 2/2 (100%) | 12/12 (100%) |
| `packages/backend/src/auth/aws/index.ts` | N/A (0/0, re-export only) | N/A | N/A | N/A |
| `packages/backend/src/connections/options.ts` | 82/82 (100%) | 86/87 (98.85%) | 5/5 (100%) | 74/74 (100%) |
| `packages/backend/src/connections/errors.ts` | 91/91 (100%) | 83/84 (98.8%) | 13/13 (100%) | 67/67 (100%) |
| Aggregate (summed counters, all 4 scoped files measured, none missing) | 187/187 (100%) | 183/185 (98.91%) | 20/20 (100%) | 153/153 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/connections/errors.ts:182` (`PREFIX[code] ?? 'Connection failed'`, fallback arm) | Defensive fallback; every code `classifyCode` can return has a prefix | Not changed by this task; unreachable without a new error code. No test added |
| `packages/backend/src/connections/options.ts:169` (`readPem`: `?? String(error)` for an error without `code`) | TLS file read error without a Node error code (task x509-proxy) | Not changed by this task; no AWS behavior. No test added |

## Unable to test

- Real MONGODB-AWS authentication against Atlas or AWS STS (explicit keys, session token, default
  chain sources such as environment, SSO, profile and instance role): needs real AWS/Atlas, which is
  out of reach here and assigned to the human task `aws-verify`. Follow-up: that task.
- The driver's own default chain failing at run time (it would reach the EC2 instance metadata
  endpoint over the network) was not run, to keep the tests deterministic and offline. The wrapping
  the driver applies (`MongoAWSError` with the SDK error as `cause`) is reproduced with the real
  driver class instead.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production
defects found.
