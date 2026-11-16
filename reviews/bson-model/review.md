# Code Review

Date: 2026-11-16

Task: bson-model - Core: BSON value model with lossless EJSON round trip

Scope: final revision of the task. The parent asked for the committed diff from `git merge-base HEAD origin/main` to HEAD `e5ddbe41165a2efc285ca1bbfdeb61b4f624a630`, limited to `packages/core` and `package-lock.json`. That covers the BSON model, EJSON, conversions and path API (`e6a1a96`), the test-writer's tests and reports (`efe5a9c`), and the fixes for CR-1..CR-4 and TW-1/OBS-1..3 (`e5ddbe4`). Uncommitted spec changes from the concurrently running test-writer are not part of this scope.

Requirements:
- tasks/bson-model.md acceptance criteria and recorded assumptions
- SPEC.md "Documents and BSON"
- docs/ARCHITECTURE.md (packages/core is pure TS with no Node/Electron APIs, strict TS, no `any` in core)
- AGENTS.md
- MongoDB Extended JSON v2 specification (canonical format), with `bson` 7.3.4 as the reference output
- reviews/bson-model/fixes.md and reviews/bson-model/tests.md (the claimed fixes I checked)

Git range:
- Branch: main
- HEAD: e5ddbe41165a2efc285ca1bbfdeb61b4f624a630
- Base/start: `git merge-base HEAD origin/main`, as the parent specified. The session's git log snapshot shows the task commits on top of `ce1963a`.
- Commits reviewed: 3 (e6a1a96, efe5a9c, e5ddbe4)

Limitation of this pass: shell access (Bash) was denied in this session, so I could not run `git diff`, `git merge-base`, vitest or coverage myself. This pass reads the committed files at HEAD in full: model.ts, json-tree.ts, ejson.ts, iso-date.ts, convert.ts, path.ts, src/index.ts, package.json, convert.spec.ts and the ejson.spec.ts fixture. I did not re-read the package-lock.json diff. package.json declares only `bson ^7.3.4` as a runtime dependency, which matches the first review and docs/ARCHITECTURE.md. The test results quoted below come from fixes.md and tests.md, not from my own runs.

