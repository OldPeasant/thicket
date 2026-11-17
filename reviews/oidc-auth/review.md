# Code Review

Date: 2026-11-17

Task: oidc-auth - M5: OIDC authentication

Scope: `git diff c43b477..c88f053 -- . ':!tasks' ':!reviews'`. This second review covers the whole task code, plus checks of the fixes for CR-1..CR-3 from the first review (described in `reviews/oidc-auth/fixes.md`). It also covers the test-only commit c88f053 on top of fbf81a5. That commit changes `oidc.spec.ts`, `options.spec.ts` and the contract's `index.spec.ts`, and adds `backend.oidc.spec.ts`; it changes no production code. Before this review the branch was rebased. The code is the same as at the earlier hashes: `git diff 0dc1ff1 fbf81a5 -- . ':!tasks' ':!reviews'` is empty. Uncommitted changes were not reviewed.

Requirements:
- tasks/oidc-auth.md: the acceptance criteria and the 8 recorded assumptions
- SPEC.md M5 OIDC: authorization code flow in the system browser, device flow as a fallback, token cache in the keychain
- docs/ARCHITECTURE.md: the MONGODB-OIDC paragraph (updated in this task)
- docs/QUALITY.md (report contract) and AGENTS.md
- The mongodb driver sources in `node_modules/mongodb/lib`: `mongo_client.js` (host check after SRV resolution) and `utils.js` (`hostMatchesWildcards`, `HostAddress.toHostPort`)

Git range:
- Branch: main
- HEAD: c88f053e308e85461d15e75aeb7fd346eb19b50c
- Base/start: c43b477cf3bb1064aa73d1ad55561da847f01185
- Commits reviewed: 6 (893ed51, e0041c1, fe6643f, eb2545e, fbf81a5, c88f053)

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Fixes from the first review

- **CR-1 (ALLOWED_HOSTS): fixed.**
  - New profile field `auth.oidcTrustedEndpoint` (optional boolean, `packages/contract/src/profiles.ts`). `clientConfig` sets `ALLOWED_HOSTS` only when this field is true (`packages/backend/src/connections/options.ts:79-83`).
  - `ownHosts` turns the hosts into lower-case names without ports. For `mongodb+srv://` it produces `*.<parent domain>`.
  - I checked this against the driver:
    - `MongoClient.connect` checks `host.toHostPort().host` after SRV resolution.
    - `toHostPort()` gives an IPv6 address without brackets, which matches the `'::2'` the test expects.
    - `hostMatchesWildcards` only understands the `*.` and `*/` prefixes, so the SRV wildcard is correct.
  - The driver's refusal becomes `AUTH_FAILED`, and the message names the option (`errors.ts:112-117`, `errors.ts:187-192`).
  - Unit tests use a real `MongoClient` against `127.0.0.2:9` for both the refused and the trusted case.
  - The new field is recorded as an assumption, and auth-ui-m5 is expected to show it in the UI.
- **CR-2 (refused tokens reused forever): fixed.**
  - `callbackFor` marks a target in the `answered` WeakSet only after `signIn` returned tokens. `refused` forgets the tokens (memory and keychain) only for a saved profile whose callback answered (`oidc.ts:113-139`).
  - The manager calls `refused` only for `AUTH_FAILED`, in both `test()` (`manager.ts:154`) and `connect()` (`manager.ts:360`). A failing forget is logged and the error code stays the same.
  - IdP errors and the `ALLOWED_HOSTS` refusal happen before any tokens are handed out, so they keep the cache.
  - Drafts that don't match the saved profile get no `profileId`, so nothing is forgotten for them. This is correct.
