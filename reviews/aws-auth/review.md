# Code Review

Date: 2026-11-17

Task: aws-auth - M5: AWS IAM authentication

Scope: task commit range f6c3558..5cb24af (`git diff f6c3558..5cb24af`), committed changes only

Requirements:
- tasks/aws-auth.md acceptance criteria and recorded assumptions
- SPEC.md M5 ("AWS IAM (MONGODB-AWS): access key / secret / session token, or the default AWS credential chain")
- docs/ARCHITECTURE.md (connections/options, packaging, secrets)
- AGENTS.md (no secrets in logs or fixtures)
- Parent instructions: driver 7.9 MONGODB-AWS constraints; integration with connections/manager.ts (`secretsFor`, conn.test secret reuse); security of secrets in logs/errors

Git range:
- Branch: main
- HEAD: a53e280717bede8a7501290892c56be39584d886 (same tree content as task commit 5cb24af8a5660d172d196a5de5308d2b18f2a59e)
- Base/start: f6c3558cfc957963775e8799e1dc79f5c118716a
- Commits reviewed: 1 code commit (plus 2 `assume` commits touching only tasks/)
- Uncommitted changes: none

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## What was checked

- `packages/backend/src/auth/aws/aws.ts`, `index.ts`, `aws.spec.ts` (new), `connections/options.ts`, `options.spec.ts`, `errors.ts`, `docs/ARCHITECTURE.md`, `packages/backend/package.json`, `package-lock.json` (additions only, all resolved from registry.npmjs.org).
- Driver 7.9 behavior against the mapping: `connection_string.ts` rejects username/password and `AWS_SESSION_TOKEN` for MONGODB-AWS; the mapping sets neither (`options.auth` stays undefined, the session token goes through `AWS_CREDENTIAL_PROVIDER`). `aws_temporary_credentials.ts` uses a given provider as is and otherwise builds `fromNodeProviderChain()`; it needs `@aws-sdk/credential-providers` loadable in both cases (`kModuleError` check precedes the `_provider` check), so the new dependency is required. The installed version 3.1170.0 satisfies the driver peer range `^3.806.0`. Provider failures are wrapped as `MongoAWSError`, now classified `AUTH_FAILED`.
- `authSource` forced to `$external` (the driver rejects any other explicit authSource for MONGODB-AWS); a user name in the URI is refused before the driver does it with a less helpful error.
- Integration with `ConnectionManager.secretsFor`: stored secrets (`awsSecretAccessKey`, `awsSessionToken`, `password`) are passed through, `secretMode: 'ask'` drops a stored `password`, a request password wins; `matchesSaved` still guards secret reuse for drafts in `conn.test`. The current editor stores the typed secret as kind `password` (connection-editor.ts), which the mapping accepts.
- Secrets in logs/errors: the provider closure is never logged; `log()` and `toConnectError()` redact every value in `secrets`, which includes the AWS secret and session token; the only error message built here names the access key ID (an identifier, consistent with the user name in the existing SCRAM message) and never the secret or token (asserted in `aws.spec.ts`). Test fixtures use clearly fictitious values.
- The backend utilityProcess inherits `process.env` (apps/desktop/src/main/index.ts), so the default chain can see `AWS_PROFILE`/`AWS_REGION`.
- Focused tests: `cd packages/backend && npx vitest run src/auth/aws src/connections/options.spec.ts` -> 2 files, 66 tests passed.
- Not verified here: an esbuild bundle of the backend now pulling in the AWS SDK (a dry-run bundle command was not permitted in this review session). The driver's `require('@aws-sdk/credential-providers')` is a static string literal, so esbuild should bundle it like `socks`; the parent's `.taskcheck`/packaging smoke is the place to confirm it.
- Acceptance criterion 1 (unit tests for explicit keys and default chain) is met by `aws.spec.ts` and the two new `options.spec.ts` cases, including `new MongoClient(uri, options)` acceptance by the real driver. Criterion 2 is a human task (`aws-verify`) and correctly not claimed. Editor fields for the AWS secret/session token belong to `auth-ui-m5`, not this task.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | New MongoAWSError -> AUTH_FAILED classification has no test**
    - File: `packages/backend/src/connections/errors.ts:53`
    - Category: Tests
    - Problem: `MongoAWSError` was added to `AUTH_NAMES`, but the `AUTH_FAILED by %s` table in `packages/backend/src/connections/errors.spec.ts:34-40` only covers `MongoMissingCredentialsError` and the server codes. A default chain without credentials (the documented `AUTH_FAILED` path in docs/ARCHITECTURE.md) has no regression test.
    - Why it matters: a later edit of the name set would silently turn "no AWS credentials found" into a generic error code without failing any test.
    - Suggested fix: add `['MongoAWSError name', driverError('MongoAWSError', 'Could not load credentials from any providers')]` to the existing AUTH_FAILED table.

- [ ] **CR-2 | A stored `password` secret silently wins over a stored `awsSecretAccessKey`; docs describe it as "typed" only**
    - File: `packages/backend/src/auth/aws/aws.ts:46` (docstring line 16; `docs/ARCHITECTURE.md:190`)
    - Category: Quality
    - Problem: `secretsFor` (manager.ts:276-279) merges all stored secrets, so with `secretMode: 'saved'` `secrets['password']` is also the stored `password` kind, and `secrets['password'] ?? secrets['awsSecretAccessKey']` prefers it. The docstring and ARCHITECTURE.md describe it as "the typed `password`". A profile that kept a stored `password` (e.g. from an earlier SCRAM configuration, or because the current editor stores under `password`) and later gets an `awsSecretAccessKey` uses the old value without any indication. The test "uses the secret typed at connect, over a saved one" cannot distinguish typed from stored.
    - Why it matters: `auth-ui-m5` will decide which secret kind the editor stores; the documented contract should say which kind is canonical and what wins when both exist, otherwise a stale secret produces a confusing `AUTH_FAILED`.
    - Suggested fix: document the actual precedence ("the request or stored `password`, else the stored `awsSecretAccessKey`") in the docstring and ARCHITECTURE.md, or record an assumption naming the canonical kind so `auth-ui-m5` follows it.

## Review conclusion

No material issues found.
