# Code Review

Date: 2026-11-17

Task: shell-backend - M4: mongosh host in the backend (round 3, final review for the whole task)

Scope: all task commits `git diff 735b36d..02d12f9` (committed changes only, `package-lock.json` checked for the mongosh packages only), with special attention to the round-3 fix commit 02d12f9 (CR-5, `split.ts` argument pattern). Reviewed revision: 02d12f9070f8e5b061be5f3f32a9a8d794037dc7. The working tree was clean when reviewed.

Requirements:
- tasks/shell-backend.md acceptance criteria and recorded assumptions (including the exit/quit assumption)
- SPEC.md (M4 Shell, IPC section)
- docs/mongosh.md
- docs/ARCHITECTURE.md
- packages/contract (shell.* methods, ShellOutput)
- AGENTS.md
- earlier rounds: reviews/shell-backend/review.md (round 2), tests.md, fixes.md (round 3)

Git range:
- Branch: main
- HEAD: 02d12f9070f8e5b061be5f3f32a9a8d794037dc7
- Base/start: 735b36d36aa2edab5c72fc2c7dda7f749f430509 (`git merge-base HEAD origin/main`)
- Commits reviewed: 5 (2f0b3d7 implementation, 6339ca9 tests + round-1 review, 2708094 round-1 fixes, 92c9fb1 round-2 tests + review, 02d12f9 CR-5 fix)

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Changes since round 2

`git diff --stat 2708094 02d12f9 -- . ':!reviews' ':!tasks'` touches only `host.spec.ts`, `split.spec.ts`, `test/integration/shell.int.spec.ts` (round-2 tests in 92c9fb1, test files only) and `split.ts` (5 lines, 02d12f9). The only production change since the round-2 review is the `COMMAND` regex and its doc comment in `packages/backend/src/shell/split.ts:83-90`. All other production code (`host.ts`, `runtime.ts`, `worker.ts`, `output.ts`, `handlers.ts`, server/connections wiring, `build.mjs`) is unchanged, so the round-2 conclusions for it still hold.

## Round-1 and round-2 findings

- CR-1 (host lifecycle untested): resolved in round 2; further strengthened by the round-2 `host.spec.ts` additions.
- CR-2 (exit/quit close the client): resolved in round 2; unchanged.
- CR-3 (completion after a restart): resolved in round 2; unchanged.
- CR-4 (queued evals of a closed session start workers): resolved in round 2; unchanged.
- CR-5 (comment glued to a command argument swallows the following lines): resolved in 02d12f9. Details below.

## Review of the CR-5 fix (02d12f9)

- The argument pattern changed from `(?!\/[/*])[^\s;]+` to `(?:(?!\/[/*])[^\s;])+`, so no position inside an argument may start `//` or `/*`; the existing trailing-comment branch then takes the comment and group 1 (the command text passed to mongosh) excludes it.
- Traced and probed with the committed regex (node, read-only):
  - `use test// c` -> `use test`; `use test/* a */ /* b */;` -> `use test`; `use test/**/` -> `use test`; `use a/b//c` -> `use a/b`.
  - A single `/` stays in the argument: `use a/b` -> `use a/b`, `show dbs /` -> `show dbs /` (then rejected by the argument check in `commandAt`, as before).
  - Command-word lookahead `(?=$|[\s;]|\/[/*])` is unchanged: `it/x` is still not a command, `it//x` still is.
  - `use a/*b` (an unclosed block comment glued to an argument) no longer matches and goes to mongosh as JavaScript, where `/*` really does open a comment; acceptable and consistent with how an unclosed comment after whitespace was already handled.
  - No backtracking blow-up: arguments are whitespace-free and separated by mandatory whitespace, so the nested quantifier is unambiguous; a 40 000-character `use a a a ...!` line is rejected in under 1 ms. Matching is still limited to the current line (`commandAt` slices to `lineEnd`).
- Statement-start detection, string/template/regex/comment skipping in `splitShellInput` and the argument-count/identifier checks in `commandAt` are untouched.
- The six new `split.spec.ts` cases cover the reported inputs (`use test// c\ndb.c.find()`, `show dbs//x`, `show dbs/* x */`, `use test/* c */\nx`, `show profile 5//last\nx`) and the single-slash regression guard (`use a/b\nx`); all pre-existing split cases are unchanged and pass.

## Verification run by this reviewer

- `npx vitest run packages/backend/src/shell` at 02d12f9 (clean working tree) -> 4 files, 165 tests passed.
- Integration tests (`test/integration/shell.int.spec.ts`, Podman) were not run by this reviewer; fixes.md reports `npx vitest run --config test/integration/vitest.config.ts shell` -> 16 passed. AC1 to AC3 (`use test; db.c.insertOne({a:1}); db.c.find()` as EJSON, `while(true){}` interrupted under 2 s, `complete('db.c.fi')`) remain covered there; the parent worker's `tasks.py verify` evidence must come from its own run.
- No secrets, no new dependencies in the round-3 commit.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None open. CR-5 (P3) from round 2 is resolved in 02d12f9 as described above.

## Review conclusion

No material issues found.

All round-1 findings (CR-1 to CR-4) remain resolved, the round-2 finding CR-5 is fixed correctly without regressions in the splitter, the only production change since round 2 is the `split.ts` regex, and the shell unit suite passes at 02d12f9.
