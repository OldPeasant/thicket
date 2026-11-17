# Fix Report

Date: 2026-11-17

Task: oidc-auth - M5: OIDC authentication

Scope: current task; findings CR-1, CR-2, CR-3 of `reviews/oidc-auth/review.md` (base 97f87a5, reviewed up to d5138b9).

## Fixed findings

### CR-1 — OIDC connects fail for every server that is not Atlas or localhost (driver `ALLOWED_HOSTS`)

Files changed:
- `packages/contract/src/profiles.ts`
- `packages/backend/src/connections/options.ts`
- `packages/backend/src/connections/errors.ts`
- `packages/backend/src/connections/options.spec.ts`
- `packages/backend/src/connections/errors.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
Without `ALLOWED_HOSTS` the mongodb 7.9 driver only sends OIDC tokens to its default list (Atlas domains, localhost, 127.0.0.1, ::1). It refuses every other host with a `MongoInvalidArgumentError`, which was classified as `NETWORK_ERROR` and had a cryptic message. Users had no way to allow other hosts.

Fix:
New optional profile auth field `oidcTrustedEndpoint?: boolean` (default false), next to `oidcFlow`. It works like mongosh's `--oidcTrustedEndpoint`. When it is true, `clientConfig` sets `authMechanismProperties.ALLOWED_HOSTS` to the connection string's own hosts, lower-cased as the driver compares them. For `mongodb+srv://` it sets `*.<parent domain of the SRV name>` (the SRV name itself when it has fewer than 3 labels). The driver checks hosts after SRV resolution and requires SRV results to be in that domain, so no catch-all `*` is needed. A plain `*` would not work anyway: the driver's `hostMatchesWildcards` only understands `*.` and `*/` prefixes. When the field is false or absent, or the connection string can't be parsed, the driver default stays. `classifyCode` now treats the driver's "is not valid for OIDC authentication with ALLOWED_HOSTS" refusal as `AUTH_FAILED`. `toConnectError` adds a sentence that names `oidcTrustedEndpoint`. ARCHITECTURE.md describes the option.

Validation:
- `npx vitest run src/connections/options.spec.ts -t ALLOWED_HOSTS` (packages/backend) — Pass (6 tests). The tests cover: the default is kept; own hosts with IPv6 and lower-casing; SRV domain; the driver accepts the option; a real `MongoClient.connect` to the non-default host `127.0.0.2:9` is refused as `AUTH_FAILED` with a message naming the option; with the option set, the same host passes the host check.
- `errors.spec.ts` "maps the driver's OIDC ALLOWED_HOSTS refusal..." — Pass

### CR-2 — Cached tokens the server rejects are reused on every later connect

Files changed:
- `packages/backend/src/auth/oidc/oidc.ts`
- `packages/backend/src/connections/manager.ts`
- `packages/backend/src/auth/oidc/oidc.spec.ts`
- `packages/backend/src/connections/manager.spec.ts`

Problem:
Nothing invalidated the token cache when the server refused a token served by the callback. Every later connect refreshed the same refused identity and never opened an interactive sign-in again.

Fix:
`OidcAuthenticator.callbackFor` now records each target whose callback handed tokens to the driver (in a WeakSet). The new method `OidcAuthenticator.refused(target)` calls `forget(profileId)`, which clears memory and keychain, but only when the target has a profile id and its callback answered. The manager's `oidcCallback` became `oidcSession`, which returns `{ callback, refused }`. `conn.open` (`connect`) and `conn.test` call `refused` when the failure is `AUTH_FAILED`. Other failure codes keep the tokens. If forgetting fails (keychain error), the failure is logged and the answer stays `AUTH_FAILED`. The fix also forgets tokens that came from an interactive sign-in. The reason: the next connect would otherwise refresh that same refused identity, which is the lock-in this finding describes. Refusals that happen before any token was handed out (for example the `ALLOWED_HOSTS` refusal or an IdP discovery failure) keep the cache.

Validation:
- `oidc.spec.ts` "tokens the server refused are forgotten: the next connect signs in interactively" (served from the stored cache via refresh, refused, `saveTokens(p1, null)`, next connect opens the browser) and "refused forgets nothing when the callback handed out no tokens, or for a draft" — Pass
- `manager.spec.ts` "an AUTH_FAILED open or test tells the authenticator...", "other connect failures keep the tokens", "a failing forget is logged; the answer stays AUTH_FAILED" — Pass

### CR-3 — The shared discovery promise is bound to the first caller's abort signal

Files changed:
- `packages/backend/src/auth/oidc/oidc.ts`

Problem:
The discovery promise is cached per issuer, but its request used the abort signal of the connect that started it. Cancelling that connect therefore failed the other connects that shared the promise.

Fix:
The cached discovery fetch no longer gets a caller's signal (only the CA). It is bounded by the 30 s request timeout. Each `signIn` waits on it through the existing `abortable(promise, signal)` helper from `connections/manager`. The connections module imports the oidc module as a type only, so this adds no runtime cycle.

Validation:
- `oidc.spec.ts` "cancelling one connect during discovery does not fail another profile's connect" (the existing failing test, unchanged) — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `npx vitest run src/auth/oidc` (packages/backend) — Pass (2 files)
- `npx vitest run src/connections/manager.spec.ts -t OIDC` — Pass (13 tests)
- `npx vitest run src/connections/options.spec.ts -t ALLOWED_HOSTS` — Pass (6 tests)

Full test suite:
- `npm run check` (repo root: eslint + prettier, typecheck incl. renderer ngc, vitest 67 files / 3706 tests, renderer `ng test` 80 files / 2429 tests) — Pass
- `npm run test:int -- oidc` (Podman, MongoDB Enterprise + Keycloak fixture) — Pass (6 tests)

Lint/type-check/build:
- Included in `npm run check` — Pass

`.taskcheck`:
- Not run directly; `.taskcheck` runs `npm run check`, which passed

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
