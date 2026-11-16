# Code Review

Date: 2026-11-16

Task: uri-model - Core: connection profile ⇄ connection string (second pass, final revision 645c0a4)

Scope: `git diff ea59a3ddbc07b4922bbc5111b2074a0ecff847f5 645c0a4 -- packages package-lock.json` (packages/core/src/uri/*, packages/core/src/index.ts, packages/core/package.json, package-lock.json). Committed changes only; the working tree was clean. Fix commits checked separately with `git diff edb078d 645c0a4` (convert.ts, mask.ts and their specs).

Requirements:
- tasks/uri-model.md acceptance criteria, goal and recorded assumptions #1-#4
- SPEC.md §6 ("logs and error messages mask passwords in URIs"), SPEC.md §3 (form ⇄ URI)
- docs/ARCHITECTURE.md (core free of Node/Electron APIs, `mongodb-connection-string-url` dependency)
- AGENTS.md, previous review (CR-1..CR-4), reviews/uri-model/fixes.md, reviews/uri-model/tests.md

Git range:
- Branch: main
- HEAD: 645c0a4
- Base/start: ea59a3ddbc07b4922bbc5111b2074a0ecff847f5 (`git merge-base HEAD origin/main`)
- Commits reviewed: 3 (edb078d implementation, 9476472 test-writer tests, 645c0a4 fixes)

Commands run:
- `cd packages/core && npx vitest run src/uri` -> 2 files, 200 tests passed
- `node -e` with `mongodb-connection-string-url` (read-only probe): `mongodb://u:my secret@h` -> accepted (password `my%20secret`); `mongodb://u:a<TAB>b@h` -> accepted; `mongodb://u:@h` -> accepted
- `node --experimental-strip-types` probe of `maskText` from `src/uri/mask.ts`:
  - `log: mongodb://u:my secret@h/db failed` -> returned unchanged (password visible)
  - `{"uri":"mongodb://u:p@h","email":"x:y@z"}` -> `{"uri":"mongodb://u:****@z"}`
  - `mongodb://u:pw@h/db"` -> `mongodb://u:****@h/db"`
- Read `node_modules/mongodb-connection-string-url/lib/index.js` lines 85-135 (userinfo validation)

Summary: 0 P0, 0 P1, 1 P2, 1 P3

Status of earlier findings:
- CR-1 (P1, `maskText` leak on quotes/`<`/`>`/backtick): resolved. `URI_IN_TEXT` (mask.ts:17) now runs to the next whitespace or next scheme; `toConnectionString` encodes `'` (convert.ts:418-420). Covered by mask.spec.ts:124-147 and the all-specials test at mask.spec.ts:150-166. A remaining, pre-existing whitespace case is reported as CR-5.
- CR-2 (P2, empty user info): resolved. convert.ts:436-439 treats `''` as no user name and throws `ConnectionStringError` for a password without a user name; tests at convert.spec.ts:200-215 assert it and the old test locking in the defect was replaced.
- CR-3 (P3, socket path in brackets): resolved. convert.ts:406 brackets only hosts with `:` and no `/`; round-trip test at convert.spec.ts:~220-226.
- CR-4 (P3, `__proto__`/prototype keys): resolved. `setOwn` (convert.ts:57-59) and `Object.hasOwn` in `addExtra`/`parsePairs`; tests at convert.spec.ts:392-410.

Acceptance criteria:
- AC1 (20+ round-trip URIs incl. SRV, IPv6, encoded credentials, authMechanismProperties): met (fixtures.ts, convert.spec.ts round-trip and idempotence tests pass).
- AC2 (unknown options preserved in `extra`, test): met, including prototype-named keys.
- AC3 (`mask()` never leaks the password in any test URI, test): met; `mask()` and `maskText()` checked over all fixtures and every printable ASCII special character.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-5 | `maskText()` still leaks a password that contains raw whitespace**
    - File: `packages/core/src/uri/mask.ts:17` (`URI_IN_TEXT`), used by `maskText` at `mask.ts:109-111` and `parseConnectionString` at `convert.ts:378`
    - Category: Security
    - Problem: the match ends at the first whitespace. The library accepts an unencoded space (or tab) in the password (`mongodb://u:my secret@h` parses; whatwg-url percent-encodes it), so such a URI is valid and usable. `maskText('log: mongodb://u:my secret@h/db failed')` matches only `mongodb://u:my`, which has no `@`, so `mask()` returns it unchanged and the whole password stays in the text (verified by probe). Not a regression of the fix (the old regex also stopped at whitespace), and URIs written by `toConnectionString` are safe because it encodes the space as `%20`; the exposure is a user-pasted/typed URI that reaches a log line.
    - Why it matters: SPEC §6 requires logs to mask passwords in URIs; `maskText` is that path, and this input is accepted by the driver.
    - Suggested fix: let the regex take an optional credentials part that may contain spaces/tabs (not newlines) up to an `@`, e.g. `mongodb(?:\+srv)?:\/\/(?:[^\s@/?#]*:[^@\r\n/?#]*@)?…` before the existing `\S` run, so `mask()` sees the full user info (over-masking in odd text is acceptable per the `mask()` contract). Add `mongodb://u:my secret@h` and a tab variant to the `maskText` leak tests.

## P3 Low

- [ ] **CR-6 | `maskText()` rewrites the host in compact JSON log lines that contain a later `@`**
    - File: `packages/core/src/uri/mask.ts:17` together with `mask.ts:86-101`
    - Category: Quality
    - Problem: because the match now runs to the next whitespace, in compact JSON (no spaces, as `JSON.stringify` produces) the token swallows following fields. For a URI without `/`, `?` or `#`, `mask()` then takes the last `@` of the whole token as the end of the credentials: `{"uri":"mongodb://u:p@h","email":"x:y@z"}` becomes `{"uri":"mongodb://u:****@z"}`, i.e. the logged host is shown as `z` and the `email` field disappears (verified by probe). No secret leaks (it masks more), and fixes.md documents a related trade-off, but the output is misleading rather than just over-masked.
    - Why it matters: structured log lines are a likely use of `maskText`; a wrong host in a connection-failure log hampers diagnosis.
    - Suggested fix: in `maskText`, trim the token at a quote that is followed by a JSON/text delimiter (`",`, `"}`, `',` ...) once the credentials end (an `@`) has been found before it, or only extend past a quote when no `@` precedes it; add a test with a compact JSON line.

## Review conclusion

Material issues found; fix before completing the task. CR-1..CR-4 are resolved and no regression of the fixed behavior was found; all 200 uri tests pass. CR-5 (P2) is a remaining `maskText` password leak for driver-valid URIs with raw whitespace in the password and should be fixed or explicitly accepted by the parent worker as a recorded assumption; CR-6 (P3) is a non-security log-fidelity issue.
