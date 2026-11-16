# Test Report

Date: 2026-11-16

Task: uri-model - Core: connection profile ⇄ connection string (round 6, revision f477ad0 after fixes Round 5)

Scope: `git diff f367a4947439fde3900886bc89cf0611cc5c33a8 f477ad045b5bc451aff6ac33539db35af2572092` on branch `main` (base supplied by the parent worker; HEAD = `f477ad045b5bc451aff6ac33539db35af2572092`). Task-owned commits (`git log --oneline f367a49..HEAD`): `9e0636d` (implementation), `bcf23fb`, `03ea54d`, `b2cc5f8`, `53b3f0f`, `a942abd`, `3c06ebd`, `e518cad`, `5670ad7`, `3e0bc22`, `f477ad0` (test passes, reviews, fixes). Production files of the task (`git diff --name-only f367a49 HEAD -- '*.ts'`): `packages/core/src/uri/{convert,mask,model,index}.ts`, `packages/core/src/index.ts` (re-export). Since round 5 only `packages/core/src/uri/mask.ts` changed in production code (`f477ad0`: `uriEnd` caches the next embedded scheme and tracks the query state per word; `endsInQuery` removed; dead line removed from `endsInSecretOption`). This round focuses on that change; the whole task scope is re-run and re-measured. Uncommitted at measurement time: `packages/core/src/uri/mask.spec.ts` (this round) and `reviews/uri-model/review.md` (code-reviewer, not touched by me).

Requirements:
- `tasks/uri-model.md` acceptance criteria and recorded assumptions (mask hides password, proxyPassword, tlsCertificateKeyFilePassword, AWS_SESSION_TOKEN; maskText masks URIs in free text)
- `SPEC.md` §6 "logs and error messages mask passwords in URIs" (over-masking acceptable, leaking not); §1 goal 4 "documents up to the 16 MB limit stay responsive"
- `reviews/uri-model/fixes.md` Round 5 (TW-8 / CR-9 fix to verify)
- Parent worker instructions for this round (TW-8 fixed; no regression: leaks, splitting of later URIs, hangs)

## History of earlier rounds

- Round 1 (`bcf23fb`): 8 failing tests documented TW-1..TW-3 (with CR-1..CR-4 from review); fixed in `03ea54d`.
- Round 2 (`b2cc5f8`): TW-4 (secret option value containing a scheme), CR-5/CR-6; TW-4/CR-5 fixed in `53b3f0f`, CR-6 accepted (over-masking).
- Round 3 (`a942abd`): TW-5 (digits-then-scheme password split) and TW-6 (= CR-7, raw space in a secret option value); fixed in `3c06ebd`.
- Round 4 (`e518cad`): TW-7 (= CR-8, secret option after a non-secret value with a raw space); fixed in `5670ad7`.
- Round 5 (`3e0bc22`): 15 tests; TW-8 (= CR-9, `maskText` quadratic on a long line after a query part, Low); fixed in `f477ad0`.

## Test files changed

- `packages/core/src/uri/mask.spec.ts`

## Tests added or updated

Count: 6 (new `describe` block `maskText incremental scan`). No existing test changed or removed. Core suite: 308 -> 314 tests.

- `masks a long line after a secret value with a raw space in linear time` (10k vs 40k words; before `f477ad0` this shape was quadratic too: round 5 measured 250 kB in 1.56 s)
- `masks many connection strings with queries on one line in linear time` (2k vs 8k strings)
- `masks credentials with a raw space followed by a query with a raw space` (exact output; the query state scan starts at the body, before the CR-5 credentials jump)
- `ends the token at the first whitespace when the first word has a fragment after "?"` (exact output; the only test hitting the new `run.indexOf('#', q) >= 0` return)
- `keeps a scheme inside a secret value in a later word of the query` (exact output; cached `next` scheme consumed in a later word)
- `splits off an upper-case scheme in a later word after a query` (exact output)

