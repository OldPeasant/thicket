# Code Review

Date: 2026-11-16

Task: uri-model - Core: connection profile ⇄ connection string (sixth pass, final revision f477ad0)

Scope: `git diff f367a4947439fde3900886bc89cf0611cc5c33a8 f477ad0 -- packages` (packages/core/src/uri/*, packages/core/package.json, packages/core/src/index.ts). Committed changes only; the working tree was clean. Delta since the fifth pass: `git show f477ad0` changes only `packages/core/src/uri/mask.ts` (`uriEnd` loop made linear, `endsInQuery` removed, one redundant line removed from `endsInSecretOption`), plus `reviews/uri-model/fixes.md` "Round 5".

Requirements:
- tasks/uri-model.md acceptance criteria and recorded assumptions
- SPEC.md §6 ("logs and error messages mask passwords in URIs"; over-masking acceptable, leaking not)
- docs/ARCHITECTURE.md, AGENTS.md, docs/QUALITY.md
- previous review rounds (CR-1..CR-9), reviews/uri-model/fixes.md "Round 5", reviews/uri-model/tests.md (TW-8)

Git range:
- Branch: main
- HEAD: f477ad045b5bc451aff6ac33539db35af2572092
- Base/start: f367a4947439fde3900886bc89cf0611cc5c33a8
- Commits reviewed: 11 (9e0636d .. f477ad0); this pass focuses on f477ad0

Commands run:
- `cd packages/core && npx vitest run` -> 3 files, 308 tests passed (includes the TW-8 test `masks a long line of prose after a query in linear time`, mask.spec.ts:554)
- `git show f477ad0 -- packages`, full read of `packages/core/src/uri/mask.ts`, grep for callers of `endsInSecretOption` / `endsInQuery` in the current tree and in 3c06ebd.
- Ad-hoc `node` timing probes and a differential run against the previous revision were not possible in this session (the shell refused those commands). The equivalence and complexity conclusions below come from reading the code; the timing evidence is the committed TW-8 test and the fixer's recorded differential check (fixes.md "Round 5").

Summary: 0 P0, 0 P1, 0 P2, 1 P3

Status of earlier findings:
- CR-1 (P1), CR-2 (P2), CR-3 (P3), CR-4 (P3), CR-5 (P2): still resolved; convert.ts unchanged since earlier rounds, tests pass.
- CR-6 (P3, compact JSON host rewrite): accepted over-masking, unchanged.
- CR-7 / TW-6 (P3): still resolved.
- CR-8 / TW-7 (P3): still fixed (since 5670ad7). The task note "CR-8 accepted (P3)" in tasks/uri-model.md still describes it as accepted; the parent worker may want to record an assumption that it was fixed (task metadata, not code).
- CR-9 / TW-8 (P2, quadratic `maskText()` after a query): fixed by f477ad0, see below.
- TW-5: still resolved.

CR-9 fix verification (mask.ts:170-206):
- Query state: the old `endsInQuery(text.slice(start, runEnd))` tested "first `?` of the body exists and no `#` after it". The new code scans only `text.slice(scanned, runEnd)` with `scanned` starting at `bodyStart` (not at `end`, so the credentials part skipped by the CR-5 `@` step is still scanned, as before). On the first run with no `?` it returns `runEnd` (old result: same). If the first run has a `?`, `inQuery` becomes true and a `#` after that `?` in the same run returns (old: `indexOf('#', q)`, same). Later runs only start after the first `?`, so any `#` in them is after it (old: same). `inQuery` can only be false on the first iteration, because a false result returns. Equivalent.
- Embedded scheme search: `next` is searched once from `end` and only advanced after it lies inside a run. A kept match has `index >= runEnd`, and `runEnd` is a whitespace character, so `index >= runEnd + 1 = end` of the next iteration: the same match a fresh search from `end` would find. Equivalent.
- Removed line in `endsInSecretOption` (former line 135): without `/`, `?` or `#` the following `indexOf('?')` is -1 and the function returns false anyway; its only caller (`endsInSecret`, mask.ts:124) reaches it only when that search is >= 0. No behavior change.
- Complexity: per run the work is the run length (`ws.exec`, `slice`, `indexOf`/`includes`), and the scheme regex scans the text once per `uriEnd` call, so a long prose line after a query is linear. The TW-8 test asserts the 500 kB case stays under 200 ms or scales about linearly, and passes.
- Remaining super-linear path (not a finding): `endsInSecret(text.slice(start, next.index))` (mask.ts:184) still costs O(prefix) per embedded scheme. It is only reached repeatedly when many `mongodb://` occurrences sit on one line inside a secret option value (e.g. after `proxyPassword=` with no `&`), which predates this round (3c06ebd) and needs thousands of connection strings on one log line; the fixer recorded it in fixes.md. Not realistic for log lines and not a regression.

Regression check: no new leak and no behavior change found; all leak tests (fixtures, special characters, TW-4..TW-8) pass.

Acceptance criteria:
- AC1 (20+ round-trip URIs incl. SRV, IPv6, encoded credentials, authMechanismProperties): met; round-trip suites in convert.spec.ts pass, convert.ts unchanged this round.
- AC2 (unknown options preserved in `extra`): met; tests pass.
- AC3 (`mask()` never leaks the password in any of the test URIs): met; all mask/maskText leak tests pass.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-10 | `endsInSecretOption` keeps an `undecodable` parameter no caller sets**
    - File: `packages/core/src/uri/mask.ts:130-133` (doc comment and signature), used at 145 and 149
    - Category: Quality
    - Problem: The only call left is `endsInSecretOption(prefix)` at mask.ts:124, so `undecodable` is always `true`. The caller that passed `false` (the former `valueEnd` loop, still present in 3c06ebd at line 188) was removed in round 4, and the doc comment still describes the parameter as a choice.
    - Why it matters: A reader has to work out that the "undecodable returns false" path is dead; small, but this function is security-relevant (it decides whether a scheme belongs to a secret).
    - Suggested fix: Drop the parameter and return `true` directly for an undecodable key or `authMechanismProperties` value, and adjust the doc comment. Non-blocking; can also be accepted as is.

## Review conclusion

No material issues found. CR-9/TW-8 is fixed by f477ad0: the `uriEnd` loop is linear for prose after a query part and behaves the same as the previous revision (checked by reading the code; the fixer's recorded differential check agrees). CR-1..CR-8 and TW-5 stay resolved, CR-6 stays accepted, and all three acceptance criteria are met with 308 passing tests in packages/core. CR-10 is an optional P3 cleanup.
