# Code Review

Date: 2026-11-17

Task: x509-proxy - M2: X.509, SOCKS5 proxy, read preference and write concern

Scope: round 2, final revision. Committed changes `git diff df542a0..abf63eb` (commits 95ee3bc, 62a9668, ceef14d, abf63eb), excluding `tasks/` and `reviews/` except the follow-up `tasks/raw-cmd-read-pref.md`. Round 1 reviewed ceef14d. Since then the only commit is abf63eb, which adds tests only (`errors.spec.ts`, `manager.spec.ts`, `options.spec.ts`, `packages/contract/src/index.spec.ts`; 645 insertions, 0 deletions) plus the round-1 reports. `git diff --stat ceef14d..abf63eb` outside `reviews/` and `tasks/` shows no production file. The working tree was clean.

Requirements:
- `tasks/x509-proxy.md` acceptance criteria and recorded assumptions
- `tasks/conn-ui-m2.md` (to judge the dispositions of CR-2 and CR-3)
- `SPEC.md` section 6 M2 Connectivity and section 7 Testing
- `docs/ARCHITECTURE.md` "Connections" and "Integration tests"
- `docs/QUALITY.md`, `AGENTS.md`
- Parent agent instructions (round 2: check that the new tests cover CR-1, confirm or challenge the intended dispositions)

Git range:
- Branch: main
- HEAD: abf63eb71e7b75ca300a562ba24407cfa10969c1
- Base/start: df542a0a2fe259616953e8400d54e9374a1a1310
- Commits reviewed: 4

Summary: 0 P0, 0 P1, 0 P2, 0 P3 (new in round 2). Round-1 findings: CR-1 (P2) resolved; CR-2, CR-3, CR-4 (P3) remain open and are non-blocking. See the dispositions below.

Commands run by the reviewer (round 2, on abf63eb):
- `cd packages/backend && npx vitest run src/connections/` -> 4 files, 206 tests passed
- `cd packages/contract && npx vitest run src/index.spec.ts` -> 329 tests passed
- `npm run check` -> pass (eslint `--max-warnings 0` and Prettier clean, typecheck clean, root Vitest 48 files / 2989 tests passed, renderer 55 files / 1341 tests passed)
- Round 1, still valid because production code did not change: `npx vitest run --config test/integration/vitest.config.ts x509 proxy` (Docker) -> 2 files, 18 tests passed; Node probe of the driver for `readPreferenceTags` with `primary` (see CR-3)

Acceptance criteria (unchanged from round 1, because no production or integration code changed):
- AC1 (X.509 user authenticates with a generated client cert; wrong cert -> AUTH_FAILED): met by `x509.int.spec.ts`. A foreign-CA certificate gives TIMEOUT/NETWORK_ERROR. That is recorded as an assumption and tested as "not AUTH_FAILED".
- AC2 (connection through a SOCKS5 container): met by `proxy.int.spec.ts`. The member names resolve only behind the proxy, so a successful connect proves that the proxy was used.
- AC3 (secondaryPreferred routes reads to a secondary, `hello.me`): met at the driver-client level. The gap in the app's raw `db.command()` paths is tracked in `tasks/raw-cmd-read-pref.md` and documented in `docs/ARCHITECTURE.md`. The split is sound.

Round-2 check of the new tests against CR-1:
- UserNotFound while connecting is AUTH_FAILED. `errors.spec.ts` covers code 11, `codeName`, and both, also inside a server-selection error and a cause chain. `toConnectError(..., true)` gets the AUTH prefix and no `detail`.
- UserNotFound outside a connect stays SERVER_ERROR. Covered with `connecting` false and with the default, and through `toConnectError` with `detail { serverCode: 11, codeName }`. `manager.spec.ts` "UserNotFound on an open connection (serverInfo) stays SERVER_ERROR" checks that `serverInfo()` (manager.ts:262) keeps `connecting = false`. `open` and `test` (connect and ping) check the true path. If `connecting` were passed from the wrong call site, these tests would fail.
- `ERR_OSSL_*` is TLS_ERROR. Covered for three codes and for a wrapped cause. The tests also check that it ranks below AUTH_FAILED and above NETWORK_ERROR, and that a code which only contains `ERR_OSSL_` in the middle is not TLS. `toConnectError` gets the TLS prefix.
- `proxy` in `matchesSaved` (manager.ts:302). Covered when the draft changes the host, port or user, removes the proxy, or adds one. In each case `loadSecrets` is not called and no stored proxy password reaches the client options. The test with the same proxy and reordered keys does get the stored password. I checked by reasoning that removing the `proxy` comparison would make the "removes the proxy" and the three "another proxy ..." cases fail, because `loadSecrets` would be called and the connect would succeed. The tests are therefore real guards and not tautologies.
- The tests assert behavior: client options that reach the injected `createClient`, error codes and messages, log lines, and `loadSecrets` calls. The `options.spec.ts` constructor tests use the real `MongoClient`, without connecting, to show that the driver accepts the produced options. All fixture secrets are fictitious literals. No test was removed or weakened.
- One note, not a finding: `options.spec.ts` "ignores a key file without a certificate file" pins the current CR-2 behavior. If CR-2 is fixed later, that test has to change on purpose.

CR-1 is resolved.