All 6 pass.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Round-trip tests for 20+ URIs incl. SRV, IPv6, encoded credentials, authMechanismProperties | `connection string round trip` (35 fixtures in `fixtures.ts`, incl. SRV, IPv6 loopback, IPv6 replica set with credentials, percent-encoded credentials, AWS IAM with session token, Kerberos with authMechanismProperties), `toConnectionString`, `parseConnectionString edge cases` (convert.spec.ts, unchanged) | `npx vitest run --root packages/core` | Pass |
| AC2 Unknown options preserved in `extra` | `unknown options`, `unknown options named like Object.prototype members` | `npx vitest run --root packages/core` | Pass |
| AC3 `mask()` never leaks the password in any of the test URIs | `mask > never leaks a secret: $name` over all fixtures (also after a round trip and via `maskText`), special-character rows, `mask edge cases` | `npx vitest run --root packages/core` | Pass |
| TW-8 / CR-9 fix: `maskText` linear on a long line after a query | `masks a long line of prose after a query in linear time` (round 5, was failing) + the 2 new linear-time tests | `npx vitest run --root packages/core` | Pass |
| No behaviour regression from the `f477ad0` rewrite (leaks, splitting of later URIs) | all earlier `maskText` tests + 4 new exact-output tests; plus a one-off differential probe (below) | `npx vitest run --root packages/core` | Pass |
| No regression of earlier fixes (TW-1..TW-7, CR-1..CR-8) | all existing `mask`/`maskText` tests | `npx vitest run --root packages/core` | Pass |

Differential probe (temporary spec `packages/core/src/uri/zz-probe.tmp.spec.ts`, deleted after the run, not part of the suite): `maskText` of `f477ad0` vs. a verbatim copy of the pre-`f477ad0` `uriEnd`/`endsInQuery`/`endsInSecret`/`endsInSecretOption` driving the exported `mask()`, on 400 000 seeded random strings built from schemes (incl. upper-case and SRV), `:`, `@`, `/`, `?`, `#`, `&`, `=`, spaces, tabs, CR/LF, U+2028, secret option names (plain, percent-encoded key, AWS_SESSION_TOKEN raw and encoded), `%ZZ`, ports, IPv6 brackets, quotes, `+`, `%20`. Command: `npx vitest run --root packages/core src/uri/zz-probe.tmp.spec.ts --reporter=verbose --silent=false` -> `differential strings 400000, diffs 0`. Independent of the fixer's own 200 000-string check.

Timing probe (same temporary spec, current code; ms per call): query + 400k words (2 MB) 17 ms; 16 MB line after a query 135 ms; secret value with raw space + 400k words 1.5 s (100k words 0.36 s: linear, 4.2x); 95k connection strings with queries on one line (1.9 MB) 2.9 s (linear, 4.2x); credentials with 400k spaces 0.4 ms; prose with 100k schemes after a query 40 ms. No hang found.

## Focused test execution

Command:

`npx vitest run --root packages/core src/uri/mask.spec.ts -t "incremental scan" --reporter=verbose` (repo root), then `npx vitest run --root packages/core`

Result:

Pass: 6 passed (focused); core workspace Test Files 3 passed (3), Tests 314 passed (314).

`npx prettier --check packages/core/src/uri/mask.spec.ts` -> "All matched files use Prettier code style!"; `npx eslint packages/core/src/uri/mask.spec.ts` -> no output (pass).

## Full test execution

Command:

`npm run check` (repo root: `npm run lint && npm run typecheck && npm run test`)

Result:

Fail, for a reason outside this task: lint passes ("All matched files use Prettier code style!"); `typecheck` fails in workspace `@thicket/desktop` (`apps/desktop`, electron-shell task, not touched by uri-model) with `TS2307: Cannot find module 'electron'` / `'playwright-core'` and follow-on `TS7006` errors. Cause: `apps/desktop/package.json` declares `electron` and `playwright-core` and `package-lock.json` lists `node_modules/electron`, but neither is installed in `node_modules` (dependencies not reinstalled after that workspace arrived). I may not install dependencies; the parent must run the project's install (`docs/ARCHITECTURE.md`) before `.taskcheck`. The steps after `typecheck` did not run in the chain, so I ran them separately:

