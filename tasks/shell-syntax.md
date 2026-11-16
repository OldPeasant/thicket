---
title: Core: shell syntax ⇄ EJSON (safe parser and printer)
status: in_progress
owner: dell26/agent-3
deps: [bson-model]
touches: [packages/core/src/shellsyntax]
prio: 1
lease_until: 2026-11-16T19:28:26Z
---
## Goal
Parse mongosh-style literals (`ObjectId("…")`, `ISODate`, `NumberLong`, `NumberDecimal`, `UUID`, `BinData`, `Timestamp`, regex literals, unquoted keys) into the BSON model without eval, and print the model back in that syntax with stable formatting.

## Acceptance criteria
- [x] Parser rejects code (`function`, calls other than the known constructors, `this`) with a position (tests)
  - verified (2026-11-16 20:12+0100 by dell26/agent-3): npx vitest run src/shellsyntax (packages/core) -> 390 passed; 'refuses code with a position' suite (function, this, eval, unknown calls, arrows, operators, property access, spread, methods, template literals...) asserts message + line/column
- [x] print(parse(x)) round-trips for a corpus of 30+ queries/documents (test)
  - verified (2026-11-16 20:12+0100 by dell26/agent-3): npx vitest run src/shellsyntax -> passed: printShellSyntax(parseShellSyntax(x)) === x for a 34-entry corpus of queries/documents/pipelines, plus 9 normalized variants and an every-BSON-type EJSON->shell->model round trip (single-line and indented)
- [x] Errors carry line/column for the raw editor and query bar
  - verified (2026-11-16 20:12+0100 by dell26/agent-3): npx vitest run src/shellsyntax -> passed: every error is ShellSyntaxError with offset/line/column (1-based, CRLF/CR aware), message ends '(line L, column C)'; ~60 invalid-input cases assert exact line/column incl. multi-line documents

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 19:50+0100 by dell26/agent-3): Own recursive-descent parser in packages/core/src/shellsyntax instead of ejson-shell-parser (named in ARCHITECTURE): that library goes through JS objects (loses repeated keys, reorders integer-like keys, loses Int64 precision) and its acorn errors don't map to our model; ours yields the BsonValue model directly with line/column errors
- ASSUMPTION (2026-11-16 19:50+0100 by dell26/agent-3): Number literals follow mongosh: integer in int32 range -> Int32, anything else (fraction, exponent beyond int32, -0) -> Double; printer writes integral doubles in int32 range as Double(n). Timestamp(a, b) is read as legacy shell Timestamp(t, i); printer writes Timestamp({ t, i }). Printer style: double quotes, ObjectId/ISODate/NumberLong/NumberDecimal/UUID/BinData/BSONRegExp/Code/BSONSymbol/DBPointer/MinKey()/MaxKey(), regex literal when options are within imsu
- ASSUMPTION (2026-11-16 19:50+0100 by dell26/agent-3): Regex literal flags g, y, d, v are rejected (MongoDB has no such options) instead of being silently dropped; regex patterns are not validated (MongoDB uses PCRE, not JS RegExp)
