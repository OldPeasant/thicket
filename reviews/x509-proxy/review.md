# Code Review

Date: 2026-11-17

Task: x509-proxy - M2: X.509, SOCKS5 proxy, read preference and write concern

Scope: committed changes `git diff df542a0..HEAD` (commits 95ee3bc, 62a9668, ceef14d), excluding `tasks/` except the new follow-up `tasks/raw-cmd-read-pref.md`. Uncommitted working-tree changes (`errors.spec.ts`, `manager.spec.ts`, apparently from the concurrent test-writer) were not reviewed.

Requirements:
- `tasks/x509-proxy.md` acceptance criteria and recorded assumptions
- `SPEC.md` section 6 M2 Connectivity (X.509, SOCKS5, read preference / write concern) and section 7 Testing
- `docs/ARCHITECTURE.md` "Connections" and "Integration tests"
- `docs/QUALITY.md`, `AGENTS.md`
- Parent agent instructions (judge the AC3 split; secrets, error classification, fixtures)

Git range:
- Branch: main
- HEAD: ceef14d541f2a94dc665d2400caabebd32069f0a
- Base/start: df542a0a2fe259616953e8400d54e9374a1a1310
- Commits reviewed: 3

Summary: 0 P0, 0 P1, 1 P2, 3 P3

Commands run by the reviewer:
- `npx vitest run --config test/integration/vitest.config.ts x509 proxy` (Docker) -> 2 files, 18 tests passed (45 s)
- `npx vitest run packages/backend/src/connections/options.spec.ts` -> 34 passed
- `npm run typecheck` -> pass
- `npm run check` -> lint stopped on Prettier warnings in `errors.spec.ts` and `manager.spec.ts`. Both files have uncommitted changes outside the reviewed commits. No committed file of this task was flagged.
- `python tasks.py check` -> ok
- Node probe of the driver: `readPreferenceTags` with mode `primary` (or without a mode) is accepted by `new MongoClient` and silently dropped (see CR-3)

Acceptance criteria:
- AC1 (X.509 user authenticates with a generated client cert; wrong cert -> AUTH_FAILED): met. `x509.int.spec.ts` authenticates with a PEM bundle, an encrypted bundle and separate cert/key files, and checks `connectionStatus` for the `$external` user. "Wrong cert" is covered by a same-CA certificate whose subject has no user, and by a user name that does not match the subject. Both return AUTH_FAILED (UserNotFound -> AUTH_FAILED only while connecting). A certificate from a foreign CA returns TIMEOUT or NETWORK_ERROR, not AUTH_FAILED. This is recorded as an assumption and tested as "not AUTH_FAILED", so humans can review it.
- AC2 (connection through a SOCKS5 container): met. The member names resolve only behind the proxy. A connection without the proxy returns DNS_ERROR, so a successful connect proves that the proxy was used. The test also checks that the proxy password does not appear in logs.
- AC3 (secondaryPreferred routes reads to a secondary, `hello.me`): met at the driver-client level. `hello` is sent with `client.readPreference` and returns `rs-b:27017`. Connection-checkout events confirm that `find` goes to the secondary.

AC3 split assessment: sound. The criterion asks for an integration test of client-level routing, and that test is present. The app's own reads and writes are raw `db.command()` calls in `docs/` and `browse/`. Those packages are outside this task's `touches`, and changing them needs cursor pinning for `getMore`/`killCursors`. `tasks/raw-cmd-read-pref.md` covers that work with concrete, testable criteria and dependencies that exist (`conn-close-streams`, `validator`). `docs/ARCHITECTURE.md` documents the current gap. Until that task is done, the SPEC Must "open on secondary for read-only work" has no visible effect in the app. That is tracked, not hidden.

