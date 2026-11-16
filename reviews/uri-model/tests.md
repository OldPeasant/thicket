# Test Report

Date: 2026-11-16

Task: uri-model - Core: connection profile ⇄ connection string (third pass, revision 6b9c970 after fixes Round 2)

Scope: `git diff ea59a3ddbc07b4922bbc5111b2074a0ecff847f5 6b9c970b0837f7f6b83e9965a761ad2f500d2847` on branch `main` (base = `git merge-base HEAD origin/main`; HEAD = `6b9c970b0837f7f6b83e9965a761ad2f500d2847`). Task-owned commits: `edb078d` (implementation), `9476472`, `645c0a4`, `9efb954`, `6b9c970` (test passes, reviews, fixes). Production files of the task: `packages/core/src/uri/{convert,mask,model,index}.ts`, `packages/core/src/index.ts` (re-export), `packages/core/package.json` / `package-lock.json` (dependency). Since the last test pass (`645c0a4`) only `packages/core/src/uri/mask.ts` changed in production code (`maskText` rewritten as a scanner: `endsInSecret`, `uriEnd`; `mask()` invalid-URI branch limits the visible user name), confirmed with `git diff 645c0a4 6b9c970 --stat`. This pass focuses on that new code; the whole task scope is re-run and re-measured. Uncommitted at measurement time: `packages/core/src/uri/mask.spec.ts` (this pass) and `reviews/uri-model/review.md` (code-reviewer, not touched by me).

Requirements:
- `tasks/uri-model.md` acceptance criteria and recorded assumptions (mask hides password, proxyPassword, tlsCertificateKeyFilePassword, AWS_SESSION_TOKEN; maskText masks URIs in free text)
- `SPEC.md`: "logs and error messages mask passwords in URIs"
- `reviews/uri-model/fixes.md` Round 2 (TW-4, CR-5 fixes to verify), `reviews/uri-model/review.md`
- Parent worker instructions for this pass

## Test files changed

- `packages/core/src/uri/mask.spec.ts`

## Tests added or updated

Count: 12 (new `describe('maskText scanner boundaries')` in `mask.spec.ts`, counting each `it.each` row). No existing test changed or removed. Core suite: 249 -> 261 tests.

- Branch coverage of `endsInSecret` / `uriEnd` (pass): split after an IPv6 host with port; after a fragment following the query; after an option without `=`; after a non-secret `authMechanismProperties` entry (with and without `:`); no split inside the value of an undecodable option key (`%ZZ=`) or an undecodable `authMechanismProperties` value (exact masked output asserted); no split inside an upper-case `PROXYPASSWORD` value with an upper-case embedded scheme.
- `accepts a raw space in a secret option value, like the driver` (pass): `parseConnectionString('mongodb://h/?proxyHost=p&proxyPassword=my spaceOptSecret').proxy.password === 'my spaceOptSecret'`.
- `does not start a new connection string at a scheme after a digits-only password prefix` (fails, TW-5).
- `masks a secret option value containing a raw space: %s` (3 rows, all fail, TW-6).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Round-trip tests for 20+ URIs incl. SRV, IPv6, encoded credentials, authMechanismProperties | `connection string round trip` (34 fixtures + count check), `toConnectionString`, `parseConnectionString edge cases` (convert.spec.ts, unchanged since pass 2) | `npx vitest run --root packages/core` | Pass |
| AC2 Unknown options preserved in `extra` | `unknown options`, `unknown options named like Object.prototype members` | `npx vitest run --root packages/core` | Pass |
| AC3 `mask()` never leaks the password in any of the test URIs | `mask` over all fixtures, special-character rows, `mask edge cases`; `mask()` assertions in the new TW-5/TW-6 tests also pass | `npx vitest run --root packages/core` | Pass |
| TW-4 fix: secret option value containing a scheme | `hides secret option values that contain a connection-string scheme`, new undecodable-key / undecodable-AMP / upper-case tests | `npx vitest run --root packages/core` | Pass |
| CR-5 fix: raw space/tab in the user password | `masks passwords containing a raw space or tab`, line-break and over-masking tests | `npx vitest run --root packages/core` | Pass |
| Splitting of joined connection strings still works | `still splits connection strings joined ...`, new IPv6/fragment/flag/non-secret AMP tests | `npx vitest run --root packages/core` | Pass |
| SPEC: logs mask passwords (`maskText`), remaining cases | new TW-5 and TW-6 tests | `npx vitest run --root packages/core` | Fail: 4 tests (TW-5, TW-6) |

