# Code Review

Date: 2026-11-16

Task: shell-syntax - Core: shell syntax ⇄ EJSON (safe parser and printer)

Scope: `git diff 7f8c117..b748d7a` (committed changes only; the working tree was clean at review time)

Requirements:
- `tasks/shell-syntax.md` acceptance criteria and recorded assumptions
- `SPEC.md` raw editor requirement (shell syntax, "parsing never evaluates code") and security section ("Shell-syntax parsing ... uses a parser, never `eval`")
- `docs/ARCHITECTURE.md` (tech table, new "Shell syntax" section, Conventions)
- `AGENTS.md`

Git range:
- Branch: main
- HEAD: b748d7ac9924d7e6d8a6a4fb75ceab94d05e3928
- Base/start: 7f8c1178a032046ea84f563dc1e2487ecd45e5c6
- Commits reviewed: 1 (b748d7a "Add safe shell-syntax parser and printer for the BSON model")

Files reviewed in full: `packages/core/src/shellsyntax/{errors,index,syntax,value,print}.ts`,
`packages/core/src/shellsyntax/shellsyntax.spec.ts`, `packages/core/src/index.ts`, the
`docs/ARCHITECTURE.md` diff, plus the helpers they use (`bson/model.ts`, `bson/iso-date.ts`,
`bson/ejson.ts` base64/hex helpers and regex option set).

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## Commands and results

- `npx vitest run --project core packages/core/src/shellsyntax` -> 1 file, 136 tests passed
- `npm run check` (what `.taskcheck` runs: lint, type check, unit tests) -> passed; 25 files / 1505 tests (workspaces) and 5 files / 181 tests (renderer)
- `node -e` with `new RegExp(p, f)` for `(?i)a`, `a++`, `(?>a)` and `\-` with flag `u` -> all throw `SyntaxError` in JS (evidence for CR-1)
- `node -e` checks of `BigInt("+5")`, `String(1e21)` and `Date#toISOString` for extended years -> as the parser/printer expect (no finding)
- `python tasks.py verify shell-syntax` (read-only listing) -> all 3 criteria still unverified; the parent worker records evidence before `done`
- Ad-hoc probe scripts (bundling a TS script with esbuild and running it) were not permitted in this environment, so the edge cases below were verified by reading the code paths and by the existing spec.

## Acceptance criteria assessment

1. Parser rejects code with a position: met. `function`, `this`, `eval`, `async`, `new`, etc. are refused in `parseCallee` (`syntax.ts:302`); bare names, shorthand properties, methods, computed keys, spread, template literals, parentheses/arrows, operators and property access/calls on values are refused in the parser; unknown calls (`alert`, `process.exit`, `Function`, `ObjectId.prototype.constructor`) are refused in `value.ts:63-69` via a `Map` allow-list (no prototype lookup). Tested with line/column in `shellsyntax.spec.ts` ("refuses code with a position", 25 cases).
2. print(parse(x)) round-trips for 30+ inputs: met. `CANONICAL` has 34 entries asserted to print back exactly and to re-parse equal with `indent: 2`; 9 normalizing variants are checked for a fixpoint; an "every BSON type" EJSON fixture round-trips.
3. Errors carry line/column: met. `ShellSyntaxError` has `offset`, 1-based `line`/`column`, `reason`; message ends with "(line L, column C)"; every error path goes through it (syntax via `fail` in `syntax.ts`, value errors via node `pos` in `value.ts`).

## Safety review

- No `eval`, `Function`, `new RegExp(userInput)` or dynamic property access on user-controlled names anywhere in the scope; constructor lookup is a `Map`.
- User regex patterns are never compiled or executed (only scanned by `scanRegexBody`, linear), so no ReDoS from input.
- The parser's own regexes (`NUMBER`, `IDENT`, `SPACE`) are linear; comments use `indexOf`; nesting is capped at 500 (`MAX_DEPTH`, tested with 600 `[`), and arguments of constructor calls count toward depth.
- Losslessness checked by code reading for each model type: integral doubles in Int32 range print as `Double(n)`, `-0` as `-0`, other doubles via `String(v)` (shortest round-trip, exponent form accepted by `NUMBER`); Int64 outside the safe range is quoted; dates outside the JS range use `new Date(<exact ms>)`; regex falls back to `BSONRegExp` for `l`/`x` options, empty patterns, leading `*`, and patterns the literal scanner would end early; lone surrogates survive via `JSON.stringify`'s `\uXXXX` escapes; 16-byte subtype-4 binary prints as `UUID`; duplicate keys and key order are preserved (array of entries, not a JS object).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Regex literals printed for patterns mongosh cannot parse**
    - File: `packages/core/src/shellsyntax/print.ts:142`
    - Category: Integration
    - Problem: `fitsLiteral` only checks the flag set and that the literal scanner ends at the right `/`. MongoDB patterns are PCRE, so stored patterns such as `(?i)abc` (inline flags), `a++` (possessive), `(?>a)` (atomic), or any pattern with the `u` option that uses an escape JS's unicode mode rejects (`\-`, `\_`) are printed as `/(?i)abc/`, `/a\-/u`, etc. These texts round-trip through our own parser (which does not validate patterns, by the recorded assumption), but they are a `SyntaxError` in mongosh/JS (verified with `new RegExp(...)` in Node). The ARCHITECTURE section and task goal describe the output as mongosh shell syntax, and the product embeds a mongosh console, so copying the raw editor text there fails for these documents.
    - Why it matters: the printed text is not portable to mongosh for common PCRE-only queries; the in-app round trip is unaffected.
    - Suggested fix: additionally require `new RegExp(pattern, options)` to compile (in a `try`; compiling does not run the pattern on input) before choosing the literal form, otherwise print `BSONRegExp("…", "…")`; add a corpus entry such as `BSONRegExp("(?i)a", "")`.
    - Disposition suggestion: fix in this task (small, local) or record as an accepted limitation.

- [ ] **CR-2 | `parseShellSyntaxDocument` error points at a leading comment instead of the value**
    - File: `packages/core/src/shellsyntax/index.ts:23`
    - Category: Correctness
    - Problem: the "Expected a document" position is computed with `text.trimStart()`, which skips whitespace but not comments, while the parser accepts leading comments. For `// filter\n[1]` the error is reported at line 1, column 1 (the comment) instead of line 2, column 1 (the array).
    - Why it matters: the query bar and raw editor mark the wrong place for a slightly malformed input that the rest of the parser handles correctly.
    - Suggested fix: use the root node's `pos` (e.g. have `parseSyntax` return the root node and check `node.kind !== 'object'` before `toBsonValue`, failing at `node.pos`), and add a test with a leading comment.
    - Disposition suggestion: fix in this task or defer; cosmetic.

## Review conclusion

No material issues found. The implementation meets all three acceptance criteria, uses no `eval` or input-driven regex compilation, bounds nesting, and is lossless for every BSON model type under its own parser. The two P3 findings are optional improvements (mongosh portability of printed regexes, error position after a leading comment). Acceptance-criteria evidence still has to be recorded with `tasks.py verify` by the parent worker.
