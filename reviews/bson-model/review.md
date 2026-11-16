# Code Review

Date: 2026-11-16

Task: bson-model - Core: BSON value model with lossless EJSON round trip

Scope: committed changes of the task, `git diff ed95d7e3c8e0c3798e189970964380e6b495cfe3..cc82bfd -- packages package-lock.json` (packages/core/src/bson/*, packages/core/src/index.ts, packages/core/package.json, package-lock.json). The parent named commit 1222614; cc82bfd (current HEAD) is the same commit rebased onto ed95d7e, and `git diff 1222614 cc82bfd -- packages/core` is empty, so the reviewed code is identical.

Requirements:
- tasks/bson-model.md acceptance criteria and recorded assumptions (`python tasks.py assumptions`)
- SPEC.md "Documents and BSON"
- docs/ARCHITECTURE.md (packages/core is pure TS with no Node/Electron APIs, strict TS, no `any` in core)
- AGENTS.md
- MongoDB Extended JSON v2 specification (canonical format), with `bson` 7.3.4 as the reference output

Git range:
- Branch: main
- HEAD: cc82bfdebffdc59efc9eb6f5feafde2267c2fae4
- Base/start: ed95d7e3c8e0c3798e189970964380e6b495cfe3
- Commits reviewed: 1 (cc82bfd, rebased equivalent of 1222614)

Uncommitted changes existed during the review (the test-writer was editing convert.spec.ts and ejson.spec.ts and adding json-tree.spec.ts and model.spec.ts). They are outside the reviewed scope.

Summary: 0 P0, 0 P1, 0 P2, 5 P3

Verification performed:
- `cd packages/core && npx vitest run --coverage --coverage.include='src/bson/**'` gave 5 files and 100 tests passed. Branch coverage: ejson.ts 98.78%, json-tree.ts 94.28%, path.ts 98.85%, model.ts 0% (lines 186-220). convert.ts and iso-date.ts were not listed with any uncovered lines.
- `node -e` against `bson` 7.3.4 showed that bson's canonical Double output matches the fixture formats (`1e+21`, `100000000000000000000.0`, `-1e-7`), `Decimal128.fromString('2.0').toString()` returns `2.0`, and bson re-encodes `{"$binary":{"base64":"AB==",...}}` as `AA==`.
- The project denied writing probe spec files, so the remaining behavior below comes from reading the exact code paths. Each one is deterministic from the regexes and branches quoted.

Acceptance criteria assessment:
1. Round trip: met. The fixture in ejson.spec.ts covers every BSON type, including the deprecated ones (Undefined, Symbol, DBPointer, CodeWScope), Binary subtypes 00-09 and 80, UUID, -0, NaN/±Infinity, Int64 values above 2^53 and the int64 limits, and dates outside the JS Date range. A byte-identical test plus a per-leaf comparison against bson's canonical output check it.
2. Field order: met. The test covers integer-like keys, `$`-prefixed keys, `__proto__` and repeated keys. Documents that only look like type wrappers stay documents.
3. Conversion table: met. Every named conversion has valid and invalid cases.
4. Path API: met. get/set/insert/remove/move (plus rename) are implemented and tested. Branch coverage of convert.ts is 100% per the coverage run.

Renderer safety: no Node globals, Buffer or `node:` imports. Base64 is hand-rolled, and `bson` is the only runtime dependency (it ships a browser build and docs/ARCHITECTURE.md lists it). The eslint `no-restricted-imports` rule for packages/core still applies.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Decimal128 integers written with a fractional zero (e.g. "2.0") cannot be converted to Int32/Int64**
    - File: `packages/core/src/bson/convert.ts:158-182`
    - Category: Correctness
    - Problem: `toInteger` accepts a decimal only when its text matches `INT_TEXT` (`^[+-]?\d+$`) or `decimalInteger`'s regex, which requires an `E` exponent. bson's canonical string for 2.0 is `2.0` (checked with `Decimal128.fromString('2.0').toString()`), so `convert({type:'decimal', value:'2.0'}, 'int')` fails with "not an integer". Meanwhile `1.0E+3`, `12000E-1` and Double `2.0` all convert.
    - Why it matters: whether an integral Decimal128 converts depends on how it happens to be printed. Users can't convert values like `NumberDecimal("100.00")` (common for money) to an integer type, even though the value is exact.
    - Suggested fix: make the exponent part of `decimalInteger`'s regex optional (`(?:E([+-]\d+))?`, default exponent 0) and add a test for `dec('2.0')` / `dec('-100.00')`.

- [ ] **CR-2 | String → Double converts out-of-range text to Infinity, against the module's "never silently overflows" contract**
    - File: `packages/core/src/bson/convert.ts:202-208`
    - Category: Correctness
    - Problem: `NUMBER_TEXT` accepts `"1e400"`, and `Number("1e400")` is `Infinity`, which is returned without a check. The Decimal → Double branch right above it does reject overflow (`overflows Double`). Regex → String (`toText`, line 138-139) also drops the regex options without an error. The module comment (line 17-18) promises a conversion "never silently truncates or overflows".
    - Why it matters: converting the text `1e400` in the type dropdown silently stores Infinity, and converting `/a/i` to a string silently loses `i`. Both go against SPEC "overflow is an error" and the documented contract.
    - Suggested fix: in the string branch, fail when the result is not finite unless the text is literally `[+-]Infinity`/`NaN`, as the decimal branch already does. For Regex → String, either fail when `options` is non-empty or document the dropped options as an intentional exception (with an assumption).

- [ ] **CR-3 | `getAt` throws instead of returning `undefined` for negative or fractional array indexes**
    - File: `packages/core/src/bson/path.ts:46-58` (via `indexIn`, line 24-33)
    - Category: Correctness
    - Problem: `getAt` returns `undefined` for every other missing or mismatched segment: wrong segment type, missing key, index beyond the length, non-container. But a number segment on an array goes to `indexIn`, which throws `BsonModelError` for `-1` or `1.5`. So `getAt(root, ['a','b',-1])` throws while `getAt(root, ['a','b',99])` returns `undefined`.
    - Why it matters: callers that treat `getAt` as a non-throwing lookup (UI path resolution, diffing) can crash on a stale or computed index.
    - Suggested fix: in `getAt`, return `undefined` when an array segment is not a non-negative integer before calling `indexIn`, and add a test for `-1` and `1.5`.

- [ ] **CR-4 | Binary base64 is stored as received, not canonicalized, although the model documents it as canonical**
    - File: `packages/core/src/bson/ejson.ts:219-223`, `packages/core/src/bson/model.ts:36-37`
    - Category: Correctness
    - Problem: `BASE64` accepts encodings with non-zero padding bits (e.g. `AB==`), and `binary()` stores the text unchanged. bson decodes and re-encodes, so its canonical output for `{"$binary":{"base64":"AB==","subType":"00"}}` is `AA==` (checked with `node -e`), while `stringifyEJson` writes back `AB==`. `BsonBinary.base64` is documented as "canonical (padded) base64".
    - Why it matters: two equal Binary values can have different model representations. That breaks structural equality, which later diff and change-count logic is likely to rely on, and output can differ from bson's canonical EJSON. Real inputs are rare (servers and drivers emit canonical base64), hence P3.
    - Suggested fix: normalize in `binary()` with `bytesToBase64(base64ToBytes(base64))`, or reject non-canonical padding bits, and add a test.

- [ ] **CR-5 | Committed tests leave the model constructors and the JSON nesting limit unexercised**
    - File: `packages/core/src/bson/model.ts:185-220`, `packages/core/src/bson/json-tree.ts:60`
    - Category: Tests
    - Problem: in the committed revision, the exported constructors `int32` (range/integer validation and -0 normalization) and `int64` (range validation) have 0% branch coverage. The `MAX_DEPTH` guard in `parseJsonTree` (the protection against stack exhaustion on hostile input) and the "unexpected token" path at json-tree.ts:120 are also uncovered.
    - Why it matters: these are public validation paths that later editing tasks will call. Untested limits regress easily. Uncommitted model.spec.ts and json-tree.spec.ts from the test-writer may already address this; if they do and get committed, this finding is resolved.
    - Suggested fix: add tests for `int32(2**31)`, `int32(1.5)`, `int32(-0)`, `int64(2n**63n)`, and a document nested more than 1000 levels deep.

## Review conclusion

No material issues found. All four acceptance criteria are met by the committed code. The P3 findings are small correctness and consistency improvements that the parent may fix or record as accepted.
