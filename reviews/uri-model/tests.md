# Test Report

Date: 2026-11-16

Task: uri-model - Core: connection profile ⇄ connection string (fifth pass, revision cfd245d after fixes Round 4)

Scope: `git diff 2693efcf889a05c8ab14886508568ec74bbecf6d cfd245d1ef2c282e3e167d9ad84e89cdde60d21c` on branch `main` (base supplied by the parent worker and equal to `git merge-base HEAD origin/main`; HEAD = `cfd245d1ef2c282e3e167d9ad84e89cdde60d21c`). Task-owned commits (`git log --oneline 2693efc..HEAD`): `ed883de` (implementation), `4a7164c`, `9c085b7`, `bbff6da`, `a29b39f`, `c537952`, `c6761ff`, `900386e`, `cfd245d` (test passes, reviews, fixes). The base hash differs from round 4 (`0ba91a5`) because of a rebase; the task file list is unchanged. Production files of the task: `packages/core/src/uri/{convert,mask,model,index}.ts`, `packages/core/src/index.ts` (re-export). Since round 4 only `packages/core/src/uri/mask.ts` changed in production code (`cfd245d`: `uriEnd` no longer ends the connection string at whitespace inside the query part, new helper `endsInQuery`, removed `valueEnd`), plus two changed expectations and one new test in `mask.spec.ts`. This pass focuses on that change; the whole task scope is re-run and re-measured. Uncommitted at measurement time: `packages/core/src/uri/mask.spec.ts` (this pass) and `reviews/uri-model/review.md` (code-reviewer, not touched by me).

Requirements:
- `tasks/uri-model.md` acceptance criteria and recorded assumptions (mask hides password, proxyPassword, tlsCertificateKeyFilePassword, AWS_SESSION_TOKEN; maskText masks URIs in free text; CR-8 assumption, superseded by the Round 4 fix)
- `SPEC.md` §6 "logs and error messages mask passwords in URIs" (over-masking acceptable, leaking not); §1 goal 4 "documents up to the 16 MB limit stay responsive"
- `reviews/uri-model/fixes.md` Round 4 (TW-7 / CR-8 fix to verify)
- Parent worker instructions for this pass (check TW-7, look for leaks, lost splitting of later URIs and hangs)

## Test files changed

- `packages/core/src/uri/mask.spec.ts`

## Tests added or updated

Count: 15 (one new `describe` block `maskText query part across whitespace`, counting each `it.each` row). No existing test changed or removed. Core suite: 293 -> 308 tests.

- pass: secret option after a non-secret value with a tab, two spaces, a Unicode line separator (U+2028), an upper-case secret key, a percent-encoded secret key (5 rows); URI without a path (`mongodb://h?...`, exact output); URI at the very start of the text (exact output); percent-encoded `AWS_SESSION_TOKEN%3A...` after a raw space; two connection strings on one line, each with a raw space before a secret (both masked, exact output); a later `mongodb+srv://` string after prose following a query is still split off; a later string whose own query has a raw space before a secret is split off and both secrets masked; the token ends at the first whitespace after a `#` and the next string is masked separately; text on the next line is not swallowed and its string is masked separately; a URI without a query still ends at the first whitespace (`failed? retry` stays visible).
- fail (1, TW-8): `masks a long line of prose after a query in linear time`.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Round-trip tests for 20+ URIs incl. SRV, IPv6, encoded credentials, authMechanismProperties | `connection string round trip` (35 fixtures in `fixtures.ts`, incl. SRV, IPv6 loopback, IPv6 replica set with credentials, percent-encoded credentials, AWS IAM with session token, Kerberos with authMechanismProperties), `toConnectionString`, `parseConnectionString edge cases` (convert.spec.ts, unchanged) | `npx vitest run --root packages/core` | Pass |
| AC2 Unknown options preserved in `extra` | `unknown options`, `unknown options named like Object.prototype members` | `npx vitest run --root packages/core` | Pass |
| AC3 `mask()` never leaks the password in any of the test URIs | `mask > never leaks a secret: $name` over all fixtures (also after a round trip and via `maskText`), special-character rows, `mask edge cases` | `npx vitest run --root packages/core` | Pass |
| TW-7 / CR-8 fix (Round 4): secret option after a non-secret value with a raw space | 3 round-4 TW-7 rows + 10 new leak/exact-output tests above | `npx vitest run --root packages/core` | Pass |
| No regression: later connection strings on the same line still split off | round-4 `still splits off a later connection string ...` + 4 new splitting tests (SRV, own query with secret, after `#`, next line) | `npx vitest run --root packages/core` | Pass |
| No regression of earlier fixes (TW-1..TW-6, CR-1..CR-7) | all existing `mask`/`maskText` tests | `npx vitest run --root packages/core` | Pass |
| SPEC §1/§6: `maskText` stays responsive on a long log line (no hang) | `masks a long line of prose after a query in linear time` | `npx vitest run --root packages/core` | Fail: 1 test (TW-8) |

