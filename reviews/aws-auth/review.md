# Code Review

Date: 2026-11-17

Task: aws-auth - M5: AWS IAM authentication

Scope: round 3 (narrow), final revision 25a54b2bc2a45c6460bec3ae5270971a0570984a. Round 3 reviews the only code change since round 2: `git diff ec12179 25a54b2 -- packages`. That diff adds 8 test cases for MONGODB-AWS through an SSH tunnel and changes no production code. Round 2 reviewed the task's net changes `git diff 5ae4d00 ec12179` at ec1217934ed12fab2d28ad49f9fde716c80714fd and found nothing. Its results are summarized below and still apply, because production code is unchanged. Committed changes only.

Requirements:
- tasks/aws-auth.md acceptance criteria and recorded assumptions
- SPEC.md M5 ("AWS IAM (MONGODB-AWS): access key / secret / session token, or the default AWS credential chain")
- docs/ARCHITECTURE.md (connections/options, packaging, secrets)
- AGENTS.md (no secrets in logs or fixtures)
- Parent instructions for round 3: review the new tunnel tests for correctness, real secrets and flakiness, and run the focused suite

Git range:
- Branch: main
- HEAD: 25a54b2bc2a45c6460bec3ae5270971a0570984a
- Base/start: ec1217934ed12fab2d28ad49f9fde716c80714fd for round 3. The task's merge base with origin/main is 5ae4d005cf68ba0021d0a2f0aee39399dce638f4.
- Commits reviewed: 1 in round 3 (25a54b2, which changes tests and reports only). Rounds 1 and 2 covered a53e280, 3eaa142, e8d2b94 and ec12179.
- Uncommitted changes: none

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## What was checked (round 3)

- `options.spec.ts`, `describe('through an SSH tunnel (after task ssh-tunnel)')`, 4 tests. The assertions match `options.ts`:
  - The SSH-without-tunnel check (`options.ts:50`) runs before the `MONGODB-AWS` branch (`:62`), so "needs the open tunnel before any AWS check" expecting `INTERNAL` is correct.
  - The tunnel options are merged last (`:143-146`). `TunnelProxy` has no auth fields, so the AWS options and `options.auth === undefined` survive. The test confirms this, and also confirms through a real `new MongoClient(uri, options)` that the driver accepts the proxy options and the MONGODB-AWS credentials together.
  - With the default chain, `authMechanismProperties` is undefined. A missing secret is still `AUTH_FAILED` when a tunnel is present.
- `manager.spec.ts`, `describe('ConnectionManager MONGODB-AWS through an SSH tunnel ...')`, 4 tests:
  - On a successful open, the driver gets both the proxy options and the credential provider, and `close` closes the tunnel exactly once.
  - A missing secret after the tunnel opened, a user name in the connection string, and a `MongoAWSError` from the client all give `AUTH_FAILED`. In each case the tunnel is closed and no client is left behind (`created` is empty where clientConfig throws).
  - The AWS secret does not appear in the error message or any log line.
  - Each test uses the existing `setup`, `savedProfile`, `fakeClient` and `rejection` helpers and the `SshTunnel` type with `satisfies`, consistent with the ssh-tunnel test block.
- Secrets: every value is clearly fictitious (`AKIAFICTITIOUSKEY789`, `fictitious/...`, `fictitious-...`) and uses `.example.test` hosts. No real credentials or keys.
- Flakiness: there are no timers, sleeps or real sockets. The only real driver object is a `MongoClient` that is constructed but never connected, so no SRV lookup and no network I/O happen. The pre-existing AWS test uses the same pattern. Proxy ports are plain numbers that nothing listens on.
- Round 2 findings still hold, because no production code changed. CR-1 and CR-2 from round 1 are resolved. The merge resolution with ssh-tunnel keeps both features intact. The dependency additions come only from registry.npmjs.org with integrity hashes. Criterion 1 is met by unit tests. Criterion 2 is the human task `aws-verify` and is correctly not claimed here.
- Commands run in this review (at 25a54b2, in `packages/backend`):
  - `npx vitest run src/auth/aws src/connections`: 5 files and 257 tests passed. Round 2 had 249, so this is +8.
  - `npx tsc --noEmit -p .`: no errors.
  - `npx eslint src/connections/options.spec.ts src/connections/manager.spec.ts`: no findings.
- Not run here: the full `.taskcheck`, which the parent worker runs.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found.