- **CR-3 (shared discovery bound to the first caller's signal): fixed.**
  - The cached discovery request no longer uses any caller's signal (`oidc.ts:243-251`).
  - Each `signIn` waits through `abortable(..., signal)` (`oidc.ts:163`). A failed fetch is removed from the cache.

## Test-only commit c88f053

I read the new tests against the production code. Each one checks behavior, and none of the existing tests were weakened or removed.

- **`oidc.spec.ts`:**
  - Cancel racing a browser failure: the result is `CANCELLED` and a `finished ok:false` prompt is sent. This matches `oidc.ts:311-316`.
  - Tokens from an interactive sign-in that the server then refused are forgotten. The forget happens once per connect, because `refused` removes the target from `answered`.
  - A refusal forgets only that profile's tokens. The test checks this through the IdP grant sequence.
- **`options.spec.ts`:**
  - The SRV name is lower-cased.
  - An unparseable connection string keeps the driver's default `ALLOWED_HOSTS` and keeps the callback.
- **contract `index.spec.ts`:**
  - Accepted and rejected values for `oidcFlow` and `oidcTrustedEndpoint`.
  - The `auth` object stays strict, so it can't hold token fields.
- **New `server/backend.oidc.spec.ts`:**
  - It records the `OidcEnvironment` that `startBackend` builds, using a subclass mock; the real authenticator still runs.
  - It checks that `openBrowser` and `saveTokens` reach main over the privileged port, and that main's refusal rejects.
  - It checks that `oidc.prompt` reaches every open renderer and not a closed one, and that the payload passes `oidcPrompt`.
  - It runs a real `conn.open` of an OIDC profile on 127.0.0.2. The result is `AUTH_FAILED` naming `oidcTrustedEndpoint`, with no main calls. This proves the authenticator is wired into the manager.
  - All fixtures are made up (`*.example.test`). No real credentials are used.

## Also checked, no finding

- **Flow security:**
  - PKCE S256 is used for both grants, and the `state` value has 24 random bytes.
  - The loopback server listens only on 127.0.0.1/::1, answers one redirect, then returns 404. A redirect with the wrong `state` does not end the wait, and the server is closed in `finally`.
  - Issuer and endpoints must be https (http only for loopback), and the discovery document must name the same issuer.
  - IdP answers are limited to 1 MB.
- **Cancellation and loading state:**
  - The connect signal and the driver's `timeoutContext` are combined.
  - Cancelling or closing ends the code wait, the device polling and in-flight IdP requests with `CANCELLED`.
  - Every prompt is followed by a `finished` event, also after errors.
- **Token cache:**
  - A broken stored `oidcTokens` value is treated as "no cache" (`parseCachedTokens`).
  - The cache is used only for the same issuer and client id.
  - A refused refresh (`IdpGrantError`) falls back to an interactive sign-in. Network errors are passed on, not hidden.
- **Main process handlers:**
  - `oidc.openBrowser` accepts only http/https, checked both in the contract and in the main handler.
  - `oidc.saveTokens` stores tokens only with `secure` storage and only for an existing profile. `null` deletes them.
  - Both are privileged (backend to main) methods. The `oidc.prompt` broadcast contains no tokens and is covered by `no-secrets.spec.ts`.
- **Secrets:**
  - No tokens are written to logs.
  - The fixture creates its user password, root password and CA when the test starts. No credentials are committed.
- **Acceptance criteria coverage in `test/integration/oidc.int.spec.ts` (MongoDB Enterprise and Keycloak):**
  - Criterion 1 (code flow with headless Chromium): covered.
  - Criterion 2 (token reuse with no browser opened, both in the same process and after a restart from the keychain): covered.
  - Criterion 3 (device flow): covered.
  - Also covered: device fallback when no browser opens, a dead refresh token, and cancel.
- **Evidence:** the acceptance criteria are not recorded in the task file yet (`tasks.py verify`). The parent worker has to record them from real `npm run test:int` runs.
- **No tests run for this review:** this review was read-only. The sandbox did not allow running the tests, so the new unit tests were checked by reading only. Whether they pass has to come from the test-writer's report and the parent's `npm run check`.

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