Summary: 0 P0, 0 P1, 0 P2, 0 P3 open (5 P3 from the first review: 4 fixed, 1 resolved by the test-writer's committed tests)

Acceptance criteria assessment (final revision):
1. Round trip: met. The ejson.spec.ts fixture covers every BSON type, including the deprecated ones (Undefined, Symbol, DBPointer, CodeWScope), Binary subtypes 00-09 and 80, UUID, -0, NaN/±Infinity, Int64 above 2^53, the int64 limits, Decimal128 max/NaN/-0 and dates outside the JS Date range. A byte-identical round trip and a per-leaf comparison against bson's canonical EJSON check it. The CR-4 change (base64 re-encoding) does not affect the fixture, which already uses canonical base64.
2. Field order: met. Integer-like keys, `$`-prefixed keys, `__proto__` and repeated keys are preserved (json-tree.ts keeps entries as an array, and ejson.ts `toDocument` maps them in order).
3. Conversion table: met. convert.spec.ts "table from the acceptance criteria" covers every named pair with valid and invalid cases.
4. Path API with tests, and 100% branch coverage on conversions: met. The fixer reports convert.ts at 148/148 branches after the fixes (fixes.md). I did not re-measure this myself because of the limitation above.

Canonical EJSON v2 conformance: the encoder writes the canonical wrappers in spec key order. Doubles go through bson's `Double` canonical format, Decimal128 through bson's `toString`, binary subtypes are two hex digits, regex options are sorted, and dates are always `{"$numberLong":...}`. CR-4 is now fixed, so binary payloads are canonical base64 as well.

Renderer safety: no `Buffer`, `node:` imports or Node globals in packages/core/src/bson. Base64 is hand-rolled (ejson.ts:340-378), and `bson` is the only runtime import. Error messages include only user-supplied values and are plain strings (no HTML).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [x] **CR-1 | Decimal128 integers written with a fractional zero (e.g. "2.0") cannot be converted to Int32/Int64**: Fixed
    - File: `packages/core/src/bson/convert.ts:171-183`
    - Category: Correctness
    - Problem (first review): `decimalInteger` required an `E` exponent, so bson's canonical `2.0` / `100.00` failed with "not an integer".
    - Resolution verified: the regex is now `^([+-]?)(\d+)(?:\.(\d+))?(?:E([+-]\d+))?$` with `exp = '0'` as default. The divisibility check still rejects real fractions. Tests at convert.spec.ts:247-256 cover `1200.0`, `-7.00`, `100.00` and `2.0`, and reject `7.50` and `-0.5`.

- [x] **CR-2 | String → Double converts out-of-range text to Infinity; Regex → String drops options**: Fixed
    - File: `packages/core/src/bson/convert.ts:138-140`, `convert.ts:203-210`
    - Category: Correctness
    - Problem (first review): `"1e400"` became Infinity without an error, and `/a/i` → string silently dropped `i`.
    - Resolution verified: the explicit `[+-]Infinity`/`NaN` text is still accepted. Any other non-finite result now fails with `overflows Double`. A regex with non-empty options fails with `the options "…" would be lost`. Tests are at convert.spec.ts:103-104 and 290-296.

- [x] **CR-3 | `getAt` throws instead of returning `undefined` for negative or fractional array indexes**: Fixed
    - File: `packages/core/src/bson/path.ts:46-60`
    - Category: Correctness
    - Problem (first review): `indexIn` threw for `-1` or `1.5` on arrays.
    - Resolution verified: `getAt` checks the segment type for both documents and arrays first and returns `undefined` before it calls `indexIn`. Write operations still throw. The fixer reports a test in path.spec.ts.

- [x] **CR-4 | Binary base64 is stored as received, not canonicalized**: Fixed
    - File: `packages/core/src/bson/ejson.ts:219-228`
    - Category: Correctness
    - Problem (first review): `AB==` stayed `AB==`, while bson writes `AA==`.
    - Resolution verified: `binary()` stores `bytesToBase64(base64ToBytes(base64))` after the `BASE64` validation. This covers the canonical form and the legacy `$binary`/`$type` form. `$uuid` was already canonical. Per fixes.md, tests compare the output with bson's canonical output for several padding cases.

- [x] **CR-5 | Committed tests leave the model constructors and the JSON nesting limit unexercised**: Resolved
    - File: `packages/core/src/bson/model.ts:197-209`, `packages/core/src/bson/json-tree.ts:60`
    - Category: Tests
    - Resolution: the test-writer's model.spec.ts and json-tree.spec.ts were committed in efe5a9c. tests.md reports model.ts 13/13 and json-tree.ts 35/35 branches, including the depth limit (1000 accepted, deeper rejected).

Related test-writer findings, checked in the same pass: OBS-3 is fixed (convert.ts:280-283: every binary source gets the 16-byte check, tested at convert.spec.ts:298-300). OBS-1 is fixed (iso-date.ts:3-4,17: extended years `[+-]\d{6}` are accepted and `-000000` is rejected; Date → String → Date round-trips at the JS date limits, tested at convert.spec.ts:277-288).

No new findings in the final revision. Reading the fix commit found no regression: the changed branches keep the old behavior for valid inputs, and the round-trip fixture and conversion table are unchanged except for the regex → string assertion, which CR-2 required to change.

## Review conclusion

No material issues found. All four acceptance criteria are met by the final revision, and CR-1..CR-5 are resolved. This conclusion rests on reading the code at HEAD e5ddbe4. I could not run git, the tests or coverage in this session, so the parent must keep its own `npm run check` and coverage results as the executed evidence.
