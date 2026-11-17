# Code Review

Date: 2026-11-17

Task: auth-ui-m5 - M5: Connection editor for LDAP, OIDC and AWS

Scope: `git diff 384a448fa59547d3354caf30d43b3d18da210f3f 23bcfe6 -- packages test` (task code commits b5b55b2, 043e9e6, 23bcfe6; the other commits in the range only touch `tasks/`). `reviews/auth-ui-m5/tests.md` read for context only.

Requirements:
- `tasks/auth-ui-m5.md` acceptance criteria and the three recorded ASSUMPTION notes
- `SPEC.md` M5 section and section 6 (Security requirements)
- `docs/ARCHITECTURE.md`, `AGENTS.md`
- Contract: `packages/contract/src/profiles.ts` (auth schema, `OIDC_FLOWS`, `SECRET_KINDS`, `profiles.setSecret` / `profiles.clearSecret`), `packages/contract/src/conn.ts` (`oidcPrompt`)
- Backend semantics: `packages/backend/src/auth/aws/aws.ts`, `packages/backend/src/auth/ldap/ldap.ts`, `packages/backend/src/connections/options.ts` (MONGODB-OIDC branch), `packages/backend/src/connections/manager.ts` (`test`, `secretsFor`, `matchesSaved`)

Git range:
- Branch: main
- HEAD: 23bcfe6
- Base/start: 384a448fa59547d3354caf30d43b3d18da210f3f
- Commits reviewed: 7 (3 touching code/tests, 4 touching only `tasks/`)

Summary: 0 P0, 0 P1, 1 P2, 2 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | A stored AWS session token can never be removed, and the backend keeps sending it with new long-term keys**
    - File: `packages/renderer/src/app/connections/connection-editor.ts:888` (`storeSecrets`), `packages/renderer/src/app/connections/connection-form.model.ts:91` (`usedSecretKinds`)
    - Category: Correctness
    - Problem: `storeSecrets` skips empty values (`if (value === undefined || value === '') continue;`), and the renderer never calls `profiles.clearSecret`. So once an `awsSessionToken` has been saved, clearing the session token field and saving leaves the old token in the keychain. Its doc comment says secrets the settings no longer use are left alone because "the backend ignores them". That is not true for this secret: `awsAuthOptions` (`packages/backend/src/auth/aws/aws.ts`) adds a stored `awsSessionToken` to the credentials whenever an access key ID is set, and `secretsFor` loads it for both saved and matching-draft connects. A user who moves a profile from temporary credentials (key ID, secret and token) to an IAM user's long-term keys, or just replaces an expired set, keeps signing with the stale token, and AWS refuses that. The editor gives no way to fix it short of deleting the profile.
    - Why it matters: The SPEC M5 "Must" for AWS IAM covers access key, secret and session token. A common credential rotation leaves the profile unable to authenticate, and the cause can't be seen in the UI.
    - Suggested fix: Give the session token field a way to remove the stored value, for example a "Remove saved token" action or "an emptied field means delete" on save, and call `profiles.clearSecret({ profileId, kind: 'awsSessionToken' })`. It may also make sense to clear it when the access key ID changes. Add a component test for it.

## P3 Low

- [ ] **CR-2 | Device-code countdown says "1 seconds"**
    - File: `packages/renderer/src/app/connections/oidc-sign-in.ts:142`
    - Category: Quality
    - Problem: `The code expires in ${String(seconds)} seconds.` is also used when `seconds === 1`, so the panel shows "The code expires in 1 seconds." for the last second before the panel disappears. The test-writer saw the same thing.
    - Why it matters: A small grammar slip in user-facing text.
    - Suggested fix: Use the singular form for 1 (`second`/`seconds`) and add a spec assertion.

- [ ] **CR-3 | "Ask" hint still says "password" for the AWS secret access key**
    - File: `packages/renderer/src/app/connections/connection-editor.html:657`
    - Category: Quality
    - Problem: The storage legend now uses `passwordLabel()` ("Secret access key storage"), but the `ask-hint` below it still says "The password above is used for Test connection only and is not stored." For MONGODB-AWS there is no field called password: the field above is "Secret access key", and the session token right next to it *is* stored on save.
    - Why it matters: The wording is inconsistent, and it could suggest that nothing typed in this group is stored.
    - Suggested fix: Build the hint from `passwordLabel()`, as the legend does, for example "The secret access key above is used for Test connection only and is not stored."

## Notes (not findings)

- I checked the backend semantics against the UI and they match: LDAP, OIDC and AWS drop `authSource` (the backend forces `$external`). The AWS key ID is kept out of the connection string, because the driver refuses it. The AWS secret is saved as the `password` kind, which `aws.ts` prefers. OIDC saves no secret mode and only non-default `oidcFlow` / `oidcTrustedEndpoint`. The `oidc.prompt` payload is handled for all three kinds.
- Component tests cover every mechanism's fields and URI sync: the editor spec's "M5" block, the model spec's M5 block, `oidc-sign-in.spec.ts` and the app-shell test. `test/e2e/ldap.e2e.ts` drives the real editor against the LDAP fixture: wrong password gives AUTH_FAILED, then Test ok, save, the stored profile has no password, and the sidebar connects.
- When this review ran, `python tasks.py verify auth-ui-m5` showed both criteria as unverified. The parent worker still has to record the evidence. `tests.md` reports `npm run test:e2e -- ldap.e2e.ts` passed on Podman (1 passed).

## Review conclusion

Material issues found; fix before completing the task. CR-1 is a medium-severity correctness gap in AWS session-token handling. CR-2 and CR-3 are small wording fixes.