## Focused test execution

Command:

`npx vitest run --root packages/core src/uri/mask.spec.ts` (repo root), then `npx vitest run --root packages/core`

Result:

Fail: Tests 1 failed | 223 passed (224) for `mask.spec.ts`; core workspace Test Files 1 failed | 2 passed (3), Tests 1 failed | 307 passed (308). The failure is the new TW-8 test (`25k words 120 ms, 100k words 1974 ms`). All 14 other new tests pass, and every pre-existing test passes, so TW-7 is fixed and no leak or lost split was found.

`npx prettier --write packages/core/src/uri/mask.spec.ts` (unchanged) and `npx eslint packages/core/src/uri/mask.spec.ts` -> pass, no output.

## Full test execution

Command:

`npm run check` (repo root: `eslint . --max-warnings 0 && prettier --check .`, typecheck of all workspaces, root `vitest run`, renderer tests)

Result:

Fail: lint ("All matched files use Prettier code style!") and typecheck pass; root `vitest run`: Test Files 1 failed | 6 passed (7), Tests 1 failed | 905 passed (906), the same TW-8 test. The renderer step did not run (chained after the failing `vitest run`).

## .taskcheck

Result:

Fail: `.taskcheck` runs `npm run check`, result as above (not invoked separately). Expected to pass once TW-8 is fixed.

## Bugs found

### `maskText()` takes quadratic time on a long line after a connection string with a query

Finding ID:

`TW-8`

Test:

`maskText query part across whitespace > masks a long line of prose after a query in linear time` (FAILING test, kept on purpose; it must not be skipped)

Production source:

`packages/core/src/uri/mask.ts:173-191` (`uriEnd` loop), introduced by `cfd245d`. Inside a query, every whitespace now starts another loop iteration (`end = runEnd + 1`), and each iteration does O(remaining/consumed text) work: `endsInQuery(text.slice(start, runEnd))` copies and scans the whole token so far (line 189), and `inner.exec(text)` from `end` scans to the end of the text when no further scheme follows (line 177). With n words on the line that is O(n x length). Before `cfd245d`, a non-secret query ended at the first whitespace and a secret value jumped to the next `&`/`#`/line break with one regex search.

Requirement:

SPEC §6 (logs and error messages are masked, so `maskText` runs synchronously on every logged line / error message) together with SPEC §1 goal 4 ("documents up to the 16 MB limit stay responsive"): an error message that embeds a large serialized document after a connection string must not block the process.

Expected behavior:

Masking time grows roughly linearly with the length of the line (the test accepts the 500 kB case if it takes < 200 ms, or < 8x the 125 kB case).

Actual behavior:

Measured on this machine: `err mongodb://u:pw@h/?tls=true ` followed by `'word '` x 25 000 (125 kB): 120 ms; x 100 000 (500 kB): 1.93-2.0 s (16x for 4x input). In a separate probe (no credentials): 250 kB 1.6 s, 500 kB 6.1 s, 1 MB 23.3 s. The same growth applies after a secret value with a raw space (`?proxyPassword=a ` + 50 000 words, 250 kB: 1.56 s). The output is correct (no leak); only the running time is affected. A line break bounds it (1 MB on the next line: 1 ms).

Severity:

Low (no secret leaks; needs a single very long log line containing a connection string with a query, but then blocks the main/backend process for seconds; 16 MB would effectively hang)

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.` (E.g. once in the query, track the `#` state incrementally instead of re-slicing the whole token per word, and search for the next embedded scheme once rather than from every word start; both loops must be linear together.)

