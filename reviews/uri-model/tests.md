# Test Report

Date: 2026-11-16

Task: uri-model - Core: connection profile ⇄ connection string (fourth pass, revision 1aa5e91 after fixes Round 3)

Scope: `git diff 0ba91a54cab66dd36e3a736a30972810e9410d1d 1aa5e91bb702fe566975000783bc827d8323029e` on branch `main` (base = `git merge-base HEAD origin/main` = `0ba91a5`, confirmed; HEAD = `1aa5e91bb702fe566975000783bc827d8323029e`). Task-owned commits (named by the parent worker, confirmed with `git log --oneline 0ba91a5..HEAD`): `f45b87e` (implementation), `be18afb`, `18b946f`, `91a0e9a`, `7c7fa04`, `f174b72`, `1aa5e91` (test passes, reviews, fixes). The base moved since round 3 (`ea59a3d` there) because of a rebase; the task file list is unchanged. Production files of the task: `packages/core/src/uri/{convert,mask,model,index}.ts`, `packages/core/src/index.ts` (re-export), `packages/core/package.json` / `package-lock.json` (dependency). Since round 3 (`f174b72`) only `packages/core/src/uri/mask.ts` changed in production code (`git diff --stat f174b72 HEAD -- packages`: `uriEnd` loop across whitespace in secret option values, new `endsInSecretOption`, stricter port regex in `endsInSecret`). This pass focuses on that code; the whole task scope is re-run and re-measured. Uncommitted at measurement time: `packages/core/src/uri/mask.spec.ts` (this pass) and `reviews/uri-model/review.md` (code-reviewer, not touched by me).

Requirements:
- `tasks/uri-model.md` acceptance criteria and recorded assumptions (mask hides password, proxyPassword, tlsCertificateKeyFilePassword, AWS_SESSION_TOKEN; maskText masks URIs in free text; CR-7 assumption, superseded by the Round 3 fix)
- `SPEC.md`: "logs and error messages mask passwords in URIs" (over-masking acceptable, leaking not)
- `reviews/uri-model/fixes.md` Round 3 (TW-5, TW-6/CR-7 fixes to verify)
- Parent worker instructions for this pass

## Test files changed

- `packages/core/src/uri/mask.spec.ts`

## Tests added or updated

Count: 31 (two new `describe` blocks in `mask.spec.ts`, counting each `it.each` row). No existing test changed or removed. Core suite: 261 -> 292 tests.

`maskText secret option values across whitespace` (TW-6 fix):
- pass: whole value with several spaces and a tab masked up to the next `&` (exact output; also asserts the driver keeps the spaces and drops the tab); value ended by `#` then continues; value without a following option swallows the rest of the line (documented over-masking, exact output); value stops at `\n` and `\r\n` and the next line stays; a later connection string after the value's `&` is still masked; a connection string swallowed into a secret value doesn't leak; two secret values with spaces in one URI; AWS token with a space followed by another property (driver parse asserted); a non-secret value (`appName=my app is down`) does not run on past whitespace.
- fail (3 rows, TW-7): `masks a secret option after a non-secret value with a raw space: %s`.

