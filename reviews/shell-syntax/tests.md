# Test Report

Date: 2026-11-16

Task: shell-syntax - Core: shell syntax ⇄ EJSON (safe parser and printer)

Scope: second pass after fixes. `git diff fdbae874c0f21a3fc38222b69419db3d440b1004..HEAD -- packages docs` on branch `main`. The base `fdbae87` is `git merge-base HEAD origin/main`, after the rebase (the first pass used base `7f8c117` and HEAD `b748d7a`). Final revision HEAD is `c2317675cedd6e3ee39cdf138d2748967cf9f02b`. Task-owned commits (`git log fdbae87..HEAD`): `458eacc` (parser and printer), `289b214` (edge tests and reports), `c231767` (fixes for CR-1, CR-2/TW-2 and TW-1). Production files in scope: `packages/core/src/shellsyntax/{errors,index,print,syntax,value}.ts` (all new in this task) and `packages/core/src/index.ts` (one added line, `export * from './shellsyntax'`). Not production code: `shellsyntax.spec.ts` and `shellsyntax.edge.spec.ts` (tests), `docs/ARCHITECTURE.md` (docs), `reviews/shell-syntax/*` (reports). Uncommitted inputs: only this pass's additions to `packages/core/src/shellsyntax/shellsyntax.edge.spec.ts`. The production files are unchanged from HEAD (the working tree was clean before this pass).

Requirements:
- `tasks/shell-syntax.md`: goal, the three acceptance criteria and the three recorded assumptions
- `docs/ARCHITECTURE.md` "Shell syntax" and "Coverage"
- `AGENTS.md`
- `reviews/shell-syntax/fixes.md` (the fixes to verify), `reviews/shell-syntax/review.md` (CR-1, CR-2)

## Test files changed

- `packages/core/src/shellsyntax/shellsyntax.edge.spec.ts` (new in commit `289b214`, extended by the fixer in `c231767`, extended again in this pass and not committed)

`shellsyntax.spec.ts` is unchanged (sha256 `faf8a5606265f10f3595cd65e5747ff9ea9520705ea29fc08ac12cf174924c49`).

## Tests added or updated

Count: 34 test cases were added in this pass (Vitest count, `it.each` rows included). The shellsyntax suite went from 356 to 390 tests. The first pass added 214 cases. Its description of the edge cases (comments, unicode, escapes, numbers, regex literals, printer, line/column, nesting limit, refusal of code) still applies.

This pass checks that each fix is covered and adds tests where coverage was thin:

