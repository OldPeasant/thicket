# Fix Report

Date: 2026-11-16

Task: bson-model - Core: BSON value model with lossless EJSON round trip

Scope: current task. Findings from `reviews/bson-model/review.md` (CR-1..CR-5) and `reviews/bson-model/tests.md` (TW-1, OBS-1..OBS-3), on top of HEAD 97f86dd. Changes are limited to `packages/core/src/bson`.

## Fixed findings

### TW-1 / CR-1 — Decimal128 integers with trailing fractional zeros cannot convert to Int32/Int64

Files changed:
- `packages/core/src/bson/convert.ts`
- `packages/core/src/bson/convert.spec.ts`

Problem:
`decimalInteger` required an `E` exponent, so canonical Decimal128 strings like `1200.0`, `-7.00` and `100.00` failed with "not an integer" even though their values are exact integers.

Fix:
The exponent is now optional in the `decimalInteger` regex (it defaults to `0`). The existing divisibility check still rejects real fractions such as `7.50` and `-0.5`. The test-writer's failing test is kept unchanged. Cases for `100.00`, `2.0` and `-0.5` were added.

Validation:
- `cd packages/core && npx vitest run src/bson` — Pass

### CR-2 — String → Double overflow to Infinity; Regex → String drops options

Files changed:
- `packages/core/src/bson/convert.ts`
- `packages/core/src/bson/convert.spec.ts`

Problem:
`"1e400"` was converted to `Infinity` without an error. A regex with options was converted to its pattern, and the options were silently lost. Both break the module's contract that a conversion "never silently truncates or overflows" and SPEC's "overflow is an error".

Fix:
The String → Double branch now returns explicit `Infinity`/`-Infinity`/`+Infinity`/`NaN` text as before. For any other numeric text it fails with `overflows Double` when the result is not finite. Regex → String fails with `the options "<opts>" would be lost` when `options` is non-empty, and still returns the pattern when options are empty. The existing assertion at `convert.spec.ts` "→ string", which expected `/a+/i` → `"a+"`, encoded the silent loss that CR-2 rejects. It now checks that an empty-options regex converts and an `i` regex fails. Added a test with `1e400`, `-1e400`, `Infinity`, `NaN` and the largest double.

Validation:
- `cd packages/core && npx vitest run src/bson` — Pass

### CR-3 / OBS-2 — getAt throws for negative or fractional array indexes

Files changed:
- `packages/core/src/bson/path.ts`
- `packages/core/src/bson/path.spec.ts`

Problem:
`getAt(root, ['a','b',-1])` and `[..., 1.5]` threw `BsonModelError` from `indexIn`. Every other missing or mistyped segment returns `undefined`.

Fix:
`getAt` now treats an array segment that is not a non-negative integer as mistyped and returns `undefined` before it calls `indexIn`. Write operations still throw, as before. Added a test.

Validation:
- `cd packages/core && npx vitest run src/bson` — Pass

### CR-4 — Binary base64 not stored canonically

Files changed:
- `packages/core/src/bson/ejson.ts`
- `packages/core/src/bson/ejson.spec.ts`

Problem:
`binary()` stored the base64 text exactly as received, so `AB==` stayed `AB==`. bson writes `AA==` for the same bytes, and two equal values could have different model representations.

Fix:
`binary()` stores `bytesToBase64(base64ToBytes(base64))`. This applies to both the canonical `$binary` form and the legacy `$binary`/`$type` form (`$uuid` was already canonical). Added tests that compare `stringifyEJson(parseEJson(...))` with bson's `EJSON.stringify(EJSON.parse(...))` canonical output for `AB==`, `AAB=`, `AQIDBA==`, `AQIDBAU=` and empty input, plus a legacy-form test.

Validation:
- `cd packages/core && npx vitest run src/bson` — Pass

### OBS-3 — Binary subtype 4 with a wrong length converts to UUID unchanged

Files changed:
- `packages/core/src/bson/convert.ts`
- `packages/core/src/bson/convert.spec.ts`

Problem:
`toUuidBase64` returned a subtype-4 binary without checking its length.

Fix:
Removed the subtype-4 shortcut, so every binary source now gets the 16-byte check (`a UUID has 16 bytes`). Valid 16-byte subtype-4 values still convert to themselves (existing test). Added a test for `bin(4, 'AQID')`.

Validation:
- `cd packages/core && npx vitest run src/bson` — Pass

### OBS-1 — Date → String → Date does not round-trip outside years 0000-9999

Files changed:
- `packages/core/src/bson/iso-date.ts`
- `packages/core/src/bson/iso-date.spec.ts`
- `packages/core/src/bson/convert.spec.ts`

Problem:
`formatIsoDate` writes extended years (`+010000-…`, `-000001-…`) like `Date.prototype.toISOString`, but `parseIsoDate` only accepted 4-digit years.

Fix:
The ISO year group now also accepts the extended form `[+-]\d{6}`. `-000000` is rejected, as ISO 8601 and JS `Date.parse` do. Years beyond the JS date range fail through the existing calendar-validity check. Tests added: parse cases for `+010000`, `-000001`, `+000000` and the JS maximum `+275760-09-13`. Rejections for `-000000`, 5-digit years with and without a sign, and one millisecond past the JS maximum. A convert round-trip test (Date → String → Date) for years 10000, -1 and both JS limits.

Validation:
- `cd packages/core && npx vitest run src/bson` — Pass

## Not fixed

### CR-5 — Model constructors and JSON nesting limit untested

Status:
Invalid

Reason:
Already resolved by the test-writer's committed `model.spec.ts` and `json-tree.spec.ts`: model.ts and json-tree.ts are at 100% branch coverage per `reviews/bson-model/tests.md`. No change needed.

## Validation summary

Focused tests:
- `cd packages/core && npx vitest run src/bson` — Pass (7 files, 204 tests)
- `cd packages/core && npx vitest run --coverage --coverage.include='src/bson/convert.ts' --coverage.include='src/bson/iso-date.ts' --coverage.include='src/bson/ejson.ts' --coverage.reporter=json-summary --coverage.reportsDirectory=coverage/fixer` — Pass. Branches: convert.ts 148/148 (100%), iso-date.ts 26/26 (100%), ejson.ts 164/164 (100%).
- `cd packages/core && npx vitest run --coverage --coverage.include='src/bson/**'` — Pass. The only uncovered branch in scope is path.ts:43, the unreachable defensive arm the test-writer already documented.

Full test suite:
- `npx vitest run --project core` (repo root) — Pass (7 files, 204 tests)
- `npm run check` (repo root) — Pass (exit 0). Lint and type check are clean. Vitest: 11 files / 802 tests and renderer 5 files / 181 tests, all passed.

Lint/type-check/build:
- `npx eslint packages/core --max-warnings 0` — Pass (no output)
- `npx prettier --check packages/core` — Pass
- `npm run typecheck -w packages/core` — Pass

`.taskcheck`:
- Not run directly: running `bash .taskcheck` needed an approval that was not granted in this session. Its contents (`npm run check` when package.json exists) were run directly and passed.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