`maskText port detection` (TW-5 fix):
- pass: split after `:27017` followed by each of `,` `/` `?` `#` space `"` `'` `` ` `` `)` `]` `}` `>` (12 rows); no split after `:123` + `-` `.` `;` `_` `x` (5 rows, password stays hidden); `:27017;mongodb://...` is kept together and masked rather than leaked (user password and `proxyPassword`); IPv6 literal with zone id and port still splits.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Round-trip tests for 20+ URIs incl. SRV, IPv6, encoded credentials, authMechanismProperties | `connection string round trip` (35 fixtures in `fixtures.ts`, incl. "SRV with ...", "IPv6 loopback", "IPv6 replica set with credentials", "percent-encoded credentials", "AWS IAM with session token", "Kerberos with authMechanismProperties"), `toConnectionString`, `parseConnectionString edge cases` (convert.spec.ts, unchanged) | `npx vitest run --root packages/core` | Pass |
| AC2 Unknown options preserved in `extra` | `unknown options`, `unknown options named like Object.prototype members` | `npx vitest run --root packages/core` | Pass |
| AC3 `mask()` never leaks the password in any of the test URIs | `mask > never leaks a secret: $name` over all fixtures (also after a round trip and via `maskText`), special-character rows, `mask edge cases`; the `mask()` assertions in the new TW-7 rows pass too | `npx vitest run --root packages/core` | Pass |
| TW-6 / CR-7 fix (Round 3): secret option value with raw whitespace | round-3 rows `masks a secret option value containing a raw space` + 9 new tests above | `npx vitest run --root packages/core` | Pass |
| TW-5 fix (Round 3): `:` + digits is a port only before a host delimiter | round-3 `digits-only password prefix` test + 19 new port-detection rows | `npx vitest run --root packages/core` | Pass |
| No regression of earlier fixes (TW-1..TW-4, CR-1..CR-5) and splitting of joined strings | all existing `mask`/`maskText` tests | `npx vitest run --root packages/core` | Pass |
| SPEC: logs mask secrets (`maskText`) for a secret option after a non-secret value with a raw space | 3 TW-7 rows | `npx vitest run --root packages/core` | Fail: 3 tests (TW-7) |

## Focused test execution

Command:

`npx vitest run --root packages/core` (repo root; also `npx vitest run --root packages/core src/uri/mask.spec.ts`)

Result:

Fail: Test Files 1 failed | 2 passed (3); Tests 3 failed | 289 passed (292). The 3 failures are the new TW-7 rows. Before my additions, on the same revision: 261 passed (261). All Round 3 fixes are verified by passing tests.

`npx prettier --write packages/core/src/uri/mask.spec.ts` (formatting of my file) and `npx eslint packages/core/src/uri/mask.spec.ts` -> pass, no output.

## Full test execution

Command:

`npm run check` (repo root: `eslint . --max-warnings 0 && prettier --check .`, typecheck of all workspaces, root `vitest run`, renderer tests)

Result:

Fail: lint ("All matched files use Prettier code style!") and typecheck pass; root `vitest run`: Test Files 1 failed | 6 passed (7), Tests 3 failed | 887 passed (890), the same 3 TW-7 tests. The renderer step did not run (chained after the failing `vitest run`).

## .taskcheck

Result:

Fail: `.taskcheck` runs `npm run check`, result as above. Expected to pass once TW-7 is fixed.

## Bugs found

### `maskText()` leaks a secret option that follows a non-secret option value containing a raw space

Finding ID:

`TW-7`

Test:

`maskText secret option values across whitespace > masks a secret option after a non-secret value with a raw space: %s` (3 rows: `appName=my app` then `proxyPassword`; `appName=my app` then `tlsCertificateKeyFilePassword` with user credentials; `authMechanismProperties=SERVICE_NAME:a b,AWS_SESSION_TOKEN:...`)

Production source:

`packages/core/src/uri/mask.ts:187-188` (`uriEnd`: at whitespace, the connection string ends unless the text before it ends inside a *secret* option value; a non-secret value with a raw space ends the token, so the following options are never passed to `mask()`)

Requirement:

SPEC "logs and error messages mask passwords in URIs"; recorded assumption that `mask()`/`maskText()` hide `proxyPassword`, `tlsCertificateKeyFilePassword` and `AWS_SESSION_TOKEN`. Same class as TW-6/CR-7 (raw whitespace in an option value, driver-valid), which was fixed in Round 3. Not a regression of Round 3: the token also ended at that whitespace before; the Round 3 fix covers only whitespace inside the secret value itself.

Expected behavior:

`maskText('log: mongodb://h/?appName=my app&proxyHost=p&proxyPassword=afterApp1Secret failed')` hides `afterApp1Secret`, as `mask()` on the bare URI does (that assertion passes in the same test).

Actual behavior:

The text is returned unchanged: `log: mongodb://h/?appName=my app&proxyHost=p&proxyPassword=afterApp1Secret failed`. Likewise `...?appName=my app&tls=true&tlsCertificateKeyFilePassword=afterApp2Secret failed` (only the user password is masked) and `...authMechanismProperties=SERVICE_NAME:a b,AWS_SESSION_TOKEN:afterSvc3Secret failed`. All three URIs are accepted by `parseConnectionString` (asserted). URIs written by `toConnectionString` encode spaces, so this affects hand-typed/pasted URIs echoed in a log or error message.

