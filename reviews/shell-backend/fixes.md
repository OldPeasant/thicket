# Fix Report

Date: 2026-11-17

Task: shell-backend — mongosh host in worker threads (shell.open/eval/complete/close)

Scope: current task, round 3; exactly one approved finding: CR-5 from `reviews/shell-backend/review.md`.

## Fixed findings

### CR-5 — A comment glued to a command argument still swallows the following lines

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

Validation:
- `npx vitest run packages/backend/src/shell` — Pass (4 files, 165 tests)
- `npx vitest run --config test/integration/vitest.config.ts shell` (Podman) — Pass (1 file, 16 tests)

## Not fixed

None.

## Validation summary

Focused tests:
- `npx vitest run packages/backend/src/shell` — Pass, 165 tests

Full test suite:
- `npm run check` unit suites — Pass (59 files / 3438 tests; renderer 72 files / 2154 tests)
- `npx vitest run --config test/integration/vitest.config.ts shell` — Pass, 16 tests

Lint/type-check/build:
- `npm run check` (lint, type check, unit tests) — Pass

`.taskcheck`:
- Not run separately; it runs `npm run check`, which passed.

Remaining unresolved findings:
0

No coverage was run in this round; no new coverage folders were created (the existing git-ignored
ones predate this round).

## Final status

All validated findings fixed and validation passed.
