# Code Review

Date: 2026-11-17

Task: shell-backend - M4: mongosh host in the backend (round 4, final review for the whole task)

Scope: all task commits `git diff 735b36d..8712197` (committed changes only, `package-lock.json` checked for the mongosh packages only), with special attention to the round-4 fix commit 8712197 (TW-2, `COMMAND` regex in `split.ts`). Reviewed revision: 871219790eb459a5a9ea6fcb7212cb6df3fbc3bb. At review time the working tree held uncommitted test-writer edits (`split.spec.ts`, untracked `zz-probe-tmp.spec.ts`); they were not reviewed as part of the task code.

Requirements:
- tasks/shell-backend.md acceptance criteria and recorded assumptions (including the exit/quit assumption)
- SPEC.md (M4 Shell, IPC section)
- docs/mongosh.md
- docs/ARCHITECTURE.md
- packages/contract (shell.* methods, ShellOutput)
- AGENTS.md
- earlier rounds: reviews/shell-backend/review.md (round 3), tests.md (TW-2), fixes.md (round 4)

Git range:
- Branch: main
- HEAD: 871219790eb459a5a9ea6fcb7212cb6df3fbc3bb
- Base/start: 735b36d36aa2edab5c72fc2c7dda7f749f430509 (`git merge-base HEAD origin/main`)
- Commits reviewed: 7 (2f0b3d7 implementation, 6339ca9 tests + round-1 review, 2708094 round-1 fixes, 92c9fb1 round-2 tests + review, 02d12f9 CR-5 fix, c95f534 round-3 tests + review, 8712197 TW-2 fix)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Changes since round 3

`git diff --stat 02d12f9 8712197 -- . ':!reviews' ':!tasks'` touches only `packages/backend/src/shell/split.spec.ts` (+63, tests), `test/integration/shell.int.spec.ts` (+13, a CR-5 integration test) and `packages/backend/src/shell/split.ts` (5 lines: the `COMMAND` regex and its doc comment). All other production code (`host.ts`, `runtime.ts`, `worker.ts`, `output.ts`, `handlers.ts`, server/connections wiring, `build.mjs`) is unchanged since round 2, so the earlier conclusions for it still hold.

## Earlier findings

- CR-1 (host lifecycle untested): resolved in round 2; unchanged.
- CR-2 (exit/quit close the client): resolved in round 2; unchanged.
- CR-3 (completion after a restart): resolved in round 2; unchanged.
- CR-4 (queued evals of a closed session start workers): resolved in round 2; unchanged.
- CR-5 (comment glued to a command argument): resolved in 02d12f9; the argument part of the regex is unchanged by 8712197, and the CR-5 unit cases plus the new integration case still apply.
- TW-2 (exponential backtracking in the trailing-comment part): resolved in 8712197, see below.

## Review of the TW-2 fix (8712197)

Old trailing part: `(?:(?:\/\*.*?\*\/|\/\/.*)[^\S\n]*)*`. New: `(?:(?:\/\*(?:[^*\n]|\*(?!\/))*\*\/|\/\/.*(?!.))[^\S\n]*)*`.

- Block comment: the body alternatives `[^*\n]` and `\*(?!\/)` are disjoint, and the body cannot contain `*/`, so a block comment ends exactly at its first `*/` (as JavaScript and `skipBlockComment` do). `/* **/`, `/***/`, `/* * / */` still match as one comment. A given text has a single way to be split into comments, so the outer `*` no longer explores 2^n groupings.
- Line comment: `.*(?!.)` forces the comment to run to the end of the `.` run (end of input, or a `\r`/U+2028/U+2029). A failing attempt costs O(L) cheap lookahead checks per `//` start, no regrouping. After it, `[^\S\n]*` can take the terminator character, and a further `//` or `/*` can begin only after it, so the iteration is still unambiguous; the CRLF case (`use test // first\r\ndb.c.find()`) behaves as before.
- Every loop iteration consumes at least two characters, so there is no empty-iteration ambiguity.
- Remaining parts checked for super-linear backtracking: the command word and its lookahead are fixed; arguments are whitespace-free runs separated by mandatory whitespace (`[^\S\n]+`) and cannot start a comment at any position, so the argument loop has a single parse, and its overlap with the following `[^\S\n]*` is linear (a whitespace run can only be given back character by character, each failing immediately). `commandAt` still slices the input at the next `\n`, so the `(?=\n)` alternative and every quantifier work within one line. No remaining nested ambiguous quantifier was found.
- Accepted inputs: the documented change (`use a /* x */ b */` is no longer a command and goes to mongosh whole) is correct JavaScript semantics. One further, undocumented difference exists, see CR-1 below; it is an improvement, not a regression.
- `commandAt`'s argument-count and identifier checks, statement-start detection and the string/template/regex/comment skipping in `splitShellInput` are untouched.
- The committed TW-2 timing tests (`28 block comments then code`, `28 glued block comments then code`, 1 s bound) pass, and so do all pre-existing split cases.

## Verification run by this reviewer

- `npx vitest run packages/backend/src/shell/split.spec.ts packages/backend/src/shell/handlers.spec.ts packages/backend/src/shell/output.spec.ts packages/backend/src/shell/host.spec.ts` at 8712197 production code -> 4 files, 215 tests passed in 2.7 s. `split.spec.ts` in the working tree is the committed file plus the test-writer's uncommitted, bounded additions (more TW-2 timing and semantics cases, all passing); `handlers`, `output` and `host` specs are the committed versions.
- `npx vitest run packages/backend/src/shell` (whole directory) was stopped by a 300 s timeout: it also picks up the untracked `packages/backend/src/shell/zz-probe-tmp.spec.ts`, which is not part of the committed code. The parent worker must make sure that file is removed and never committed.
- Ad-hoc regex probing outside the test runner was not available in this session; the old/new comparison above is by reading the patterns.
- Integration tests (`test/integration/shell.int.spec.ts`, Podman) were not run by this reviewer; fixes.md reports `npx vitest run --config test/integration/vitest.config.ts shell` -> 17 passed. AC1 to AC3 remain covered there; the parent worker's `tasks.py verify` evidence must come from its own run.
- No secrets, no dependency changes in the round-4 commit.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | A CR or U+2028/U+2029 inside a trailing block comment is now accepted; the fix notes say otherwise**
    - File: `packages/backend/src/shell/split.ts:93`
    - Category: Quality
    - Problem: the old block-comment body `.*?` could not match `\r`, U+2028 or U+2029; the new body `[^*\n]` matches them. So `use a /* x\ry */\nq` was not a command before (sent to mongosh whole) and now splits into `use a` and `\nq`. fixes.md states the only behavior change is the `*/` one and that the body excludes a line break "as before, since `.` excluded `\n`", and no test pins the new behavior.
    - Why it matters: the new behavior is the more correct one (JavaScript allows these characters in a block comment, and `splitShellInput` treats `\r` as whitespace), so this is not a functional regression, but the recorded scope of the change is inaccurate and an unintended future revert would go unnoticed.
    - Suggested fix: mention the difference in the fix notes or the regex doc comment and add one `split.spec.ts` case such as `'use a /* x\ry */\nq' -> ['use a', '\nq']`. Optional; does not block the task.

## Review conclusion

No material issues found.

The TW-2 fix removes the exponential (block comments) and quadratic (line comments) backtracking without introducing new ambiguity anywhere in `COMMAND`, the only production change since round 3 is that regex, all earlier findings (CR-1 to CR-5 of earlier rounds, TW-2) remain resolved, and the shell unit specs pass at 8712197. The one P3 note above is documentation/test hygiene only.
