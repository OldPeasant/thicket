# Code Review

Date: 2026-11-17

Task: aws-auth - M5: AWS IAM authentication

Scope: round 2, final revision ec1217934ed12fab2d28ad49f9fde716c80714fd (merge of origin/main incl. ssh-tunnel into the task branch). Task's net changes: `git diff 5ae4d00 ec12179` (merge base with origin/main), code paths only; committed changes only. Round 1 reviewed 5cb24af/a53e280.

Requirements:
- tasks/aws-auth.md acceptance criteria and recorded assumptions
- SPEC.md M5 ("AWS IAM (MONGODB-AWS): access key / secret / session token, or the default AWS credential chain")
- docs/ARCHITECTURE.md (connections/options, packaging, secrets)
- AGENTS.md (no secrets in logs or fixtures)
- Parent instructions: confirm CR-1/CR-2 resolved, confirm the merge resolution with ssh-tunnel (`clientConfig(profile, secrets, tunnel?)`), look for new issues

Git range:
- Branch: main
- HEAD: ec1217934ed12fab2d28ad49f9fde716c80714fd
- Base/start: 5ae4d005cf68ba0021d0a2f0aee39399dce638f4 (merge base with origin/main, already contains ssh-tunnel)
- Commits reviewed: 4 code-bearing (a53e280 implementation, 3eaa142 tests, e8d2b94 CR-2 docs, ec12179 merge)
- Uncommitted changes: none

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## What was checked

- Net task diff against the merge base: `docs/ARCHITECTURE.md`, `package-lock.json`, `packages/backend/package.json`, `src/auth/aws/{aws.ts,aws.spec.ts,index.ts}`, `src/connections/{errors.ts,errors.spec.ts,manager.spec.ts,options.ts,options.spec.ts}`. `manager.ts` has no net change from this task, and no ssh-tunnel file is changed by the merge, so ssh-tunnel code came in unchanged.
- Merge resolution, `options.ts`: the task adds only the `awsAuthOptions` import, `MONGODB-AWS` in `SUPPORTED_MECHANISMS` and the `MONGODB-AWS` branch ahead of the password branch. The ssh-tunnel parts (SSH+proxy refusal, missing-tunnel `INTERNAL`, `Object.assign(options, tunnel)`) are unchanged. `TunnelProxy` (`src/ssh/tunnel.ts:37`) has only `proxyHost/proxyPort/proxyUsername/proxyPassword`, so it cannot overwrite `authMechanism`, `authSource` or `authMechanismProperties`. AWS over SSH therefore gets the AWS options plus the tunnel's SOCKS options. When the default chain is used, its STS/IMDS lookups run in the backend process outside the tunnel. That is expected, because the tunnel only carries driver sockets.
- Merge resolution, specs: `options.spec.ts` keeps the AWS cases inside `clientConfig`, the ssh-tunnel `describe('SSH tunnels')` block, and the separate `clientConfig MONGODB-AWS (task aws-auth)` block. `manager.spec.ts` adds the `ConnectionManager MONGODB-AWS (task aws-auth)` block just before the unchanged `ConnectionManager SSH tunnels` block. No test is duplicated or lost.
- CR-1 (round 1, `MongoAWSError` -> `AUTH_FAILED` untested): resolved. `errors.spec.ts:250` `describe('MongoAWSError (task aws-auth)')` uses the real driver `MongoAWSError` and covers nested causes and redaction. `manager.spec.ts` also covers a default-chain failure wrapped in server selection, which gives `AUTH_FAILED`.
- CR-2 (round 1, secret precedence documented as "typed" only): resolved by documentation. The `aws.ts` docstring (lines 15-20), the inline comment at line 44 and `docs/ARCHITECTURE.md` now state the actual order: typed or stored `password` first, then a stored `awsSecretAccessKey` as a fallback only with `secretMode: 'saved'`. With `'ask'`, only the typed secret is used. Behavior is unchanged and matches `aws.ts:46-50`.
- Dependencies: the only lock additions are `@aws-sdk/*`, `@smithy/*`, `@aws/lambda-invoke-store` and `bowser`. All resolve from registry.npmjs.org with integrity hashes. The desktop bundle externals from ssh-tunnel (`electron`, `cpu-features`, `apps/desktop/scripts/build.mjs:20`) do not exclude the AWS SDK.
- Secrets: the manager tests assert that the AWS secret and session token appear in no log line, error message or status, and never in serialized options. All fixture values are clearly fictitious.
- Acceptance criteria: criterion 1 (unit tests for the option mapping, explicit keys and default chain) is met by `aws.spec.ts`, the `options.spec.ts` AWS cases (including `new MongoClient(uri, options)` with the real driver) and the manager flow tests. Criterion 2 is the human task `aws-verify`. It is correctly not claimed here.
- Commands run in this review (at ec12179, in `packages/backend`): `npx vitest run src/auth/aws src/connections` passed 5 files and 249 tests. `npx tsc --noEmit -p .` passed with no errors.
- Not run here: the full `.taskcheck` and a desktop bundle build. The parent worker runs `.taskcheck`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None. Both round-1 P3 findings (CR-1, CR-2) are resolved in the final revision.

## Review conclusion

No material issues found.
