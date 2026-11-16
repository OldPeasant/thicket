# Test Report

Date: 2026-11-16

Task: uri-model - Core: connection profile ⇄ connection string

Scope: base `6813e14a9613908d1013b47dfe336c487dee57e6` .. task commit `e726035ef73fb07cf50c0a4d00bb33b95152cd01` (HEAD, branch `main`), one task-owned commit (supplied by the parent worker, matches `git diff --name-only 6813e14 HEAD`). Production files: `packages/core/src/uri/{model,convert,mask,index}.ts`, `packages/core/src/index.ts` (re-export), `packages/core/package.json` + `package-lock.json` (dependency `mongodb-connection-string-url`). Test files: `packages/core/src/uri/{convert,mask}.spec.ts`, `fixtures.ts`. Uncommitted at measurement time: only the two spec files changed by this report (hashes below); `reviews/uri-model/review.md` from the code-reviewer is present untracked and was not touched.

Requirements:
- `tasks/uri-model.md` acceptance criteria and recorded assumptions
- `SPEC.md` line 267: "logs and error messages mask passwords in URIs"; line 151 (copyable connection string, password masked)
- `docs/ARCHITECTURE.md` "Coverage" and "Conventions"
- Parent worker instructions (focus on mask() leak paths and parse/format edge cases)

## Test files changed

- `packages/core/src/uri/convert.spec.ts`
- `packages/core/src/uri/mask.spec.ts`

## Tests added or updated

Count: 67 (23 in `convert.spec.ts`, 44 in `mask.spec.ts`, counting each `it.each` row). No existing test was changed or removed.

Added to `convert.spec.ts`:
- `toConnectionString`: port boundaries 1/65535/65536; user name without password; `/` and `?` in the database name; `&`, `=`, `#` in option values and extra keys; `w=0`; extra array values written as repeated keys after known options.
- `parseConnectionString edge cases`: port boundaries and leading zeros; port 0/65536 and malformed IPv6 (`[::1`, `[::1]x`, `[]`) rejected; invalid percent-encoding in host/database; unescaped `:` in password rejected without echoing it; user without password; empty query; numbers beyond safe integer and non-integers kept in extra; empty `w`/`authMechanismProperties` kept in extra; repeated `authMechanismProperties` key kept in extra; no state shared between parses.
- `unknown options named like Object.prototype members`: `toString`, `constructor`, `hasOwnProperty`, `valueOf`, `__proto__` as option keys; `__proto__` as `authMechanismProperties` / `readPreferenceTags` key (fail, TW-1 / TW-2).

Added to `mask.spec.ts`:
- `maskText`: upper-case scheme and trailing punctuation.
- `mask and maskText on passwords with special characters`: one row per printable ASCII punctuation character and space (33 rows): the password is set in the model, written with `toConnectionString`, and must not leak through `mask()`, `maskText()` and `maskText()` with the URI in single quotes (row `'` fails, TW-3); secret options with special characters.
- `mask edge cases`: leading whitespace, mixed-case scheme, empty password, user without password, mixed-case `AWS_SESSION_TOKEN` next to an entry without `:`, repeated secret option, credentials plus secret option plus fragment, `@` after the hosts without a preceding `:`, user names stay visible.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Round-trip tests for 20+ URIs incl. SRV, IPv6, encoded credentials, authMechanismProperties | existing `connection string round trip` (34 fixture URIs + count check); added `toConnectionString` / `parseConnectionString edge cases` rows | `cd packages/core && npx vitest run` | Pass |
| AC2 Unknown options are preserved in `extra` | existing `unknown options` tests (pass); added `unknown options named like Object.prototype members` (7 tests) | `cd packages/core && npx vitest run` | Fail: 7 tests, TW-1 and TW-2 |
| AC3 `mask()` never leaks the password in any of the test URIs | existing `mask` tests over all fixtures (pass); added special-character rows and `mask edge cases` (all `mask()` assertions pass) | `cd packages/core && npx vitest run` | Pass for `mask()` |
| SPEC 267 logs and error messages mask passwords in URIs (`maskText`, error messages of `parseConnectionString`) | added `hides a password containing %j` (33 rows), `rejects a password with an unescaped ":" without echoing it` | `cd packages/core && npx vitest run` | Fail: 1 row (`'`), TW-3 |

## Focused test execution

Command:

`cd packages/core && npx vitest run`

Result:

Fail: Test Files 2 failed | 1 passed (3); Tests 8 failed | 188 passed (196). The 8 failures are exactly the new tests documenting TW-1, TW-2 and TW-3; all other new and existing tests pass. Before the additions: 128 passed in `src/uri`.

