# Test Report

Date: 2026-11-16

Task: uri-model - Core: connection profile ⇄ connection string (second pass, final revision after fixes)

Scope: `git diff ea59a3ddbc07b4922bbc5111b2074a0ecff847f5 645c0a4a364c03dae5f0a0f7f5bd4ad7025acf0a` on branch `main` (base = `git merge-base HEAD origin/main`; HEAD = `645c0a4a364c03dae5f0a0f7f5bd4ad7025acf0a`). Task-owned commits supplied by the parent worker: `edb078d` (implementation), `9476472` (first test-writer pass and reports), `645c0a4` (fixer: CR-1..CR-4, TW-1..TW-3). Production files: `packages/core/src/uri/{convert,mask,model,index}.ts`, `packages/core/src/index.ts` (re-export), `packages/core/package.json` and `package-lock.json` (dependency `mongodb-connection-string-url`). Test files: `packages/core/src/uri/{convert,mask}.spec.ts`, `fixtures.ts`. Uncommitted at measurement time: the two spec files changed by this pass (hashes under Coverage) and `reviews/uri-model/review.md`, modified by the code-reviewer, not touched by me.

Requirements:
- `tasks/uri-model.md` acceptance criteria and recorded assumptions
- `SPEC.md`: "logs and error messages mask passwords in URIs"; copyable connection string with the password masked
- `reviews/uri-model/fixes.md` (fixes to verify), `reviews/uri-model/review.md` (CR-1..CR-4)
- Parent worker instructions for this pass

## Test files changed

- `packages/core/src/uri/convert.spec.ts`
- `packages/core/src/uri/mask.spec.ts`

## Tests added or updated

Count: 43 (7 in `convert.spec.ts`, 36 in `mask.spec.ts`, counting each `it.each` row). No existing test was changed or removed. Suite size went from 201 to 244 tests.

Added to `convert.spec.ts`:
- `toConnectionString` (CR-2, CR-3, CR-1 writer side): the "password needs a user name" error never contains the password; an apostrophe in a user name without password is written as `%27` and reads back; IPv6 hosts still go in brackets and plain socket paths are still percent-encoded after the `formatHost` change.
- `unknown options named like Object.prototype members` (CR-4 / TW-1 / TW-2): a repeated `__proto__` / `toString` key keeps all values in order and round-trips (exercises the array push path on an own property); `extra` stays a plain object with `Object.prototype`, global `Object.prototype` untouched, spreading and JSON keep the entries; an own `__proto__` key in an `extra` map coming from `JSON.parse` (stored profile) is written out.

Added to `mask.spec.ts`:
- `hides a password containing %j in quoted, bracketed and JSON text` (33 rows, CR-1 / TW-3 regression): a Thicket-written URI with each printable ASCII special character in the password, wrapped in double quotes, backticks, `<>`, `(...)`, a JSON object whose other value contains `@` and `:`, and a JSON array of two URIs.
- `hides secret options with quotes inside quoted text`: `proxyPassword` and `tlsCertificateKeyFilePassword` containing `'`, `"`, backtick, `<`, `>` inside quoted and JSON text.
- `hides a user password that contains a connection-string scheme`: passes (Thicket percent-encodes `:` and `/` in user info).
- `hides secret option values that contain a connection-string scheme`: fails, TW-4.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Round-trip tests for 20+ URIs incl. SRV, IPv6, encoded credentials, authMechanismProperties | `connection string round trip` (34 fixtures + count check), `toConnectionString`, `parseConnectionString edge cases`; new IPv6/socket and apostrophe tests | `cd packages/core && npx vitest run` | Pass |
| AC2 Unknown options are preserved in `extra` | `unknown options`, `unknown options named like Object.prototype members` (incl. 4 new tests) | `cd packages/core && npx vitest run` | Pass |
| AC3 `mask()` never leaks the password in any of the test URIs | `mask` over all fixtures, special-character rows, `mask edge cases`; `mask()` assertion of the TW-4 test | `cd packages/core && npx vitest run` | Pass |
| SPEC: logs and error messages mask passwords in URIs (`maskText`) | `hides a password containing %j` (both variants, 66 rows), quote/scheme tests | `cd packages/core && npx vitest run` | Fail: 1 test, TW-4 (all user-password cases pass) |
| CR-2 password without user name rejected, empty user name = none | `rejects a password without a user name ...`, `treats an empty user name as none`, `never puts the password into the error ...` | `cd packages/core && npx vitest run` | Pass |
| CR-3 socket path with `:` not bracketed | `writes a Unix socket path containing ":" ...`, `still writes IPv6 hosts in brackets ...` | `cd packages/core && npx vitest run` | Pass |

## Focused test execution

Command:

