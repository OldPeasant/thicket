# Test Report

Date: 2026-11-16

Task: shell-syntax - Core: shell syntax ⇄ EJSON (safe parser and printer)

Scope: `git diff 7f8c117..HEAD` on branch `main`. Base `7f8c1178a032046ea84f563dc1e2487ecd45e5c6` (from the parent), HEAD `b748d7ac9924d7e6d8a6a4fb75ceab94d05e3928`, one task-owned commit `b748d7a` ("Add safe shell-syntax parser and printer for the BSON model"). Production files in scope: `packages/core/src/shellsyntax/{errors,index,print,syntax,value}.ts` (all new) and `packages/core/src/index.ts` (one added line, `export * from './shellsyntax'`). Not production code: `shellsyntax.spec.ts` (test) and `docs/ARCHITECTURE.md` (docs). Uncommitted inputs: the new test file `packages/core/src/shellsyntax/shellsyntax.edge.spec.ts`. `reviews/shell-syntax/review.md` is also uncommitted, but it is the code-reviewer's file and is not a test input, so I did not touch it.

Requirements:
- `tasks/shell-syntax.md`: goal, the three acceptance criteria and the three recorded assumptions (own parser; number/printer style; regex flags g/y/d/v refused, patterns not validated)
- `docs/ARCHITECTURE.md` "Shell syntax" and "Coverage"
- `AGENTS.md`, and the parent's list of edge cases to cover

## Test files changed

- `packages/core/src/shellsyntax/shellsyntax.edge.spec.ts` (new)

The existing `shellsyntax.spec.ts` is unchanged (sha256 `faf8a5606265f10f3595cd65e5747ff9ea9520705ea29fc08ac12cf174924c49`).

## Tests added or updated

Count: 214 test cases in the new file (Vitest count, `it.each` rows included). 212 pass. 2 fail because of production defects (TW-1, TW-2).