## Focused test execution

Command:

`npx --prefix . vitest run --root packages/core` (also run filtered with `src/uri/mask.spec.ts -t "scanner boundaries"`)

Result:

Fail: Test Files 1 failed | 2 passed (3); Tests 4 failed | 257 passed (261). The 4 failures are the new TW-5 (1) and TW-6 (3) tests. All Round 2 fixes (TW-4, CR-5, `mask()` invalid-branch change) are verified by passing tests.

`npx prettier --check packages/core` -> "All matched files use Prettier code style!" (after `prettier --write` on `mask.spec.ts`). `npx eslint packages/core` -> pass, no output.

## Full test execution

Command:

`npm --prefix . run check` (lint: `eslint . --max-warnings 0 && prettier --check .`, typecheck, `vitest run`, renderer tests)

Result:

Fail: lint and typecheck pass; root `vitest run`: Test Files 1 failed | 6 passed (7), Tests 4 failed | 855 passed (859), the same 4 tests. The renderer step did not run (chained after the failing `vitest run`).

## .taskcheck

Result:

Fail: `.taskcheck` runs `npm run check`, result as above. Expected to pass once TW-5 and TW-6 are fixed.

## Bugs found

### `maskText()` leaks secret option values that contain a raw space

Finding ID:

`TW-6`

Test:

`maskText scanner boundaries > masks a secret option value containing a raw space: %s` (3 rows: `proxyPassword`, `AWS_SESSION_TOKEN` in `authMechanismProperties`, `tlsCertificateKeyFilePassword`)

Production source:

`packages/core/src/uri/mask.ts:145-169` (`uriEnd`: the CR-5 extension across whitespace only applies to user-info credentials; option values still end at the first whitespace)

Requirement:

SPEC "logs and error messages mask passwords in URIs"; recorded assumption that `mask()`/`maskText()` hide `proxyPassword`, `tlsCertificateKeyFilePassword` and `AWS_SESSION_TOKEN`. Same class as CR-5, which was treated as a required fix.

Expected behavior:

`maskText('log: mongodb://h/?proxyHost=p&proxyPassword=my spaceOptSecret failed')` hides the whole proxy password, as `mask()` does on the bare URI.

Actual behavior:

The driver's parser accepts the raw space (`parseConnectionString(...).proxy.password === 'my spaceOptSecret'`, asserted by a passing test), but `maskText` ends the connection string at the space: output `log: mongodb://h/?proxyHost=p&proxyPassword=**** spaceOptSecret failed`. Likewise `...AWS_SESSION_TOKEN%3A**** spaceTokSecret failed` and `...tlsCertificateKeyFilePassword=**** spaceKeySecret&tls=true failed`. URIs written by `toConnectionString` encode spaces, so this affects user-typed URIs (e.g. pasted into the connection form and echoed in an error/log).

Severity:

Medium (password-equivalent secret leaked into logs for a driver-valid URI; same rating as CR-5)

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.` (E.g. when the text before a whitespace ends inside a secret option value, as `endsInSecret` already detects, extend the match to the next `&`, `#`, line break or end of the text, analogous to the CR-5 rule; masking more is acceptable.)

### `maskText()` splits an invalid URI whose password is digits followed by a scheme

Finding ID:

`TW-5`

Test:

`maskText scanner boundaries > does not start a new connection string at a scheme after a digits-only password prefix`

Production source:

`packages/core/src/uri/mask.ts:120-123` (`endsInSecret` authority branch: `/:(?!\d+(?:[^A-Za-z0-9]|$))/` treats `:123-` as a port)

Requirement:

SPEC log masking; consistency with the Round 2 fix and its test `does not start a new connection string at a scheme inside the password` (`amongodb`, `a,mongodb` cases).

Expected behavior:

`maskText('x mongodb://u:123-mongodb://digitTailSecret@h y')` hides the password, as `mask()` on the same string does (`mask()` assertion passes).

Actual behavior:

Text returned unchanged: `x mongodb://u:123-mongodb://digitTailSecret@h y`. The scanner splits after `123-` (looks like a port), so the first part has no `@` and the second part shows `digitTailSecret` as a user name. Same with `,`, `.` or any non-alphanumeric character after the digits.

Severity:

Low (the URI is invalid for the driver: unencoded `/` in the password; but the fixer explicitly chose to cover invalid inputs of this kind)

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.` (E.g. when the authority before the scheme has no `@` but an `@` follows later in the same run, as `uriEnd` can check, do not split; or accept the limitation as a recorded assumption and the parent decides on the test.)

### Prior findings (disposition)

| ID | Disposition in this pass |
|---|---|
| TW-1, TW-2, TW-3, CR-1..CR-4 | Fixed earlier; tests still pass |
| TW-4 | Fixed in `6b9c970`; original test passes, 3 new tests cover the undecodable-key, undecodable-AMP-value and upper-case paths of `endsInSecret` |
| CR-5 | Fixed in `6b9c970` for user-info passwords; tests pass. Option values with raw spaces are not covered by the fix: TW-6 |
| CR-6 | Not fixed, accepted by the parent worker as over-masking (no leak); not retested beyond existing tests |

### Observations (not defects, no failing test)

- Documented over-masking remains (e.g. `mongodb://host:27017 failed for user@x` -> `mongodb://host:****@x`; JSON tails after a URI). No leak.
- `mask()` drops a fragment after a secret option value (`...=keySecret#frag` -> `...=****`), as before; masking more.

## Coverage