- `npx tsc -p tsconfig.json` (root) -> pass, no output
- `npm run typecheck -w packages/contract -w packages/backend -w packages/renderer --if-present` -> 0 `error TS`; `npm run typecheck -w packages/core` -> pass
- `npx vitest run` (root) -> Test Files 14 passed (14), Tests 1051 passed (1051)
- `npm run test -w packages/renderer` -> Test Files 5 passed (5), Tests 181 passed (181)

## .taskcheck

Result:

Fail (not invoked separately; it runs `npm run check`, result above). The failure is the missing `electron`/`playwright-core` install in `apps/desktop`, unrelated to uri-model; every uri-model and other test passes.

## Bugs found

None in this round. No failing test was added.

### Findings (disposition)

| ID | Severity | Disposition in this round |
|---|---|---|
| TW-8 / CR-9 | Low | Fixed in `f477ad0`: the round-5 test passes (measured 16 MB line after a query in 135 ms), plus 2 new linear-time tests; output identical to the previous revision on 400 000 random strings |
| TW-7 / CR-8 | Low | Fixed in `5670ad7`; tests still pass |
| TW-1..TW-6, CR-1..CR-7 | various (earlier rounds) | Fixed earlier; tests still pass |
| CR-6 | Low | Accepted earlier as over-masking (no leak); unchanged |

### Observations (not defects, no failing test)

- Many embedded schemes inside one secret value or password are still quadratic: `mongodb://h/?proxyPassword=` + `mongodb://` x 5 000 (50 kB) 51 ms, x 20 000 (200 kB) 609 ms (12x for 4x); in a password 7 ms -> 70 ms. Cause: `endsInSecret(text.slice(start, next.index))` re-checks the whole prefix per embedded scheme (unchanged by `f477ad0`, present since the TW-4 fix). Only adversarial input (thousands of `mongodb://` inside one secret) triggers it; the fixer noted the same in fixes.md Round 5. No finding raised.
- A secret value with a raw space and long prose after it costs about 0.75 µs per character (2 MB in 1.5 s), mostly in `mask()` on the swallowed token; linear, not a hang.
- Pre-existing design, unchanged: a later connection string after a secret value with a raw space is merged into that value (over-masking, no leak); a connection string never continues across a line break.

## Coverage