Also run on the final test files: `npx prettier --check packages/core` -> pass; `npx eslint packages/core` -> pass; `npx tsc -p packages/core/tsconfig.json` -> pass.

## Full test execution

Command:

`npm run check` (repository root)

Result:

Fail: `lint` and `typecheck` (all workspaces) pass; `vitest run` fails with Test Files 2 failed | 4 passed (6), Tests 8 failed (the same 8 as above). The renderer test step (`npm run test -w packages/renderer`) did not run because it is chained after the failing `vitest run`.

## .taskcheck

Result:

Fail: `.taskcheck` runs `npm run check`, result as above (the 8 failing tests that document TW-1..TW-3). It passes again once the production defects are fixed.

## Bugs found

### Option keys named like Object.prototype members are corrupted or lost in `extra`

Finding ID:

`TW-1`

Test:

`unknown options named like Object.prototype members > preserves ?%s=x in extra and on the round trip` (rows `toString`, `constructor`, `hasOwnProperty`, `valueOf`, `__proto__`)

Production source:

`packages/core/src/uri/convert.ts:320-325` (`addExtra`), also `model.extra` created as a plain object literal in `packages/core/src/uri/model.ts:131`

Requirement:

AC2 "Unknown options are preserved in an `extra` map"; model doc "a round trip never drops anything".

Expected behavior:

`parseConnectionString('mongodb://h/?toString=x').extra` is `{ toString: 'x' }` and `toConnectionString` writes back `mongodb://h/?toString=x`; same for any other key.

Actual behavior:

`addExtra` reads `m.extra[key]` and finds the inherited `Object.prototype` member, so `toString`/`constructor`/`valueOf`/`hasOwnProperty` become `[<native function>, 'x']` and the writer emits `toString=function%20toString()%20%7B%20%5Bnative%20code%5D%20%7D&toString=x`. For `__proto__` the assignment replaces the prototype of `extra` and the option disappears (`mongodb://h`).

Severity:

Medium

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### `__proto__` entries in authMechanismProperties / readPreferenceTags are silently dropped

Finding ID:

`TW-2`

Test:

`unknown options named like Object.prototype members > preserves an authMechanismProperties entry named __proto__`, `... > preserves a readPreferenceTags entry named __proto__`

Production source:

`packages/core/src/uri/convert.ts:54-65` (`parsePairs`: `out[k] = ...` on a plain object)

Requirement:

AC2 / round trip never drops an option.

Expected behavior:

`?authMechanismProperties=__proto__:x` and `?readPreferenceTags=__proto__:x` are written back unchanged (either as a map entry or verbatim in `extra`).

Actual behavior:

The `__proto__` assignment is swallowed, `parsePairs` returns `{}`. `authMechanismProperties` is then omitted entirely (`mongodb://h`); `readPreferenceTags=__proto__:x` becomes `readPreferenceTags=` which changes its meaning to "match any member".

Severity:

Low

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### `maskText()` leaks a password that contains an apostrophe

Finding ID:

`TW-3`

Test:

`mask and maskText on passwords with special characters > hides a password containing "'"`

Production source:

`packages/core/src/uri/mask.ts:12` (`URI_IN_TEXT` stops at `'`), used by `maskText` (`mask.ts:104-106`) and by the error path of `parseConnectionString` (`convert.ts:370`)

Requirement:

SPEC.md 267 "logs and error messages mask passwords in URIs"; task goal "password masking for display and logs".

Expected behavior:

`maskText('connect mongodb://u:ab\'cdSecret@host.example.com failed')` hides `ab'cdSecret`.

Actual behavior:

The text is returned unchanged with the full password. `toConnectionString` itself writes `'` unencoded (`encodeURIComponent` leaves `!'()*` as is) and the driver accepts it, so any profile whose password contains `'` leaks it in every log line or error passed through `maskText`. `mask()` on the bare string is correct. Related, already covered by the recorded assumption and therefore not given a failing test: a URI with an unencoded space in the password (accepted by `parseConnectionString`) is also not masked by `maskText` (`maskText('x mongodb://u:pa ssSecret@h y')` is returned unchanged).

Severity:

High

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### Observations (not defects, no failing test)

- `mongodb://user:@h` (empty password) is written back as `mongodb://user@h`; the model cannot tell an empty password from none. Meaning to the driver is the same in practice.
- IPv6 zone ids stay percent-encoded in the model (`fe80::1%25eth0`) although `UriHost.host` is documented as decoded; the round trip is correct.
- `mask()` does not mask `AWS_SESSION_TOKEN` written with a space after the comma (`SERVICE_NAME:x, AWS_SESSION_TOKEN:t`); whether the driver trims property keys was not verified.

## Coverage

