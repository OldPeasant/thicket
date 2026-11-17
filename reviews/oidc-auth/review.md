# Code Review

Date: 2026-11-17

Task: oidc-auth - M5: OIDC authentication

Scope: `git diff 7e83e99..HEAD -- . ':!tasks' ':!reviews'` (production code under `packages/backend/src/auth/oidc`, `packages/backend/src/connections`, `packages/backend/src/server/backend.ts`, `packages/contract`, `apps/desktop/src/oidc`, `apps/desktop/src/main`, plus `test/integration/oidc.int.spec.ts` and `test/integration/fixtures/oidc.ts`). Unit tests added in parallel by the test-writer (untracked `flows.spec.ts`, `testing.ts`) are not part of this review.

Requirements:
- tasks/oidc-auth.md acceptance criteria and recorded assumptions (`python tasks.py assumptions`)
- SPEC.md M5 OIDC line ("authorization code flow with the system browser, device flow as a fallback; token cache in the keychain")
- docs/ARCHITECTURE.md, MONGODB-OIDC paragraph
- docs/QUALITY.md (report contract), AGENTS.md
- mongodb 7.9.0 driver sources: `lib/cmap/auth/mongodb_oidc/human_callback_workflow.js`, `callback_workflow.js`, `lib/mongo_client.js`, `lib/cmap/auth/mongo_credentials.js`

Git range:
- Branch: main
- HEAD: e784f263258be7957dd7642895377c6439e7c1d5
- Base/start: 7e83e992e51b1f62eabbf2d3440b365c3f56a2a1
- Commits reviewed: 3 (bec730c, 433f67f, e784f26)

Summary: 0 P0, 1 P1, 1 P2, 1 P3

Verified as correct (no finding): PKCE S256 with a 32-byte verifier for both flows; a 24-byte random `state` checked on the loopback redirect, mismatching or foreign requests do not end the wait, the server answers one redirect and then 404; loopback listeners bind only to 127.0.0.1/::1 and are closed in `finally` (also on abort, browser failure and token errors); discovery requires https (loopback http only) for the issuer and every endpoint and checks the document's `issuer` equals the announced one; the callback result only carries `accessToken`/`expiresInSeconds`/`refreshToken`, as `isCallbackResultInvalid` requires; the driver's `timeoutContext` and the connect's abort signal are combined, so the driver's 5-minute limit, `conn.close` and a cancelled `conn.test` stop polling and close the loopback server; `oidc.openBrowser` is a privileged (backend-to-main) method, checked to http/https both by the contract and in the main handler before `shell.openExternal`; the `oidc.prompt` broadcast carries no tokens (and is covered by `no-secrets.spec.ts`); tokens are not written to logs; `oidcTokens` is persisted only with secure storage and an existing profile; profile deletion already removes all its secrets.

## P0 Critical

None.

## P1 High

