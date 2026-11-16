# Code Review

Date: 2026-11-16

Task: shell-syntax - Core: shell syntax ⇄ EJSON (safe parser and printer)

Scope: second review after fixes, final revision `c2317675cedd6e3ee39cdf138d2748967cf9f02b`. Diff `git diff fdbae87..c231767 -- packages docs` (base = `origin/main` = merge-base; committed changes only, working tree clean per the session's git status).

Requirements:
- `tasks/shell-syntax.md` acceptance criteria and the three recorded assumptions
- `SPEC.md` raw editor / security requirements (parser, never `eval`)
- `docs/ARCHITECTURE.md` (tech table, "Shell syntax" section, Conventions)
- `AGENTS.md`
- Earlier reports: `reviews/shell-syntax/review.md` (first revision, CR-1, CR-2), `reviews/shell-syntax/tests.md` (TW-1, TW-2), `reviews/shell-syntax/fixes.md`

Git range:
- Branch: main
- HEAD: c2317675cedd6e3ee39cdf138d2748967cf9f02b
- Base/start: fdbae874c0f21a3fc38222b69419db3d440b1004 (`origin/main`)
- Commits reviewed: 3 (`458eacc` "Add safe shell-syntax parser and printer for the BSON model", `289b214` "Add shell-syntax edge-case tests and review reports", `c231767` "Fix shell-syntax review findings: JS-compilable regex literals, document error position, Infinity/NaN args")

Files reviewed in full at the final revision: `packages/core/src/shellsyntax/{index,print,syntax,value}.ts`, `packages/core/src/shellsyntax/shellsyntax.edge.spec.ts`, the value/round-trip tables of `packages/core/src/shellsyntax/shellsyntax.spec.ts`, and `docs/ARCHITECTURE.md` (the "Shell syntax" section does not describe the regex print rule, so the CR-1 fix leaves it accurate).

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Commands and results

- Shell access (Bash) was denied to this reviewer in this session, so no command could be run. The git range was resolved from `.git/HEAD`, `.git/refs/heads/main` and `.git/packed-refs` (`refs/remotes/origin/main` = `fdbae87`, the parent commit of `458eacc` in the session's git log). Every statement below comes from reading the final code.
- Test results are taken from `reviews/shell-syntax/fixes.md` and were not re-run by this reviewer: `cd packages/core && npx vitest run src/shellsyntax` -> 2 files, 356 tests passed; `npm run check` -> passed (workspaces 26 files / 1725 tests, renderer 5 files / 181 tests). The parent worker must re-run `.taskcheck` before `done`. The earlier review also showed with `node -e` that `new RegExp` throws for `(?i)a`, `a++`, `(?>a)` and `\-` with `u`. That is the behavior the CR-1 fix relies on.

## Status of earlier findings

- **CR-1 (P3, regex literals mongosh cannot parse): resolved.** `print.ts:140-162` now also requires `compilesInJs(pattern, options)` (`new RegExp` inside `try`/`catch`; compiling never runs the pattern on input, and there is no `eval`) before it chooses `/…/flags`. Otherwise it prints `BSONRegExp("…", "…")`. I checked for regressions. The existing conditions are unchanged: flags within `imsu`, a non-empty pattern, no leading `*`, and the scanner must end at the closing `/`, which also rejects line terminators. A literal and `new RegExp` share JS's pattern grammar (Annex B without `u`, strict with `u`), so the compile check matches what mongosh accepts for a literal. Patterns that already printed as literals still do when they are valid JS (`/[\]/]/`, `/\//`, `/x/imsu`, `/a*/`, `/a\-/`). The corpus entries `/^ab+c$/mi` and `/a\/b[/]/` are valid JS, so they are unaffected. The new edge rows (`(?i)a`, `a++`, `(?>a)` with `i`, `a\-` with `u` -> `BSONRegExp`; `a\-` without `u` -> literal) each go through `expectRoundTrip`. The parser accepts `BSONRegExp` with the same options, so the round trip still holds.
- **CR-2 / TW-2 (P3, document error at a leading comment): resolved.** `index.ts:20-27` now throws "Expected a document ({ … })" at `root.pos`, the start of the parsed root node after trivia (comments included), instead of using `trimStart()`. For signed numbers `pos` is the sign, which is correct. The test `parseShellSyntaxDocument points at the value after a leading comment (TW-2)` expects line 2, column 2 for `// filter\n [1]`. The BOM/blank-CRLF test (line 3, column 3) also still applies: `SPACE` includes `﻿`.
- **TW-1 (Double/NumberDecimal with bare Infinity/NaN): resolved.** `value.ts:213-218` `nonFiniteWord` accepts only `word` nodes named `Infinity`/`NaN`. `doubleCtor` maps them with `Number(word)`, and `decimal` passes the word to `Decimal128.fromString`, which accepts `Infinity`/`NaN`. Integer constructors (`NumberLong`, `NumberInt`, `Date`, `Timestamp`, binary subtype) still go through `integerArg`, which refuses `word` nodes at the argument's position. The tests check this (`NumberLong(Infinity)` -> column 12, `NumberInt(NaN)` -> column 11). Other words (`true`, `null`, `MinKey`) are still refused by `Double(…)`/`NumberDecimal(…)` as before.

## Acceptance criteria re-check (final revision)

1. **Parser rejects code (`function`, calls other than the known constructors, `this`) with a position (tests): met.** Unchanged by the fixes. `CODE_WORDS` are refused in `parseCallee` (`syntax.ts:302`). Unknown calls are refused through the `CONSTRUCTORS` `Map` (`value.ts:63-69`), with no prototype lookup. Bare names, operators, property access, spread, template literals, parentheses and methods are refused in the parser. Tests with line and column: "refuses code with a position" in `shellsyntax.spec.ts` and the 32-case "refusal of code constructs" table plus the side-effect test in `shellsyntax.edge.spec.ts`.
2. **print(parse(x)) round-trips for a corpus of 30+ queries/documents (test): met.** The 34-entry canonical corpus in `shellsyntax.spec.ts` is unchanged. The printer change only moves JS-invalid patterns to `BSONRegExp`, which round-trips, and the new edge rows check that through `expectRoundTrip`.
3. **Errors carry line/column for the raw editor and query bar: met.** All errors are `ShellSyntaxError` with `offset`, `line`, `column` and `reason`. The one known wrong position (CR-2/TW-2) is fixed and tested.

## Safety review

- The only new dynamic construct is `new RegExp(pattern, options)` in the printer. It compiles a stored pattern and never runs it against input, so it cannot cause ReDoS, and it is not `eval`/`new Function` (ARCHITECTURE Conventions). `packages/core` still uses no Node or Electron API: `RegExp` is a language built-in.
- Nothing else in the fixes widens what the parser accepts: `nonFiniteWord` matches exactly two names and only for two constructors.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None. CR-1 and CR-2 from the first review are resolved (see "Status of earlier findings").

## Review conclusion

No material issues found. The fixes for CR-1, CR-2/TW-2 and TW-1 are correct and small, and I found no regressions from reading the code. All three acceptance criteria are met at revision `c2317675cedd6e3ee39cdf138d2748967cf9f02b`. This reviewer could not run commands in this session. The parent worker must confirm the focused tests and `.taskcheck` on this revision, and record per-criterion evidence with `tasks.py verify` before `done`.
