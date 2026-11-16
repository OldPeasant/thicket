# Fix Report

Date: 2026-11-17

Task: x509-proxy - M2: X.509, SOCKS5 proxy, read preference and write concern

Scope: current task. Approved finding CR-1 (P2) from `reviews/x509-proxy/review.md`. CR-2, CR-3 and CR-4 (P3) were accepted by the parent and were deliberately left unchanged.

Git scope examined: HEAD 4649c96 on main. Production diff `8942ecf~1..4649c96` for `packages/backend/src/connections/errors.ts` and `packages/backend/src/connections/manager.ts`. The test-writer's tests were added in 5d48082.

## Fixed findings

None. No code or test changes were needed (see below).

## Not fixed

### CR-1 - New error-classification and secret-matching rules have no unit tests

Status:
Invalid (no longer valid: already resolved by commit 5d48082)

Reason:
Each rule that the production diff introduced was checked against the existing tests:
- UserNotFound counts as AUTH_FAILED only while connecting (`errors.ts` `isAuth(c, connecting)`, `USER_NOT_FOUND = 11`). `errors.spec.ts` "UserNotFound (task x509-proxy)" covers code 11, `codeName`, and both, with `connecting` true (AUTH_FAILED), false, and the default (SERVER_ERROR). It also covers the error inside a server-selection failure, inside a cause chain, and the string code "11" (not matched). `toConnectError(..., true)` gets the AUTH prefix, and otherwise it returns SERVER_ERROR with `detail { serverCode: 11, codeName }`.
- Call sites pass the right `connecting` value. `manager.spec.ts` checks that UserNotFound is AUTH_FAILED while opening and while testing (both connect and ping), and that it stays SERVER_ERROR on an open connection (`serverInfo`).
- `ERR_OSSL_*` is TLS_ERROR (`isTls`). `errors.spec.ts` "OpenSSL errors (task x509-proxy)" covers three OSSL codes and a wrapped cause. It also checks the ranking below AUTH_FAILED and above NETWORK_ERROR, and that a code with `ERR_OSSL_` in the middle is not TLS. `toConnectError` gets the TLS prefix.
- `proxy` in `matchesSaved`. `manager.spec.ts` "ConnectionManager proxy and X.509 (task x509-proxy)" covers these cases: the same proxy with keys reordered gets the stored proxy password. A changed host, port or user, a removed proxy, or an added proxy gets no stored secrets (`loadSecrets` not called, no `proxyPassword` in the client options). The proxy password never reaches log lines or error messages.

Nothing in CR-1 is still uncovered, so no test was added. This agrees with the round-2 review, which marks CR-1 as resolved.

### CR-2, CR-3, CR-4 (P3)

Status:
Out of scope for this fixer run

Reason:
The parent accepted these findings and asked for them to stay unchanged. Their dispositions are recorded by the parent in `quality.json`.

## Validation summary

Focused tests:
- `cd packages/backend && npx vitest run src/connections` - Pass (4 files, 206 tests)

Full test suite:
- Not run by the fixer, because nothing changed. The round-2 review recorded `npm run check` passing on the same code.

Lint/type-check/build:
- Not applicable (no changes)

`.taskcheck`:
- Not run (no changes; the parent runs it before `done`)

Remaining unresolved findings:
0 (CR-1 is resolved. CR-2, CR-3 and CR-4 were accepted by the parent and are not counted as unresolved.)

## Final status

No valid findings required code changes.