Severity:

Medium (password-equivalent secret leaked into logs for a driver-valid URI; same rating as TW-6/CR-5)

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.` (E.g. at whitespace inside the query of a token that is still in an option value, whether or not the value is secret, continue to the next `&`/`#`/line break when a secret option key or `AWS_SESSION_TOKEN` follows on the same line before any new scheme; or check the rest of the line for a secret key before ending the token. Masking more is acceptable. Note the test `does not run a non-secret option value on past whitespace` pins the current exact output for a line *without* a later secret; a fix may need to change that expectation only if it over-masks there, which the parent may accept.)

### Prior findings (disposition)

| ID | Disposition in this pass |
|---|---|
| TW-1, TW-2, TW-3, TW-4, CR-1..CR-5 | Fixed earlier; tests still pass |
| TW-5 | Fixed in `1aa5e91`; round-3 test passes, 19 new port-detection rows pass (delimiters still split, non-delimiters keep the password hidden) |
| TW-6 / CR-7 | Fixed in `1aa5e91`; round-3 rows pass, 9 new tests pass. The CR-7 assumption in `tasks/uri-model.md` ("masks only the first word") no longer matches the code; the parent may want to note that it is superseded. Related remaining gap: TW-7 |
| CR-6 | Accepted earlier as over-masking (no leak); unchanged |

### Observations (not defects, no failing test)

- New over-masking from the Round 3 fix: a secret value with a raw space and no following `&`/`#` swallows the rest of the line (`x mongodb://h/?proxyPassword=a eolSecret then more prose` -> `x mongodb://h/?proxyPassword=****`); pinned by a test, matches the fixer's documented choice.
- `:27017;mongodb://...` (and other non-delimiter characters after a port) no longer splits; the joined strings are masked together, more is hidden, nothing leaks (tested).
- `mask()` still drops a fragment after a secret option value, as before.

## Coverage

