# Code Review

Date: 2026-11-16

Task: bson-model - Core: BSON value model with lossless EJSON round trip

Final reviewed revision: baf3ba3dd760f22a26766a1bc2cf68c6162968f4 (rebased; the code was reviewed at d0474169113d4dd0a199c67bedfc9dc811b0e5e5, see "Rebase pass")

Scope: final revision of the task. The parent asked for the committed diff from `git merge-base HEAD origin/main` to HEAD, limited to `packages/core` and `package-lock.json`. That covers the BSON model, EJSON, conversions and path API (`e6a1a96`), the test-writer's tests and reports (`efe5a9c`), the fixes for CR-1..CR-4 and TW-1/OBS-1..3 (`e5ddbe4`), and the test-writer's follow-up spec-only commit (`d047416`). The production code was reviewed at `e5ddbe4` (first section below). The delta `e5ddbe4..d047416` was reviewed in a second pass (section "Delta pass").

Requirements:
- tasks/bson-model.md acceptance criteria and recorded assumptions
- SPEC.md "Documents and BSON"
- docs/ARCHITECTURE.md (packages/core is pure TS with no Node/Electron APIs, strict TS, no `any` in core)
- AGENTS.md
- MongoDB Extended JSON v2 specification (canonical format), with `bson` 7.3.4 as the reference output
- reviews/bson-model/fixes.md and reviews/bson-model/tests.md (the claimed fixes I checked)

Git range:
- Branch: main
- HEAD: baf3ba3dd760f22a26766a1bc2cf68c6162968f4 (before the rebase: d0474169113d4dd0a199c67bedfc9dc811b0e5e5)
- Base/start: 2ad72d2d5d76b68f3f9d834418ad86e4e37d3cf0 after the rebase (before it: `ce1963a`)
- Commits reviewed: 5 after the rebase (fe32363, 7dac9bd, c510559, 668c57b, baf3ba3); before it 4 (e6a1a96, efe5a9c, e5ddbe4, d047416)

Limitation of the first pass (at e5ddbe4): shell access was denied in that session, so I could not run `git diff`, `git merge-base`, vitest or coverage. That pass read the committed files at e5ddbe4 in full: model.ts, json-tree.ts, ejson.ts, iso-date.ts, convert.ts, path.ts, src/index.ts, package.json, convert.spec.ts and the ejson.spec.ts fixture. I did not re-read the package-lock.json diff. package.json declares only `bson ^7.3.4` as a runtime dependency, which matches the first review and docs/ARCHITECTURE.md. The delta pass had shell access; see below for what I ran.