`cd packages/core && npx vitest run`

Result:

Fail: Test Files 1 failed | 2 passed (3); Tests 1 failed | 243 passed (244). The single failure is the new TW-4 test. All fixes from `fixes.md` (CR-1..CR-4, TW-1..TW-3) are covered and pass.

Also on the final test files: `npx prettier --check packages/core` -> All matched files use Prettier code style (after `prettier --write` on the two spec files I edited); `npx eslint packages/core` -> pass, no output; `npx tsc -p packages/core/tsconfig.json --noEmit` -> pass.

## Full test execution

Command:

`npm run check` (repository root)

Result:

Fail: lint (eslint + `prettier --check .`) and typecheck of all workspaces pass; root `vitest run`: Test Files 1 failed | 6 passed (7), Tests 1 failed | 841 passed (842), the same TW-4 test. The renderer test step did not run because it is chained after the failing `vitest run`.

## .taskcheck

Result:

Fail: `.taskcheck` runs `npm run check`, result as above. It passes once TW-4 is fixed.

## Bugs found

### `maskText()` leaks the tail of a secret option value that contains `mongodb://`

Finding ID:

`TW-4`

Test:

`mask and maskText on passwords with special characters > hides secret option values that contain a connection-string scheme`

Production source:

`packages/core/src/uri/mask.ts:17` (`URI_IN_TEXT`, introduced by the CR-1 fix in `645c0a4`), together with `packages/core/src/uri/convert.ts:398-400` (`encodeQuery` leaves `:` and `/` unencoded in option values)

Requirement:

SPEC "logs and error messages mask passwords in URIs"; task goal "password masking for display and logs"; recorded assumption that `mask()` masks `proxyPassword`, `tlsCertificateKeyFilePassword` and `AWS_SESSION_TOKEN`.

Expected behavior:

`maskText('connect ' + toConnectionString(model) + ' failed')` hides the whole value of `proxyPassword`, `tlsCertificateKeyFilePassword` and the `AWS_SESSION_TOKEN` property for any value, as `mask()` on the bare URI already does.

Actual behavior:

The new `URI_IN_TEXT` ends a match at every embedded `mongodb://` / `mongodb+srv://`. Thicket writes option values with `:` and `/` unencoded, so a valid URI such as `mongodb://h/?proxyPassword=px-mongodb://proxyTail2Secret` (accepted by `parseConnectionString`, password read back unchanged) is split in two: `mask()` masks only `px-`, and the second token `mongodb://proxyTail2Secret` has no credentials, so the text becomes `...proxyPassword=****mongodb://proxyTail2Secret`. Same for `authMechanismProperties=AWS_SESSION_TOKEN:tok-mongodb://...` and `tlsCertificateKeyFilePassword=...mongodb+srv://...`. The first failing assertion reports `leaks awsTail1Secret`. User passwords are not affected (`:` and `/` are percent-encoded in user info). Before the fix this case was masked, so this is a regression of the CR-1 fix. Related, for invalid input only (driver rejects it, no test added): `maskText('x mongodb://u:amongodb://bSecret@h y')` now returns the text unchanged, while `mask()` on the same string masks it.

Severity:

