# Fix Report

Date: 2026-11-16

Task: shell-syntax - Core: shell syntax ⇄ EJSON (safe parser and printer)

Scope: current task; findings CR-1 and CR-2 from `reviews/shell-syntax/review.md`, TW-1 and TW-2 from `reviews/shell-syntax/tests.md` (base 7f8c117, reviewed HEAD 2b448fa). Changes are limited to `packages/core/src/shellsyntax`.

## Fixed findings

### CR-1 — Regex literals printed for patterns mongosh cannot parse

Files changed:
- `packages/core/src/shellsyntax/print.ts`
- `packages/core/src/shellsyntax/shellsyntax.edge.spec.ts`

Problem:
The printer chose the `/pattern/flags` literal form for PCRE-only patterns (`(?i)a`, `a++`, `(?>a)`, `\-` with option `u`) that are a `SyntaxError` in JS, so the printed text could not be pasted into mongosh.

Fix:
The literal form now additionally requires `new RegExp(pattern, options)` to compile (`compilesInJs`, inside `try`/`catch`). Compiling does not execute the pattern against any input and no `eval` is used. Otherwise `BSONRegExp("…", "…")` is printed. Added 5 rows to the edge spec's "regex literal or BSONRegExp" table (`(?i)a`, `a++`, `(?>a)` with `i`, `a\-` with `u` print as `BSONRegExp`; `a\-` without `u` stays a literal), each round-tripped.

Validation:
- `cd packages/core && npx vitest run src/shellsyntax` — Pass

### CR-2 / TW-2 — `parseShellSyntaxDocument` error points at a leading comment instead of the value

Files changed:
- `packages/core/src/shellsyntax/index.ts`

Problem:
The "Expected a document" position was computed with `trimStart()`, which skips white space but not comments, so `// filter\n [1]` reported line 1, column 1.

Fix:
`parseShellSyntaxDocument` now calls `parseSyntax`, converts with `toBsonValue`, and throws at the root syntax node's `pos`. The existing edge test "parseShellSyntaxDocument points at the value after a leading comment (TW-2)" covers it; the BOM/blank-lines test still passes.

Validation:
- `cd packages/core && npx vitest run src/shellsyntax` — Pass

### TW-1 — `Double(Infinity)`, `Double(NaN)`, `NumberDecimal(Infinity)`, `NumberDecimal(NaN)` refused

Files changed:
- `packages/core/src/shellsyntax/value.ts`
- `packages/core/src/shellsyntax/shellsyntax.edge.spec.ts`

Problem:
Bare `Infinity` and `NaN` parse as `word` nodes, so the Double and Decimal constructors (which accepted only number or string nodes) refused them while `-Infinity` (a number node) was accepted.

Fix:
Added `nonFiniteWord(node)` in `value.ts`, used by the `Double` and `NumberDecimal`/`Decimal128` constructors to accept bare `Infinity`/`NaN`. Integer arguments (`NumberLong`, `NumberInt`, `Date`, `Timestamp`, binary subtypes) still refuse them. Extended the TW-1 edge test with `NumberDecimal(NaN)` and `Decimal128(Infinity)`, and added a test that `NumberLong(Infinity)` and `NumberInt(NaN)` are still refused at the argument's position.

Validation:
- `cd packages/core && npx vitest run src/shellsyntax` — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/core && npx vitest run src/shellsyntax` — Pass: 2 files, 356 tests passed (previously 350 tests, 2 failing)

Full test suite:
- `npm run check` (repo root) — Pass: workspaces 26 files / 1725 tests passed; renderer 5 files / 181 tests passed

Lint/type-check/build:
- `npm run check` runs `eslint . --max-warnings 0`, `prettier --check .` and the type check — Pass (after `npx prettier --write` on `value.ts`)

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check`, which passed as above)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
