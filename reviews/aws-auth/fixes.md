# Fix Report

Date: 2026-11-17

Task: aws-auth - M5: AWS IAM authentication

Scope: current task, findings CR-1 and CR-2 of `reviews/aws-auth/review.md` (HEAD 3eaa142, base f6c3558); fixes are uncommitted working-tree changes, documentation only

## Fixed findings

### CR-2 — A stored `password` secret silently wins over a stored `awsSecretAccessKey`; docs describe it as "typed" only

Files changed:
- `packages/backend/src/auth/aws/aws.ts`
- `docs/ARCHITECTURE.md`

Problem:
The `awsAuthOptions` doc comment and the ARCHITECTURE.md MONGODB-AWS paragraph called the preferred secret "the typed `password`", but `ConnectionManager.secretsFor` merges stored secrets, so with `secretMode: 'saved'` a stored `password` kind also wins over a stored `awsSecretAccessKey`.

Fix:
Documentation only, no behaviour change. The doc comment, a new inline comment at the secret selection, and the ARCHITECTURE.md paragraph now state the real order: the `password` secret (typed at connect, or the stored `password` kind, which is the profile's primary secret and what the connection editor saves; with `secretMode: 'ask'` only the typed one) wins over the stored `awsSecretAccessKey`, which is a fallback used only with `secretMode: 'saved'`.

Validation:
- `cd packages/backend && npx vitest run src/auth/aws src/connections` — Pass (5 files, 237 tests)
- `npx prettier --check packages/backend/src/auth/aws/aws.ts docs/ARCHITECTURE.md` — Pass

## Not fixed

### CR-1 — New MongoAWSError -> AUTH_FAILED classification has no test

Status:
Invalid (already resolved)

Reason:
The test-writer's commit 3eaa142 added `describe('MongoAWSError (task aws-auth)')` to `packages/backend/src/connections/errors.spec.ts` (from line 250), asserting `classifyCode(...)` is `AUTH_FAILED` for the real driver `MongoAWSError`, with and without connecting, nested causes and server selection wrapping, plus `toConnectError` redaction. No change needed; those tests pass in the run above.

## Validation summary

Focused tests:
- `cd packages/backend && npx vitest run src/auth/aws src/connections` — Pass (5 files, 237 tests)

Full test suite:
- Not run (documentation-only change; the parent runs `.taskcheck`)

Lint/type-check/build:
- `npx prettier --check packages/backend/src/auth/aws/aws.ts docs/ARCHITECTURE.md` — Pass

`.taskcheck`:
- Not run (left to the parent worker)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
