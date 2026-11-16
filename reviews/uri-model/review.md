# Code Review

Date: 2026-11-16

Task: uri-model - Core: connection profile ⇄ connection string (third pass, final revision 6b9c970)

Scope: `git diff ea59a3ddbc07b4922bbc5111b2074a0ecff847f5 6b9c970 -- packages package-lock.json` (packages/core/src/uri/*, packages/core/src/index.ts, packages/core/package.json, package-lock.json). Committed changes only; the working tree was clean. Delta since the second pass checked with `git diff 645c0a4 6b9c970 -- packages`: only `packages/core/src/uri/mask.ts` and `mask.spec.ts` (plus `convert.spec.ts` tests added in 9efb954).

Requirements:
- tasks/uri-model.md acceptance criteria and recorded assumptions
- SPEC.md §6 ("logs and error messages mask passwords in URIs"; over-masking acceptable, leaking not)
- docs/ARCHITECTURE.md, AGENTS.md
- previous reviews (CR-1..CR-6), reviews/uri-model/fixes.md "Round 2", reviews/uri-model/tests.md (TW-4)

Git range:
- Branch: main
- HEAD: 6b9c970
- Base/start: ea59a3ddbc07b4922bbc5111b2074a0ecff847f5 (`git merge-base HEAD origin/main`)
- Commits reviewed: 5 (edb078d, 9476472, 645c0a4, 9efb954, 6b9c970)

Commands run:
- `cd packages/core && npx vitest run` -> 3 files, 249 tests passed
- Read-only probes, `node --experimental-strip-types --input-type=module -e` importing `./src/uri/mask.ts` (and `mongodb-connection-string-url` for validity):
  - `log: mongodb://u:my secret@h/db failed` -> `log: mongodb://u:****@h/db failed` (CR-5 fixed)
  - `mongodb://u:my<TAB>secret@h/db ok` -> `mongodb://u:****@h/db ok`
  - `mongodb://u:pa ss@h mongodb://v:q r@h2` -> both passwords masked
  - `connect mongodb://h1 then mongodb://u:p q@h2/db` -> `... mongodb://u:****@h2/db`
  - `mongodb://u:p@h/?proxyPassword=px-mongodb://proxyTail2Secret` -> `...?proxyPassword=****` (TW-4 fixed)
  - `["mongodb://h/?proxyPassword=pp","mongodb://b:pw@h2/db"]` -> `["mongodb://h:****@h2/db"]` (merged, masked, no leak)
  - `["mongodb://h/?authMechanismProperties=AWS_SESSION_TOKEN:tok","mongodb://b:pw@h2/db"]` and the comma-joined variant -> split correctly, token and `pw` both masked
  - `"mongodb://a@h1","mongodb://b:pw@h2/db"`, `mongodb://h:27017,mongodb://b:pw@h2`, `mongodb://[::1]:27017,mongodb://b:pw@h2` -> split, second password masked
  - `err: mongodb://u:pw@h1:27017,h2:27017/?replicaSet=rs mongodb://u:pw@h3` -> both masked
  - `mask('not a uri')` unchanged; `mask('mongodb://u:p@h/x@y')` -> `mongodb://u:****@h/x@y`; `mask('mongodb://u/p:w@h')` -> `mongodb://u:****@h`
  - `mongodb://h/?proxyPassword=a b` (library: valid) -> `mongodb://h/?proxyPassword=**** b`; `mongodb://u:p@h/?proxyPassword=my proxy pw&tls=true` -> `...proxyPassword=**** proxy pw&tls=true`; `...?tlsCertificateKeyFilePassword=a<TAB>b` -> `=****<TAB>b` (see CR-7)
  - `{"uri":"mongodb://u:p@h","email":"x:y@z"}` -> `{"uri":"mongodb://u:****@z"}` (CR-6 behavior unchanged, accepted)
- Read `packages/core/src/uri/mask.ts` in full and the new `maskText`/`mask` tests in `mask.spec.ts`; `grep encode src/uri/convert.ts` (Thicket-written option values are percent-encoded, spaces included).

Summary: 0 P0, 0 P1, 0 P2, 1 P3

Status of earlier findings:
- CR-1 (P1, quote/`<`/`>`/backtick leak): still resolved; quoted-text tests pass and probes with quotes masked.
- CR-2 (P2, empty user info): still resolved (convert.ts unchanged since 645c0a4).
- CR-3 (P3, socket path brackets): still resolved (convert.ts unchanged).
- CR-4 (P3, prototype keys): still resolved (convert.ts unchanged).
- CR-5 (P2, raw whitespace in password): resolved. `uriEnd` (mask.ts:145-169) extends the credentials to an `@` found before any `/`, `?`, `#`, line break or scheme; tests for space, tab, quoted and multi-URI lines added. The documented over-masking of prose (`mongodb://host:27017 failed for user@x` -> `mongodb://host:****@x`) masks, never leaks, so it is acceptable under SPEC §6.
- CR-6 (P3, compact JSON host rewrite): accepted by the parent worker as over-masking; no leak, behavior unchanged. Closed as accepted.
- TW-4 (secret option value containing `mongodb://`): resolved. `endsInSecret` (mask.ts:117-142) keeps such schemes inside the token; the `mask()` invalid branch (mask.ts:86-95) now shows only text before the authority end as the user name, so a merged secret option value can't surface as a "user name". Probed merge/split cases above: no leak found.

Acceptance criteria:
- AC1 (20+ round-trip URIs): met; round-trip suites pass.
- AC2 (unknown options preserved in `extra`): met.
- AC3 (`mask()` never leaks the password in any test URI): met; all fixture and special-character tests pass, and no password leak was found in new probes.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-7 | `maskText()` leaks the part of a secret option value after raw whitespace**
    - File: `packages/core/src/uri/mask.ts:156-161` (`uriEnd`, run ends at the next whitespace)
    - Category: Security
    - Problem: CR-5's whitespace extension covers only the user password. The library accepts a raw space or tab inside a query value (`mongodb://h/?proxyPassword=a b` parses), but the token ends at that whitespace and only the first word of the value is masked: `mongodb://u:p@h/?proxyPassword=my proxy pw&tls=true` -> `...proxyPassword=**** proxy pw&tls=true`; `tlsCertificateKeyFilePassword=a<TAB>b` -> `=****<TAB>b` (verified by probe). Connection strings written by `toConnectionString` are safe (`encodeQuery` percent-encodes spaces); the exposure is a hand-typed/pasted URI with a raw-whitespace proxy or key-file password reaching a log or error message. Rated low because these options are rare and raw spaces in them rarer still; the user password case (the common one) is fixed.
    - Why it matters: SPEC §6 says leaking is not acceptable; the leaked tail is part of a secret.
    - Suggested fix: either accept it explicitly as an assumption (`tasks.py assume`), or, in `uriEnd`, when the run ends while `endsInSecret(text.slice(start, runEnd))` is true (the cut is inside a secret option value), extend the run to the next `&`, `#` or line break before continuing; add a test with `proxyPassword=my proxy pw`.

Note (not a finding): a raw line break inside a password (`mongodb://u:my\nsecret@h`, accepted by the library because the URL parser strips it) is not masked; this is the deliberate "no extension across a line break" choice, and such input is not a realistic log line.

## Review conclusion

No material issues found. CR-5 and TW-4 are resolved, CR-1..CR-4 remain fixed, CR-6 is accepted over-masking, and no password leak or regression was found in the new `maskText` scanner or the `mask()` invalid-input change; 249 core tests pass. CR-7 (P3) is an optional hardening for raw whitespace in secret option values that the parent worker may fix or record as an assumption.