What the existing spec already covered well: the round-trip corpus (34 canonical texts plus 9 variants, all BSON types from EJSON, indented output), refusal of `function`/`this`/`eval`/unknown calls/operators/property access with line and column, and value errors with positions. The gaps I added tests for:
- Comments: block comments between every token; line comments ended by `\n`, `\r\n`, `\r`, U+2028 and U+2029; comment-only and whitespace-only input; block comments do not nest; `//` and `/*` are never read as a regex; `;;` is refused.
- Unicode: unicode white space (BOM, NBSP, U+3000, U+2028/2029, U+1680, VT/FF); U+0085 is refused (it is not JS white space); unicode identifiers and ZWJ/ZWNJ in keys; the printer quotes non-ASCII keys; `\u` escapes in identifiers are refused; an emoji key is refused.
- String escapes: every single-character escape, identity escapes, `\x`, `\u`, `\u{…}` up to 8 digits and U+10FFFF, `\0`, line continuations (LF, CRLF, CR, U+2028, U+2029), raw U+2028 in strings, and quoted keys with escapes. Invalid escapes are refused with positions (`\08`, `\8`, short `\u`, `\u{}`, unclosed `\u{`, 9 digits, bad `\x`, unterminated strings including `"\0` at the end of input). Control characters and lone surrogates round-trip.
- Numbers: Int32 and Double boundaries (±2^31), hex/octal/binary/`_`, `5.`, `.5`, `1e3`, `+5`, a sign followed by white space or a comment, `-0.0`, `1e400`, BigInt at the Int64 limits, `-NaN`, and integers beyond 2^53. Invalid literals are refused (`00`, `08`, `0x`, `0b2`, `1_`, `1__0`, `0_1`, `1e`, `1n2`, `1.5e3n`, `.`, out-of-range BigInt, `5..toString()`). Number keys follow JS. Constructors given number literals keep exact Int64 values (`NumberLong(9223372036854775807)`, `NumberDecimal(0b11)`, `NumberDecimal(-Infinity)`).
- Regex literals: `/` inside a class, escaped `]` and `/`, unicode in the pattern, patterns are not validated (`/(/`, per the assumption), flags are sorted, every unsupported flag is refused with its position (g, y, d, v, x, l, é, ig), unterminated forms (newline, escaped newline, U+2028, trailing `\`, open class), property access on a regex and text after a regex, a regex used as a key, `RegExp(pattern)` without flags, and a `Timestamp(5)` argument that is not a document.
- Printer regex fallback (13 cases, each round-tripped): trailing backslash, leading `/`, U+2028, CR, `a]/`, open class, BSON-only options `l`/`x`/`imsux`, and the literal form for `[\]/]`, `\/`, `imsu` and `a*`.
- Printer scalars: double edge values (`1e+21`, ±2^31 boundaries, `Double(0)`, `-0`, MAX_VALUE, MIN_VALUE, `2^53+2`), the NumberLong safe/unsafe boundary, dates outside the JS Date range (`new Date(±Int64)`), Decimal128 `Infinity`/`NaN`/`-0` and large exponents, non-16-byte subtype 4 binaries, keys that are code words or `__proto__`/`constructor`, and indent clamping (-3, 2.9, 99).
- Line and column: CRLF, lone CR, mixed breaks, end of input after CRLF, tabs, surrogate pairs (UTF-16 columns), after a multi-line comment, an unterminated string and a value error on CRLF lines; `offset`, `reason` and the message suffix; `instanceof BsonModelError`; `parseShellSyntaxDocument` after a BOM and blank lines, and after a leading comment (TW-2).
- Depth limit: 501 nested empty arrays and 500 nested objects are accepted and print; one level more is refused at the position of the too-deep value; constructor arguments count as a level; a flat array of 20,000 items parses.
- Code refusal (32 cases with positions): `this`, `class`, `void`, `typeof`, `delete`, `yield`, `import()`, `async`, `new new`, `new (X)`, `constructor()`, `toString()`, `hasOwnProperty()`, `ObjectId.constructor()`, `Binary.createFromBase64.call()`, `require()`, `__proto__`, `globalThis.process`, tagged templates, assignment, IIFE, `.constructor`, `.length`, `.source`, `["toString"]()`, member access on an object, `&&`, `?:`, `==`, the comma operator, `!`, and getters. A side-effect test checks that a global function named in the text is never called. Known constructors are still accepted with and without `new` and with arguments split over several lines.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Parser rejects code (`function`, calls other than the known constructors, `this`) with a position | `shellsyntax.spec.ts` "refuses code with a position" (25); `shellsyntax.edge.spec.ts` "refusal of code constructs" (32 + side-effect test + accept-known-constructors test), "unicode identifiers" (escaped keywords) | `cd packages/core && npx vitest run src/shellsyntax` | Pass |
| AC2 print(parse(x)) round-trips a corpus of 30+ queries/documents | `shellsyntax.spec.ts` "printShellSyntax" (34-entry canonical corpus, 9 variants, all BSON types); edge spec printer regex fallback (13), scalars (27), unicode keys, strings | same | Pass |
| AC3 Errors carry line/column for the raw editor and query bar | `shellsyntax.spec.ts` position tables, `positionAt`; edge spec "line and column" (CRLF/CR/mixed/tab/surrogate), position assertions throughout | same | Fail: TW-2 (`parseShellSyntaxDocument` reports line 1, column 1 instead of the value's position when a comment comes first). Every other position test passes. |
| Goal: parse mongosh literals (NumberDecimal, Double, …) | edge spec "number literals" | same | Fail: TW-1 (`Double(Infinity)`, `Double(NaN)`, `NumberDecimal(Infinity)` are refused, while `Double(-Infinity)` is accepted) |
| Assumption: g/y/d/v flags refused, patterns not validated | edge spec "regex literals" | same | Pass |
| Assumption: Int32/Double number rules, printer style | edge spec "number literals", "printShellSyntax: scalars" | same | Pass |
| Nesting limit (parser robustness, `MAX_DEPTH` 500) | edge spec "nesting limit" | same | Pass |

## Focused test execution

Command:

`cd packages/core && npx vitest run src/shellsyntax`

Result:

Fail: 2 test files, 350 tests, 348 passed, 2 failed (TW-1, TW-2; both are production defects, see below). The existing spec's 136 tests all pass.

Also run (repo root):
- `npx eslint packages/core/src/shellsyntax --max-warnings 0` -> Pass
- `npx prettier --check packages/core/src/shellsyntax` -> Pass
- `npm run typecheck -w packages/core` -> Pass

## Full test execution

Command:

`cd packages/core && npx vitest run` (all core specs), then `npm run check` at the repo root (lint, then typecheck, then all tests)

Result:

Fail, only because of TW-1 and TW-2. Core: 15 files, 982 tests, 980 passed, 2 failed. `npm run check`: lint and typecheck passed; tests ran 26 files with 1719 tests, 1717 passed, 2 failed (the same two).

## .taskcheck

Result:

Fail. `.taskcheck` runs `npm run check`, and I ran that command directly (results above). It fails only on TW-1 and TW-2 and will pass once the production code is fixed.

## Bugs found

### Double(Infinity), Double(NaN) and NumberDecimal(Infinity) are refused

Finding ID:

`TW-1`

Test:

`shellsyntax.edge.spec.ts` > number literals > "accepts Infinity and NaN as constructor arguments like mongosh (TW-1)"

Production source:

`packages/core/src/shellsyntax/value.ts:227-232` (`doubleCtor`) and `value.ts:213-217` (`decimal`). The cause: `syntax.ts` parses an unsigned `Infinity`/`NaN` as a `word` node. Only the signed forms (`-Infinity`, `+Infinity`, `-NaN`) become `number` nodes. The constructors check only for `arg.kind === 'number'` and otherwise require a string.

Requirement:

Task goal: parse mongosh-style literals such as `NumberDecimal` into the BSON model. In mongosh, `Double(Infinity)` and `NumberDecimal(Infinity)` are valid. The parser already accepts `Double(-Infinity)` and `NumberDecimal(-Infinity)`, and a bare `Infinity`/`NaN` as a value.

Expected behavior:

`Double(Infinity)` -> Double Infinity, `Double(NaN)` -> Double NaN, `NumberDecimal(Infinity)` -> Decimal128 `Infinity`, the same as the signed forms.

Actual behavior:

`Expected a number as a string (line 1, column 8)` for `Double(Infinity)` and `Double(NaN)`. `Expected a decimal as a string (line 1, column 15)` for `NumberDecimal(Infinity)`.

Severity:

Low. The printer never writes these forms, so the round trip is not affected. But text that users paste from mongosh is refused, and the behavior is inconsistent with the signed forms.

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### parseShellSyntaxDocument reports the wrong position when the text starts with a comment

Finding ID:

`TW-2`

Test:

`shellsyntax.edge.spec.ts` > line and column > "parseShellSyntaxDocument points at the value after a leading comment (TW-2)"

Production source:

`packages/core/src/shellsyntax/index.ts:23-24`. The "Expected a document" position is computed with `text.length - text.trimStart().length`, which skips white space but not comments.

Requirement:

AC3 "Errors carry line/column for the raw editor and query bar". Comments are explicitly allowed in the input (`index.ts` doc comment, ARCHITECTURE "Shell syntax").

Expected behavior:

`parseShellSyntaxDocument('// filter\n [1]')` fails with line 2, column 2 (the `[`).

Actual behavior:

It fails with line 1, column 1 (the start of the comment), so the editor marks the wrong place. Without a leading comment the position is correct (for example after a BOM and blank CRLF lines).

Severity:

Low. The error is still raised, but the editor marks the wrong position. A query bar text such as `// active users\n[...]` is a realistic input.

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### Observations (no failing test; the requirement does not define the behavior, the parent decides)

- OBS-1: An error message for an unexpected astral character contains a lone surrogate. For example `{ a: 😀 }` gives `Unexpected "\ud83d"` (shown as a replacement character). `describe()` in `syntax.ts` uses `text.slice(at, at + 1)`. The position is correct; only the message text is affected.
- OBS-2: `Date("2024-01-01")` without `new` is read as a Date. In JavaScript and mongosh, `Date(…)` without `new` returns a string. This is probably intended (treat it like `new Date`), but it is not recorded as an assumption.
- OBS-3: `+5n` is accepted as NumberLong 5. In JavaScript, unary `+` on a BigInt throws a TypeError. This is harmless.
- OBS-4: `\u{…}` accepts at most 8 hex digits, so `\u{000000041}` is refused, although JavaScript allows any number of leading zeros. This is harmless.
- OBS-5: The parser treats U+2028/U+2029 as line terminators (comments, strings, regex), but `positionAt` counts only `\n`, `\r\n` and `\r` as line breaks, as its doc comment says. Whether this matches the editor's line model depends on the editor component (CodeMirror splits on U+2028 by default, Monaco does not). I did not assert either behavior.

## Coverage

Status: verified for the passing test selection. I measured with every test except TW-1 and TW-2, because Vitest writes no coverage report when a test fails. The coverage command with all tests exits nonzero and produced no report. The two excluded tests only call `Double(…)`, `NumberDecimal(…)` and `parseShellSyntaxDocument`, and the selected tests already execute those paths.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured as a separate metric. Every `shellsyntax/*.ts` file is new in this task, so whole-file coverage equals changed-line coverage for them. The only changed line in `src/index.ts` is `export * from './shellsyntax'`, which v8 does not count as a statement (see the gap table).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `shell-syntax`; base `7f8c1178a032046ea84f563dc1e2487ecd45e5c6` (from the parent); HEAD `b748d7ac9924d7e6d8a6a4fb75ceab94d05e3928`; task-owned commit `b748d7a` (the only commit in `git log 7f8c117..HEAD`); file scope from `git diff --stat 7f8c117..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD `b748d7a` plus the uncommitted `shellsyntax.edge.spec.ts`. sha256 values, identical before and after the final run: errors.ts `9caf5050532b1a9a5436ae416a9649be22b033eefbeff13fad5e5d6cae400657`, index.ts `e57d2541ef197b950fecbbe3d1d9de6d830cc4e05df4b23e2c5a449a012659f5`, print.ts `afccd3f80230c6c6b317c70b29fbcc366ddb0067fac1cef232120166f913c014`, syntax.ts `e570c6f3bba9ecee8fa7254a459cdf39339fe28f02583442d63aae6dd53e377c`, value.ts `c30c74944f30906e82a2c3011dceaac450030757dd88f1eac43b6010e5de11ed`, src/index.ts `b17d6851b66eb5b8ea90a401e5477a9e213711a4c5cc671ffdc63d2885fedc11`, shellsyntax.spec.ts `faf8a5606265f10f3595cd65e5747ff9ea9520705ea29fc08ac12cf174924c49`, shellsyntax.edge.spec.ts `aa8747c0118b30a6fcf00797afb3c7d56035e2245a83a195574ed7de84d91e0d`.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/shellsyntax/{errors,index,print,syntax,value}.ts` and `src/index.ts`. Excluded: `*.spec.ts` (tests) and `docs/ARCHITECTURE.md` (docs). No files were renamed or deleted.
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with `@vitest/coverage-v8`. Working directory `packages/core`. Command: `npx vitest run src/shellsyntax -t '^(?![\s\S]*TW-)' --coverage --coverage.include='src/shellsyntax/*.ts' --coverage.include='src/index.ts' --coverage.exclude='**/*.spec.ts' --coverage.reportsDirectory=coverage/tw-shellsyntax-final --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text`. Test selection: both shellsyntax spec files, 348 tests run, 2 skipped by the name filter (TW-1, TW-2). An earlier filter, `^(?!.*TW-).*$`, wrongly skipped 11 tests whose names contain line terminators, so I did not use that run.
- Run start/completion time and exit status: started 20:03:36 local (2026-11-16), duration 456 ms, all selected tests passed (348 passed, 2 skipped), exit 0. Earlier runs, for the record: the baseline before the new tests (`coverage/tw-shellsyntax-baseline`, 136 tests) had syntax.ts 94.78% statements and value.ts 87.96% branches. The run with all tests (`coverage/tw-shellsyntax-1`) failed on TW-1 and TW-2 and wrote no report.
- Generated report paths and report hashes/run identifier: `packages/core/coverage/tw-shellsyntax-final/coverage-summary.json` sha256 `12a814b9f2e7d9c1109ff2057a2697eeef825f71a1e85878f33e3f59719f4f53`; `packages/core/coverage/tw-shellsyntax-final/coverage-final.json` sha256 `dd43cdf21dfbe21b2d1eae4d5e85775222294b38d4947168e839a72bcb6562ae` (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: `coverage/tw-shellsyntax-final` is a new directory created by this run (both files have the run's timestamp, 20:03:36). The source and test hashes were taken before and after the run and match.
- Final run after latest test additions and production fixes: yes, after the last test additions. No production fix was made, because TW-1 and TW-2 are still open. Once they are fixed, the coverage must be measured again.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/core/src/shellsyntax/errors.ts` | 16/16 (100%) | 5/5 (100%) | 2/2 (100%) | 15/15 (100%) |
| `packages/core/src/shellsyntax/index.ts` | 6/6 (100%) | 2/2 (100%) | 2/2 (100%) | 6/6 (100%) |
| `packages/core/src/shellsyntax/print.ts` | 54/54 (100%) | 52/52 (100%) | 12/12 (100%) | 50/50 (100%) |
| `packages/core/src/shellsyntax/syntax.ts` | 307/307 (100%) | 212/212 (100%) | 17/17 (100%) | 271/271 (100%) |
| `packages/core/src/shellsyntax/value.ts` | 203/203 (100%) | 124/133 (93.23%) | 41/41 (100%) | 175/175 (100%) |
| `packages/core/src/index.ts` | 0/1 (0%) | N/A (0/0) | N/A (0/0) | 0/1 (0%) |
| Aggregate (summed counters, all 6 files measured, none missing or excluded) | 586/587 (99.83%) | 395/404 (97.77%) | 74/74 (100%) | 517/518 (99.81%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `value.ts:54` (two `node.exact ?? 0n` arms) and `value.ts:80` (`node.exact ?? 0n`) | None. A BigInt number node always has `exact` set (`syntax.ts` `parseNumber` refuses non-integer BigInts). | Justified gap: unreachable defensive fallback |
| `value.ts:126` (`call.kind === 'call' ? … : 'value'`, else arm) | None. `args()` is only called with call nodes. | Justified gap: unreachable defensive fallback |
| `value.ts:137, 149, 161, 167, 173` (`node ?? call` arms in `stringArg`, `objectIdHex`, `base64Binary`, `hexBinary`, `subtypeArg`-related) | None. The argument count is checked before each call, so the node is never undefined. | Justified gap: unreachable defensive fallback |
| `src/index.ts:2` (`export const WORKSPACE = …`) | Not task code: a pre-existing line that no shellsyntax test loads. The task's added `export * from './shellsyntax'` has no v8 statement. Static check: `npm run typecheck` passes, so the re-export does not clash. | Justified gap: outside the task's executable changes |
| Closed in this pass: `syntax.ts:220` (`"\0` at the end of input), `value.ts:216` (`NumberDecimal(-Infinity)`), `value.ts:272-273` (`Timestamp(5)`), `value.ts:285` (`RegExp("…")` without flags) | Error/edge paths of the goal's constructors and escapes | Tests added: `rejects "\"\\0"`, the `NumberDecimal(-Infinity)` assertion, `refuses a single Timestamp argument that is not a document`, `reads RegExp(pattern) without flags` |

## Unable to test

- The raw editor and query bar that display these positions are not part of this task (no UI in scope). I verified AC3 at the API level only (`line`, `column`, `offset`, and the message suffix). It needs follow-up in the editor/query-bar tasks, including the line model for U+2028 (OBS-5).
- With TW-1 and TW-2 failing, a coverage run of the full test selection is not possible. Vitest writes no report on failure, so I used the filtered run described above.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion. I added 214 edge-case tests in `shellsyntax.edge.spec.ts`; 212 pass. AC1 (refusal of code with a position) and AC2 (round trip of a 30+ corpus) are well covered and pass. Two Low-severity defects fail and block `.taskcheck`:
- TW-1: `Double(Infinity)`, `Double(NaN)` and `NumberDecimal(Infinity)` are refused.
- TW-2: `parseShellSyntaxDocument` reports line 1, column 1 instead of the value's position when the text starts with a comment (part of AC3).

Task-scoped coverage: 100% of statements, lines and functions in the `shellsyntax` files. Branches are 395/404 overall; the 9 uncovered branches are unreachable defensive fallbacks in `value.ts`.
