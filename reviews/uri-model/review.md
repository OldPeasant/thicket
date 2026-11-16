# Code Review

Date: 2026-11-16

Task: uri-model - Core: connection profile ⇄ connection string (fourth pass, final revision 1aa5e91)

Scope: `git diff 0ba91a54cab66dd36e3a736a30972810e9410d1d 1aa5e91 -- packages package-lock.json` (packages/core/src/uri/*, packages/core/src/index.ts, packages/core/package.json, package-lock.json). Committed changes only; the working tree was clean. Delta since the third pass: `git show 1aa5e91` changes only `packages/core/src/uri/mask.ts` (`endsInSecret` port detection, new `endsInSecretOption`, `uriEnd` loop) plus `reviews/uri-model/fixes.md`; the tests for it were added in f174b72.

Requirements:
- tasks/uri-model.md acceptance criteria and recorded assumptions
- SPEC.md §6 ("logs and error messages mask passwords in URIs"; over-masking acceptable, leaking not)
- docs/ARCHITECTURE.md, AGENTS.md, docs/QUALITY.md
- previous reviews (CR-1..CR-7), reviews/uri-model/fixes.md "Round 3", reviews/uri-model/tests.md (TW-5, TW-6)

Git range:
- Branch: main
- HEAD: 1aa5e91
- Base/start: 0ba91a54cab66dd36e3a736a30972810e9410d1d
- Commits reviewed: 7 (f45b87e, be18afb, 18b946f, 91a0e9a, 7c7fa04, f174b72, 1aa5e91)

Commands run:
- `cd packages/core && npx vitest run` -> 3 files, 261 tests passed (including the TW-5 and three TW-6 rows that failed on the previous revision)
- Read `packages/core/src/uri/mask.ts` in full and the `git show 1aa5e91` diff.
- Read-only probes, `node --experimental-strip-types --input-type=module -e` importing `./src/uri/mask.ts` and `mongodb-connection-string-url`:
  - `log: mongodb://h/?proxyPassword=my pw&tls=true x` -> `...?proxyPassword=****&tls=true x` (CR-7/TW-6 fixed)
  - `x mongodb://h/?proxyPassword=a b&proxyPassword=c d&q=1 tail` -> both values masked, `&q=1 tail` kept
  - `log: mongodb://h/?proxyPassword=a b\nmongodb://u:pw@h2 end` -> stops at the line break, second password masked
  - `log: mongodb://h/?proxyPassword=a b#f mongodb://u:pw@h2 end` -> stops after the fragment, second password masked
  - `log: mongodb://h/?proxyPassword=a b mongodb://u:pw@h2/?x=1&proxyPassword=S end` -> swallowed into one token, `mongodb://h:****@h2/?x=1&proxyPassword=****` (over-masking, no leak)
  - `x mongodb://h/?proxyPassword=a  &&& b` -> `...proxyPassword=****&&& b` (loop terminates; each iteration advances past the previous run end)
  - `x mongodb://u:123-mongodb://digitTail@h y` -> `x mongodb://u:****@h y` (TW-5 fixed)
  - `x mongodb://h:27017,mongodb://b:pw@h2 y` -> still split, `b:****`; `x mongodb://h:27017;mongodb://b:pw@h2 y` -> merged as `mongodb://h:****@h2` (over-masking, no leak)
  - `log: mongodb://u:p@h/?appName=My App&proxyHost=x&proxyPassword=leakSecret1 done` -> unchanged after the user password; `leakSecret1` visible (see CR-8); the library parses this URI as valid with `proxyPassword` = `leakSecret1`
  - `log: mongodb://h/?authMechanism=MONGODB-AWS&authMechanismProperties=SERVICE_NAME:a b,AWS_SESSION_TOKEN:leakTok2 done` -> unchanged, token visible (see CR-8); the library parses it as valid

Summary: 0 P0, 0 P1, 0 P2, 1 P3

Status of earlier findings:
- CR-1 (P1, quote/`<`/`>`/backtick leak): still resolved; tests pass.
- CR-2 (P2, empty user info): still resolved (convert.ts unchanged).
- CR-3 (P3, socket path brackets): still resolved (convert.ts unchanged).
- CR-4 (P3, prototype keys in `extra`): still resolved (convert.ts unchanged).
- CR-5 (P2, raw whitespace in the user password): still resolved; tests pass.
- CR-6 (P3, compact JSON host rewrite): accepted over-masking, unchanged.
- CR-7 / TW-6 (P3, raw whitespace inside a secret option value): resolved by 1aa5e91. `uriEnd` (mask.ts:174-194) carries a secret option value across whitespace to the next `&`, `#` or line break; probes above show no leak and no runaway loop. The task note "CR-7 accepted: maskText masks only the first word ..." no longer describes the code; the parent worker may want to record that it was fixed instead.
- TW-5 (digits-only password before an embedded scheme): resolved; the port regex (mask.ts:122) now requires a host delimiter after the digits. Joined strings after a real port still split; other separators merge and mask more, never less.

No regression found in 1aa5e91: all previous tests pass and the over-masking it adds (prose up to the next `&`/`#`/line break) is documented and acceptable under SPEC §6.

Acceptance criteria:
- AC1 (20+ round-trip URIs incl. SRV, IPv6, encoded credentials, authMechanismProperties): met; round-trip suites pass.
- AC2 (unknown options preserved in `extra`): met; tests pass.
- AC3 (`mask()` never leaks the password in any of the test URIs): met; all fixture and special-character tests pass. CR-8 concerns `maskText()` on hand-typed URIs outside the test set.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-8 | `maskText()` leaks a secret option that follows a raw space in a non-secret option value**
    - File: `packages/core/src/uri/mask.ts:187-188` (`uriEnd`: a run that ends at whitespace outside a secret value ends the connection string)
    - Category: Security
    - Problem: The TW-6 fix carries the token past whitespace only when the whitespace falls inside a secret value. When it falls inside an earlier non-secret value, the token ends there and any secret option after it stays in the plain text. Verified by probe: `mongodb://u:p@h/?appName=My App&proxyHost=x&proxyPassword=leakSecret1` -> `proxyPassword=leakSecret1` visible; `authMechanismProperties=SERVICE_NAME:a b,AWS_SESSION_TOKEN:leakTok2` -> token visible. `mongodb-connection-string-url` parses both as valid, with the secret as the option value, so the driver would use them. Not a regression (the previous revisions behaved the same); same exposure class as CR-7: only hand-typed or pasted URIs, since `toConnectionString` percent-encodes spaces. A raw space in `appName` is the most plausible trigger.
    - Why it matters: SPEC §6 says leaking a secret in logs is not acceptable; the leaked text is the proxy password or AWS session token.
    - Suggested fix: when the run ends at whitespace inside the query (after `?`, before `#`) of a token, and the text after the whitespace up to the next whitespace/line break contains `&<secret key>=` or a secret `authMechanismProperties` entry, continue the token (same `&`/`#`/line-break rule as TW-6); simpler alternative: in the query part, always carry the token to the next `&`, `#` or line break, accepting more over-masking. Add tests for both probes above. Or record it as an accepted assumption, like CR-7 was.

## Review conclusion

No material issues found. CR-7/TW-6 and TW-5 are resolved by 1aa5e91 without regression (261 core tests pass, probes show no new leak or non-terminating loop); CR-1..CR-5 remain fixed and CR-6 stays accepted. CR-8 (P3) is an optional hardening for hand-typed URIs with a raw space in a non-secret option followed by a secret option; the parent worker may fix it or record it as an assumption.
