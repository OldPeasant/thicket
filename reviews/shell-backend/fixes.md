# Fix Report

Date: 2026-11-17

Task: shell-backend — mongosh host in worker threads (shell.open/eval/complete/close)

Scope: current task. This report covers two fix rounds, each with exactly one approved finding:
CR-5 from `reviews/shell-backend/review.md` (round 3, commit 02d12f9) and TW-2 from
`reviews/shell-backend/tests.md` (round 4, this change).

## Fixed findings

### CR-5 — A comment glued to a command argument still swallows the following lines

Round: 3 (commit 02d12f9)

Files changed:
- `packages/backend/src/shell/split.ts`
- `packages/backend/src/shell/split.spec.ts`

Problem:
The argument pattern in `COMMAND` was `(?!\/[/*])[^\s;]+`: only the first character of an
argument was checked, so a `//` or `/*` directly after an argument (`use test// c`, `show dbs//x`,
`show dbs/* x */`) became part of the argument. `use test// c\ndb.c.find()` was then rejected as a
command (two arguments) and passed whole to mongosh, which dropped the `db.c.find()`; `show dbs//x`
became `show("dbs//x")`.

Fix:
The argument pattern is now `(?:(?!\/[/*])[^\s;])+`: no character of an argument may start `//` or
`/*`, so the trailing-comment branch takes the comment. A single `/` inside an argument (`use a/b`)
is still part of it. Doc comment of `COMMAND` updated accordingly.

Tests added to the "trailing comment edge cases" table in `split.spec.ts`:
- `use test// c\ndb.c.find()` -> `['use test', '\ndb.c.find()']`
- `show dbs//x` -> `['show dbs']`
- `show dbs/* x */` -> `['show dbs']`
- `use test/* c */\nx` -> `['use test', '\nx']`
- `show profile 5//last\nx` -> `['show profile 5', '\nx']`
- `use a/b\nx` -> `['use a/b', '\nx']` (single slash stays in the argument)

All previously existing split cases still pass unchanged.

Validation (round 3):
- `npx vitest run packages/backend/src/shell` — Pass (4 files, 165 tests)
- `npx vitest run --config test/integration/vitest.config.ts shell` (Podman) — Pass (1 file, 16 tests)
- `npm run check` — Pass

### TW-2 — Catastrophic backtracking in the trailing-comment part of `COMMAND`

Round: 4 (this change, uncommitted)

Files changed:
- `packages/backend/src/shell/split.ts` (the `COMMAND` regex and its doc comment only)

Problem:
The trailing-comment part `(?:(?:\/\*.*?\*\/|\/\/.*)[^\S\n]*)*` was ambiguous. The lazy `.*?` of
the block-comment branch could also span several comments (`/**/ /**/` as one comment), so when
the match failed at the end (`use a /**/ /**/ ... /**/ x`) the engine tried every grouping of the
comments: 2^n steps. 28 comments took 3.3 to 6.1 s (split.spec.ts tests "28 block comments then
code" and "28 glued block comments then code" failed their 1 s bound).

While checking the rest of the regex as asked, a second, quadratic ambiguity was found in the same
part: the line-comment branch `\/\/.*` could stop early and leave its trailing spaces to the
following `[^\S\n]*` (and a later `//` inside it could start a new loop iteration). With
`use a //` + 20000 spaces + a U+2028 + `x`, the match took about 730 ms.

Fix:
- Block comment: `\/\*(?:[^*\n]|\*(?!\/))*\*\/`. The body cannot contain `*/` (nor a line break,
  as before, since `.` excluded `\n`), so a block comment ends at its first `*/`. This matches how
  `skipBlockComment` in the same file and JavaScript itself end a block comment.
- Line comment: `\/\/.*(?!.)`. The comment must run as far as `.` matches (to the end of the line
  or a `\r`/U+2028/U+2029), so it has a single possible extent. Accepted inputs are the same as
  before (e.g. the CRLF case `use test // first\r\ndb.c.find()` still splits).
- The argument part (`(?:[^\S\n]+(?:(?!\/[/*])[^\s;])+)*` followed by `[^\S\n]*`) was checked:
  an argument cannot contain whitespace and arguments need a separator, so it has one way to
  match; only the trailing whitespace overlaps with the separator, which is linear per position
  and was measured (below).

Only behavior change: a block comment can no longer extend past its first `*/`
(`use a /* x */ b */` was a command `use a` before; now it is not a command and goes to mongosh
whole, as JavaScript would read it). No test depended on the old behavior.

The failing tests were kept unchanged; no test was weakened or removed.

Validation (round 4):
- `npx vitest run packages/backend/src/shell` — Pass (4 files, 190 tests, including both TW-2
  timing tests)
- Ad-hoc timing check, not committed (`npx tsx -e` importing `split.ts`): 5000 spaced or glued
  `/**/` then code 0.5 to 1.0 ms; 3000 `/***/ /* * */` 1.1 ms; 5000 ` //` 0.1 ms; `//` + 20000
  spaces + U+2028 + `x` 0.1 ms (was about 730 ms); 30000 trailing spaces then `(` 0.8 ms; 10000
  `a/ /` arguments 3.6 ms; 10000 unterminated `/* /*` 0.6 ms. Semantics spot checks:
  `use a /* x */ /** y **/ // z\r\nq` -> `['use a', '\nq']`, `use a // c\r// d\nq` ->
  `['use a', '\nq']`, `use a // c\rx` -> not a command, `show dbs /***/;x` -> `['show dbs', 'x']`.
- `npx vitest run --config test/integration/vitest.config.ts shell` (Podman, MongoDB 8 container
  fixture) — Pass (1 file, 17 tests)
- `npm run check` — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `npx vitest run packages/backend/src/shell` — Pass, 4 files, 190 tests

Full test suite:
- `npm run check` unit suites — Pass (backend/root 59 files / 3463 tests; renderer 72 files /
  2154 tests)
- `npx vitest run --config test/integration/vitest.config.ts shell` (Podman) — Pass, 17 tests

Lint/type-check/build:
- `npm run check` (eslint, prettier --check, type checks, unit tests) — Pass

`.taskcheck`:
- Not run separately; it runs `npm run check`, which passed.

Remaining unresolved findings:
0

No coverage was run in these rounds.

## Final status

All validated findings fixed and validation passed.