Status: partial-failed. Fresh report for revision `6b9c970` with the final test files of this pass, but the command exited nonzero because of the TW-5/TW-6 tests. Numbers are diagnostic; re-run after the fix. A run on the unmodified test files before my additions (`coverage/uri-model-tw-pass3a`, exit 0, 249 passed) gave mask.ts 107/110 statements, 63/68 branches, 10/10 functions, 94/94 lines (uncovered `endsInSecret` lines 126-133, 138-139).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately; all three files were added by this task (base `ea59a3d`), so whole-file equals changed-line coverage for the task. For the Round 2 change alone, every line of `endsInSecret`/`uriEnd` is executed (lines 94/94); only the two `?? ''` fallbacks are unhit branches.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `uri-model`; base `ea59a3ddbc07b4922bbc5111b2074a0ecff847f5`; HEAD `6b9c970b0837f7f6b83e9965a761ad2f500d2847`; commits named by the parent worker and confirmed with `git diff --stat 645c0a4 6b9c970`.
- Source/test snapshot identifier (including uncommitted inputs): sha256 `convert.ts` 0428507d6d8b8504de6daf3e06736f364d172a1074a4b40a72e76a7b8bc730c6, `mask.ts` 125c123c530d74a9b58da090fbb765696ba0574b1dc9a5754e8da16195fb3c26, `model.ts` da63a9eb80e58633c566a92e7d46397dcf5e9d4d49a317613df048d64010a5ff, `fixtures.ts` 899cd1c1aeb791fc0cf81693642f1623aea576ffef8a78a5fc98e20f5f77291e, `convert.spec.ts` 37621a794cc8badc5c4a5b542c49b321398c2556e701609493cc35154e7d804e (all committed); uncommitted `mask.spec.ts` f2493cd975878d9728253277800e3bc6d4cadbdee7c156e669b034328c44fba0.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/uri/convert.ts`, `src/uri/mask.ts`, `src/uri/model.ts`. Excluded: `src/uri/index.ts`, `src/index.ts` (re-exports only), `src/uri/fixtures.ts` (test data), spec files, `package.json`/`package-lock.json` (dependency metadata). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8`; `npx --prefix . vitest run --root packages/core --coverage --coverage.include=src/uri/convert.ts --coverage.include=src/uri/mask.ts --coverage.include=src/uri/model.ts --coverage.reportsDirectory=coverage/uri-model-tw-pass3 --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json --coverage.reportOnFailure=true --coverage.skipFull=false`, run from the repo root; all 261 tests of the `core` workspace.
- Run start/completion time and exit status: started 2026-11-16 19:19:51 +0100, duration 237 ms; nonzero exit (4 failed | 257 passed).
- Generated report paths and report hashes/run identifier: `packages/core/coverage/uri-model-tw-pass3/coverage-summary.json` sha256 cac7aaea147c95d07b9bb9a52a9950ce490ad31399114ae76f7437c2f068e225, `coverage-final.json` sha256 4e0f59a16080c94a1ed5215074a8bec92b05ae2dd81dbcc9be1294661192326b (Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: new, previously nonexistent reports directory; source and spec hashes taken before (19:19:48) and after the run are identical.
- Final run after latest test additions and production fixes: yes for revision `6b9c970` and the final test files; a fix for TW-5/TW-6 makes it stale.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/core/src/uri/convert.ts` | 219/220 (99.55%) | 130/131 (99.24%) | 87/88 (98.86%) | 190/191 (99.48%) |
| `packages/core/src/uri/mask.ts` | 110/110 (100%) | 66/68 (97.06%) | 10/10 (100%) | 94/94 (100%) |
| `packages/core/src/uri/model.ts` | 4/4 (100%) | N/A (0/0) | 1/1 (100%) | 4/4 (100%) |
| Aggregate (summed counters, 3 measured files, none missing or excluded beyond those listed above) | 333/334 (99.70%) | 196/199 (98.49%) | 98/99 (98.99%) | 288/289 (99.65%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/core/src/uri/mask.ts:126-133`, `138` (fragment after query, option without `=`, undecodable key, undecodable AMP value, non-secret AMP entry) | TW-4 fix: when an embedded scheme splits or not | Covered by the 7 new boundary tests |
| `packages/core/src/uri/mask.ts:128`, `139` (`.pop() ?? ''` fallbacks) | none: `split()` always returns a non-empty array | Justified gap (unreachable) |
| `packages/core/src/uri/convert.ts:248` (`readPreferenceTags` `isSet: () => false`) | none: never called for a repeatable option | Justified gap (unchanged since pass 2) |
| `packages/core/src/uri/convert.ts:377` (branch: thrown value not an `Error`) | defensive | Justified gap (unchanged since pass 2) |

## Unable to test

- Whether the real MongoDB driver/server accepts a raw space in a proxy password at connect time: only the driver's URI parser (`mongodb-connection-string-url`, via `parseConnectionString`) was used; a live connection is outside this task. The parser accepting it is enough for the logging risk.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion. The Round 2 fixes (TW-4, CR-5, `mask()` invalid branch) are verified and `endsInSecret`/`uriEnd` are fully line-covered after 8 new passing boundary tests. Two new `maskText` leaks have failing tests that must not be skipped: TW-6 (Medium, driver-valid URIs with a raw space in `proxyPassword`, `tlsCertificateKeyFilePassword` or `AWS_SESSION_TOKEN`) and TW-5 (Low, invalid URI with a digits-then-scheme password). Prettier, ESLint and typecheck pass. The test file and this report are left uncommitted for the parent worker.