### Prior findings (disposition)

| ID | Disposition in this pass |
|---|---|
| TW-1..TW-6, CR-1..CR-7 | Fixed earlier; tests still pass |
| TW-7 / CR-8 | Fixed in `cfd245d`; the 3 round-4 rows pass and 10 new tests (other whitespace kinds, key spellings, no path, start of text, two strings per line) pass. The CR-8 assumption in `tasks/uri-model.md` ("CR-8 accepted") no longer matches the code; the parent may want to note it as superseded |
| CR-6 | Accepted earlier as over-masking (no leak); unchanged |

The two expectations changed in `cfd245d` (`keeps a scheme inside the value of an option key that cannot be decoded`, `... authMechanismProperties value that cannot be decoded`) now expect the trailing ` y` to be masked too. That is more masking, not less: the `expectNoLeak` assertions are unchanged and pass. Not a weakening.

### Observations (not defects, no failing test)

- Over-masking from the TW-7 rule: prose after a query is now part of the token. `mask()` mostly keeps it visible, but when the prose contains `:` and `@` the invalid-URI path masks from the host on (`x mongodb://h/?appName=x failed: user@example` -> `x mongodb://h:****@example`), and after a secret value with prose a later connection string is merged into it (`"mongodb://h/?...&proxyPassword=q" and "mongodb://u:q2@h"` -> `"mongodb://h:****@h"`). No secret leaks; it matches the documented "masking more is acceptable".
- A connection string is never continued across a line break (decision from round 3, pinned by tests). The WHATWG parser behind `mongodb-connection-string-url` drops raw tab/CR/LF, so `mongodb://h/?appName=my app\n&proxyHost=p&proxyPassword=x` is valid for the driver, and `maskText` would show the part after the line break. Pre-existing design, not introduced by `cfd245d`; only relevant for URIs that were split over lines.
- `mask.ts:135` (`endsInSecretOption`: `if (body.search(/[/?#]/) < 0) return false;`) is dead since `cfd245d`: its only caller `endsInSecret` handles that case first, and the `undecodable` parameter is now always `true`. Optional cleanup.

## Coverage