Low (needs a secret that contains a literal connection-string scheme, but it is a leak into logs for a URI Thicket writes itself)

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.` (For example: only split at a scheme that is not inside a query value, e.g. not preceded by `=`, `:` or `,`, or let `maskText` re-join a token whose predecessor ended inside a secret option value.)

### Prior findings (disposition)

| ID | Disposition in this pass |
|---|---|
| TW-1 | Fixed in `645c0a4`; the 5 original rows pass, plus new repeated-key and plain-object tests |
| TW-2 | Fixed in `645c0a4`; both original tests pass |
| TW-3 / CR-1 | Fixed in `645c0a4` for user passwords; original row passes, 33 new wrapping rows pass; the new splitting rule causes TW-4 |
| CR-2 | Fixed; covered by fixer tests plus the new error-message test |
| CR-3 | Fixed; covered by fixer test plus the new IPv6/socket regression test |
| CR-4 | Same defect as TW-1/TW-2; fixed and covered |

### Observations (not defects, no failing test)

- Documented trade-off of the CR-1 fix: text that follows a URI without whitespace is masked too when it contains `@`/`:` or follows a secret option, e.g. `maskText('{"uri":"mongodb://u:pw@h","a":"b@c"}')` gives `{"uri":"mongodb://u:****@c"}` and `{"uri":"mongodb://h/?proxyPassword=pp","n":"x"}` loses the rest of the JSON. Over-masking only, no leak.
- Earlier observations (empty password written as none, IPv6 zone ids kept percent-encoded, `AWS_SESSION_TOKEN` key with a leading space not masked) are unchanged.

## Coverage

Status: partial-failed. The coverage command ran on the final test snapshot of revision `645c0a4` and produced a fresh report, but exited nonzero because of the TW-4 test. Numbers are diagnostic; re-run after the TW-4 fix.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately; all three files are added by this task (no deletions in `git diff ea59a3d 645c0a4`), so whole-file coverage equals changed-line coverage for them.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `uri-model`; base `ea59a3ddbc07b4922bbc5111b2074a0ecff847f5`; HEAD `645c0a4a364c03dae5f0a0f7f5bd4ad7025acf0a`; commits `edb078d`, `9476472`, `645c0a4` supplied by the parent worker, confirmed with `git diff --stat ea59a3d 645c0a4`.
- Source/test snapshot identifier (including uncommitted inputs): sha256 `convert.ts` 0428507d6d8b8504de6daf3e06736f364d172a1074a4b40a72e76a7b8bc730c6, `mask.ts` 6503de8450375a91debb2d92a97b4204a270e56bf2fa24d4adcfd62393e7e9be, `model.ts` da63a9eb80e58633c566a92e7d46397dcf5e9d4d49a317613df048d64010a5ff, `fixtures.ts` 899cd1c1aeb791fc0cf81693642f1623aea576ffef8a78a5fc98e20f5f77291e (committed, unchanged); uncommitted `convert.spec.ts` 37621a794cc8badc5c4a5b542c49b321398c2556e701609493cc35154e7d804e, `mask.spec.ts` 2cfbd290c5159e462ec36904a6add75cdbda892b5ff8987be5f63415332163a8.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/uri/convert.ts`, `src/uri/mask.ts`, `src/uri/model.ts`. Excluded: `src/uri/index.ts` and `src/index.ts` (re-exports only), `src/uri/fixtures.ts` (test data), spec files, `package.json`/`package-lock.json` (dependency metadata). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` 5.1.0; `npx vitest run --coverage --coverage.include='src/uri/convert.ts' --coverage.include='src/uri/mask.ts' --coverage.include='src/uri/model.ts' --coverage.reportsDirectory=coverage/uri-model-tw-pass2 --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json --coverage.reportOnFailure=true` in `packages/core`; all tests of the `core` workspace (244).
- Run start/completion time and exit status: started 2026-11-16 19:11:11 +0100, duration 215 ms; nonzero exit (1 failed | 243 passed).
- Generated report paths and report hashes/run identifier: `packages/core/coverage/uri-model-tw-pass2/coverage-summary.json` sha256 efd40293d5f19db79c2d3df913ebcac2a2e89c8c74397440d76973c8da41cfbd, `coverage-final.json` sha256 5b955910d834c7d4d9441c96e18388c3d69234952e80e69374b700f122e9b507 (Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: new, previously nonexistent reports directory; source and spec hashes taken before and after the run are identical.
- Final run after latest test additions and production fixes: yes for revision `645c0a4` and the final test files; a fix for TW-4 would make it stale.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/core/src/uri/convert.ts` | 219/220 (99.55%) | 130/131 (99.24%) | 87/88 (98.86%) | 190/191 (99.48%) |
| `packages/core/src/uri/mask.ts` | 60/60 (100%) | 36/36 (100%) | 9/9 (100%) | 52/52 (100%) |
| `packages/core/src/uri/model.ts` | 4/4 (100%) | N/A (0/0) | 1/1 (100%) | 4/4 (100%) |
| Aggregate (summed counters, 3 measured files, none missing) | 283/284 (99.65%) | 166/167 (99.40%) | 97/98 (98.98%) | 246/247 (99.60%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/core/src/uri/convert.ts:248` (`readPreferenceTags` `isSet: () => false`) | none: `isSet` is never called for a `repeatable` option | Justified gap (dead code), not reachable through the public API |
| `packages/core/src/uri/convert.ts:377` (branch: thrown value not an `Error`) | defensive; the library always throws `Error`s | Justified gap |
| New fixer code (`setOwn`, `encodeUserinfo`, `formatHost` socket branch, password-without-user check) | CR-1..CR-4 | All covered; see tests above |

## Unable to test

- Whether the MongoDB driver trims whitespace around `authMechanismProperties` keys (earlier observation): needs the driver or a server; not required by the criteria. No follow-up unless the fixer wants to harden `mask()`.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion. All fixes from `fixes.md` (CR-1..CR-4, TW-1..TW-3) are verified by passing tests; one new Low-severity leak, TW-4 (`maskText` splitting at a `mongodb://` inside a secret option value, a regression from the CR-1 fix), has a failing test that must not be skipped. Prettier, ESLint and type check pass. The test files and this report are left uncommitted for the parent worker.