- [ ] **CR-1 | OIDC connects fail for every server that is not Atlas or localhost (driver `ALLOWED_HOSTS`)**
    - File: `packages/backend/src/connections/options.ts:79`
    - Category: Integration
    - Problem: The MONGODB-OIDC options set `authMechanismProperties = { OIDC_HUMAN_CALLBACK }` without `ALLOWED_HOSTS`. In mongodb 7.9 `MongoCredentials` then fills in `DEFAULT_ALLOWED_HOSTS` (`*.mongodb.net`, `*.mongodb-qa.net`, `*.mongodb-dev.net`, `*.mongodbgov.net`, `*.mongo.com`, `localhost`, `127.0.0.1`, `::1`; `lib/cmap/auth/mongo_credentials.js:30-60`), and `MongoClient.connect` refuses every other host for a human-callback OIDC connect before connecting (`lib/mongo_client.js:238-247`: `Host '...' is not valid for OIDC authentication with ALLOWED_HOSTS of ...`). A self-hosted MongoDB Enterprise server such as `mongodb://db.corp.example:27017` (the deployment the SPEC/fixture targets) can therefore never sign in. The integration fixture connects to `mongodb://localhost:<port>` (`test/integration/fixtures/oidc.ts:200`), which is in the default list, so the tests pass and hide this. `ALLOWED_HOSTS` cannot be set in the connection string either (the driver rejects it, `lib/connection_string.js:270-276`), so users have no workaround.
    - Why it matters: The "Must" OIDC feature only works against Atlas or a server on the local machine; the user gets a cryptic driver error instead of a sign-in.
    - Suggested fix: Make the trust decision explicit rather than disabling the check silently (the list protects IdP tokens from being sent to an arbitrary server that announces the same issuer). For example, a profile option like Compass's "Consider target endpoint trusted" / mongosh's `--oidcTrustedEndpoint` that sets `ALLOWED_HOSTS` to the profile's own hosts (or `['*']`), keeping the driver default otherwise; map the driver's refusal to a readable `AUTH_FAILED` message that names the option; record the choice with `tasks.py assume` (auth-ui-m5 can expose the field). Add a unit test for the `ALLOWED_HOSTS` mapping and a test that a non-default host is accepted when trusted (and refused with the readable message when not).

## P2 Medium

- [ ] **CR-2 | Cached tokens the server rejects are reused on every later connect; there is no way back to an interactive sign-in**
    - File: `packages/backend/src/auth/oidc/oidc.ts:162-179` (also `oidc.ts:114-118`, `packages/backend/src/connections/manager.ts:323-345`)
    - Category: Correctness
    - Problem: On a new connect the driver has no cache, so it runs the two-step conversation, calls the callback once and raises the server's `AuthenticationFailed` without retrying (`human_callback_workflow.js:81-87`). `signIn` answers that callback from the profile's cache (refresh with the cached refresh token, or reuse a cached access token), and nothing invalidates that cache when the server refuses the resulting token: `OidcAuthenticator.forget()` is never called anywhere, the in-memory map takes precedence over the keychain, and `connect()`/`test()` only classify the error. Examples: the IdP session in the browser was signed in to a different account than the one the `$external` user exists for (common with SSO); a revoked access token stored without a refresh token; a changed role/audience mapping. Each later connect refreshes the same refresh token and fails again, for as long as the refresh token lives (offline tokens can last weeks), and the browser is never opened again. The only escape is deleting the profile. Assumption #3 explains the refresh-first order, which is fine, but it does not cover a refused token.
    - Why it matters: A user can lock a profile into a failing identity with no recovery in the UI or the backend.
    - Suggested fix: When a connect/test of a MONGODB-OIDC profile fails with `AUTH_FAILED` after the callback returned cached or refreshed tokens, drop them (`oidc.forget(profileId)`, memory and keychain), so the next connect signs in interactively; or let the callback bypass the cache on a retry. Add a unit test (callback served from cache, server refuses, next connect goes interactive).

## P3 Low

- [ ] **CR-3 | The shared discovery promise is bound to the first caller's abort signal**
    - File: `packages/backend/src/auth/oidc/oidc.ts:141` and `oidc.ts:218-226`
    - Category: Correctness
    - Problem: `discover()` caches one promise per issuer, but the request inside it uses the `http.signal` of the connect that started it. If two connects with the same issuer (two profiles, or `conn.open` and `conn.test`) overlap and the first is cancelled or closed while the discovery document is still being fetched, the second connect also fails with `CANCELLED` although it was not cancelled.
    - Why it matters: A spurious `CANCELLED` for an unrelated connect; narrow window, but cancel during sign-in is an expected user action.
    - Suggested fix: Fetch the cached discovery document without a caller signal (it is bounded by the 30 s request timeout) and let each caller wait on it through `abortable(promise, signal)`, or do not share in-flight requests.

## Review conclusion

Material issues found; fix before completing the task.