Status: partial-failed. Fresh report for revision `1aa5e91` with the final test file of this pass, but the command exited nonzero because of the 3 TW-7 tests. Numbers are diagnostic; re-run after the fix. Round 3 (revision `6b9c970`, prior mask.ts) is stale and not reused.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately; all three files were added by this task (base `0ba91a5`), so whole-file equals changed-line coverage for the task. For the Round 3 change alone (`endsInSecret` port regex, `endsInSecretOption`, `uriEnd` loop), every line is executed (mask.ts lines 105/105); the only unhit branches are the two `.pop() ?? ''` fallbacks.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `uri-model`; base `0ba91a54cab66dd36e3a736a30972810e9410d1d` (parent-supplied, equals `git merge-base HEAD origin/main`); HEAD `1aa5e91bb702fe566975000783bc827d8323029e`; commits and files from `git log`/`git diff --name-only 0ba91a5..HEAD -- '*.ts'`.
- Source/test snapshot identifier (including uncommitted inputs): sha256 `convert.ts` 0428507d6d8b8504de6daf3e06736f364d172a1074a4b40a72e76a7b8bc730c6, `mask.ts` 22c39b69dad41b71257794d89612ac1d2806a09354374a7d6fcb0d72123563cf, `model.ts` da63a9eb80e58633c566a92e7d46397dcf5e9d4d49a317613df048d64010a5ff, `index.ts` 42f5debbedc6980834810b788175691010af4a1f56d0d037c222511bfd7e1792, `fixtures.ts` 899cd1c1aeb791fc0cf81693642f1623aea576ffef8a78a5fc98e20f5f77291e, `convert.spec.ts` 37621a794cc8badc5c4a5b542c49b321398c2556e701609493cc35154e7d804e (all committed); uncommitted `mask.spec.ts` fc413c5cc1777ec0f0f8c67715849d662b87ec5abf814df673ebfbc54ce425bc.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/uri/convert.ts`, `src/uri/mask.ts`, `src/uri/model.ts`. Excluded: `src/uri/index.ts`, `src/index.ts` (re-exports only), `src/uri/fixtures.ts` (test data), spec files, `package.json`/`package-lock.json` (dependency metadata). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8`; `npx vitest run --coverage --coverage.include='src/uri/convert.ts' --coverage.include='src/uri/mask.ts' --coverage.include='src/uri/model.ts' --coverage.reportsDirectory=coverage/uri-model-tw-pass4 --coverage.reporter=text --coverage.reporter=json-summary --coverage.reportOnFailure=true`, run in `packages/core`; all 292 tests of the `core` workspace.
- Run start/completion time and exit status: started 2026-11-16 19:26:18 +0100, duration 213 ms; nonzero (3 failed | 289 passed).
- Generated report paths and report hashes/run identifier: `packages/core/coverage/uri-model-tw-pass4/coverage-summary.json` sha256 3c3404d932a596d7339e6549d36ab427e2b7b0d2ff62e945235e7975c3de945e (Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: new, previously nonexistent reports directory (created 19:26); source and spec hashes taken before (19:26:10) and after (19:26:22) the run are identical.
- Final run after latest test additions and production fixes: yes for revision `1aa5e91` and the final test file; a fix for TW-7 makes it stale.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/core/src/uri/convert.ts` | 219/220 (99.55%) | 130/131 (99.24%) | 87/88 (98.86%) | 190/191 (99.48%) |
| `packages/core/src/uri/mask.ts` | 127/127 (100%) | 81/83 (97.59%) | 11/11 (100%) | 105/105 (100%) |
| `packages/core/src/uri/model.ts` | 4/4 (100%) | N/A (0/0) | 1/1 (100%) | 4/4 (100%) |
| Aggregate (summed counters, 3 measured files; exclusions listed above, none missing) | 350/351 (99.72%) | 211/214 (98.60%) | 99/100 (99.00%) | 299/300 (99.67%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/core/src/uri/mask.ts:139`, `151` (`.pop() ?? ''` fallbacks) | none: `split()` always returns a non-empty array | Justified gap (unreachable) |
| `packages/core/src/uri/mask.ts:187-194` (`uriEnd` whitespace loop: line break, `#`, end-of-text and `&` exits) | TW-6 fix | Covered by the new whitespace tests (each exit asserted with exact output) |
| `packages/core/src/uri/mask.ts:122` (port regex, delimiter alternatives) | TW-5 fix | Covered by the 19 new port-detection rows |
| `packages/core/src/uri/convert.ts:248` (`readPreferenceTags` `isSet: () => false`) | none: never called for a repeatable option | Justified gap (unchanged since pass 2) |
| `packages/core/src/uri/convert.ts:377` (branch: thrown value not an `Error`) | defensive | Justified gap (unchanged since pass 2) |

## Unable to test

- Whether a live MongoDB driver connection accepts raw spaces in option values: only the driver's URI parser (`mongodb-connection-string-url`, via `parseConnectionString`) was used; a live connection is outside this task. The parser accepting it is enough for the logging risk.

## History of earlier rounds

- Pass 1 (`be18afb`): 8 failing tests documented TW-1..TW-3 (and CR-1..CR-4 from review); fixed in `18b946f`.
- Pass 2 (`91a0e9a`): TW-4 (secret option value containing a scheme) and CR-5/CR-6; TW-4/CR-5 fixed in `7c7fa04`, CR-6 accepted.
- Pass 3 (`f174b72`): 12 tests; TW-5 (digits-then-scheme password split) and TW-6 (raw space in secret option value, = CR-7); both fixed in `1aa5e91`.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion. All three acceptance criteria are covered by passing tests on revision `1aa5e91`, and the Round 3 fixes (TW-5, TW-6/CR-7) are verified with 28 new passing tests and no regression of earlier fixes. One new `maskText` leak has 3 failing tests that must not be skipped: TW-7 (Medium, a secret option after a non-secret option value with a raw space stays visible in logs). Lint and typecheck pass; `npm run check` fails only on the TW-7 tests. The test file and this report are left uncommitted for the parent worker.