Summary: 0 P0, 0 P1, 0 P2, 0 P3 open (5 P3 from the first review: 4 fixed, 1 resolved by the test-writer's committed tests; the delta pass found nothing new)

Acceptance criteria assessment (final revision):
1. Round trip: met. The ejson.spec.ts fixture covers every BSON type, including the deprecated ones (Undefined, Symbol, DBPointer, CodeWScope), Binary subtypes 00-09 and 80, UUID, -0, NaN/±Infinity, Int64 above 2^53, the int64 limits, Decimal128 max/NaN/-0 and dates outside the JS Date range. A byte-identical round trip and a per-leaf comparison against bson's canonical EJSON check it. The CR-4 change (base64 re-encoding) does not affect the fixture, which already uses canonical base64.
2. Field order: met. Integer-like keys, `$`-prefixed keys, `__proto__` and repeated keys are preserved (json-tree.ts keeps entries as an array, and ejson.ts `toDocument` maps them in order).
3. Conversion table: met. convert.spec.ts "table from the acceptance criteria" covers every named pair with valid and invalid cases.
4. Path API with tests, and 100% branch coverage on conversions: met. The fixer reports convert.ts at 148/148 branches after the fixes (fixes.md), and tests.md reports the coverage run at the final revision. I did not re-measure coverage myself.

Canonical EJSON v2 conformance: the encoder writes the canonical wrappers in spec key order. Doubles go through bson's `Double` canonical format, Decimal128 through bson's `toString`, binary subtypes are two hex digits, regex options are sorted, and dates are always `{"$numberLong":...}`. CR-4 is now fixed, so binary payloads are canonical base64 as well.

Renderer safety: no `Buffer`, `node:` imports or Node globals in packages/core/src/bson. Base64 is hand-rolled (ejson.ts:340-378), and `bson` is the only runtime import. Error messages include only user-supplied values and are plain strings (no HTML).

## Delta pass (e5ddbe4..d047416)

Commands run (repo root):
- `git diff e5ddbe4 d047416 -- packages`: only `packages/core/src/bson/convert.spec.ts` (+46), `iso-date.spec.ts` (+10) and `path.spec.ts` (+4) changed.
- `git diff --quiet e5ddbe4 d047416 -- packages ':(exclude)*.spec.ts' package-lock.json package.json`: exit 0. No production code, package.json or lockfile changed in the delta. The production code at the final revision is therefore the code reviewed at e5ddbe4.
- `npx vitest run --project core`: 7 files, 219 tests passed.

Test correctness and quality of the added specs:
- convert.spec.ts: the new Decimal128 cases check the Int32/Int64 range limits with fractional zeros (`2147483647.0`, `-2147483648.00`, `-9223372036854775808.0`, and the overflow just past each limit), `-0.0` → Int32 `0` (vitest `toEqual` distinguishes -0, so this pins +0), and `1200.01` still rejected. The TW-1 regression test goes through `parseEJson`, so it exercises the real normalized form (`12000E-1` → `1200.0`), not a hand-built value. The String → Double cases pin the trimmed specials, padded overflow (`" 2e308 "` keeps the original text in the message) and case-sensitive `nan` rejection. Regex → String covers a multi-option set and the empty pattern. The Binary UUID cases cover the 0-byte and 17-byte lengths and the non-canonical base64 padding bits (`...Dh==` → `...Dg==`), checked against the shared `UUID`/`UUID_B64` constants at convert.spec.ts:16-17. All assertions check behavior through the public `convert`/`parseEJson` API.
- iso-date.spec.ts: the added accepted/rejected pairs sit exactly on the extended-year and JS Date limits (`+010000-01-01` with and without an offset, `-271821-04-20` vs one millisecond earlier), plus `0000` and malformed year widths (`+0010000`, unsigned `010000`, `-000000`) and an invalid day (`+010000-02-30`). The expected millisecond values are correct (253402300800000 = 10000-01-01Z; -8.64e15 = the JS Date minimum).
- path.spec.ts: NaN, Infinity and -0 indexes. `-0` addressing element 0 is consistent with `Number.isInteger(-0)`. The `[-0, 'nope']` line asserts a descent into an Int32 leaf, which is already covered by the "mistyped segments" test; it is redundant but harmless.

No findings in the delta.

OBS-4 (String/Decimal → Double underflow, e.g. `"1e-400"` → 0): I agree with the test-writer that this is not a defect in the current scope. The recorded task assumption (tasks/bson-model.md, 19:31) says lossy conversions are errors "except Decimal->Double which rounds like Number()", and a value too small for a double rounding to 0 or to a subnormal is the same kind of precision loss as `0.1` rounding. CR-2 was about overflow to Infinity, which changes the value class, not about rounding. Rejecting underflow would also make the String → Double rule inconsistent with Decimal → Double. If a human later wants "non-zero must not become zero", that is a product decision for the assumption, not a fix for this task. A test pinning the current behavior would be optional documentation, not a required gap.

## Rebase pass (d047416 -> baf3ba3, base 2ad72d2)

The branch was rebased onto main, which now contains the `uri-model` task (packages/core/src/uri, dependency `mongodb-connection-string-url`). Conflicts in packages/core/package.json, packages/core/src/index.ts and package-lock.json were resolved by keeping both sides. Commands run (repo root, HEAD = baf3ba3):
- `git diff d047416 baf3ba3 -- packages/core/src/bson`: empty. The BSON code and specs are byte-identical to the reviewed revision.
- `git diff --stat 2ad72d2 baf3ba3 -- . ':(exclude)reviews' ':(exclude)tasks'`: besides packages/core/src/bson, only package-lock.json (2 lines), packages/core/package.json (+1) and packages/core/src/index.ts (+1/-1 comment, +1 export) change.
- packages/core/package.json: `dependencies` holds both `bson ^7.3.4` and `mongodb-connection-string-url ^7.0.3`.
- packages/core/src/index.ts: `export * from './bson';` and `export * from './uri';`, each once. The exported names do not clash (bson: `parseEJson`, `parseEJsonDocument`, `stringifyEJson`, `convert`, `uuidOf`, `ConversionError`, `ConversionTarget`, `parseIsoDate`, `formatIsoDate` and the model/path/json-tree exports; uri: `ConnectionStringError`, `parseConnectionString`, `toConnectionString`, `MASK`, `mask`, `maskText` and the model types). TypeScript would report a conflicting `export *` name as TS2308, and the typecheck passes.
- package-lock.json vs base: the `packages/core` entry lists `bson ^7.3.4` and `mongodb-connection-string-url ^7.0.3`, and `node_modules/bson` (7.3.4) is no longer flagged `"dev": true`. That is right now that it is a runtime dependency of core. `node_modules/mongodb-connection-string-url` is present. No other lock changes.
- `npm run typecheck -w packages/core`: passes (tsc, no errors).
- `npx vitest run --project core`: 9 files, 532 tests passed. That is the bson specs plus the uri specs from main.

No findings in the rebase pass.

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
    - Resolution verified: the regex is now `^([+-]?)(\d+)(?:\.(\d+))?(?:E([+-]\d+))?$` with `exp = '0'` as default. The divisibility check still rejects real fractions. Tests at convert.spec.ts:247-256 cover `1200.0`, `-7.00`, `100.00` and `2.0`, and reject `7.50` and `-0.5`. The delta adds the range-limit and EJSON-parsed cases.

- [x] **CR-2 | String → Double converts out-of-range text to Infinity; Regex → String drops options**: Fixed
    - File: `packages/core/src/bson/convert.ts:138-140`, `convert.ts:203-210`
    - Category: Correctness
    - Problem (first review): `"1e400"` became Infinity without an error, and `/a/i` → string silently dropped `i`.
    - Resolution verified: the explicit `[+-]Infinity`/`NaN` text is still accepted. Any other non-finite result now fails with `overflows Double`. A regex with non-empty options fails with `the options "…" would be lost`. Tests are at convert.spec.ts:103-104 and 290-296, extended in the delta.

- [x] **CR-3 | `getAt` throws instead of returning `undefined` for negative or fractional array indexes**: Fixed
    - File: `packages/core/src/bson/path.ts:46-60`
    - Category: Correctness
    - Problem (first review): `indexIn` threw for `-1` or `1.5` on arrays.
    - Resolution verified: `getAt` checks the segment type for both documents and arrays first and returns `undefined` before it calls `indexIn`. Write operations still throw. path.spec.ts:28-35 covers -1, 1.5, NaN, Infinity and -0.

- [x] **CR-4 | Binary base64 is stored as received, not canonicalized**: Fixed
    - File: `packages/core/src/bson/ejson.ts:219-228`
    - Category: Correctness
    - Problem (first review): `AB==` stayed `AB==`, while bson writes `AA==`.
    - Resolution verified: `binary()` stores `bytesToBase64(base64ToBytes(base64))` after the `BASE64` validation. This covers the canonical form and the legacy `$binary`/`$type` form. `$uuid` was already canonical. Tests compare the output with bson's canonical output for several padding cases, and the delta adds a parsed non-canonical UUID converting to the expected UUID text.

- [x] **CR-5 | Committed tests leave the model constructors and the JSON nesting limit unexercised**: Resolved
    - File: `packages/core/src/bson/model.ts:197-209`, `packages/core/src/bson/json-tree.ts:60`
    - Category: Tests
    - Resolution: the test-writer's model.spec.ts and json-tree.spec.ts were committed in efe5a9c. tests.md reports model.ts 13/13 and json-tree.ts 35/35 branches, including the depth limit (1000 accepted, deeper rejected).

Related test-writer findings, checked in the same pass: OBS-3 is fixed (convert.ts:280-283: every binary source gets the 16-byte check, tested at convert.spec.ts:298-300 and extended in the delta). OBS-1 is fixed (iso-date.ts:3-4,17: extended years `[+-]\d{6}` are accepted and `-000000` is rejected; Date → String → Date round-trips at the JS date limits, tested at convert.spec.ts:277-288 and in iso-date.spec.ts). OBS-4 is not a defect; see "Delta pass".

No new findings in the final revision. Reading the fix commit found no regression: the changed branches keep the old behavior for valid inputs, and the round-trip fixture and conversion table are unchanged except for the regex → string assertion, which CR-2 required to change.

## Review conclusion

No material issues found. All four acceptance criteria are met by the final revision baf3ba3dd760f22a26766a1bc2cf68c6162968f4. Its BSON code is identical to the reviewed d0474169113d4dd0a199c67bedfc9dc811b0e5e5, and the rebase conflict resolution is correct (typecheck passes, 532 core tests pass). CR-1..CR-5 are resolved. The delta e5ddbe4..d047416 changes only spec files, and the production code is identical to the code reviewed at e5ddbe4. `npx vitest run --project core` passed with 219 tests at d047416 and with 532 tests (bson + uri) at baf3ba3. I did not re-measure coverage, so the parent must keep its own `npm run check` and coverage results as the executed evidence for criterion 4.