Dispositions proposed by the parent:
- CR-2 `accepted` (form validation belongs to `conn-ui-m2`): confirmed as acceptable for a P3. `conn-ui-m2` has the criterion "Component tests for field validation ... of the new options", but it does not name this rule. A renderer check also would not cover profiles that reach the backend another way (an RPC without the form, an import). The `quality.json` note should therefore say that the backend keeps ignoring `keyFile` without `certificateKeyFile`. The parent should also add the rule to `conn-ui-m2` (a note or an assumption) so it is not lost.
- CR-3 `accepted`: the disposition is fine, but the proposed reason ("driver ignores tags") restates the defect and does not justify accepting it. A sound note would be: P3, no wrong data is written, reads only go to the primary instead of the tagged member, and the form validation in `conn-ui-m2` is the planned place to reject tags without a non-primary read preference. As with CR-2, the rule should be recorded on `conn-ui-m2`.
- CR-4 `accepted` (test-only image, `latest` was the only tag verified): confirmed. The image is used only by the integration fixture. It does not ship and does not run in `.taskcheck`.

Security notes (no findings; unchanged from round 1):
- `proxyPassword` and `tlsKeyPassphrase` go only into driver options and are redacted from every log line and connect error. The new manager tests check this for the proxy password, also when an error message contains it.
- `matchesSaved` compares `proxy`, so a changed draft cannot pull the stored proxy password to another host. The new tests now cover this.
- The fixtures generate all keys and passwords at runtime. No credentials are committed in the code or in the new tests.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [x] **CR-1 | New error-classification and secret-matching rules have no unit tests** (round 1; resolved in abf63eb)
    - File: `packages/backend/src/connections/errors.ts:113`, `packages/backend/src/connections/errors.ts:104`, `packages/backend/src/connections/manager.ts:302`
    - Category: Tests
    - Problem: In round 1, no unit test covered the UserNotFound split by `connecting` (in particular SERVER_ERROR outside a connect and `serverInfo()` passing false), `ERR_OSSL_*` as TLS, or `proxy` in `matchesSaved`.
    - Why it matters: These are context-dependent and secret-protection rules, and only the always-run unit suite protects them.
    - Suggested fix: Unit tests in `errors.spec.ts` and `manager.spec.ts`.
    - Status (round 2): Resolved. abf63eb adds the requested tests. They cover all three rules and would fail on the regressions described. See "Round-2 check" above.

## P3 Low

- [ ] **CR-2 | `tls.keyFile` without `certificateKeyFile` is silently ignored** (round 1; open, proposed disposition `accepted`)
    - File: `packages/backend/src/connections/options.ts:69`
    - Category: Correctness
    - Problem: `keyFile` is read only inside `if (tls.certificateKeyFile !== undefined)`. A profile that sets only `keyFile` connects without a client certificate and gives no hint. The contract allows this combination. abf63eb now pins this behavior in a test (`options.spec.ts` "ignores a key file without a certificate file"). The X.509 case already gives AUTH_FAILED.
    - Why it matters: For non-X.509 profiles the user later sees a misleading TLS or server error instead of a configuration error.
    - Suggested fix: Return a TLS_ERROR, or reject the combination in the contract. If the finding is accepted, record the rule on `conn-ui-m2`.
    - Status (round 2): Accepting it is acceptable for a P3. See "Dispositions" above for the note it needs.

- [ ] **CR-3 | `readPreferenceTags` with a `primary` or missing read preference is silently dropped** (round 1; open, proposed disposition `accepted`)
    - File: `packages/backend/src/connections/options.ts:123`
    - Category: Correctness
    - Problem: The contract doc (`packages/contract/src/profiles.ts:153`) says tags need a non-primary `readPreference`, but nothing enforces it. The installed driver accepts the combination and drops the tags.
    - Why it matters: A profile that looks like it routes reads by tag sends all reads to the primary, and nothing tells the user.
    - Suggested fix: Reject the combination in the contract (`superRefine`) or in `clientConfig`, or at least in the `conn-ui-m2` form.
    - Status (round 2): Accepting it is acceptable, but the note must state the real reason (P3, reads still succeed on the primary, form validation planned in `conn-ui-m2`). "The driver ignores tags" is not a reason.

- [ ] **CR-4 | SOCKS fixture image is not pinned** (round 1; open, proposed disposition `accepted`)
    - File: `test/integration/fixtures/socks.ts:19`
    - Category: Quality
    - Problem: `docker.io/serjs/go-socks5-proxy:latest` is used. The other fixture images are pinned to a version tag.
    - Why it matters: An upstream change can break the integration tests without any change in the repository.
    - Suggested fix: Pin a tag or digest.
    - Status (round 2): Accepting it is confirmed. The image is test-only, and `latest` was the only tag verified.

## Review conclusion

No material issues found. In the final revision abf63eb, all acceptance criteria are met. The new unit tests resolve CR-1: they cover the UserNotFound/connecting split, `ERR_OSSL_*` as TLS, and `proxy` in `matchesSaved` with behavior-level assertions. `npm run check` passes. CR-2 to CR-4 are P3 and non-blocking. Accepting them is fine, provided the `quality.json` notes for CR-2 and CR-3 give the reasons stated above, and both rules are recorded on `conn-ui-m2`.
