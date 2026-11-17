# Code Review

Date: 2026-11-17

Task: ldap-auth - M5: LDAP (PLAIN) authentication

Scope: full task diff `git diff 0522253..91b6f09 -- . ':!tasks' ':!reviews'` (commits 5e74591 and 91b6f09), re-review at the final revision with focus on the tests added in 91b6f09. Production code is unchanged since the earlier review of 93bacf7 (= rebased 5e74591); 91b6f09 touches only test files.

Requirements:
- tasks/ldap-auth.md acceptance criterion: "Integration test: LDAP user authenticates; wrong password → AUTH_FAILED (Enterprise + OpenLDAP fixtures)", plus the two recorded assumptions ($external always; image choices, user-to-DN mapping, no LDAP authz query)
- SPEC.md M5 and section 7 (Enterprise + OpenLDAP integration fixture via `npm run test:int`)
- docs/ARCHITECTURE.md connections section
- AGENTS.md (no secrets in fixtures, generated test credentials)
- Sibling convention: packages/backend/src/auth/aws

Git range:
- Branch: main
- HEAD: 91b6f0907ffb4b118dce258fae8bc612c7ded67f
- Base/start: 0522253eb061ae71c6f8eda3e7c74fd5568a1bbd (`git merge-base HEAD origin/main`)
- Commits reviewed: 2 (5e74591, 91b6f09)

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## What was checked

- Production code (`auth/ldap/ldap.ts`, `auth/ldap/index.ts`, `connections/options.ts`), the fixture (`test/integration/fixtures/ldap.ts`) and `docs/ARCHITECTURE.md` are identical to the revision reviewed earlier; the earlier assessment stands (PLAIN mapped to `$external` with user/password in driver options, password never in the URI or error messages, `AUTH_FAILED` before connecting without user or password, generated fixture passwords, cleanup on partial start failure).
- New tests in 91b6f09:
  - `ldap.spec.ts`: `secretMode: 'ask'` uses the typed password. Correct and matches the documented contract.
  - `options.spec.ts`: a percent-encoded URI user resolves to the decoded name and the real `MongoClient` reports mechanism `PLAIN`, source `$external`, overriding `authSource`/`authMechanism` in the URI; TLS options survive next to the LDAP options; the three refusal cases (no password, `secretMode: 'none'`, no user anywhere) answer `AUTH_FAILED` without leaking the password; an unparseable connection string yields `AUTH_FAILED` instead of a crash. These assert observable behaviour (resulting driver credentials, error codes), not internals.
  - `ldap.int.spec.ts`: against the real Enterprise + OpenLDAP fixture, a profile `authSource: 'admin'` plus URI `authSource=admin&authMechanism=SCRAM-SHA-256` still authenticates as `alice@$external` (end-to-end evidence for the `$external` assumption); a wrong password typed at connect (`secretMode: 'ask'`) gives `AUTH_FAILED` with the password absent from message and logs.
- No existing tests were removed or weakened; the `ldapProfile` helper change is additive.

## Validation run by the reviewer

- `npm run test:int -- ldap` (HEAD 91b6f09, Podman/Testcontainers) -> 1 file, 8 tests passed, 9.3 s.
- `npm run test -w packages/backend` -> 29 files, 1175 tests passed.
- `npx vitest run packages/backend/src/auth/ldap packages/backend/src/connections/options.spec.ts` -> 2 files, 80 tests passed.
- `npx eslint` on the three changed test files and `auth/ldap` -> no findings; `npm run typecheck` -> passed.

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