Status: partial-failed. Fresh report for revision `cfd245d` with the final test file of this pass, but the command exited nonzero (exit 1) because of the TW-8 test. The numbers are diagnostic; re-run after the fix. Round 4 numbers (revision `1aa5e91`, prior mask.ts) are stale and not reused.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured with a separate tool. All three files were added by this task (base `2693efc`), so whole-file equals changed-line coverage for the task. For the `cfd245d` change alone (mask.ts lines 181-199: `uriEnd` loop exit and `endsInQuery`), every line is executed and no branch in that range is unhit (from `coverage-final.json`).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `uri-model`; base `2693efcf889a05c8ab14886508568ec74bbecf6d` (parent-supplied, equals `git merge-base HEAD origin/main`); HEAD `cfd245d1ef2c282e3e167d9ad84e89cdde60d21c`; commits and files from `git log` and `git diff --name-only 2693efc -- '*.ts'`.
- Source/test snapshot identifier (including uncommitted inputs): sha256 `convert.ts` 0428507d6d8b8504de6daf3e06736f364d172a1074a4b40a72e76a7b8bc730c6, `mask.ts` a8312d4ef0e767a75f3b96d0194a6f5e671daedd6339b49f85db36805e55b3c3, `model.ts` da63a9eb80e58633c566a92e7d46397dcf5e9d4d49a317613df048d64010a5ff, `index.ts` 42f5debbedc6980834810b788175691010af4a1f56d0d037c222511bfd7e1792, `fixtures.ts` 899cd1c1aeb791fc0cf81693642f1623aea576ffef8a78a5fc98e20f5f77291e, `convert.spec.ts` 37621a794cc8badc5c4a5b542c49b321398c2556e701609493cc35154e7d804e (all committed); uncommitted `mask.spec.ts` 49e093300f9e09237b6af83030c878e2515e092223c0abc8a4e4704b18497246.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/uri/convert.ts`, `src/uri/mask.ts`, `src/uri/model.ts`. Excluded: `src/uri/index.ts`, `src/index.ts` (re-exports only), `src/uri/fixtures.ts` (test data), spec files. No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8`; `npx vitest run --coverage --coverage.include='src/uri/convert.ts' --coverage.include='src/uri/mask.ts' --coverage.include='src/uri/model.ts' --coverage.reportsDirectory=coverage/uri-model-tw-pass5 --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json --coverage.reportOnFailure=true`, run in `packages/core`; all 308 tests of the `core` workspace.
- Run start/completion time and exit status: started 2026-11-16 19:33:56 +0100, duration 2.25 s; exit 1 (1 failed | 307 passed).
- Generated report paths and report hashes/run identifier: `packages/core/coverage/uri-model-tw-pass5/coverage-summary.json` sha256 d4ec6d75a42cb59cef153eb242173a261dd43d57a0da37a400838db6f8e7e4b5, `coverage-final.json` (both Git-ignored, written 19:33:58).
- Evidence outputs are fresh and inputs stayed unchanged: new, previously nonexistent reports directory; source and spec hashes taken before and after the run are identical.
- Final run after latest test additions and production fixes: yes for revision `cfd245d` and the final test file; a fix for TW-8 makes it stale.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/core/src/uri/convert.ts` | 219/220 (99.55%) | 130/131 (99.24%) | 87/88 (98.86%) | 190/191 (99.48%) |
| `packages/core/src/uri/mask.ts` | 122/123 (99.19%) | 76/79 (96.20%) | 12/12 (100%) | 103/103 (100%) |
| `packages/core/src/uri/model.ts` | 4/4 (100%) | N/A (0/0) | 1/1 (100%) | 4/4 (100%) |
| Aggregate (summed counters, 3 measured files; exclusions listed above, none missing) | 345/347 (99.42%) | 206/210 (98.10%) | 100/101 (99.01%) | 297/298 (99.66%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/core/src/uri/mask.ts:135` (statement and `if` branch `return false`) | none: dead since `cfd245d` (caller `endsInSecret` handles prefixes without `/?#` first) | Justified gap; reported as an observation (optional cleanup) |
| `packages/core/src/uri/mask.ts:142`, `151` (`.pop() ?? ''` fallbacks) | none: `split()` always returns a non-empty array | Justified gap (unreachable, unchanged) |
| `packages/core/src/uri/mask.ts:181-199` (`cfd245d` change) | TW-7 fix | Fully covered by round-4 and the 15 new tests |
| `packages/core/src/uri/convert.ts:248` (`readPreferenceTags` `isSet: () => false`) | none: never called for a repeatable option | Justified gap (unchanged since pass 2) |
| `packages/core/src/uri/convert.ts:377` (branch: thrown value not an `Error`) | defensive | Justified gap (unchanged since pass 2) |

## Unable to test

- Whether a live MongoDB driver connection accepts raw whitespace in option values: only the driver's URI parser (`mongodb-connection-string-url`, via `parseConnectionString`) was used; a live connection is outside this task.
- The TW-8 test measures wall-clock time. It compares two input sizes (ratio < 8, or < 200 ms absolute) so it does not depend on machine speed; a linear implementation passes with a wide margin, the current one shows a ratio of about 16.

## History of earlier rounds

- Pass 1 (`4a7164c`): 8 failing tests documented TW-1..TW-3 (and CR-1..CR-4 from review); fixed in `9c085b7`.
- Pass 2 (`bbff6da`): TW-4 (secret option value containing a scheme) and CR-5/CR-6; TW-4/CR-5 fixed in `a29b39f`, CR-6 accepted.
- Pass 3 (`c537952`): TW-5 (digits-then-scheme password split) and TW-6 (raw space in a secret option value, = CR-7); fixed in `c6761ff`.
- Pass 4 (`900386e`): 31 tests; TW-7 (secret option after a non-secret value with a raw space, = CR-8); fixed in `cfd245d`.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion. TW-7 is fixed: 14 new leak and splitting tests pass, no leak, no lost split of later connection strings and no regression of earlier fixes were found, and all three acceptance criteria are covered by passing tests on revision `cfd245d`. The `cfd245d` change made `maskText` quadratic on long lines after a connection string with a query (TW-8, Low, 1 MB line about 23 s). One failing test documents it and must not be skipped. Lint and typecheck pass. `npm run check` fails only on the TW-8 test. The test file and this report are left uncommitted for the parent worker.