- CR-1 (the printer prints a regex literal only when the pattern compiles as a JS RegExp). The fixer added 5 table rows. This pass adds 11 rows to a new "JS compile check" table, and each row is round-tripped. These stay literals because they are valid JS: `\p{L}+` with `u`, named groups with a `\k<…>` backreference, lookbehind and negative lookahead with `i`, `.` with `s`, `(a+)+$`. These print as `BSONRegExp` because JS cannot compile them: `\p{NotAProperty}` with `u`, `a{2,1}`, `[z-a]`, the PCRE comment `(?#note)a`, `(`, and `\Aa\z` with `u`. One more test parses the literals `/a++/` and `{ name: /(?i)ann/, ok: /ann/i }` and prints them. The PCRE-only literal becomes `BSONRegExp` and the valid one inside the same document stays a literal. The parser does not validate patterns (as the assumption says), so the printer must handle this.
- CR-2/TW-2 (`parseShellSyntaxDocument` reports the error at the root node's position). There were already the TW-2 test and the BOM/CRLF test. This pass adds 7 rows: a block comment, several line comments on CRLF lines, a BOM followed by a block comment, a signed number (`-5`), `new Date(0)` (the position of `new`), a regex literal, and a comment that contains `{ a: 1 }`. It also adds three tests. A document surrounded by comments is accepted. A value error such as `NumberLong("x")` after a comment is reported at its argument, not as "Expected a document". Code after a leading comment is refused at the right line and column.
- TW-1 (bare `Infinity`/`NaN` as arguments to `Double` and `NumberDecimal`/`Decimal128`). The fixer extended the TW-1 test and added `NumberLong`/`NumberInt` refusals. This pass adds:
  - `new Double(NaN)` and `new NumberDecimal(Infinity)`;
  - an argument with comments around it;
  - both constructors nested in a document;
  - round trips: `Double(Infinity)` prints `Infinity`, `Double(NaN)` prints `NaN`, `NumberDecimal(NaN)` prints `NumberDecimal("NaN")`;
  - refusal of the other words (`true`, `undefined`, `MinKey`, `null`, `false`) with the exact reason and column, so `nonFiniteWord` does not let other words through;
  - refusal of `Infinity`/`NaN` where an integer is needed, with positions: `new Date(Infinity)`, `new Date(NaN)`, `Timestamp(Infinity, 1)`, `Timestamp(1, NaN)`, `BinData(NaN, "")`.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Parser rejects code (`function`, calls other than the known constructors, `this`) with a position | `shellsyntax.spec.ts` "refuses code with a position"; `shellsyntax.edge.spec.ts` "refusal of code constructs", "parseShellSyntaxDocument still refuses code after a leading comment with its position" | `npx --prefix packages/core vitest run --root packages/core src/shellsyntax` (same as `cd packages/core && npx vitest run src/shellsyntax`) | Pass |
| AC2 print(parse(x)) round-trips a corpus of 30+ queries/documents | `shellsyntax.spec.ts` "printShellSyntax" (34-entry corpus, 9 variants); edge spec "printShellSyntax: regex literal or BSONRegExp" (both tables, CR-1 rows included), scalars, "round-trips the values read from Double(Infinity) and NumberDecimal(NaN)" | same | Pass |
| AC3 Errors carry line/column for the raw editor and query bar | `shellsyntax.spec.ts` position tables; edge spec "line and column" (TW-2 and the 7 new leading-comment rows, value error before the not-a-document error), position assertions throughout | same | Pass at the API level. The editor and query bar are not in this task. |
| Goal: parse mongosh literals (`NumberDecimal`, `Double`, …) | edge spec "number literals" (TW-1 and the new Infinity/NaN tests) | same | Pass |
| CR-1 printed regex literals must be valid in mongosh | edge spec "pattern … (JS compile check)" (11), the fixer's 5 rows, "prints a parsed PCRE-only regex literal as BSONRegExp, also inside a document" | same | Pass |
| Assumption: g/y/d/v flags refused, patterns not validated | edge spec "regex literals" | same | Pass |
| Nesting limit (`MAX_DEPTH` 500) | edge spec "nesting limit" | same | Pass |

## Focused test execution

Command:

`npx --prefix packages/core vitest run --root packages/core src/shellsyntax` (run from the repo root, with absolute paths; same as `cd packages/core && npx vitest run src/shellsyntax`)

Result:

Pass: 2 test files, 390 tests passed, 0 failed.

## Full test execution

Command:

`npm run check` at the repo root (`npm run lint && npm run typecheck && npm run test`). The typecheck step failed, so I also ran `npm run test` and `npm run typecheck -w packages/core` on their own.

Result:

Fail, for an environment reason that is not part of this task:
- `npm run lint` (`eslint . --max-warnings 0 && prettier --check .`): Pass, including the edited spec file.
- `npm run typecheck`: the root, desktop, contract, core and backend workspaces pass. `@thicket/renderer` fails with `TS2307: Cannot find module '@angular/router'` and `Cannot find module 'ajv/dist/2020'`, plus follow-on type errors in `schema-validator.ts`. `packages/renderer/package.json` declares `@angular/router ~22.2.6` and `ajv ^8.20.0`, which were added by the already-merged `explorer-copy` commits (`e77e1cd`, `a459cb1`), but neither package is in `node_modules` in this clone. The dependencies were never installed, and this agent may not install them.
- `npm run typecheck -w packages/core`: Pass.
- `npm run test`: the root Vitest run passes (30 files, 1920 tests, including both shellsyntax specs). Then `ng test` in `packages/renderer` fails to build for the same missing modules.

The task diff (`git diff fdbae87..HEAD`) does not touch `packages/renderer`, `package.json` or `package-lock.json`. Running `npm install` (or `npm ci`) in this clone should clear these errors. The parent must do that and run `npm run check` again before `done`. The fixer's report says `npm run check` passed earlier, so the dependencies most likely came in with the rebase onto `fdbae87`.

## .taskcheck

Result:

Fail in this clone. `.taskcheck` runs `npm run check`, and I ran that command directly (see above). The failure comes only from the renderer's uninstalled `@angular/router` and `ajv` dependencies, not from shell-syntax code. Run it again after `npm install`.

## Bugs found

No new production defects were found in this pass. The earlier findings now stand as follows:

### Double(Infinity), Double(NaN) and NumberDecimal(Infinity) are refused

Finding ID:

`TW-1`

Test:

`shellsyntax.edge.spec.ts` > number literals > "accepts Infinity and NaN as constructor arguments like mongosh (TW-1)", plus this pass's tests "accepts bare Infinity and NaN with new, inside documents and around comments", "round-trips the values read from Double(Infinity) and NumberDecimal(NaN)", "refuses the other word … as a Double or Decimal argument", "still refuses … which needs an integer"

Production source:

`packages/core/src/shellsyntax/value.ts:213-244` (`nonFiniteWord`, `decimal`, `doubleCtor`)

Requirement:

Task goal: parse mongosh-style literals such as `NumberDecimal` and `Double`.

Expected behavior:

`Double(Infinity)`, `Double(NaN)`, `NumberDecimal(Infinity)`, `NumberDecimal(NaN)` and `Decimal128(Infinity)` give the non-finite values. Other words, and integer-only arguments, are still refused.

Actual behavior:

Fixed in `c231767`. All of the tests above pass.

Severity:

Low

Fix required:

`No — fixed in c231767 and verified by the tests above.`

### parseShellSyntaxDocument reports the wrong position when the text starts with a comment

Finding ID:

`TW-2` (same defect as the code-reviewer's CR-2)

Test:

`shellsyntax.edge.spec.ts` > line and column > "parseShellSyntaxDocument points at the value after a leading comment (TW-2)", plus the 7 rows of "parseShellSyntaxDocument points at the value after %s" and the three tests that follow them

Production source:

`packages/core/src/shellsyntax/index.ts:20-27`

Requirement:

AC3 "Errors carry line/column for the raw editor and query bar".

Expected behavior:

The "Expected a document" error points at the first character of the value, after any comments or white space.

Actual behavior:

Fixed in `c231767` (the error is thrown at the root syntax node's `pos`). All of the tests above pass.

Severity:

Low

Fix required:

`No — fixed in c231767 and verified by the tests above.`

### Observations (no failing test; the requirement does not define the behavior)

These are unchanged from the first pass. The parent decides on them.
- OBS-1: An error message for an unexpected astral character contains a lone surrogate. For example `{ a: 😀 }` gives `Unexpected "\ud83d"`. The position is correct.
- OBS-2: `Date("…")` without `new` is read as a Date. In JavaScript and mongosh it returns a string. This is not recorded as an assumption.
- OBS-3: `+5n` is accepted as NumberLong 5. JavaScript throws a TypeError for it.
- OBS-4: `\u{…}` accepts at most 8 hex digits.
- OBS-5: `positionAt` counts only `\n`, `\r\n` and `\r` as line breaks. The parser also treats U+2028/U+2029 as line terminators. Whether this matches the editor's line model depends on the editor component.
- OBS-6 (new, CR-1): The printer decides between the literal and `BSONRegExp` by asking whether the JS engine running the printer (Node or Electron) can compile the pattern. That engine's RegExp syntax can differ from mongosh's engine (for example the `v` flag or duplicate named groups). This is harmless because `BSONRegExp` is always a valid fallback.

## Coverage

Status: verified. The run used the full shellsyntax test selection on the final revision plus this pass's test additions. All 390 tests passed and the run exited 0.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured as a separate metric. Every `shellsyntax/*.ts` file is new in this task, so whole-file coverage equals changed-line coverage for them. The only changed line in `src/index.ts` is `export * from './shellsyntax'`, which v8 does not count as a statement.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `shell-syntax`. Base `fdbae874c0f21a3fc38222b69419db3d440b1004` (`git merge-base HEAD origin/main`, as the parent specified). HEAD `c2317675cedd6e3ee39cdf138d2748967cf9f02b`. Task-owned commits `458eacc`, `289b214`, `c231767` (`git log fdbae87..HEAD`). File scope from `git diff --stat fdbae87..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD `c231767` plus the uncommitted edits to `shellsyntax.edge.spec.ts`. sha256 values, identical before and after the run:
  - errors.ts `9caf5050532b1a9a5436ae416a9649be22b033eefbeff13fad5e5d6cae400657`
  - index.ts `8f277f0c58146c4c092aa42ad012d76aedf953f81dede243c1c16c25e2a3a10c`
  - print.ts `e695232383c8c6af95ab6be01287805a3d970817834784f25b1fb9e42673021c`
  - syntax.ts `e570c6f3bba9ecee8fa7254a459cdf39339fe28f02583442d63aae6dd53e377c`
  - value.ts `f6ff4ba45a9d6f180c0f833a2f5e274695f841bc4943aabbf338890109d4e6d8`
  - src/index.ts `b17d6851b66eb5b8ea90a401e5477a9e213711a4c5cc671ffdc63d2885fedc11`
  - shellsyntax.spec.ts `faf8a5606265f10f3595cd65e5747ff9ea9520705ea29fc08ac12cf174924c49`
  - shellsyntax.edge.spec.ts `b104e549317f8fc6ebf87bc84f4c83b96334d1468b676655237206f9bdf6f9e9`
- Exact included files; renamed/deleted/excluded files and reasons: included `src/shellsyntax/{errors,index,print,syntax,value}.ts` and `src/index.ts`. Excluded: `*.spec.ts` (tests), `docs/ARCHITECTURE.md` (docs), `reviews/**` (reports). No files were renamed or deleted.
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with `@vitest/coverage-v8`, root `packages/core`. Command: `npx --prefix packages/core vitest run --root packages/core src/shellsyntax --coverage --coverage.include=src/shellsyntax/*.ts --coverage.include=src/index.ts --coverage.exclude=**/*.spec.ts --coverage.reportsDirectory=coverage/tw-shellsyntax-pass2 --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text`. This is the parent's command plus `src/index.ts`, a fresh report directory and machine-readable reporters. Test selection: both shellsyntax spec files, all 390 tests, with no name filter.
- Run start/completion time and exit status: started 20:09:20 local time on 2026-11-16, ran 401 ms, 390 passed, exit 0.
- Generated report paths and report hashes/run identifier (both git-ignored):
  - `packages/core/coverage/tw-shellsyntax-pass2/coverage-summary.json` sha256 `85b6c9f8d8dc603fbd93bbd662e7885b64b0f25b138e7f29c56cb1a92840b10a`
  - `packages/core/coverage/tw-shellsyntax-pass2/coverage-final.json` sha256 `b4079ac249bfede19d30a08cf55a0accce2db0893b92c659833687cca1d85ff7`
- Evidence outputs are fresh and inputs stayed unchanged: `coverage/tw-shellsyntax-pass2` is a new directory that this run created. The source and test hashes were taken before and after the run, and they match.
- Final run after latest test additions and production fixes: yes. The run measured the final production revision `c231767` with all of this pass's test additions.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/core/src/shellsyntax/errors.ts` | 16/16 (100%) | 5/5 (100%) | 2/2 (100%) | 15/15 (100%) |
| `packages/core/src/shellsyntax/index.ts` | 6/6 (100%) | 2/2 (100%) | 2/2 (100%) | 6/6 (100%) |
| `packages/core/src/shellsyntax/print.ts` | 58/58 (100%) | 53/53 (100%) | 13/13 (100%) | 54/54 (100%) |
| `packages/core/src/shellsyntax/syntax.ts` | 307/307 (100%) | 212/212 (100%) | 17/17 (100%) | 271/271 (100%) |
| `packages/core/src/shellsyntax/value.ts` | 210/210 (100%) | 133/142 (93.66%) | 42/42 (100%) | 180/180 (100%) |
| `packages/core/src/index.ts` | 0/1 (0%) | N/A (0/0) | N/A (0/0) | 0/1 (0%) |
| Aggregate (summed counters; all 6 files measured, none missing or excluded) | 597/598 (99.83%) | 405/414 (97.82%) | 76/76 (100%) | 526/527 (99.81%) |

All of the code added by the fixes is fully covered:
- `compilesInJs` in `print.ts`: both the success and the `catch` paths.
- `nonFiniteWord` in `value.ts`: both words, other words and non-word nodes.
- The `word !== null` branches in `decimal` and `doubleCtor`.
- The root-position throw in `index.ts`.

The 9 uncovered branches are the same unreachable defensive fallbacks as in the first pass.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `value.ts:54` (two `node.exact ?? 0n` arms) and `value.ts:80` (`node.exact ?? 0n`) | None. A BigInt number node always has `exact` set. | Justified gap: unreachable defensive fallback |
| `value.ts:126` (`call.kind === 'call' ? … : 'value'`, else arm) | None. `args()` is only called with call nodes. | Justified gap: unreachable defensive fallback |
| `value.ts:137, 149, 161, 167, 173` (`node ?? call` arms in `stringArg`, `integerArg`-related, `objectIdHex`, `base64Binary`, `hexBinary`) | None. The argument count is checked before each call, so the node is never undefined. | Justified gap: unreachable defensive fallback |
| `src/index.ts:2` (`export const WORKSPACE = …`) | Not task code. It is a pre-existing line that no shellsyntax test loads. The task's added re-export has no v8 statement, and `npm run typecheck -w packages/core` passes. | Justified gap: outside the task's executable changes |
| Fix code in `print.ts:151-162`, `value.ts:213-244`, `index.ts:20-27` | CR-1, TW-1, CR-2/TW-2 | Covered. Tests are listed under "Tests added or updated". |

## Unable to test

- The raw editor and query bar that display these positions are not part of this task. I verified AC3 at the API level only (`line`, `column`, `offset`, the message suffix). Follow-up belongs in the editor/query-bar tasks, including the U+2028 line model (OBS-5).
- Whether mongosh itself accepts each printed regex literal. Only the JS RegExp compiler of the Node version running the tests was used. mongosh is not available here (OBS-6).
- A passing `npm run check`/`.taskcheck` in this clone. The renderer's `@angular/router` and `ajv` dependencies are not installed. Follow-up for the parent: run `npm install`, then run `npm run check` again.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The fixes for CR-1, CR-2/TW-2 and TW-1 are verified. I added 34 tests, and all 390 shellsyntax tests pass on final revision `c231767`. Statements, lines and functions are 100% covered in every `shellsyntax` file, and branches are 405/414. The only uncovered branches are unreachable defensive fallbacks. `npm run check` (and therefore `.taskcheck`) currently fails in this clone, only because the renderer's dependencies are not installed. That is not part of this task: the parent must run `npm install` and run `npm run check` again before `done`.