Status: verified for revision `f477ad0` plus the final test file of this round (fresh run, exit 0).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured with a separate tool. All three measured files were added by this task (base `f367a49`), so whole-file equals changed-line coverage for the task. For the `f477ad0` change alone (mask.ts `uriEnd` lines 170-206), every statement is executed and every branch arm is hit (from `coverage-final.json`: e.g. line 200 `#` after `?` in the first word 1 hit, line 198 no `?` in the first word 115 hits, line 201 `#` in a later word 2 hits).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `uri-model`; base `f367a4947439fde3900886bc89cf0611cc5c33a8` (parent-supplied); HEAD `f477ad045b5bc451aff6ac33539db35af2572092`; commits and files from `git log f367a49..HEAD` and `git diff --name-only f367a49 HEAD -- '*.ts'`.
- Source/test snapshot identifier (including uncommitted inputs): sha256 `convert.ts` 0428507d6d8b8504de6daf3e06736f364d172a1074a4b40a72e76a7b8bc730c6, `mask.ts` 25ffb89813ae5aef1ce65147bedf94985edbe5eb4e3694d8be8ac4a89ff051f3, `model.ts` da63a9eb80e58633c566a92e7d46397dcf5e9d4d49a317613df048d64010a5ff, `uri/index.ts` 42f5debbedc6980834810b788175691010af4a1f56d0d037c222511bfd7e1792, `src/index.ts` 8b4fc9487fabd047ddc84b93457d634b06b6ba149ecdc26a49e6a6c7d39e714e, `fixtures.ts` 899cd1c1aeb791fc0cf81693642f1623aea576ffef8a78a5fc98e20f5f77291e, `convert.spec.ts` 37621a794cc8badc5c4a5b542c49b321398c2556e701609493cc35154e7d804e (all committed); uncommitted `mask.spec.ts` 561a7e2d2f63b75877ffa873b013c1329864ae8d2228c8088f98817a2d64cbd4.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/uri/convert.ts`, `src/uri/mask.ts`, `src/uri/model.ts`. Excluded: `src/uri/index.ts`, `src/index.ts` (re-exports only), `src/uri/fixtures.ts` (test data), spec files. No renames or deletions. None missing from the report.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` (v8), Node v24.21.0; `npx vitest run --coverage --coverage.include='src/uri/convert.ts' --coverage.include='src/uri/mask.ts' --coverage.include='src/uri/model.ts' --coverage.reportsDirectory=coverage/uri-model-tw-pass6 --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json`, run in `packages/core`; all 314 tests of the `core` workspace.
- Run start/completion time and exit status: first run 2026-11-16 19:41:10-19:41:15 +0100; confirming rerun into the same directory 19:41:29-19:41:31 +0100, exit 0, byte-identical reports.
- Generated report paths and report hashes/run identifier: `packages/core/coverage/uri-model-tw-pass6/coverage-summary.json` sha256 c81cbc4ee24026b2efaebe456f6c794f0dfd1563dd787230660fa1d586862669, `coverage-final.json` sha256 741a9c54e0b544d9ef51d0e58917e7b36ef17106d634917db750e8cacafc09c2 (both Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: new, previously nonexistent reports directory; source and spec hashes before and after the runs are identical.
- Final run after latest test additions and production fixes: yes (revision `f477ad0`, final test file). Round 5 numbers (revision `cfd245d`) are stale and not reused.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/core/src/uri/convert.ts` | 219/220 (99.55%) | 130/131 (99.24%) | 87/88 (98.86%) | 190/191 (99.48%) |
| `packages/core/src/uri/mask.ts` | 129/129 (100%) | 79/81 (97.53%) | 11/11 (100%) | 110/110 (100%) |
| `packages/core/src/uri/model.ts` | 4/4 (100%) | N/A (0/0) | 1/1 (100%) | 4/4 (100%) |
| Aggregate (summed counters, 3 measured files; exclusions listed above, none missing) | 352/353 (99.72%) | 209/212 (98.58%) | 99/100 (99.00%) | 304/305 (99.67%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/core/src/uri/mask.ts:138`, `150` (`.pop() ?? ''` fallback arms) | none: `split()` always returns a non-empty array | Justified gap (unreachable, unchanged) |
| `packages/core/src/uri/mask.ts:170-206` (`f477ad0` change) | TW-8 fix and equivalence with the previous revision | Fully covered (every arm hit); 6 new tests |
| `packages/core/src/uri/convert.ts:248` (`readPreferenceTags` `isSet: () => false`, statement and function) | none: never called for a repeatable option | Justified gap (unchanged since round 2) |
| `packages/core/src/uri/convert.ts:377` (branch: thrown value not an `Error`) | defensive | Justified gap (unchanged since round 2) |

The round-5 dead line in `endsInSecretOption` (old mask.ts:135) is gone, so it no longer appears as uncovered.

## Unable to test

- Whether a live MongoDB driver connection accepts raw whitespace in option values: only the driver's URI parser (`mongodb-connection-string-url`, via `parseConnectionString`) was used; a live connection is outside this task.
- The linear-time tests measure wall-clock time. They compare two input sizes (ratio < 8, or the larger run < 200 ms) so they don't depend on machine speed; observed ratios are about 4.
- `npm run check` / `.taskcheck` end to end: blocked by the missing `electron`/`playwright-core` install in `apps/desktop` (environment, not this task). Follow-up for the parent: install dependencies as documented, then rerun `npm run check`.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. TW-8 is fixed: the round-5 linear-time test passes, a 16 MB line after a query is masked in 135 ms, and a 400 000-string differential probe found no output difference from the previous revision (no new leak, no lost split of later connection strings, no hang). 6 new tests pass (314/314 in packages/core; root vitest 1051/1051; renderer 181/181), and all three acceptance criteria are covered by passing tests. `npm run check` fails only at typecheck of `apps/desktop` because `electron`/`playwright-core` are not installed, which is unrelated to this task. The parent must reinstall dependencies and rerun the check before `done`. The test file and this report are left uncommitted for the parent worker.