Security notes (no findings):
- `proxyPassword` and `tlsKeyPassphrase` go only into driver options, never into the URI. Every log line and error message of a connect is redacted with all secret values, which includes both new secrets. `proxyPassword` is a new `SECRET_KINDS` entry, so the renderer only sees it in `storedSecrets` names.
- `matchesSaved` now also compares `proxy`, so a draft that changes the proxy host does not receive the stored proxy password.
- The fixtures generate the CA, client keys, key passphrase, root password and proxy password at runtime. They write keys with mode 0600 to a `mkdtemp` folder and remove it on stop and on setup failure. `socks.ts` stops the containers and the network on failure and on stop. No credentials are committed.
- `readPem` error messages contain the file path and the errno code, not the file contents.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | New error-classification and secret-matching rules have no unit tests**
    - File: `packages/backend/src/connections/errors.ts:113`, `packages/backend/src/connections/errors.ts:104`, `packages/backend/src/connections/manager.ts:302`
    - Category: Tests
    - Problem: The commits change `classifyCode`/`toConnectError`: a new `connecting` flag makes UserNotFound (code 11 / `codeName`) AUTH_FAILED only while connecting, and `ERR_OSSL_*` now counts as TLS. They also add `proxy` to `matchesSaved`. The committed `errors.spec.ts` and `manager.spec.ts` contain no test for any of these. The positive paths are covered only indirectly by the Docker integration tests, which `.taskcheck` does not run. Three things are untested anywhere: UserNotFound outside a connect stays SERVER_ERROR (the documented browse behavior), `serverInfo()` keeps `connecting = false`, and a draft with a changed `proxy` gets no stored `proxyPassword`.
    - Why it matters: The UserNotFound split is context-dependent and easy to regress. For example, a later caller could pass `true` from a non-connect path and turn `dropUser` errors into AUTH_FAILED. The `proxy` comparison in `matchesSaved` is a secret-protection rule: without it, an edited draft could send the stored proxy password to a different host. Only the always-run unit suite protects these rules.
    - Suggested fix: Add `errors.spec.ts` cases for UserNotFound with `connecting` true and false (by code and by `codeName`) and for an `ERR_OSSL_BAD_DECRYPT` cause. Add a `manager.spec.ts` case where `conn.test` gets a draft with the saved id but a different `proxy` and must not receive the stored `proxyPassword`.

## P3 Low

- [ ] **CR-2 | `tls.keyFile` without `certificateKeyFile` is silently ignored**
    - File: `packages/backend/src/connections/options.ts:69`
    - Category: Correctness
    - Problem: `keyFile` is read only inside `if (tls.certificateKeyFile !== undefined)`. A profile that sets only `keyFile` connects without a client certificate and gives no hint. The contract (`packages/contract/src/profiles.ts`, `keyFile` doc) allows this combination.
    - Why it matters: The user sees a later, misleading server error (for example an X.509 AUTH_FAILED "needs a client certificate" message, or a TLS handshake failure) instead of a clear configuration error.
    - Suggested fix: Return a TLS_ERROR (or reject in the contract with a refinement) when `keyFile` is set without `certificateKeyFile`.

- [ ] **CR-3 | `readPreferenceTags` with a `primary` or missing read preference is silently dropped**
    - File: `packages/backend/src/connections/options.ts:123`
    - Category: Correctness
    - Problem: The contract doc says the tags need "a `readPreference` other than `primary`", but neither the contract nor `clientConfig` enforces this. A probe of the installed driver shows that `new MongoClient(uri, { readPreferenceTags: [{ dc: 'a' }] })` and `{ readPreference: 'primary', readPreferenceTags: [...] }` are accepted, and the client's mode stays `primary` with the tags dropped.
    - Why it matters: A profile that looks like it routes reads by tag routes everything to the primary, and nothing tells the user.
    - Suggested fix: Reject the combination in the contract (`superRefine` on `profile`), or return an error from `clientConfig`, so the upcoming form task (`conn-ui-m2`) gets a validation error.

- [ ] **CR-4 | SOCKS fixture image is not pinned**
    - File: `test/integration/fixtures/socks.ts:19`
    - Category: Quality
    - Problem: `docker.io/serjs/go-socks5-proxy:latest` is used, while the other fixture images are pinned to a version tag (`mongo:8.2`, `mongo:7.0` in `fixtures/mongo.ts`). The fixture also depends on the image's env names (`PROXY_USER`, `PROXY_PASSWORD`) and on its log line (`Start listening proxy service`) for the wait strategy.
    - Why it matters: An upstream change to `latest` can break the integration tests without any change in the repository.
    - Suggested fix: Pin a specific tag or digest.

## Review conclusion

No material issues found. The acceptance criteria are met. I ran the X.509 and SOCKS5 integration tests myself and they pass. The AC3 deferral to `raw-cmd-read-pref` is a sound split. CR-1 is a non-blocking but important unit-test gap and should be addressed or explicitly dispositioned. CR-2 to CR-4 are minor.