Status: partial-failed. The coverage command ran on the final test snapshot and produced a fresh report, but exited nonzero because of the 8 failing tests (TW-1..TW-3). Numbers are diagnostic until the fixes land and coverage is re-run.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (all three files are new in this task, so whole-file coverage equals changed-line coverage for them).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `uri-model`; base `6813e14a9613908d1013b47dfe336c487dee57e6`; HEAD `e726035ef73fb07cf50c0a4d00bb33b95152cd01`; single task commit and file list supplied by the parent worker, confirmed with `git diff --name-only 6813e14 HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): sha256 `convert.ts` 8206f9b3..., `mask.ts` 119c3d0a..., `model.ts` da63a9eb... (committed, unchanged); uncommitted `convert.spec.ts` db7ffffe809d5d3fddc35b0f21ef937ccba691df29cbaf4c46c5df7788cd04e7, `mask.spec.ts` fc055865d6ccbb90a4e2ed0e23485cb2ebd710d02313586ce8af7d9b93c19e62.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/uri/convert.ts`, `src/uri/mask.ts`, `src/uri/model.ts`. Excluded: `src/uri/index.ts` and `src/index.ts` (re-exports only), `src/uri/fixtures.ts` (test data), spec files, `package.json`/`package-lock.json` (dependency metadata). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` 5.1.0; `npx vitest run --coverage --coverage.include='src/uri/convert.ts' --coverage.include='src/uri/mask.ts' --coverage.include='src/uri/model.ts' --coverage.reportsDirectory=coverage/uri-model-tw-final2 --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json --coverage.reportOnFailure=true` in `packages/core`; all tests of the `core` workspace.
- Run start/completion time and exit status: started 2026-11-16 19:04:30 +0100, duration 215 ms; nonzero exit (8 failed | 188 passed).
- Generated report paths and report hashes/run identifier: `packages/core/coverage/uri-model-tw-final2/coverage-summary.json` sha256 bf348ea741008edbc74df4c9c7a6853cf3eef8ba43972567d3a54d08e128341c (Git-ignored), plus `coverage-final.json` in the same fresh directory.
- Evidence outputs are fresh and inputs stayed unchanged: new, previously nonexistent reports directory; spec and source hashes taken before and after the run are identical.
- Final run after latest test additions and production fixes: yes for the test additions; no production fixes exist yet (TW-1..TW-3 open), so coverage must be re-run after the fixer's changes.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/core/src/uri/convert.ts` | 214/215 (99.53%) | 124/125 (99.20%) | 85/86 (98.84%) | 185/186 (99.46%) |
| `packages/core/src/uri/mask.ts` | 60/60 (100%) | 36/36 (100%) | 9/9 (100%) | 52/52 (100%) |
| `packages/core/src/uri/model.ts` | 4/4 (100%) | N/A (0/0) | 1/1 (100%) | 4/4 (100%) |
| Aggregate (summed counters, 3 measured files, none missing) | 278/279 (99.64%) | 160/161 (99.38%) | 95/96 (98.96%) | 241/242 (99.59%) |

Before the added tests (same command, pre-addition snapshot): statements 271/279, branches 151/161, functions 95/96, lines 240/242.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/core/src/uri/convert.ts:240` (`readPreferenceTags` `isSet: () => false`) | none: unreachable, `isSet` is never called for a `repeatable` option | Justified gap (dead code); not testable through the public API |
| `packages/core/src/uri/convert.ts:369` (branch: thrown value not an `Error`) | defensive; the library always throws `Error`s | Justified gap |
| `packages/core/src/uri/convert.ts:331` (decode error) | invalid percent-encoding in host/database | Covered by `rejects invalid percent-encoding in the host or database name` |
| `packages/core/src/uri/convert.ts:185`, `:259` (empty `authMechanismProperties` / `w`) | AC2: unrepresentable known values kept in `extra` | Covered by `keeps empty w and authMechanismProperties values verbatim in extra` |
| `packages/core/src/uri/mask.ts:36` (property entry without `:`), `:88` (`@` without preceding `:`) | AC3 mask edge paths | Covered by `masks the AWS session token whatever the key case, next to entries without a colon` and `does not mask an "@" after the hosts when no ":" comes before it` |

## Unable to test

- Whether the MongoDB driver trims whitespace around `authMechanismProperties` keys (affects the third observation): needs the driver or a real server; not required by the criteria. No follow-up unless the fixer wants to harden `mask()`.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion (TW-1 Medium, TW-2 Low, TW-3 High). The 8 failing tests are intentional and must not be skipped; `.taskcheck` passes once the defects are fixed. The test files and this report were left uncommitted for the parent worker to verify and commit.
